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
    assert.match(html, /id="hudClickThroughHint"/);
    assert.match(html, /id="labelMainWindowSection"/);
    assert.match(script, /updateClickThroughHint\(\)/);
    assert.match(script, /clickthrough_hint: 'คลิกทะลุอยู่ · กด \{key\} เพื่อกลับ'/);
    assert.match(script, /main_window_section: 'Main window \(not HUD\)'/);
});
