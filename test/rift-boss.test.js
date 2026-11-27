require('./helpers/isolated-data');
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectRift, projectBosses, DEFAULTS } = require('../public/js/rift-schedule');
const db = require('../server/db');
const push = require('../server/push');
const bossReport = require('../public/js/boss-report');
const app = require('../server/server');

const MIN = 60 * 1000;
const at = (hhmm, day = '27') => Date.parse(`2026-11-${day}T${hhmm}:00+07:00`);
const iso = (ms) => new Date(ms).toISOString();
const rift = (times, extra = {}) => ({ id: 9001, name: 'Maluk', location: "Maluk's Castle", kind: 'rift', next_spawn: null, last_kill_time: null, interval: 60, rift: { ...DEFAULTS, ...times }, ...extra });

// ---------- projection ----------

test('a projected rift shows the lobby as next_spawn and is not pinned before the lobby', () => {
    const b = projectRift(rift({ open_at: iso(at('10:00')) }), at('09:00'));
    assert.equal(b.next_spawn, iso(at('09:55')));
    assert.equal(b.pinned_alive, false);
    assert.equal(b.rift_phase, 'CLOSED');
    assert.equal(b.interval, 360, 'start to start when nobody marks the run');
    assert.equal(b.last_kill_time, null, 'a rift has no kill');
});

test('a Spawned rift is NOW from the lobby until the real close, then counts down to the next lobby', () => {
    const r = rift({ open_at: iso(at('10:00')), confirmed: true });
    const lobby = projectRift(r, at('09:57'));
    assert.equal(lobby.rift_phase, 'LOBBY');
    assert.equal(lobby.pinned_alive, false, 'the lobby uses the normal five-minute NOW window');
    assert.equal(lobby.next_spawn, iso(at('09:55')));
    const open = projectRift(r, at('10:30'));
    assert.equal(open.pinned_alive, true);
    assert.equal(open.next_spawn, iso(at('09:55')), 'same run keeps the same next_spawn (alerts dedupe on it)');
    const closing = projectRift(r, at('11:00') + 30 * 1000);
    assert.equal(closing.pinned_alive, true);
    const after = projectRift(r, at('11:01'));
    assert.equal(after.pinned_alive, false);
    assert.equal(after.next_spawn, iso(at('16:56')));
});

test('an entered time (not Spawned) shows NOW for the lobby five minutes only, then the next run', () => {
    // Owner: only Spawned keeps NOW until the close; an entered time still counts as spawned.
    const r = rift({ open_at: iso(at('10:00')) });
    assert.equal(projectRift(r, at('09:57')).next_spawn, iso(at('09:55')));
    const open = projectRift(r, at('10:30'));
    assert.equal(open.pinned_alive, false);
    assert.equal(open.rift_phase, 'OPEN', 'the real phase stays visible');
    assert.equal(open.next_spawn, iso(at('16:56')), 'next run: 6 h after this close');
    assert.equal(open.rift_confirmed, false);
});

test('a longer lobby stays NOW after its first five minutes', () => {
    const b = projectRift(rift({ open_at: iso(at('10:00')), lobby_min: 15, confirmed: true }), at('09:52'));
    assert.equal(b.rift_phase, 'LOBBY');
    assert.equal(b.pinned_alive, true);
});

test('an Unset rift projects as Unset and normal bosses are untouched', () => {
    const unset = projectRift(rift({}), at('10:00'));
    assert.equal(unset.next_spawn, null);
    assert.equal(unset.pinned_alive, false);
    const normal = { id: 1, name: 'Valefar', next_spawn: iso(at('10:00')), interval: 60 };
    const list = [normal];
    assert.equal(projectBosses(list, at('10:00')), list, 'no rift: same array, no copy');
    assert.equal(projectBosses([normal, rift({})], at('10:00'))[0], normal);
});

test('auto-advance never touches a rift, even with a stale stored next_spawn', () => {
    const stale = rift({ open_at: iso(at('10:00')) }, { next_spawn: iso(at('01:00')) });
    assert.equal(db.calculateBossAutoAdvance(stale, at('12:00')), null);
    assert.equal(db.calculateBossAutoAdvance(projectRift(stale, at('12:00')), at('12:00')), null);
});

