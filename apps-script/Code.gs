const CACHE_SECONDS = 21600;

function doGet() {
  return json_({ ok: true, service: 'juggler-web-api', version: 2 });
}

function doPost(e) {
  try {
    const request = JSON.parse((e.postData && e.postData.contents) || '{}');
    const props = PropertiesService.getScriptProperties();
    const expectedPin = props.getProperty('WEB_PIN');
    const folderId = props.getProperty('FOLDER_ID');

    if (!expectedPin || !folderId) throw new Error('Script Propertiesが未設定です');
    if (String(request.pin || '') !== expectedPin) {
      return json_({ ok: false, error: 'PINが違います' });
    }

    const action = String(request.action || 'summary');
    if (action === 'auth') return json_({ ok: true, data: { authenticated: true } });

    const latest = latestBackup_(folderId);

    const cache = CacheService.getScriptCache();
    const cacheKey = cacheKey_(latest, action, request);
    const cached = cache.get(cacheKey);
    if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);

    const source = JSON.parse(latest.getBlob().getDataAsString('UTF-8'));
    if (source.type !== 'history-export' || !Array.isArray(source.records)) {
      throw new Error('履歴バックアップ形式ではありません');
    }

    const output = action === 'events'
      ? convertEvents_(source, request, latest)
      : convert_(source, latest);
    const text = JSON.stringify({ ok: true, data: output });

    if (text.length < 90000) cache.put(cacheKey, text, CACHE_SECONDS);
    return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return json_({ ok: false, error: String(error.message || error) });
  }
}

function cacheKey_(file, action, request) {
  const raw = [
    action,
    request.hall || '',
    request.machine || '',
    request.number || '',
    request.date || ''
  ].join('|');
  const digest = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw)
  ).slice(0, 20);
  return 'v2-' + file.getId() + '-' + file.getLastUpdated().getTime() + '-' + digest;
}

function latestBackup_(folderId) {
  const files = DriveApp.getFolderById(folderId).getFilesByType(MimeType.PLAIN_TEXT);
  let latest = null;
  while (files.hasNext()) {
    const file = files.next();
    if (!/\.json$/i.test(file.getName())) continue;
    if (!latest || file.getLastUpdated() > latest.getLastUpdated()) latest = file;
  }
  if (!latest) {
    const all = DriveApp.getFolderById(folderId).getFiles();
    while (all.hasNext()) {
      const file = all.next();
      if (!/\.json$/i.test(file.getName())) continue;
      if (!latest || file.getLastUpdated() > latest.getLastUpdated()) latest = file;
    }
  }
  if (!latest) throw new Error('バックアップJSONが見つかりません');
  return latest;
}

function convertEvents_(source, request, file) {
  const sourceEvents = Array.isArray(source.events)
    ? source.events
    : (Array.isArray(source.bonusEvents) ? source.bonusEvents : []);
  const hall = String(request.hall || '');
  const machine = String(request.machine || '');
  const number = String(request.number || '');
  const date = String(request.date || '');

  const events = sourceEvents.map(e => ({
    date: String(e.date || e.businessDate || ''),
    hall: String(e.hall || ''),
    machine: String(e.kishu || e.machine || ''),
    number: String(e.daiban || e.number || ''),
    seq: Number(e.seq || 0),
    time: String(e.time || ''),
    gameGap: Number(e.gameGap != null ? e.gameGap : (e.gap || 0)),
    type: String(e.type || ''),
    capturedAt: Number(e.capturedAt || 0)
  })).filter(e =>
    (!hall || e.hall === hall) &&
    (!machine || e.machine === machine) &&
    (!number || e.number === number) &&
    (!date || e.date === date)
  ).sort((a, b) => a.seq - b.seq);

  return {
    schemaVersion: 6,
    generatedAt: Utilities.formatDate(file.getLastUpdated(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'),
    hall: hall,
    machine: machine,
    number: number,
    date: date,
    events: events
  };
}

function convert_(source, file) {
  const records = source.records.map(r => ({
    date: r.date,
    hall: r.hall,
    machine: r.kishu,
    number: r.daiban,
    games: Number(r.games || 0),
    big: Number(r.big || 0),
    reg: Number(r.reg || 0),
    capturedAt: Number(r.capturedAt || 0),
    lastGame: Number(r.lastGame || 0),
    maxPayout: Number(r.maxPayout || 0)
  })).sort((a, b) => b.date.localeCompare(a.date) || a.hall.localeCompare(b.hall) || String(a.number).localeCompare(String(b.number)));

  const latestDate = records.length ? records[0].date : '';
  const latestRecords = records.filter(r => r.date === latestDate && r.games >= 1000);
  const targets = latestRecords.map(r => {
    const regRate = r.reg > 0 ? r.games / r.reg : 9999;
    const score = Math.max(0, Math.min(99, Math.round(100 - Math.max(0, regRate - 220) / 3)));
    return { hall: r.hall, machine: r.machine, number: r.number, score: score, reason: 'Web暫定：最新日のREGと回転数から算出' };
  }).sort((a, b) => b.score - a.score).slice(0, 20);

  const games = records.reduce((n, r) => n + r.games, 0);
  const big = records.reduce((n, r) => n + r.big, 0);
  const reg = records.reduce((n, r) => n + r.reg, 0);
  const dates = new Set(records.map(r => r.date));

  return {
    schemaVersion: 6,
    generatedAt: Utilities.formatDate(file.getLastUpdated(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'),
    sourceFile: file.getName(),
    balances: (Array.isArray(source.balances) ? source.balances : []).map(b => ({
      hall: String(b.hall || ''),
      date: String(b.date || b.businessDate || ''),
      invest: Number(b.invest || 0),
      payout: Number(b.payout || 0),
      net: Number(b.net != null ? b.net : Number(b.payout || 0) - Number(b.invest || 0)),
      memo: String(b.memo || '')
    })),
    sourceExportedAt: source.exportedAt || 0,
    latestDate: latestDate,
    history: records,
    targets: targets,
    lab: {
      machines: new Set(records.map(r => r.hall + '|' + r.machine + '|' + r.number)).size,
      avgGames: records.length ? Math.round(games / records.length) : 0,
      setting: '-',
      rows: [
        { label: '保存日数', value: String(dates.size), note: records.length.toLocaleString() + '件' },
        { label: 'BIG合算', value: big ? '1/' + Math.round(games / big) : '-', note: '全保存データ' },
        { label: 'REG合算', value: reg ? '1/' + Math.round(games / reg) : '-', note: '全保存データ' }
      ]
    }
  };
}



function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
