const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { getStatus, STALE_AFTER_MS } = require('../desktop-app/overlay/hud-connection');

test('HUD distinguishes connecting, live, and stale without a server request', () => {
    const now = 100_000;
    assert.equal(getStatus(0, false, now), 'connecting');
    assert.equal(getStatus(now - STALE_AFTER_MS + 1, false, now), 'live');
    assert.equal(getStatus(now - STALE_AFTER_MS, false, now), 'stale');
    assert.equal(getStatus(now, true, now), 'stale');
    assert.equal(getStatus(now, false, now), 'live');
});

test('HUD status shows last fresh snapshot and preserves boss rows during transient failures', () => {
    const html = fs.readFileSync('desktop-app/overlay/index.html', 'utf8');
    const script = fs.readFileSync('desktop-app/overlay/overlay.js', 'utf8');
    assert.match(html, /id="hudConnection"[^>]*role="status"/);
    assert.match(html, /<script src="hud-connection\.js"><\/script>\s*<script src="overlay\.js"><\/script>/);
    assert.match(script, /if \(!state\.serverSnapshotStale\) state\.lastFreshSnapshotAt = Date\.now\(\)/);
    assert.match(script, /getStatus\(\s*state\.lastFreshSnapshotAt,\s*state\.serverSnapshotStale/);
    assert.match(script, /Temporary network\/server failure: keep the last snapshot and local countdown/);
    assert.match(script, /renderBossList\(\);\s*renderConnectionStatus\(\);\s*scheduleHudTick\(\);/);
});

test('HUD tolerates two missed syncs and treats an unchanged reply as fresh', () => {
    const script = fs.readFileSync('desktop-app/overlay/overlay.js', 'utf8');
    assert.ok(STALE_AFTER_MS > 2 * require('../desktop-app/hud-sync').SYNC_INTERVAL_MS);
    const unchanged = script.match(/if \(res && res\.ok && res\.unchanged\) \{[\s\S]*?return;/)[0];
    assert.match(unchanged, /lastFreshSnapshotAt = Date\.now\(\)/);
});

test('HUD closes on auth loss instead of treating it as a transient failure', () => {
    const script = fs.readFileSync('desktop-app/overlay/overlay.js', 'utf8');
    assert.match(script, /res\?\.status === 401 \|\| res\?\.status === 403/);
});
