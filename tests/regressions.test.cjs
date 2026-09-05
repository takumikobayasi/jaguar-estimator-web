const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function viewer(history, selectedDate = '2026-09-07') {
  const sandbox = {
    state: { hall: 'test', machines: ['マイジャグラーV'], data: { history } },
    document: { querySelector: () => ({ value: selectedDate }) },
    shortMachineName: name => name,
    esc: value => String(value),
    estimateRows: () => ({ probs: [0, 0, 0, 0, 0, 1], likely: 6 }),
  };
  vm.createContext(sandbox);
  for (const name of ['normDate', 'jstToday', 'captureView', 'fourPlusForecast', 'weeklyHabitPanel']) {
    const source = html.split('\n').find(line => line.trimStart().startsWith(`function ${name}(`));
    assert(source, `Missing function: ${name}`);
    vm.runInContext(source, sandbox);
  }
  return sandbox;
}
const row = date => ({ date, hall: 'test', machine: 'マイジャグラーV', number: '100', games: 3000, big: 10, reg: 10, capturedAt: Date.parse(date + 'T23:10:00+09:00') });

test('inline browser script parses', () => {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
  new vm.Script(script);
});

for (const timezone of ['Asia/Tokyo', 'UTC', 'America/Los_Angeles']) {
  test(`${timezone}: calendar includes the final business date and aligns weekdays`, () => {
    process.env.TZ = timezone;
    const calendar = vm.runInContext('captureView()', viewer([row('2026-09-07')]));
    assert.match(calendar, /class="day confirmed" title="2026-09-07" data-capture-date="2026-09-07"><strong>7<\/strong><span>1台/);
    // 42 days through Mon 9/7 starts Tue 7/28: two empty cells under Sun/Mon.
    assert.match(calendar, /class="calendar"><div aria-hidden="true"><\/div><div aria-hidden="true"><\/div><div class="day none" title="2026-07-28"/);
    assert.equal((calendar.match(/data-capture-date=/g) || []).length, 42);
  });
  test(`${timezone}: forecast crosses month and leap-day boundaries without shifting`, () => {
    process.env.TZ = timezone;
    const sandbox = viewer([]);
    sandbox.rows = [row('2028-02-28')];
    const forecast = vm.runInContext('fourPlusForecast(rows)', sandbox);
    assert.equal(forecast[0].date, '2028-02-29');
    assert.equal(forecast[0].weekday, '火');
    assert.equal(forecast[1].date, '2028-03-01');
    assert.equal(forecast[1].weekday, '水');
    assert.equal(forecast[6].date, '2028-03-06');
  });
  test(`${timezone}: Monday weekly results exclude the previous Sunday`, () => {
    process.env.TZ = timezone;
    const panel = vm.runInContext('weeklyHabitPanel()', viewer([row('2026-09-05'), row('2026-09-06'), row('2026-09-07')]));
    assert.match(panel, /今週の★ <b>1<\/b>/);
    assert.match(panel, /<small>月<\/small><b>★1<\/b>/);
  });
}

function selectBackup(files) {
  const iterator = values => { let index = 0; return { hasNext: () => index < values.length, next: () => values[index++] }; };
  const sandbox = { DriveApp: { getFolderById: () => ({ getFiles: () => iterator(files) }) } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), sandbox);
  return vm.runInContext("latestBackup_('test-folder')", sandbox);
}
const file = (name, date, mime) => ({ getName: () => name, getLastUpdated: () => new Date(date), mime });

test('fixed web JSON is selected over old text/plain and newer restore backups', () => {
  const target = file('jaguar-web-latest.json', '2026-09-05', 'application/json');
  assert.equal(selectBackup([file('old.json', '2026-08-01', 'text/plain'), target, file('restore.json', '2026-09-06', 'text/plain')]), target);
});
test('duplicate fixed names select the newest file regardless of MIME', () => {
  const newest = file('jaguar-web-latest.json', '2026-09-06', 'application/json');
  assert.equal(selectBackup([newest, file('jaguar-web-latest.json', '2026-08-01', 'text/plain')]), newest);
});
test('legacy folders select newest JSON of any MIME and ignore non-JSON', () => {
  const newest = file('backup.JSON', '2026-09-05', 'application/json');
  assert.equal(selectBackup([file('old.json', '2026-08-01', 'text/plain'), newest, file('note.txt', '2026-09-06', 'text/plain')]), newest);
});
test('empty folders produce an actionable error', () => {
  assert.throws(() => selectBackup([]), /バックアップJSONが見つかりません/);
});
