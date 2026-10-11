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

test('HUD announcement marquee loops seamlessly and is not restarted by repeated polls', () => {
    const overlay = read('desktop-app/overlay/overlay.js');
    const fn = overlay.slice(overlay.indexOf('function updateAnnouncementMarquee() {'), overlay.indexOf('function applyTrackerSnapshot('));
    assert.ok(fn.includes('if (text.dataset.marqueeKey === key) return;'));
    // A second copy follows the first so the loop restart is invisible ("train" style)
    assert.ok(fn.includes("copy.classList.add('ann-seg-copy')"));
    assert.ok(fn.includes('distance = segWidth + MARQUEE_GAP_PX'));

    const apply = overlay.slice(overlay.indexOf('function applyTrackerSnapshot('));
    assert.ok(apply.includes('dom.hudAnnouncementText.dataset.annText !== annText'));

    const css = read('desktop-app/overlay/overlay.css');
    assert.ok(css.includes('animation: hudMarqueeLoop var(--marquee-duration, 10s) linear infinite;'));
    assert.ok(css.includes('translateX(calc(-1 * var(--marquee-distance, 200px)))'));
    assert.equal(css.includes('hudMarqueeBounce'), false);
    assert.ok(css.includes('margin-left: 48px') && overlay.includes('const MARQUEE_GAP_PX = 48;'));
});

test('Firebase rules deny direct client access except the public live event stream', () => {
    const rules = JSON.parse(read('database.rules.json')).rules;
    assert.equal(rules['.read'], false);
    assert.equal(rules['.write'], false);
    assert.equal(rules.tracker.liveEvent['.read'], true);
    assert.equal(rules.tracker.liveEvent['.write'], undefined);
    assert.equal(JSON.stringify(rules).includes('"write":true'), false);
});

test('Vercel functions run next to Firebase in Singapore', () => {
    const vercel = JSON.parse(read('vercel.json'));
    assert.deepEqual(vercel.regions, ['sin1']);
});

test('Desktop updater verifies the installer SHA-256 from the GitHub release before running it', () => {
    const main = read('desktop-app/main.js');
    assert.ok(main.includes("assetSha256: /^sha256:[0-9a-f]{64}$/i.test(setupAsset?.digest || '')"));
    const update = main.slice(main.indexOf('async function startDesktopUpdate()'));
    assert.ok(update.indexOf('await sha256File(tempPath)') > 0);
    assert.ok(update.indexOf('await sha256File(tempPath)') < update.indexOf("spawn(tempPath, ['/S']"));
});

test('Download links never open an empty window inside the desktop app', () => {
    const alerts = read('public/js/realtime-alerts.js');
    assert.ok(alerts.includes("if (/Electron/i.test(navigator.userAgent)) {"));
    assert.ok(alerts.includes("link.removeAttribute('target')"));

    const main = read('desktop-app/main.js');
    assert.ok(main.includes('mainWindow.webContents.setWindowOpenHandler('));
    assert.ok(main.includes("shell.openExternal(url)"));
    assert.ok(main.includes("return { action: 'deny' };"));
});
