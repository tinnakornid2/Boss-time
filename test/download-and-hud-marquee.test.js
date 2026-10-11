const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Download App points to the Setup installer, with Portable as the secondary option', () => {
    const alerts = read('public/js/realtime-alerts.js');
    assert.ok(alerts.includes("const defaultDownloadUrl = 'https://github.com/tinnakornid2/Boss-time/releases/latest/download/BossTracker-Setup.exe';"));
    assert.ok(alerts.includes('id="download-app-setup-link"'));
    assert.ok(alerts.includes("${t('download_modal_cta')}"));
    assert.ok(alerts.includes("${t('download_modal_portable')}"));
    assert.equal(/download_modal_badge: '[^']*Portable/.test(alerts), false);

    const server = read('server/server.js');
    const route = server.slice(server.indexOf("app.get(['/download/app'"), server.indexOf("app.get(['/download/app'") + 800);
    assert.ok(route.includes('BossTracker-Setup.exe'));
    assert.equal(route.includes('Portable.zip'), false);
});

test('HUD announcement marquee is not restarted by repeated polls', () => {
    const overlay = read('desktop-app/overlay/overlay.js');
    const fn = overlay.slice(overlay.indexOf('function updateAnnouncementMarquee() {'), overlay.indexOf('function applyTrackerSnapshot('));
    assert.ok(fn.includes('if (text.dataset.marqueeKey === key) return;'));
    // Measurement happens before any class toggle
    assert.ok(fn.indexOf('text.scrollWidth') < fn.indexOf("text.classList.remove('marquee-active');\n    text.style.removeProperty"));

    const apply = overlay.slice(overlay.indexOf('function applyTrackerSnapshot('));
    assert.ok(apply.includes('dom.hudAnnouncementText.textContent !== annText'));
});
