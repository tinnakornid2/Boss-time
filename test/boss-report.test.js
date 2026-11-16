const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const report = require('../public/js/boss-report.js');

const NOW = Date.UTC(2026, 10, 16, 7, 0, 0); // 16/11 14:00 in UTC+7
const min = 60 * 1000;
const iso = ms => new Date(ms).toISOString();

const data = {
    invasionLabel: 'L3',
    hideInvasionBosses: false,
    bosses: [
        { id: 1, name: 'Valefar', location: 'Cave', is_invasion: false, last_kill_time: iso(NOW - 60 * min), next_spawn: iso(NOW + 120 * min) },
        { id: 2, name: 'Behemoth', is_invasion: false, last_kill_time: iso(NOW - 240 * min), next_spawn: iso(NOW - 2 * min) },
        { id: 3, name: 'Kronos', is_invasion: false, last_kill_time: null, next_spawn: null },
        { id: 4, name: 'Antharas', is_invasion: false, pinned_alive: true, last_kill_time: iso(NOW - 600 * min), next_spawn: iso(NOW - 30 * min) },
        { id: 5, name: 'Valefar', is_invasion: true, last_kill_time: iso(NOW - 10 * min), next_spawn: iso(NOW + 30 * min) },
        { id: 6, name: 'Zaken', is_invasion: true, last_kill_time: null, next_spawn: null }
    ]
};

test('report splits normal and invasion bosses and sorts by status then spawn', () => {
    const r = report.buildReport(data, NOW, { showUnset: false });
    assert.deepEqual(r.normal.map(row => [row.id, row.status]), [[4, 'alive'], [2, 'now'], [1, 'upcoming']]);
    assert.deepEqual(r.invasion.map(row => row.id), [5]);
    assert.equal(r.invasionLabel, 'L3');
});

test('Unset bosses appear only when asked and have no kill time', () => {
    const r = report.buildReport(data, NOW, { showUnset: true });
    const kronos = r.normal.find(row => row.id === 3);
    assert.equal(kronos.status, 'unset');
    assert.equal(kronos.killMs, null);
    assert.equal(r.normal[r.normal.length - 1].id, 3, 'Unset goes last');
    assert.deepEqual(r.invasion.map(row => row.id), [5, 6]);
});

test('NOW lasts exactly five minutes after spawn', () => {
    const boss = { next_spawn: iso(NOW) };
    assert.equal(report.bossStatus(boss, NOW - 1), 'upcoming');
    assert.equal(report.bossStatus(boss, NOW), 'now');
    assert.equal(report.bossStatus(boss, NOW + 5 * min - 1), 'now');
    assert.equal(report.bossStatus(boss, NOW + 5 * min), 'upcoming');
});

test('a boss past its NOW window shows the next cycle like the server catch-up', () => {
    const boss = { id: 9, name: 'Orfen', is_invasion: false, interval: 60, last_kill_time: iso(NOW - 200 * min), next_spawn: iso(NOW - 140 * min) };
    const [row] = report.buildReport({ bosses: [boss] }, NOW, {}).normal;
    // spawns at -140, -80, -20 have passed their NOW window; next is +40
    assert.equal(row.status, 'upcoming');
    assert.equal(row.killMs, NOW - 20 * min);
    assert.equal(row.spawnMs, NOW + 40 * min);
    const alive = report.buildReport({ bosses: [{ ...boss, pinned_alive: true }] }, NOW, {}).normal[0];
    assert.equal(alive.status, 'alive', 'Still alive never advances');
});

test('hidden invasion is left out of the report', () => {
    const r = report.buildReport({ ...data, hideInvasionBosses: true }, NOW, { showUnset: true });
    assert.equal(r.invasionHidden, true);
    assert.deepEqual(r.invasion, []);
    assert.doesNotMatch(report.reportText(r, 'all', NOW, 7, 'en'), /Invasion bosses/);
});

test('times use the selected dashboard timezone', () => {
    assert.equal(report.formatTime(NOW, 7), '16/11 14:00');
    assert.equal(report.formatTime(NOW, 8), '16/11 15:00');
    assert.equal(report.formatTime(null, 7), '-');
});