test('the report never auto-advances a rift by its interval', () => {
    const now = at('09:58');
    const report = bossReport.buildReport({ bosses: [projectRift(rift({ open_at: iso(at('10:00')) }), now)] }, now, {});
    const row = report.normal.find(r => r.id === 9001);
    assert.equal(row.spawnMs, at('09:55'));
    assert.equal(row.status, 'now');
});

// ---------- push timing ----------

test('push alerts a rift 5 minutes before the lobby and at the lobby, not at start or close', () => {
    const r = rift({ open_at: iso(at('10:00')), confirmed: true });
    const items = (nowMs) => push.collectItems({ bosses: [projectRift(r, nowMs)], nowMs, calculateBossAutoAdvance: db.calculateBossAutoAdvance });
    assert.equal(items(at('09:50'))[0].spawnMs, at('09:55'));
    assert.equal(items(at('09:55'))[0].spawnMs, at('09:55'));
    assert.equal(items(at('10:30')).length, 0, 'no alert while the run is open');
    assert.equal(items(at('11:01'))[0].spawnMs, at('16:56'));
});

test('a rift with no lobby still alerts at its start', () => {
    const r = rift({ open_at: iso(at('10:00')), lobby_min: 0 });
    const nowMs = at('10:00') + 20 * 1000;
    const list = push.collectItems({ bosses: [projectRift(r, nowMs)], nowMs, calculateBossAutoAdvance: db.calculateBossAutoAdvance });
    assert.equal(list.length, 1);
    assert.equal(list[0].spawnMs, at('10:00'));
});

