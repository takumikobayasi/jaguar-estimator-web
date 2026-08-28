(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JugglerPredictionEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const VERSION = '0.2.0';
  const DAY_MS = 86400000;

  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
  const normDate = value => String(value || '').replace(/\//g, '-');
  const dayValue = value => {
    const parts = normDate(value).split('-').map(Number);
    if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return 0;
    return Math.round(Date.UTC(parts[0], parts[1] - 1, parts[2]) / DAY_MS);
  };
  const numberValue = value => {
    const number = Number(String(value ?? '').replace(/^0+/, '') || 0);
    return Number.isFinite(number) ? number : 0;
  };
  const machineKey = row => `${row.machine}|${String(row.number)}`;
  const p4FromEstimate = estimate => estimate && Array.isArray(estimate.probs)
    ? estimate.probs.slice(3).reduce((sum, value) => sum + Number(value || 0), 0)
    : null;
  const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const weightedAverage = pairs => {
    const weight = pairs.reduce((sum, pair) => sum + pair[1], 0);
    return weight ? pairs.reduce((sum, pair) => sum + pair[0] * pair[1], 0) / weight : 0;
  };
  const unique = values => [...new Set(values)];
  const dateDifference = (later, earlier) => dayValue(later) - dayValue(earlier);
  const dateWeekday = value => {
    const parts = normDate(value).split('-').map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  };

  function combination(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let value = 1;
    for (let i = 1; i <= k; i += 1) value = value * (n - k + i) / i;
    return value;
  }

  function bucketForDistance(distance) {
    if (distance == null) return 'none';
    if (distance === 0) return 'same';
    if (distance === 1) return 'next';
    if (distance === 2) return 'skip1';
    if (distance === 3) return 'skip2';
    return 'far';
  }

  function expectedNearest(origin, pool, strongCount) {
    const buckets = { same: 0, next: 0, skip1: 0, skip2: 0, far: 0, none: 0 };
    const total = pool.length;
    if (!total || !strongCount) {
      buckets.none = 1;
      return buckets;
    }
    const denominator = combination(total, strongCount);
    const distances = unique(pool.map(row => Math.abs(numberValue(row.number) - numberValue(origin.number)))).sort((a, b) => a - b);
    let closer = 0;
    distances.forEach(distance => {
      const atDistance = pool.filter(row => Math.abs(numberValue(row.number) - numberValue(origin.number)) === distance).length;
      const noCloser = combination(total - closer, strongCount) / denominator;
      const noCloserOrHere = combination(total - closer - atDistance, strongCount) / denominator;
      buckets[bucketForDistance(distance)] += Math.max(0, noCloser - noCloserOrHere);
      closer += atDistance;
    });
    return buckets;
  }

  function enrichRows(rows, estimate) {
    return rows.map(row => {
      const result = estimate([row]);
      const p4 = p4FromEstimate(result);
      return { ...row, _estimate: result, _p4: p4, _strong: p4 != null && p4 >= 0.5 };
    });
  }

  function transitionSummary(rows, targetDate, estimate) {
    const eligible = enrichRows(rows.filter(row => Number(row.games || 0) > 1000 && normDate(row.date) < targetDate), estimate)
      .filter(row => row._p4 != null);
    const byDate = new Map();
    eligible.forEach(row => {
      const date = normDate(row.date);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(row);
    });
    const dates = [...byDate.keys()].sort();
    const totals = {};
    const addModel = model => {
      if (!totals[model]) totals[model] = {
        model,
        origins: 0,
        observed: { same: 0, next: 0, skip1: 0, skip2: 0, far: 0, none: 0 },
        expected: { same: 0, next: 0, skip1: 0, skip2: 0, far: 0, none: 0 }
      };
      return totals[model];
    };

    dates.forEach(date => {
      const nextDate = new Date(date + 'T00:00:00Z');
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      const nextKey = nextDate.toISOString().slice(0, 10);
      if (!byDate.has(nextKey)) return;
      const sources = byDate.get(date).filter(row => row._strong);
      const nextRows = byDate.get(nextKey);
      sources.forEach(origin => {
        const modelRows = nextRows.filter(row => row.machine === origin.machine);
        const strongRows = modelRows.filter(row => row._strong);
        const distances = strongRows.map(row => Math.abs(numberValue(row.number) - numberValue(origin.number)));
        const distance = distances.length ? Math.min(...distances) : null;
        const bucket = bucketForDistance(distance);
        const target = addModel(origin.machine);
        target.origins += 1;
        target.observed[bucket] += 1;
        const expected = expectedNearest(origin, modelRows, strongRows.length);
        Object.keys(target.expected).forEach(key => { target.expected[key] += expected[key]; });
      });
    });

    const models = Object.values(totals).map(item => {
      const rates = {};
      Object.keys(item.observed).forEach(key => {
        rates[key] = {
          observed: item.origins ? item.observed[key] / item.origins : 0,
          expected: item.origins ? item.expected[key] / item.origins : 0
        };
      });
      return { ...item, rates };
    }).sort((a, b) => b.origins - a.origins);

    const overall = {
      origins: models.reduce((sum, item) => sum + item.origins, 0),
      observed: { same: 0, next: 0, skip1: 0, skip2: 0, far: 0, none: 0 },
      expected: { same: 0, next: 0, skip1: 0, skip2: 0, far: 0, none: 0 }
    };
    models.forEach(item => Object.keys(overall.observed).forEach(key => {
      overall.observed[key] += item.observed[key];
      overall.expected[key] += item.expected[key];
    }));
    overall.rates = {};
    Object.keys(overall.observed).forEach(key => {
      overall.rates[key] = {
        observed: overall.origins ? overall.observed[key] / overall.origins : 0,
        expected: overall.origins ? overall.expected[key] / overall.origins : 0
      };
    });
    return { overall, models };
  }

  function latestMachineMap(rows, targetDate, machines) {
    const latestByNumber = new Map();
    rows.filter(row => normDate(row.date) < targetDate).forEach(row => {
      const key = String(row.number);
      const current = latestByNumber.get(key);
      if (!current || normDate(row.date) > normDate(current.date)) latestByNumber.set(key, row);
    });
    return [...latestByNumber.values()].filter(row => machines.includes(row.machine));
  }

  function positionEvidence(machine, number, pastStrongByModel, transition) {
    const rows = pastStrongByModel.get(machine) || [];
    if (!rows.length) return { score: 50, distance: null, label: '位置実績なし', support: 0 };
    const latestDate = rows.map(row => normDate(row.date)).sort().at(-1);
    const latest = rows.filter(row => normDate(row.date) === latestDate);
    const distance = Math.min(...latest.map(row => Math.abs(numberValue(row.number) - numberValue(number))));
    const bucket = bucketForDistance(distance);
    const stats = transition.models.find(item => item.model === machine);
    const rate = stats && stats.rates[bucket];
    const support = stats ? stats.origins : 0;
    const lift = rate && rate.expected > 0 ? rate.observed / rate.expected : 1;
    const shrink = support / (support + 40);
    const score = clamp(50 + (lift - 1) * 24 * shrink, 38, 64);
    const labels = { same: '前回と同じ位置', next: '前回の隣', skip1: '前回から1台飛ばし', skip2: '前回から2台飛ばし', far: `前回から${distance}番差`, none: '位置不明' };
    return { score, distance, bucket, label: labels[bucket], support, lift };
  }

  function buildMorning(options) {
    const history = Array.isArray(options.history) ? options.history : [];
    const hall = String(options.hall || '');
    const machines = Array.isArray(options.machines) ? options.machines : [];
    const targetDate = normDate(options.targetDate);
    const estimate = options.estimate;
    if (!hall || !machines.length || !targetDate || typeof estimate !== 'function') {
      return { version: VERSION, targetDate, candidates: [], models: [], transition: { overall: { origins: 0 }, models: [] } };
    }
    const hallRows = history.filter(row => row.hall === hall);
    const selectedRows = hallRows.filter(row => machines.includes(row.machine));
    const pastRows = selectedRows.filter(row => normDate(row.date) < targetDate);
    const enriched = enrichRows(pastRows.filter(row => Number(row.games || 0) > 1000), estimate).filter(row => row._p4 != null);
    const transition = transitionSummary(selectedRows, targetDate, estimate);
    const universe = latestMachineMap(hallRows, targetDate, machines);
    const byKey = new Map();
    const byModel = new Map();
    const strongByModel = new Map();
    enriched.forEach(row => {
      const key = machineKey(row);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(row);
      if (!byModel.has(row.machine)) byModel.set(row.machine, []);
      byModel.get(row.machine).push(row);
      if (row._strong) {
        if (!strongByModel.has(row.machine)) strongByModel.set(row.machine, []);
        strongByModel.get(row.machine).push(row);
      }
    });
    byKey.forEach(rows => rows.sort((a, b) => normDate(a.date).localeCompare(normDate(b.date))));
    const allRate = enriched.length ? enriched.filter(row => row._strong).length / enriched.length : 0.2;
    const targetWeekday = dateWeekday(targetDate);

    const candidates = universe.map(row => {
      const rows = byKey.get(machineKey(row)) || [];
      const modelRows = byModel.get(row.machine) || [];
      const modelStrong = modelRows.filter(item => item._strong).length;
      const modelRate = (modelStrong + 2) / (modelRows.length + 4);
      const modelScore = clamp(50 + (modelRate - allRate) * 120, 25, 78);
      const recent = rows.filter(item => dateDifference(targetDate, item.date) <= 28);
      const recentPairs = recent.map(item => [item._p4 * 100, Math.exp(-Math.max(1, dateDifference(targetDate, item.date)) / 10)]);
      const historyScore = recentPairs.length ? clamp(weightedAverage(recentPairs), 10, 90) : 45;
      const weekdayRows = rows.filter(item => dateWeekday(item.date) === targetWeekday);
      const weekdayRaw = weekdayRows.length ? average(weekdayRows.map(item => item._p4 * 100)) : modelRate * 100;
      const weekdayScore = (weekdayRaw * weekdayRows.length + modelRate * 100 * 3) / (weekdayRows.length + 3);
      const strongDates = rows.filter(item => item._strong).map(item => normDate(item.date));
      const intervals = [];
      for (let i = 1; i < strongDates.length; i += 1) intervals.push(dateDifference(strongDates[i], strongDates[i - 1]));
      let intervalScore = 50;
      let intervalReason = '周期データ不足';
      if (strongDates.length && intervals.length) {
        const expected = average(intervals.slice(-4));
        const elapsed = dateDifference(targetDate, strongDates.at(-1));
        const fit = Math.max(0, 1 - Math.abs(elapsed - expected) / Math.max(3, expected));
        intervalScore = 42 + fit * 20;
        intervalReason = `前回から${elapsed}日／平均${Math.round(expected)}日`;
      }
      const position = positionEvidence(row.machine, row.number, strongByModel, transition);
      const score = Math.round(
        modelScore * 0.30 +
        historyScore * 0.25 +
        weekdayScore * 0.25 +
        intervalScore * 0.10 +
        position.score * 0.10
      );
      const branches = [
        { key: 'model', label: '機種', score: Math.round(modelScore), note: `${modelRows.length}件中${modelStrong}件が4以上相当` },
        { key: 'history', label: '履歴', score: Math.round(historyScore), note: recent.length ? `直近28日 ${recent.length}件` : '直近データ不足' },
        { key: 'weekday', label: '曜日', score: Math.round(weekdayScore), note: `同曜日 ${weekdayRows.length}件` },
        { key: 'interval', label: '間隔', score: Math.round(intervalScore), note: intervalReason },
        { key: 'position', label: '位置', score: Math.round(position.score), note: `${position.label}／検証${position.support}件` }
      ];
      return { ...row, score, branches, position, sampleCount: rows.length, selected: false };
    });

    const models = machines.map(machine => {
      const rows = candidates.filter(candidate => candidate.machine === machine).sort((a, b) => b.score - a.score || numberValue(a.number) - numberValue(b.number));
      const quota = rows.length ? Math.max(1, Math.round(rows.length * 0.2)) : 0;
      rows.slice(0, quota).forEach(row => { row.selected = true; });
      return {
        machine,
        total: rows.length,
        quota,
        candidates: rows.slice(0, quota),
        score: rows.length ? Math.round(average(rows.slice(0, quota).map(item => item.score))) : 0,
        sampleCount: (byModel.get(machine) || []).length
      };
    }).filter(model => model.total).sort((a, b) => b.score - a.score);
    candidates.sort((a, b) => Number(b.selected) - Number(a.selected) || b.score - a.score || numberValue(a.number) - numberValue(b.number));
    const dates = unique(enriched.map(row => normDate(row.date)));
    return {
      version: VERSION,
      targetDate,
      dataCutoff: dates.sort().at(-1) || '',
      sampleDays: dates.length,
      candidates,
      selected: candidates.filter(candidate => candidate.selected),
      models,
      transition
    };
  }

  function buildEvening(options) {
    const morning = options.morning || { candidates: [] };
    const history = Array.isArray(options.history) ? options.history : [];
    const date = normDate(options.date || morning.targetDate);
    const estimate = options.estimate;
    const morningMap = new Map(morning.candidates.map(row => [machineKey(row), row]));
    const rows = history.filter(row => row.hall === options.hall && normDate(row.date) === date && options.machines.includes(row.machine));
    const enriched = enrichRows(rows, estimate);
    return enriched.map(row => {
      const prior = morningMap.get(machineKey(row));
      const priorScore = prior ? prior.score : 45;
      const games = Number(row.games || 0);
      const reliability = row._p4 == null ? 0 : clamp((games - 1000) / 3000, 0, 1);
      const neighbors = enriched.filter(other => other !== row && other.machine === row.machine && other._p4 != null && Math.abs(numberValue(other.number) - numberValue(row.number)) <= 2);
      const neighborScore = neighbors.length ? average(neighbors.map(other => other._p4 * 100)) : 50;
      const liveScore = row._p4 == null ? 45 : row._p4 * 100;
      const liveWeight = 0.30 + reliability * 0.25;
      const neighborWeight = 0.10 + reliability * 0.10;
      const priorWeight = 1 - liveWeight - neighborWeight;
      const score = Math.round(priorScore * priorWeight + liveScore * liveWeight + neighborScore * neighborWeight);
      let status = '見送り';
      if (games <= 1000 || row._p4 == null) status = 'データ不足';
      else if (
        (games >= 2500 && row._p4 >= 0.70 && score >= 60) ||
        (games >= 4000 && row._p4 >= 0.60 && score >= 55)
      ) status = '座る候補';
      else if (score >= 50 && row._p4 >= 0.50) status = '様子見';
      const confidence = games >= 4000 ? '高' : games >= 2500 ? '中' : games > 1000 ? '低' : '不足';
      return {
        ...row,
        score,
        status,
        confidence,
        morningRank: morning.selected.findIndex(item => machineKey(item) === machineKey(row)) + 1,
        morningScore: priorScore,
        neighborScore: Math.round(neighborScore),
        neighborCount: neighbors.length,
        p4: row._p4,
        estimate: row._estimate
      };
    }).sort((a, b) => b.score - a.score || numberValue(a.number) - numberValue(b.number));
  }

  function buildReview(options) {
    const morning = options.morning || { selected: [], models: [] };
    const history = Array.isArray(options.history) ? options.history : [];
    const date = normDate(options.date || morning.targetDate);
    const estimate = options.estimate;
    const rows = enrichRows(history.filter(row => row.hall === options.hall && normDate(row.date) === date && options.machines.includes(row.machine)), estimate);
    const rowMap = new Map(rows.map(row => [machineKey(row), row]));
    const results = morning.selected.map(prediction => {
      const result = rowMap.get(machineKey(prediction));
      return {
        prediction,
        result,
        decided: Boolean(result && result._p4 != null),
        hit: Boolean(result && result._strong),
        p4: result ? result._p4 : null
      };
    });
    const modelRows = morning.models.map(model => {
      const eligible = rows.filter(row => row.machine === model.machine && row._p4 != null);
      const strong = eligible.filter(row => row._strong);
      const predictions = results.filter(result => result.prediction.machine === model.machine);
      const decided = predictions.filter(result => result.decided);
      const hits = predictions.filter(result => result.hit).length;
      // Missing and low-play predictions cannot be hits, so exclude them from
      // the random baseline just as they are excluded from measured precision.
      const expected = eligible.length ? decided.length * strong.length / eligible.length : 0;
      return { machine: model.machine, picks: predictions.length, decided: decided.length, hits, eligible: eligible.length, strong: strong.length, expected };
    });
    const hits = results.filter(result => result.hit).length;
    const decided = results.filter(result => result.decided).length;
    const expected = modelRows.reduce((sum, model) => sum + model.expected, 0);
    return {
      date,
      picks: results.length,
      decided,
      hits,
      precision: decided ? hits / decided : 0,
      expected,
      lift: expected ? hits / expected : 0,
      results,
      models: modelRows
    };
  }

  return { VERSION, buildMorning, buildEvening, buildReview, bucketForDistance };
});