test('copied text has name, kill time and spawn time per section, names untranslated', () => {
    const r = report.buildReport(data, NOW, { showUnset: false });
    const th = report.reportText(r, 'all', NOW, 7, 'th');
    assert.match(th, /— บอสปกติ \(3\) —/);
    assert.match(th, /— บอสอินเวชั่น L3 \(1\) —/);
    assert.match(th, /Valefar \| เวลาตาย 16\/11 13:00 \| เวลาเกิด 16\/11 16:00/);
    assert.match(th, /Behemoth \| เวลาตาย 16\/11 10:00 \| เวลาเกิด NOW \(16\/11 13:58\)/);
    assert.match(th, /Antharas \| .* \| เวลาเกิด ยังไม่ตาย/);
    const normalOnly = report.reportText(r, 'normal', NOW, 7, 'en');
    assert.match(normalOnly, /Normal bosses/);
    assert.doesNotMatch(normalOnly, /Invasion bosses/);
    const invasionOnly = report.reportText(r, 'invasion', NOW, 7, 'en');
    assert.doesNotMatch(invasionOnly, /Normal bosses/);
    assert.match(invasionOnly, /Valefar \| Died 16\/11 13:50 \| Spawns 16\/11 14:30/);
});

test('Google Sheets export is a styled table split by boss type, names untranslated', () => {
    const r = report.buildReport(data, NOW, { showUnset: true });
    const en = report.reportSheetHtml(r, 'all', NOW, 7, 'en');
    assert.match(en, /<table style="border-collapse:collapse;">/);
    assert.match(en, /background-color:#fde7c8;color:#7c2d12;[^>]*>Normal bosses \(4\)</);
    assert.match(en, /background-color:#e9ddff;color:#4c1d95;[^>]*>Invasion bosses L3 \(2\)</);
    assert.match(en, />Valefar</);
    assert.match(en, />16\/11 · 13:00</, 'times stay text in Sheets');
    assert.match(en, /color:#b42318;font-weight:bold;">NOW</);
    assert.match(en, />Still alive</);
    const th = report.reportSheetHtml(r, 'normal', NOW, 7, 'th');
    assert.match(th, />บอสปกติ \(4\)</);
    assert.match(th, />Valefar</, 'boss names are never translated');
    assert.doesNotMatch(th, /บอสอินเวชั่น/);
    const hidden = report.reportSheetHtml(report.buildReport({ ...data, hideInvasionBosses: true }, NOW, {}), 'invasion', NOW, 7, 'en');
    assert.match(hidden, /Invasion is hidden on the dashboard/);
    const evil = report.reportSheetHtml(report.buildReport({ bosses: [{ id: 1, name: '<b>x</b>', next_spawn: iso(NOW + min) }] }, NOW, {}), 'normal', NOW, 7, 'en');
    assert.match(evil, /&lt;b&gt;x&lt;\/b&gt;/);
    const tsv = report.reportTsv(r, 'invasion', NOW, 7, 'en');
    assert.match(tsv, /^1\tValefar\t16\/11 · 13:50\t16\/11 · 14:30\tWaiting$/m);
});

test('location is hidden by default and shown only when switched on', () => {
    const hidden = report.buildReport(data, NOW, {});
    assert.equal(hidden.showLocation, false);
    assert.ok(hidden.normal.every(row => row.location === ''));
    const hiddenHtml = report.reportSheetHtml(hidden, 'normal', NOW, 7, 'en');
    assert.doesNotMatch(hiddenHtml, />Location</);
    assert.doesNotMatch(hiddenHtml, />Cave</);
    assert.match(hiddenHtml, /colspan="5"/);
    assert.doesNotMatch(report.reportTsv(hidden, 'normal', NOW, 7, 'en'), /Location|Cave/);

    const shown = report.buildReport(data, NOW, { showLocation: true });
    const shownHtml = report.reportSheetHtml(shown, 'normal', NOW, 7, 'en');
    assert.match(shownHtml, />Location</);
    assert.match(shownHtml, />Cave</);
    assert.match(shownHtml, /colspan="6"/);
    assert.match(report.reportTsv(shown, 'normal', NOW, 7, 'en'), /Valefar\tCave\t/);

    const client = fs.readFileSync(path.join(__dirname, '../public/js/boss-report.js'), 'utf8');
    assert.match(client, /let showLocation = readPref\('dashboard\.reportShowLocation', 'false'\) === 'true';/);
});

test('report panel defaults to English with its own EN/TH switch', () => {
    const client = fs.readFileSync(path.join(__dirname, '../public/js/boss-report.js'), 'utf8');
    assert.match(client, /let reportLang = readPref\('dashboard\.reportLang', 'en'\) === 'th' \? 'th' : 'en';/);
    assert.match(client, /window\.open\('https:\/\/sheets\.new'/);
    for (const key of Object.keys(report.STR.en)) assert.ok(key in report.STR.th, `Thai text for ${key}`);
});

test('main table hides location by default once per device, before the dashboard reads it', () => {
    const alerts = fs.readFileSync(path.join(__dirname, '../public/js/realtime-alerts.js'), 'utf8');
    const migrateAt = alerts.indexOf("localStorage.getItem('dashboard.locationHiddenDefault') !== '1'");
    assert.ok(migrateAt > 0 && migrateAt < alerts.indexOf('const DB_URL'), 'runs at startup');
    assert.match(alerts, /localStorage\.setItem\('dashboard\.showLocation', 'false'\);\s+localStorage\.setItem\('dashboard\.locationHiddenDefault', '1'\);/);
    const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
    assert.ok(server.indexOf('/js/realtime-alerts.js') < server.indexOf('<script type="module"'), 'loads before the React bundle');
    // The desktop HUD reads the same key from the app's main window.
    const main = fs.readFileSync(path.join(__dirname, '../desktop-app/main.js'), 'utf8');
    assert.match(main, /localStorage\.getItem\('dashboard\.showLocation'\) === 'true'/);
});

test('panel starts at the narrowest width that shows every top-bar button, once per device', () => {
    const alerts = fs.readFileSync(path.join(__dirname, '../public/js/realtime-alerts.js'), 'utf8');
    const at = alerts.indexOf("localStorage.getItem('dashboard.panelWidthDefault') !== '1'");
    assert.ok(at > 0 && at < alerts.indexOf('const DB_URL'), 'runs at startup, before React reads the width');
    assert.match(alerts, /const defaultRem = role === 'member' \? 37 : 41;/);
    assert.match(alerts, /if \(current === null \|\| current === '36'\)/, 'a width someone picked is kept');
    assert.match(alerts, /window\.electronAPI\?\.setPanelWidth && window\.innerWidth < needPx/);
    const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
    assert.match(server, /realtime-alerts\.js\?v=\$\{APP_VERSION\}" data-role="\$\{userRole === 'admin' \? 'admin' : userRole === 'member' \? 'member' : 'guest'\}"/);
});

test('report button is for Admin only', () => {
    const client = fs.readFileSync(path.join(__dirname, '../public/js/boss-report.js'), 'utf8');
    assert.match(client, /return page\.props\?\.auth\?\.user\?\.role === 'admin';/);
    // \s+ instead of \n so the check also holds on a Windows (CRLF) checkout.
    assert.match(client, /if \(!isAdminPage\(\)\) return;\s+ensureButton\(\);/);
    assert.match(client, /function openModal\(\) \{\s+if \(!isAdminPage\(\)\) return;/);
});

test('report sends only the two Admin requests, never polls on a timer, and is loaded on the dashboard', () => {
    const client = fs.readFileSync(path.join(__dirname, '../public/js/boss-report.js'), 'utf8');
    // Write-style requests: the Sheets export, and the invasion-log import (asked first).
    assert.equal((client.match(/method:\s*'(POST|PUT|DELETE|PATCH)'/g) || []).length, 2);
    assert.match(client, /fetch\('\/api\/report\/sheets', \{\s+method: 'POST'/);
    assert.match(client, /if \(!window\.confirm\(question\)\) return;\s+importState = \{ busy: true \};/);
    assert.match(client, /fetch\('\/api\/report\/log\/import', \{\s+method: 'POST'/);
    assert.doesNotMatch(client, /setInterval/);
    assert.doesNotMatch(client, /'data-boss-id'/, 'report rows must not look like dashboard boss rows');
    const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
    assert.match(server, /boss-report\.js\?v=\$\{APP_VERSION\}/);
    const alerts = fs.readFileSync(path.join(__dirname, '../public/js/realtime-alerts.js'), 'utf8');
    assert.match(alerts, /getElementById\('header-report-control'\)/);
    assert.match(alerts, /#boss-report-overlay'\)\) continue;/, 'timezone shifter skips the report');
    assert.match(alerts, /textarea, tbody, #boss-report-overlay'\)\) continue;/, 'dashboard translator skips the report');
});