// ---------- routes ----------

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
const cookie = (role) => `boss_session=${app.createSession(role)}`;
const send = (base, method, path, role, body) => fetch(`${base}${path}`, {
    method,
    headers: { Cookie: cookie(role), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
});

test('members cannot create or change rift bosses', async () => {
    await withServer(async (base) => {
        assert.equal((await send(base, 'POST', '/bosses', 'member', { name: 'X', kind: 'rift' })).status, 403);
    });
});

test('Admin creates a rift: stored with no next_spawn, projected on /poll and the dashboard', async () => {
    await withServer(async (base) => {
        const openAt = Date.now() + 2 * 60 * MIN;
        const res = await send(base, 'POST', '/bosses', 'admin', {
            name: 'Maluk', location: "Maluk's Castle", chance_of_appearing: '50', kind: 'rift', is_invasion: true,
            rift: { open_at: iso(openAt) }
        });
        assert.equal(res.status, 200);
        const created = (await res.json()).boss;
        assert.equal(created.kind, 'rift');

        const stored = db.getBoss(created.id);
        assert.equal(stored.next_spawn, null, 'the DB never holds a rift spawn time');
        assert.equal(stored.is_invasion, false, 'rifts live on the main server');
        assert.equal(stored.chance_of_appearing, '50');
        assert.deepEqual(stored.rift, { ...DEFAULTS, open_at: iso(openAt), close_at: null });

        const poll = await (await fetch(`${base}/poll`, { headers: { Cookie: cookie('member') } })).json();
        const seen = poll.bosses.find(b => b.id === created.id);
        assert.equal(seen.next_spawn, iso(openAt - 5 * MIN));
        assert.equal(seen.pinned_alive, false);
        assert.equal(seen.rift_phase, 'CLOSED');
        assert.equal(db.getBosses().find(b => b.id === created.id).next_spawn, iso(openAt - 5 * MIN));
    });
});

test('kill, still alive and spawn adjust are refused for a rift', async () => {
    await withServer(async (base) => {
        const created = (await (await send(base, 'POST', '/bosses', 'admin', { name: 'Rift A', kind: 'rift', rift: { open_at: iso(Date.now()) } })).json()).boss;
        for (const body of [{ last_kill_time: iso(Date.now()) }, { still_alive: true }, { adjust_spawn_minutes: 10 }]) {
            const res = await send(base, 'PUT', `/bosses/${created.id}`, 'admin', body);
            assert.equal(res.status, 400, JSON.stringify(body));
        }
        assert.equal(db.getBoss(created.id).next_spawn, null);
        assert.equal(db.getBoss(created.id).pinned_alive, false);
    });
});

test('Admin enters the real close time; close wins, durations are kept, alert is cleared', async () => {
    await withServer(async (base) => {
        const created = (await (await send(base, 'POST', '/bosses', 'admin', { name: 'Rift B', kind: 'rift', rift: { run_min: 30 } })).json()).boss;
        await db.updateBoss(created.id, { pre_spawned: true, pre_spawn_expires_at: iso(Date.now() + 60000), alerted_by: 'admin' });
        const closeAt = Date.now() - 10 * MIN;
        const before = db.getDataRevision();
        const res = await send(base, 'PUT', `/bosses/${created.id}`, 'admin', { rift: { open_at: iso(closeAt - 120 * MIN), close_at: iso(closeAt) } });
        assert.equal(res.status, 200);
        const stored = db.getBoss(created.id);
        assert.equal(stored.rift.close_at, iso(closeAt));
        assert.equal(stored.rift.run_min, 30);
        assert.equal(stored.pre_spawned, false);
        assert.equal(stored.alerted_by, null);
        assert.ok(db.getDataRevision() >= before);
        const seen = db.getBosses().find(b => b.id === created.id);
        assert.equal(seen.next_spawn, iso(closeAt + 355 * MIN));
    });
});

test('bad rift input is refused with 400', async () => {
    await withServer(async (base) => {
        assert.equal((await send(base, 'POST', '/bosses', 'admin', { name: 'Rift C', kind: 'rift', rift: { run_min: 0 } })).status, 400);
        const created = (await (await send(base, 'POST', '/bosses', 'admin', { name: 'Rift D', kind: 'rift' })).json()).boss;
        assert.equal((await send(base, 'PUT', `/bosses/${created.id}`, 'admin', { rift: { open_at: 'not a time' } })).status, 400);
    });
});

test('Unset on a rift clears its anchor but keeps its durations', async () => {
    await withServer(async (base) => {
        const created = (await (await send(base, 'POST', '/bosses', 'admin', { name: 'Rift E', kind: 'rift', rift: { cooldown_min: 120, open_at: iso(Date.now()) } })).json()).boss;
        const res = await send(base, 'PUT', `/bosses/${created.id}`, 'admin', { unset_kill_time: true });
        assert.equal(res.status, 200);
        const stored = db.getBoss(created.id);
        assert.equal(stored.rift.open_at, null);
        assert.equal(stored.rift.close_at, null);
        assert.equal(stored.rift.cooldown_min, 120);
        assert.equal(db.getBosses().find(b => b.id === created.id).next_spawn, null);
    });
});

test('editing name and chance of a rift from the dashboard keeps it a rift', async () => {
    await withServer(async (base) => {
        const created = (await (await send(base, 'POST', '/bosses', 'admin', { name: 'Rift F', kind: 'rift', rift: { open_at: iso(Date.now()) } })).json()).boss;
        await send(base, 'PUT', `/bosses/${created.id}`, 'admin', { name: 'Rift F2', interval: '01:00', chance_of_appearing: '40', is_invasion: true });
        const stored = db.getBoss(created.id);
        assert.equal(stored.name, 'Rift F2');
        assert.equal(stored.chance_of_appearing, '40');
        assert.equal(stored.kind, 'rift');
        assert.equal(stored.is_invasion, false);
        assert.equal(stored.next_spawn, null);
    });
});

test('maintenance reset never gives a rift a spawn time', async () => {
    await withServer(async (base) => {
        const created = (await (await send(base, 'POST', '/bosses', 'admin', { name: 'Rift G', kind: 'rift', rift: { open_at: iso(Date.now()) } })).json()).boss;
        await send(base, 'POST', '/bosses/apply-reset-boss-time', 'admin', { maintenance_end_time: '10:00', configs: { [`boss_${created.id}`]: { hours: 1, minutes: 0 } } });
        const stored = db.getBoss(created.id);
        assert.equal(stored.next_spawn, null);
        assert.equal(Boolean(stored.post_maintenance), false);
    });
});

// ---------- Settings menu tab ----------

test('the Settings menu has an Admin-only Rift tab whose body is the rift panel mount', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(__dirname, '../public/build/assets');
    const bundle = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(n => /^dashboard-.*\.js$/.test(n))), 'utf8');
    assert.match(bundle, /ze=\["display","audio","invasion","events",\.\.\.T\?\["rift","admin"\]:\[\]\]/, 'members never see the tab');
    assert.match(bundle, /rt==="rift"&&T&&c\.jsx\("div",\{id:"rift-settings-mount"/);
    const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
    assert.match(server, /rift-schedule\.js\?v=\$\{APP_VERSION\}/);
    assert.match(server, /rift-panel\.js\?v=\$\{APP_VERSION\}/);
});

