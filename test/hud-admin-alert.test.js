const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('desktop-app/overlay/overlay.js', 'utf8').replace(/\r\n/g, '\n');

function extract(name) {
    const start = script.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} not found`);
    const end = script.indexOf('\n}\n', start);
    return script.slice(start, end + 2);
}

const sandbox = {};
vm.runInNewContext(`${extract('hudAlertActive')}; this.hudAlertActive = hudAlertActive;`, sandbox);
const { hudAlertActive } = sandbox;
const now = Date.parse('2026-11-27T01:06:00Z');

test('HUD admin alert is active until it expires, like the dashboard flash', () => {
    assert.equal(hudAlertActive({ pre_spawned: true, pre_spawn_expires_at: '2026-11-27T01:09:55Z' }, now), true);
    assert.equal(hudAlertActive({ pre_spawned: true, pre_spawn_expires_at: '2026-11-27T01:05:00Z' }, now), false);
    assert.equal(hudAlertActive({ pre_spawned: true, pre_spawn_expires_at: null }, now), true);
    assert.equal(hudAlertActive({ pre_spawned: false, pre_spawn_expires_at: '2026-11-27T01:09:55Z' }, now), false);
    assert.equal(hudAlertActive(null, now), false);
});

test('An alerted boss shows at the top of the HUD even while Unset or in focus mode', () => {
    const render = extract('renderBossList');
    // Unset Queen Ant (invasion) was double-clicked on production and never reached the HUD,
    // because Unset bosses sit at the bottom and focus mode hides them.
    assert.match(render, /hudAlertActive\(b, now\)/);
    assert.match(render, /alertBosses\.push\(entry\)/);
    assert.match(render, /for \(const b of alertBosses\) html \+= renderItemCard\(b\)/);
    assert.ok(render.indexOf('alertBosses) html') < render.indexOf('visibleUpcoming) html'), 'alerts render before upcoming');
    assert.ok(!/state\.focusMode[^\n]*alertBosses/.test(render), 'focus mode never hides alerts');
    assert.match(render, /const isPreSpawned = hudAlertActive\(item, now\)/);
    assert.match(script, /group_alert: '🔔 แจ้งเตือน \(Alert\)'/);
    assert.match(script, /group_alert: '🔔 ALERT'/);
});

function renderHud({ bosses, focusMode }) {
    const ctx = {
        Date, Number, String, Boolean, Math, Infinity,
        state: { bosses, events: [], serverOffset: 0, focusMode, lang: 'en', showLocation: false, timeZoneOffset: 7,
            settings: { hideInvasionBosses: false, invasionLabel: 'A9' } },
        dom: { bossListContainer: { innerHTML: '' } },
        t: key => key,
        cacheBossColor() {},
        getCachedBossColor: () => null
    };
    vm.runInNewContext(['hudAlertActive', 'getEffectiveColor', 'formatCountdown', 'formatSpawnClockTime', 'renderBossList']
        .map(extract).join('\n') + '\nrenderBossList();', ctx);
    return ctx.dom.bossListContainer.innerHTML;
}

test('Rendered HUD: an Unset invasion boss that was double-clicked is at the top in focus mode', () => {
    const n = Date.now();
    const html = renderHud({
        focusMode: true,
        bosses: [
            { id: 1, name: 'Valefar', next_spawn: new Date(n + 600000).toISOString() },
            { id: 70, name: 'Queen Ant', is_invasion: true, next_spawn: null, pre_spawned: true, pre_spawn_expires_at: new Date(n + 240000).toISOString() },
            { id: 3, name: 'Old alert', next_spawn: null, pre_spawned: true, pre_spawn_expires_at: new Date(n - 1000).toISOString() },
            { id: 4, name: 'Plain unset', next_spawn: null }
        ]
    });
    const queen = html.indexOf('data-boss-name="Queen Ant"');
    assert.ok(html.indexOf('group_alert (1)') >= 0);
    assert.ok(queen > 0 && queen < html.indexOf('data-boss-name="Valefar"'));
    assert.match(html.slice(queen - 300, queen), /boss-card\s+pre-spawned/);
    assert.ok(html.slice(queen, queen + 400).includes('[A9] Queen Ant'));
    assert.ok(html.includes('🔔 ALERT'));
    // An expired alert and a plain Unset boss stay hidden in focus mode.
    assert.ok(!html.includes('Old alert'));
    assert.ok(!html.includes('Plain unset'));
});
