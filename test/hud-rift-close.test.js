const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('desktop-app/overlay/overlay.js', 'utf8').replace(/\r\n/g, '\n');

function extract(name) {
    const start = script.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} not found`);
    return script.slice(start, script.indexOf('\n}\n', start) + 2);
}

function renderHud(bosses, settings = {}) {
    const ctx = {
        Date, Number, String, Boolean, Math, Infinity,
        state: { bosses, events: [], serverOffset: 0, focusMode: false, lang: 'en', showLocation: false, timeZoneOffset: 7,
            settings: { hideInvasionBosses: false, invasionLabel: 'A9', ...settings } },
        dom: { bossListContainer: { innerHTML: '' } },
        t: key => key,
        cacheBossColor() {},
        getCachedBossColor: () => null
    };
    vm.runInNewContext(['hudAlertActive', 'getEffectiveColor', 'formatCountdown', 'formatSpawnClockTime', 'renderBossList']
        .map(extract).join('\n') + '\nrenderBossList();', ctx);
    return ctx.dom.bossListContainer.innerHTML;
}

const card = (html, name) => html.slice(html.indexOf(`data-boss-name="${name}"`), html.indexOf(`data-boss-name="${name}"`) + 700);

test('HUD: a Spawned rift counts down to its real close next to NOW, with the close time under it', () => {
    const n = Date.now();
    const html = renderHud([{
        id: 9, name: 'Maluk', kind: 'rift', pinned_alive: true,
        next_spawn: new Date(n - 30 * 60000).toISOString(),
        rift_close_at: new Date(n + 36 * 60000 + 50000).toISOString()
    }]);
    const row = card(html, 'Maluk');
    assert.match(row, /timer-now">NOW · 36m (4|5)\ds</);
    const close = new Date(n + 36 * 60000 + 50000 + 7 * 3600000);
    assert.ok(row.includes(`${String(close.getUTCHours()).padStart(2, '0')}:${String(close.getUTCMinutes()).padStart(2, '0')}`), 'close clock shown');
});

test('HUD: other NOW rows (normal bosses, an unpinned rift) still read plain NOW', () => {
    const n = Date.now();
    const html = renderHud([
        { id: 1, name: 'Valefar', next_spawn: new Date(n - 60000).toISOString() },
        { id: 9, name: 'Maluk', kind: 'rift', pinned_alive: false, next_spawn: new Date(n - 60000).toISOString(), rift_close_at: new Date(n + 3600000).toISOString() }
    ]);
    assert.match(card(html, 'Valefar'), /timer-now">NOW</);
    assert.match(card(html, 'Maluk'), /timer-now">NOW</);
});

test('HUD: the shared Invasion colour wins over a per-boss colour, like the dashboard', () => {
    const n = Date.now();
    const bosses = [
        { id: 70, name: 'Queen Ant', is_invasion: true, color: '#22c55e', next_spawn: new Date(n + 600000).toISOString() },
        { id: 2, name: 'Valefar', color: '#22c55e', next_spawn: new Date(n + 600000).toISOString() }
    ];
    const html = renderHud(bosses, { invasionColor: '#ef4444' });
    assert.match(card(html, 'Queen Ant'), /color: #ef4444/);
    assert.match(card(html, 'Valefar'), /color: #22c55e/, 'normal bosses keep their own colour');
    assert.match(card(renderHud(bosses, { invasionColor: '' }), 'Queen Ant'), /color: #22c55e/, 'no shared colour: own colour');
    assert.match(script, /invasionColor: data\.invasionColor \|\| '#facc15'/, 'same default as the server');
});

test('the desktop app no longer calls the non-existent POST /bosses/:id/alert', () => {
    assert.ok(!fs.readFileSync('desktop-app/main.js', 'utf8').includes('/alert\''));
    assert.ok(!fs.readFileSync('desktop-app/preload.js', 'utf8').includes('toggleBossAlert'));
});
