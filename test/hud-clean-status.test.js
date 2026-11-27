const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('desktop-app/overlay/index.html', 'utf8');
const css = fs.readFileSync('desktop-app/overlay/overlay.css', 'utf8');
const script = fs.readFileSync('desktop-app/overlay/overlay.js', 'utf8');

test('HUD status stays out of the way while connected', () => {
    // A dot in the header carries the status; the bottom bar is hidden while live.
    const title = html.slice(html.indexOf('class="hud-title"'), html.indexOf('class="hud-controls"'));
    assert.ok(title.includes('id="hudStatusDot"'));
    assert.match(css, /\.hud-connection\[data-state="live"\]:not\(\.show-hint\) \{ display: none; \}/);
    assert.match(css, /\.hud-status-dot\[data-state="stale"\]/);
    assert.match(script, /dom\.hudStatusDot\.dataset\.state = connection/);
});

test('Click-through hotkey hint shows briefly, then fades', () => {
    assert.match(script, /const CLICK_THROUGH_HINT_MS = 3000;/);
    assert.match(script, /clickThroughHintTimer = setTimeout\(hideClickThroughHint, CLICK_THROUGH_HINT_MS\)/);
    assert.match(css, /\.hud-connection\.show-hint \.hud-clickthrough-hint \{ animation: hudHintFade 3s/);
});
