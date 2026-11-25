const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHudSync, isSignedOut, SYNC_INTERVAL_MS } = require('../desktop-app/hud-sync');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'desktop-app', file), 'utf8');

function setup() {
    const c = { wanted: true, clock: 0, next: { ok: true, data: { bosses: [] } }, fetches: [], sent: [], logins: [] };
    c.hud = createHudSync({
        now: () => c.clock,
        isHudWanted: () => c.wanted,
        fetchState: async opts => {
            c.fetches.push(opts.full);
            if (c.next instanceof Error) throw c.next;
            return c.next;
        },
        sendToHud: r => c.sent.push(r),
        setLoggedIn: v => c.logins.push(v)
    });
    return c;
}

test('HUD sync: the desktop app has one polling timer and the HUD has none', () => {
    const main = read('main.js');
    const overlay = read('overlay/overlay.js');
    assert.equal(main.match(/hudSync\.sync\(\), SYNC_INTERVAL_MS/g).length, 1);
    assert.doesNotMatch(overlay, /setInterval\(\s*fetchPollData/);
    assert.ok(SYNC_INTERVAL_MS >= 5000);
});

test('HUD sync: nothing is requested while the HUD is hidden, unless forced', async () => {
    const c = setup();
    c.wanted = false;
    await c.hud.sync();
    assert.equal(c.fetches.length, 0);
    await c.hud.sync({ force: true });
    assert.equal(c.fetches.length, 1);
});

test('HUD sync: full state first, then only changes; full again after requestFull', async () => {
    const c = setup();
    await c.hud.sync();
    c.next = { ok: true, unchanged: true, serverTime: 5 };
    await c.hud.sync();
    c.hud.requestFull();
    await c.hud.sync();
    assert.deepEqual(c.fetches, [true, false, true]);
    assert.deepEqual(c.sent[1], { ok: true, unchanged: true, serverTime: 5 });
});

test('HUD sync: transient failures never hide or clear the HUD', async () => {
    const c = setup();
    await c.hud.sync();
    for (const bad of [{ ok: false, status: 503 }, { ok: false, error: 'offline' }, null, new Error('page reload')]) {
        c.next = bad;
        await c.hud.sync();
    }
    assert.deepEqual(c.logins, [true]);
    assert.equal(c.sent.length, 1);
});

test('HUD sync: sign-out hides the HUD at once and the next sign-in gets full state', async () => {
    const c = setup();
    await c.hud.sync();
    for (const out of [{ ok: false, status: 401 }, { ok: false, status: 403 }, { ok: false, notAuthenticated: true }]) {
        assert.ok(isSignedOut(out));
        c.next = out;
        await c.hud.sync();
        assert.equal(c.logins.at(-1), false);
        assert.equal(c.sent.at(-1).ok, false);
    }
    c.next = { ok: true, data: {} };
    await c.hud.sync();
    assert.equal(c.fetches.at(-1), true);
    assert.equal(c.logins.at(-1), true);
});

test('HUD sync: no overlap; a forced sync during a running one runs afterwards; a stuck one is replaced', async () => {
    const c = setup();
    const waiting = [];
    const hud = createHudSync({
        now: () => c.clock, isHudWanted: () => true,
        fetchState: () => new Promise(resolve => waiting.push(resolve)),
        sendToHud: r => c.sent.push(r), setLoggedIn: () => {}
    });
    const first = hud.sync();
    await hud.sync();
    await hud.sync({ force: true });
    assert.equal(waiting.length, 1);
    waiting[0]({ ok: true, data: 1 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(waiting.length, 2);
    c.clock += 16000;
    const third = hud.sync();
    assert.equal(waiting.length, 3);
    waiting[1]({ ok: true, data: 'late' });
    waiting[2]({ ok: true, data: 'new' });
    await Promise.all([first, third]);
    assert.deepEqual(c.sent.map(r => r.data), [1, 'new']);
});

test('HUD sync: the helper is packaged with the desktop app', () => {
    const pack = fs.readFileSync(path.join(__dirname, '../scripts/pack-desktop.js'), 'utf8');
    assert.match(pack, /['"]hud-sync\.js['"]/);
});
