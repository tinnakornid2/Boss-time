const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('desktop-app/overlay/index.html', 'utf8');
const css = fs.readFileSync('desktop-app/overlay/overlay.css', 'utf8').replace(/\r\n/g, '\n');
const script = fs.readFileSync('desktop-app/overlay/overlay.js', 'utf8');

const rule = selector => {
    const start = css.indexOf(`\n${selector} {`);
    assert.ok(start >= 0, `${selector} rule not found`);
    return css.slice(start, css.indexOf('}', start));
};

test('Compact HUD rows: countdown and spawn time on one line', () => {
    assert.match(rule('.boss-timer-stack'), /flex-direction: row/);
    assert.match(rule('.boss-card'), /min-height: 0/);
});

test('Countdown follows the boss name size: one font control for both', () => {
    // Owner: numbers must always look as big as the boss name, so there is nothing else to adjust.
    const timer = rule('.boss-timer');
    assert.match(timer, /font-size: calc\(var\(--hud-font-size, 11px\) \* 0\.92\)/);
    assert.match(timer, /font-weight: 600/);
    assert.doesNotMatch(timer, /min-width: 44px/);
});

test('HUD font goes down to 7px but the dashboard never gets a size under 10px', () => {
    assert.match(script, /state\.fontSize = Math\.max\(7, Math\.min\(18, Math\.round\(fontSize\)\)\)/);
    // The dashboard only accepts 10-18px; a smaller HUD size stays in the HUD.
    assert.match(script, /fontSize: state\.fontSize >= 10 \? state\.fontSize : undefined/);
    assert.match(script, /tooltip_font_minus: 'ลดขนาด \(ต่ำสุด 7px\)'/);
});

test('Header keeps only the gear menu and click-through; focus and main window live in the menu', () => {
    const header = html.slice(html.indexOf('class="hud-controls"'), html.indexOf('</header>'));
    assert.ok(header.includes('id="btnFontSettings"') && header.includes('lucide-settings'));
    assert.ok(header.includes('id="btnClickThrough"'));
    assert.ok(!header.includes('id="btnHudFocus"') && !header.includes('id="btnOpenMain"'));
    assert.ok(!header.includes('id="fontSizeDisplay"'));
    const menu = html.slice(html.indexOf('id="hudFontPanel"'), html.indexOf('id="labelFontSize"'));
    assert.ok(menu.includes('id="btnHudFocus"') && menu.includes('id="btnOpenMain"'));
    assert.match(script, /menu_focus: 'โหมดโฟกัส'/);
});

test('Text opacity is a local HUD setting; NOW and ALERT rows stay solid', () => {
    assert.match(html, /id="textOpacitySlider"[^>]*min="25"[^>]*max="100"/);
    assert.match(script, /localStorage\.setItem\('hud\.textOpacity'/);
    assert.match(script, /setProperty\('--hud-text-opacity'/);
    assert.match(css, /\.boss-card:not\(\.now\):not\(\.pre-spawned\) > \* \{ opacity: var\(--hud-text-opacity, 1\); \}/);
    assert.match(script, /label_text_opacity: 'ความใสตัวอักษร:'/);
    assert.doesNotMatch(script, /saveHudSettings\(\{ textOpacity/);
});