test('Settings → Events form gets a font color picker, saved through the Admin event color route', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '../public/js/realtime-alerts.js'), 'utf8');
    assert.match(src, /function attachEventColorPickerToSettingsEvents\(\)/);
    assert.match(src, /attachEventColorPickerToSettingsEvents\(\);/, 'called with the other dialog helpers');
    assert.match(src, /'\/events\/' \+ currentEvent\.id \+ '\/color'/);
    assert.match(src, /pending_new_event_color_/);
});

test('font color pickers in Settings never change the shared invasion color', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '../public/js/realtime-alerts.js'), 'utf8');
    const start = src.indexOf('function syncInvasionSettingsAdminLock()');
    const body = src.slice(start, src.indexOf("fetch('/settings/invasion-color'", start));
    assert.match(body, /closest\('\.settings-event-color-picker, #rift-panel, #custom-event-color-picker-container'\)\) continue;/);
});


test('Not spawned on a rift: next start is the missed start + cooldown, alert cleared, a repeat press is refused', async () => {
    await withServer(async (base) => {
        const startAt = Date.now() - 20 * MIN;
        const created = (await (await send(base, 'POST', '/bosses', 'admin', { name: 'Rift H', kind: 'rift', rift: { open_at: iso(startAt) } })).json()).boss;
        await db.updateBoss(created.id, { pre_spawned: true, pre_spawn_expires_at: iso(Date.now() + 60000), alerted_by: 'admin' });
        assert.equal((await send(base, 'PUT', '/bosses/' + created.id, 'member', { not_spawned: true })).status, 403);
        const res = await send(base, 'PUT', '/bosses/' + created.id, 'admin', { not_spawned: true });
        assert.equal(res.status, 200);
        const stored = db.getBoss(created.id);
        assert.equal(stored.rift.close_at, iso(startAt));
        assert.equal(stored.pre_spawned, false);
        assert.equal(stored.next_spawn, null);
        const seen = db.getBosses().find(b => b.id === created.id);
        assert.equal(Date.parse(seen.rift_start_at), Date.parse(stored.rift.close_at) + 360 * MIN);
        assert.equal(seen.pinned_alive, false);
        assert.equal((await send(base, 'PUT', '/bosses/' + created.id, 'admin', { not_spawned: true })).status, 409);
    });
});


test('Spawned on a rift pins the normal timeline to that run and clears a skip', async () => {
    await withServer(async (base) => {
        const startAt = Date.now() - 20 * MIN;
        const created = (await (await send(base, 'POST', '/bosses', 'admin', { name: 'Rift I', kind: 'rift', rift: { open_at: iso(startAt) } })).json()).boss;
        assert.equal((await send(base, 'PUT', '/bosses/' + created.id, 'admin', { not_spawned: true })).status, 200);
        assert.equal((await send(base, 'PUT', '/bosses/' + created.id, 'member', { rift_spawned: true })).status, 403);
        const res = await send(base, 'PUT', '/bosses/' + created.id, 'admin', { rift_spawned: true });
        assert.equal(res.status, 200);
        const stored = db.getBoss(created.id);
        assert.equal(stored.rift.open_at, iso(startAt));
        assert.equal(stored.rift.skip, undefined);
        const seen = db.getBosses().find(b => b.id === created.id);
        assert.equal(seen.rift_phase, 'OPEN');
        assert.equal(seen.pinned_alive, true);
    });
});

// ---------- Dashboard row buttons ----------

