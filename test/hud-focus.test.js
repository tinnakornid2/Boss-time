const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('desktop-app/overlay/index.html', 'utf8');
const script = fs.readFileSync('desktop-app/overlay/overlay.js', 'utf8');

test('HUD focus mode is a local, reversible view preference', () => {
    assert.match(html, /id="btnHudFocus"[^>]*aria-pressed="false"/);
    assert.match(script, /localStorage\.getItem\('bossTracker\.hudFocusMode'\)/);
    assert.match(script, /localStorage\.setItem\('bossTracker\.hudFocusMode', String\(state\.focusMode\)\)/);
    // Overdue items show as NOW, so they must not use up the five upcoming places.
    assert.ok(script.includes('[...upcomingBosses.filter(b => b.diff <= 0), ...upcomingBosses.filter(b => b.diff > 0).slice(0, 5)]'));
    assert.match(script, /state\.focusMode \? \[\] : unsetBosses/);
    assert.match(script, /for \(const b of nowBosses\) html \+= renderItemCard\(b\)/);
});

test('HUD tells users how to exit click-through and separates main-window settings', () => {
    // The hint shares the status bar instead of taking a line from the boss list.
    const bar = html.slice(html.indexOf('id="hudConnection"'), html.indexOf('id="toastContainer"'));
    assert.ok(bar.includes('id="hudClickThroughHint"'));
    assert.match(html, /id="labelMainWindowSection"/);
    assert.match(script, /updateClickThroughHint\(\)/);
    assert.match(script, /clickthrough_hint: 'กด \{key\} เพื่อกลับ'/);
    assert.match(script, /main_window_section: 'Main window \(not HUD\)'/);
});

test('Main-window section holds only the width; HUD opacity and hotkey stay above it', () => {
    const at = id => html.indexOf('id="' + id + '"');
    const order = ['labelOpacity', 'labelHotkey', 'customHotkeyRow', 'labelMainWindowSection', 'labelPanelWidth', 'labelAppVersion'].map(at);
    assert.ok(order.every(i => i > 0));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('HUD header stays on one line when the HUD is narrow', () => {
    const css = fs.readFileSync('desktop-app/overlay/overlay.css', 'utf8');
    assert.match(css, /\.hud-header \{[^}]*white-space: nowrap/);
    assert.match(css, /\.hud-title \{[^}]*font-size: 8px/);
    assert.match(css, /@media \(max-width: 290px\) \{\s*\.hud-title-text, #hudUpdateBadgeText \{ display: none; \}/);
});
