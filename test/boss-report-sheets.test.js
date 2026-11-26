require('./helpers/isolated-data');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const app = require('../server/server');
const sheets = require('../server/google-sheets');
const report = require('../public/js/boss-report.js');

const realFetch = global.fetch;
const GAS_URL = 'https://script.google.com/macros/s/test-deployment/exec';

async function withServer(fn) {
    const server = app.listen(0);
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

const cookie = role => `boss_session=${app.createSession(role)}`;

// Answers Apps Script calls locally; everything else (our own server) goes through.
function stubAppsScript(answer) {
    const calls = [];
    global.fetch = async (url, options = {}) => {
        if (String(url).startsWith(GAS_URL)) {
            calls.push(JSON.parse(options.body || '{}'));
            return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return realFetch(url, options);
    };
    return calls;
}

function post(base, role, body) {
    return fetch(`${base}/api/report/sheets`, {
        method: 'POST',
        headers: { ...(role ? { Cookie: cookie(role) } : {}), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body || {})
    });
}

test('report export to Google Sheets is Admin only', async () => {
    await withServer(async (base) => {
        assert.equal((await post(base, null)).status, 401);
        assert.equal((await post(base, 'member')).status, 403);
        assert.ok([401, 403].includes((await post(base, 'guest')).status), 'guest is refused');
    });
});

test('without a connected Apps Script the export says so and sends nothing', async () => {
    delete process.env.GOOGLE_SCRIPT_WEBAPP_URL;
    const calls = stubAppsScript({ success: true, url: 'https://docs.google.com/spreadsheets/d/x' });
    try {
        await withServer(async (base) => {
            const res = await post(base, 'admin', { view: 'all' });
            assert.equal(res.status, 502);
            assert.deepEqual(await res.json(), { success: false, reason: 'not_configured' });
        });
        assert.equal(calls.length, 0);
    } finally {
        global.fetch = realFetch;
    }
});

test('Admin export has Apps Script write the report built from server data and returns the sheet link', async () => {
    process.env.GOOGLE_SCRIPT_SECRET_TOKEN = 'report-test-token-0123456789'; // no built-in token any more
    process.env.GOOGLE_SCRIPT_WEBAPP_URL = GAS_URL;
    const calls = stubAppsScript({ success: true, url: 'https://docs.google.com/spreadsheets/d/abc/edit#gid=7' });
    try {
        await withServer(async (base) => {
            const res = await post(base, 'admin', { view: 'normal', lang: 'th', tz: 8, showLocation: false, bosses: [{ name: 'injected' }] });
            assert.equal(res.status, 200);
            assert.deepEqual(await res.json(), { success: true, url: 'https://docs.google.com/spreadsheets/d/abc/edit#gid=7' });
        });
        assert.equal(calls.length, 1);
        const sent = calls[0];
        assert.equal(sent.action, 'write_report');
        assert.ok(sent.token, 'Apps Script token is sent');
        assert.equal(sent.report.sections.length, 1, 'normal bosses only');
        assert.equal(sent.report.sections[0].kind, 'normal');
        assert.match(sent.report.sections[0].title, /^บอสปกติ/);
        assert.match(sent.report.subtitle, /UTC\+8/);
        assert.ok(!JSON.stringify(sent.report).includes('injected'), 'browser cannot inject rows');
        assert.ok(!sent.report.sections[0].headers.includes('สถานที่'), 'location hidden by default');
    } finally {
        global.fetch = realFetch;
        delete process.env.GOOGLE_SCRIPT_WEBAPP_URL;
    }
});

test('an Apps Script deployment without write_report is reported as outdated; odd links are refused', async () => {
    const settings = { googleSheets: { webAppUrl: GAS_URL, enabled: true } };
    try {
        stubAppsScript({ success: false, message: 'Unknown action: write_report' });
        assert.deepEqual(await sheets.writeReport({ sections: [] }, settings), { success: false, reason: 'script_outdated' });
        stubAppsScript({ success: true, url: 'https://evil.example/sheet' });
        assert.deepEqual(await sheets.writeReport({ sections: [] }, settings), { success: false, reason: 'failed' });
        assert.deepEqual(await sheets.writeReport({ sections: [] }, { googleSheets: { webAppUrl: GAS_URL, enabled: false } }), { success: false, reason: 'not_configured' });
    } finally {
        global.fetch = realFetch;
    }
});

test('sheet data has one table per boss type with status per row', () => {
    const NOW = Date.UTC(2026, 10, 16, 7, 0, 0);
    const iso = ms => new Date(ms).toISOString();
    const data = {
        invasionLabel: 'L3',
        bosses: [
            { id: 1, name: 'Valefar', location: 'Cave', last_kill_time: iso(NOW - 3600e3), next_spawn: iso(NOW + 60e3) },
            { id: 2, name: 'Zaken', is_invasion: true, last_kill_time: iso(NOW - 600e3), next_spawn: iso(NOW - 60e3) }
        ]
    };
    const sheet = report.reportSheetData(report.buildReport(data, NOW, { showLocation: true }), 'all', NOW, 7, 'en');
    assert.equal(sheet.columns, 6);
    assert.deepEqual(sheet.sections.map(s => [s.kind, s.title]), [['normal', 'Normal bosses (1)'], ['invasion', 'Invasion bosses L3 (1)']]);
    assert.deepEqual(sheet.sections[0].rows[0].values, ['1', 'Valefar', 'Cave', '16/11 · 13:00', '16/11 · 14:01', 'Waiting']);
    assert.equal(sheet.sections[1].rows[0].status, 'now');
    const hidden = report.reportSheetData(report.buildReport({ ...data, hideInvasionBosses: true }, NOW, {}), 'invasion', NOW, 7, 'en');
    assert.equal(hidden.columns, 5);
    assert.deepEqual(hidden.sections[0].rows, []);
    assert.match(hidden.sections[0].note, /hidden/);
});

test('normal and invasion tables sit side by side, not stacked', () => {
    const NOW = Date.UTC(2026, 10, 16, 7, 0, 0);
    const iso = ms => new Date(ms).toISOString();
    const r = report.buildReport({ bosses: [
        { id: 1, name: 'Valefar', last_kill_time: iso(NOW - 3600e3), next_spawn: iso(NOW + 60e3) },
        { id: 2, name: 'Behemoth', last_kill_time: iso(NOW - 3600e3), next_spawn: iso(NOW + 120e3) },
        { id: 3, name: 'Zaken', is_invasion: true, last_kill_time: iso(NOW - 600e3), next_spawn: iso(NOW + 60e3) }
    ] }, NOW, {});
    const html = report.reportSheetHtml(r, 'all', NOW, 7, 'en');
    assert.match(html, /colspan="11"/, 'title spans both tables plus the gap column');
    const bandRow = html.split('<tr>').find(row => row.includes('Normal bosses (2)'));
    assert.ok(bandRow.includes('Invasion bosses (1)'), 'both section titles are on the same row');
    const firstRow = html.split('<tr>').find(row => row.includes('>Valefar<'));
    assert.ok(firstRow.includes('>Zaken<'), 'first bosses of each type share a row');
    const gs = fs.readFileSync(path.join(__dirname, '../google_apps_script/Code.gs'), 'utf8');
    assert.match(gs, /var col = 1 \+ s \* \(cols \+ 1\);/, 'Apps Script places the second table to the right');
});

test('Apps Script write_report writes only the Boss Report tab and leaves Metadata alone', () => {
    const gs = fs.readFileSync(path.join(__dirname, '../google_apps_script/Code.gs'), 'utf8');
    const at = gs.indexOf("if (action === 'write_report')");
    assert.ok(at > 0 && at < gs.indexOf('switch (action)'), 'handled before the data-mirror switch and updateMetadata');
    assert.match(gs, /var SHEET_REPORT = 'Boss Report';/);
    assert.match(gs, /setNumberFormat\('@'\)/, 'times stay text');
    const client = fs.readFileSync(path.join(__dirname, '../public/js/boss-report.js'), 'utf8');
    assert.match(client, /fetch\('\/api\/report\/sheets'/);
    assert.match(client, /onclick: copyForSheets/, 'copy + Ctrl+V stays as the fallback');
});

test('midnight snapshot is refused without the trigger secret and lists both servers', async () => {
    const original = process.env.PUSH_TICK_SECRET;
    try {
        await withServer(async (base) => {
            delete process.env.PUSH_TICK_SECRET;
            assert.equal((await fetch(`${base}/api/report/snapshot`)).status, 503);
            process.env.PUSH_TICK_SECRET = 'snapshot-secret';
            assert.equal((await fetch(`${base}/api/report/snapshot`)).status, 401);
            assert.equal((await fetch(`${base}/api/report/snapshot`, { headers: { 'x-push-tick-secret': 'wrong' } })).status, 401);
            assert.equal((await fetch(`${base}/api/report/snapshot`, { headers: { Cookie: cookie('admin') } })).status, 401, 'a login is not the trigger secret');
            const ok = await fetch(`${base}/api/report/snapshot`, { headers: { 'x-push-tick-secret': 'snapshot-secret' } });
            assert.equal(ok.status, 200);
            const body = await ok.json();
            assert.equal(body.success, true);
            assert.ok(Number(body.takenAt) > 0);
            assert.ok(Array.isArray(body.rows));
        });
    } finally {
        if (original === undefined) delete process.env.PUSH_TICK_SECRET; else process.env.PUSH_TICK_SECRET = original;
    }
});

test('snapshot rows carry server, boss, kill and spawn time; invasion is logged even when hidden', () => {
    const NOW = Date.UTC(2026, 10, 16, 17, 0, 0); // 00:00 Tue in Thailand
    const iso = ms => new Date(ms).toISOString();
    const rows = report.snapshotRows({
        serverName: '#Kain7',
        invasionLabel: 'L3',
        hideInvasionBosses: true,
        bosses: [
            { id: 1, name: 'Valefar', last_kill_time: iso(NOW - 3600e3), next_spawn: iso(NOW + 3600e3) },
            { id: 2, name: 'Zaken', is_invasion: true, last_kill_time: iso(NOW - 600e3), next_spawn: iso(NOW + 7200e3) },
            { id: 3, name: 'Kronos', next_spawn: null }
        ]
    }, NOW, 7);
    assert.deepEqual(rows, [
        { server: 'Main', kind: 'normal', id: 1, name: 'Valefar', died: '16/11 · 23:00', spawns: '17/11 · 01:00', status: 'upcoming', killIso: iso(NOW - 3600e3), spawnIso: iso(NOW + 3600e3) },
        { server: 'L3', kind: 'invasion', id: 2, name: 'Zaken', died: '16/11 · 23:50', spawns: '17/11 · 02:00', status: 'upcoming', killIso: iso(NOW - 600e3), spawnIso: iso(NOW + 7200e3) }
    ]);
    assert.ok(!JSON.stringify(rows).includes('#Kain7'), 'main server name is not fixed in the log');
});

test('Admin can import one logged night of an invasion server back onto the invasion bosses', async () => {
    const db = require('../server/db');
    const target = db.getBosses().find(b => b.is_invasion);
    const normal = db.getBosses().find(b => !b.is_invasion);
    assert.ok(target && normal, 'test data has invasion and normal bosses');
    const normalBefore = JSON.stringify(db.getBoss(normal.id));
    const now = Date.now();
    const kill = new Date(now - 30 * 60e3).toISOString();
    const spawn = new Date(now + 90 * 60e3).toISOString();
    const days = [{ date: '14/11/2026', day: 'Fri', loggedAt: '15/11 00:00', rows: [
        { server: 'Main', kind: 'normal', id: String(normal.id), name: normal.name, killIso: kill, spawnIso: spawn, status: 'upcoming' },
        { server: 'K1', kind: 'invasion', id: String(target.id), name: target.name, killIso: kill, spawnIso: spawn, status: 'upcoming' },
        { server: 'K1', kind: 'invasion', id: '999999', name: 'Ghost Boss', killIso: kill, spawnIso: spawn, status: 'upcoming' }
    ] }];
    process.env.GOOGLE_SCRIPT_WEBAPP_URL = GAS_URL;
    stubAppsScript({ success: true, url: 'https://docs.google.com/spreadsheets/d/abc/edit#gid=9', days });
    try {
        await withServer(async (base) => {
            const send = (role, body) => fetch(`${base}/api/report/log/import`, {
                method: 'POST',
                headers: { ...(role ? { Cookie: cookie(role) } : {}), 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(body)
            });
            assert.equal((await send('member', { date: '14/11/2026', loggedAt: '15/11 00:00', server: 'K1' })).status, 403);
            assert.equal((await send('admin', { date: '14/11/2026', loggedAt: '15/11 00:00', server: 'Main' })).status, 400, 'main server is never imported');
            assert.equal((await send('admin', { date: '01/01/2026', loggedAt: 'x', server: 'K1' })).status, 404);
            const ok = await send('admin', { date: '14/11/2026', loggedAt: '15/11 00:00', server: 'K1' });
            assert.equal(ok.status, 200);
            assert.deepEqual(await ok.json(), { success: true, imported: 1, skipped: ['Ghost Boss'] });
        });
        const after = db.getBoss(target.id);
        assert.equal(after.last_kill_time, kill);
        assert.equal(after.next_spawn, spawn);
        assert.equal(after.pre_spawned, false);
        assert.equal(after.alerted_by, null);
        assert.equal(JSON.stringify(db.getBoss(normal.id)), normalBefore, 'normal bosses are untouched');
    } finally {
        global.fetch = realFetch;
        delete process.env.GOOGLE_SCRIPT_WEBAPP_URL;
    }
});

test('importing a night whose spawn has passed catches the boss up to its next cycle', async () => {
    const db = require('../server/db');
    const target = db.getBosses().find(b => b.is_invasion && Number(b.interval) > 0);
    const now = Date.now();
    const interval = Number(target.interval) * 60e3;
    const spawn = now - 3 * interval - 10 * 60e3; // three cycles and ten minutes ago
    const days = [{ date: '10/11/2026', day: 'Mon', loggedAt: '11/11 00:00', rows: [
        { server: 'L3', kind: 'invasion', id: String(target.id), name: target.name, killIso: new Date(spawn - interval).toISOString(), spawnIso: new Date(spawn).toISOString(), status: 'upcoming' }
    ] }];
    process.env.GOOGLE_SCRIPT_WEBAPP_URL = GAS_URL;
    stubAppsScript({ success: true, url: 'https://docs.google.com/spreadsheets/d/abc/edit#gid=9', days });
    try {
        await withServer(async (base) => {
            const res = await fetch(`${base}/api/report/log/import`, {
                method: 'POST',
                headers: { Cookie: cookie('admin'), 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ date: '10/11/2026', loggedAt: '11/11 00:00', server: 'L3' })
            });
            assert.equal(res.status, 200);
        });
        const after = db.getBoss(target.id);
        assert.ok(Date.parse(after.next_spawn) > now, 'next spawn is in the future');
        assert.equal(Date.parse(after.next_spawn), spawn + 4 * interval);
        assert.equal(after.auto_advanced, true);
    } finally {
        global.fetch = realFetch;
        delete process.env.GOOGLE_SCRIPT_WEBAPP_URL;
    }
});

test('the log is Admin only and read through Apps Script', async () => {
    process.env.GOOGLE_SCRIPT_WEBAPP_URL = GAS_URL;
    const days = [{ date: '16/11/2026', day: 'Mon', loggedAt: '17/11 00:00', rows: [{ server: 'L3', name: 'Zaken', died: '16/11 · 23:50', spawns: '17/11 · 02:00', status: 'Waiting' }] }];
    stubAppsScript({ success: true, url: 'https://docs.google.com/spreadsheets/d/abc/edit#gid=9', days });
    try {
        await withServer(async (base) => {
            const get = role => fetch(`${base}/api/report/log`, { headers: { ...(role ? { Cookie: cookie(role) } : {}), Accept: 'application/json' } });
            assert.equal((await get(null)).status, 401);
            assert.equal((await get('member')).status, 403);
            const res = await get('admin');
            assert.equal(res.status, 200);
            assert.deepEqual(await res.json(), { success: true, url: 'https://docs.google.com/spreadsheets/d/abc/edit#gid=9', days });
        });
    } finally {
        global.fetch = realFetch;
        delete process.env.GOOGLE_SCRIPT_WEBAPP_URL;
    }
});

test('Apps Script logs at midnight after Mon/Wed/Fri, keeps 30 days, and the panel has a Log tab', () => {
    const gs = fs.readFileSync(path.join(__dirname, '../google_apps_script/Code.gs'), 'utf8');
    assert.match(gs, /var LOG_DAYS = \[1, 3, 5\];/);
    assert.match(gs, /var LOG_KEEP_DAYS = 30;/);
    assert.match(gs, /if \(hour !== 0 \|\| LOG_DAYS\.indexOf\(endedDay\) === -1\) return;/);
    assert.match(gs, /props\.getProperty\('INVASION_LOG_DONE'\) === dateKey/, 'once per night');
    assert.match(gs, /try \{ invasionLogTick\(props, url, secret, false\); \} catch/, 'never breaks the phone-alert tick');
    assert.match(gs, /if \(action === 'get_log'\)/);
    const client = fs.readFileSync(path.join(__dirname, '../public/js/boss-report.js'), 'utf8');
    assert.match(client, /tabButton\('log', '📜 ' \+ s\.log\)/);
    assert.match(client, /fetch\('\/api\/report\/log'/);
    assert.doesNotMatch(client, /setInterval/);
});

test('the Log tab can be filtered by server, with invasion servers told apart by badge label', () => {
    const client = fs.readFileSync(path.join(__dirname, '../public/js/boss-report.js'), 'utf8');
    assert.match(client, /let logServer = 'all';/);
    assert.match(client, /row\.server === logServer/);
    const rows = report.snapshotRows({ invasionLabel: 'K1', bosses: [
        { id: 2, name: 'Zaken', is_invasion: true, last_kill_time: '2026-11-16T10:00:00Z', next_spawn: '2026-11-16T18:00:00Z' }
    ] }, Date.UTC(2026, 10, 16, 17, 0, 0), 7);
    assert.equal(rows[0].server, 'K1', 'the log saves the badge label active that night');
});

test('the Log tab picks a night from a calendar, per server', () => {
    const client = fs.readFileSync(path.join(__dirname, '../public/js/boss-report.js'), 'utf8');
    assert.match(client, /class: 'br-cal-day' \+ \(has \? ' has' : ''\)/, 'only days with a log are clickable');
    assert.match(client, /disabled: !has/);
    assert.match(client, /const lead = \(first\.getUTCDay\(\) \+ 6\) % 7; \/\/ Monday first/);
    assert.match(client, /const picked = logged\.get\(logDate\) \|\| \[\];/);
    assert.match(client, /filter\(row => logServer === 'all' \|\| row\.server === logServer\)/);
});

test('after the midnight log, invasion bosses are hidden and cleared; normal bosses are never touched', async () => {
    const db = require('../server/db');
    const original = process.env.PUSH_TICK_SECRET;
    const realNow = Date.now;
    process.env.PUSH_TICK_SECRET = 'after-log-secret';
    // Give an invasion boss a time so the reset has something to clear.
    const invasion = db.getBosses().find(b => b.is_invasion);
    await db.updateBoss(invasion.id, { last_kill_time: new Date(realNow() - 60e3).toISOString(), next_spawn: new Date(realNow() + 3600e3).toISOString(), pre_spawned: true, alerted_by: 'admin' });
    const normalBefore = JSON.stringify(db.getBosses().filter(b => !b.is_invasion));
    const post = (base, headers) => fetch(`${base}/api/report/after-log`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
    try {
        await withServer(async (base) => {
            assert.equal((await post(base, {})).status, 401);
            assert.equal((await post(base, { 'x-push-tick-secret': 'wrong' })).status, 401);
            assert.equal((await post(base, { Cookie: cookie('admin') })).status, 401, 'a login is not the trigger secret');

            Date.now = () => Date.UTC(2026, 10, 17, 9, 0, 0); // Tue 16:00 Thailand: outside the window
            assert.equal((await post(base, { 'x-push-tick-secret': 'after-log-secret' })).status, 409);
            assert.equal(JSON.stringify(db.getBosses().filter(b => !b.is_invasion)), normalBefore);
            assert.ok(db.getBoss(invasion.id).next_spawn, 'nothing cleared outside the window');

            Date.now = () => Date.UTC(2026, 10, 16, 17, 20, 0); // Tue 00:20 Thailand, right after Monday's log
            const ok = await post(base, { 'x-push-tick-secret': 'after-log-secret' });
            assert.equal(ok.status, 200);
            const body = await ok.json();
            assert.equal(body.success, true);
            assert.equal(body.hidden, true);
            assert.equal(body.cleared, db.getBosses().filter(b => b.is_invasion).length);
        });
        assert.equal(db.getSettings().hideInvasionBosses, true);
        for (const boss of db.getBosses().filter(b => b.is_invasion)) {
            assert.equal(boss.last_kill_time, null);
            assert.equal(boss.next_spawn, null);
            assert.equal(boss.pre_spawned, false);
            assert.equal(boss.alerted_by, null);
        }
        const normalAfter = db.getBosses().filter(b => !b.is_invasion).map(({ updated_at, ...rest }) => rest);
        const normalExpected = JSON.parse(normalBefore).map(({ updated_at, ...rest }) => rest);
        assert.deepEqual(normalAfter, normalExpected, 'normal bosses are unchanged');
        assert.deepEqual(db.getBosses().filter(b => !b.is_invasion).map(b => b.updated_at), JSON.parse(normalBefore).map(b => b.updated_at), 'normal bosses are not even re-saved');
    } finally {
        Date.now = realNow;
        if (original === undefined) delete process.env.PUSH_TICK_SECRET; else process.env.PUSH_TICK_SECRET = original;
    }
});

test('Apps Script resets invasion only after the scheduled log is saved, never on the manual test run', () => {
    const gs = fs.readFileSync(path.join(__dirname, '../google_apps_script/Code.gs'), 'utf8');
    const writeAt = gs.indexOf("props.setProperty('INVASION_LOG_DONE', dateKey);");
    const resetAt = gs.indexOf('if (!force) resetInvasionAfterLog(props, tickUrl, secret, dateKey);');
    assert.ok(writeAt > 0 && resetAt > writeAt, 'reset is called after the log is written');
    assert.match(gs, /props\.setProperty\('INVASION_RESET_DONE', dateKey\);/, 'once per night');
    assert.match(gs, /'\/api\/report\/after-log'/);
});