test('rift rows show Spawned / Not spawned / Adjust time instead of the kill and still-alive buttons', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(__dirname, '../public/build/assets');
    const bundle = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(n => /^dashboard-.*\.js$/.test(n))), 'utf8');
    // All three row components (NOW rows, still-alive rows, main rows) branch on isRift.
    assert.equal((bundle.match(/!e\.isRift&&c\.jsx\(Oc,\{bossId:i,/g) || []).length, 3, 'kill now hidden for rifts');
    assert.equal((bundle.match(/"data-rift-action":"not_spawned"/g) || []).length, 3);
    assert.equal((bundle.match(/"data-rift-action":"spawned"/g) || []).length, 3);
    assert.equal((bundle.match(/"data-rift-action":"adjust"/g) || []).length, 3);
    assert.equal((bundle.match(/,!e\.isRift&&\w&&c\.jsxs\(c\.Fragment,\{children:\[c\.jsx\("span",\{className:"mx-0\.5 h-3 w-px bg-white\/10"\}\),c\.jsx\(gn,\{bossId:i,action:"still_alive"/g) || []).length, 3, 'still alive / 5m / 1m hidden for rifts');
    // Every place that renders a boss row passes the flag.
    const rows = bundle.match(/c\.jsx\((?:sS|rS|Fc),\{bossId:(\w+)\.id,/g) || [];
    const flagged = bundle.match(/c\.jsx\((?:sS|rS|Fc),\{bossId:(\w+)\.id,isRift:\1\.kind==="rift",/g) || [];
    assert.equal(rows.length, 5);
    assert.equal(flagged.length, rows.length);
    const panel = fs.readFileSync(path.join(__dirname, '../public/js/rift-panel.js'), 'utf8');
    assert.match(panel, /root\.BossTrackerRift = \{ mark \}/);
    assert.match(panel, /rift_spawned: true/);
    assert.match(panel, /not_spawned: true/);
    // 4 buttons do not fit the 76px column: widen it only in tables that hold a rift row.
    assert.ok(panel.includes('table:has([data-rift-action]) col[style*="76px"]{width:104px!important}'));
});

test('a Spawned rift row counts down to its real close next to NOW; other NOW rows are unchanged', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const dir = path.join(__dirname, '../public/build/assets');
    const bundle = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(n => /^dashboard-.*\.js$/.test(n))), 'utf8');
    const start = bundle.indexOf('function uc(');
    const uc = vm.runInNewContext(`(${bundle.slice(start, bundle.indexOf('const hc=', start))})`, {});
    const now = at('22:54') + 40 * 1000;
    assert.equal(uc(at('23:31') + 32 * 1000, true, false, now, true).label, 'NOW · 36m 52s');
    assert.equal(uc(at('23:31') + 32 * 1000, true, false, now, true).overdue, true);
    assert.equal(uc(at('22:26'), true, false, now).label, 'NOW', 'a normal NOW row');
    assert.equal(uc(now - 1000, true, false, now, true).label, 'NOW', 'close passed: plain NOW until the next poll');
    // Only a pinned rift passes its close; both countdown rows re-target to it.
    assert.equal((bundle.match(/riftCloseMs:(\w+)\.kind==="rift"&&\1\.pinned_alive&&\1\.rift_close_at\?Date\.parse\(\1\.rift_close_at\):0,/g) || []).length, 5);
    assert.equal((bundle.match(/\}=e,u=e\.riftCloseMs\|\|riftBaseTargetMs,/g) || []).length, 2);
    assert.equal((bundle.match(/c\.jsx\(ms,\{targetMs:u,untilClose:!!e\.riftCloseMs,/g) || []).length, 4);
});

test('a repeated Spawned does not write again (cost rule)', async () => {
    await withServer(async (base) => {
        const startAt = Date.now() - 20 * MIN;
        const created = (await (await send(base, 'POST', '/bosses', 'admin', { name: 'Rift J', kind: 'rift', rift: { open_at: iso(startAt) } })).json()).boss;
        assert.equal((await send(base, 'PUT', '/bosses/' + created.id, 'admin', { rift_spawned: true })).status, 200);
        const original = db.updateBoss;
        let writes = 0;
        db.updateBoss = (...args) => { writes++; return original.apply(db, args); };
        try {
            const again = await send(base, 'PUT', '/bosses/' + created.id, 'admin', { rift_spawned: true });
            assert.equal(again.status, 200);
            assert.equal(writes, 0, 'nothing changed, so nothing is written');
            assert.equal((await send(base, 'PUT', '/bosses/' + created.id, 'admin', { not_spawned: true })).status, 200);
            assert.equal(writes, 1, 'Not spawned after Spawned still writes');
        } finally {
            db.updateBoss = original;
        }
        assert.equal(db.getBoss(created.id).rift.skip, true);
    });
});
