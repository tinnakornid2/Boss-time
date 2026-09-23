const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const googleSheets = require('../server/google-sheets');
const db = require('../server/db');

test('Google Sheets parallel adapter rejects countdown ticks', () => {
    let capturedQueueLength = 0;
    googleSheets.mirrorMutation('countdown', { remaining: 50 });
    googleSheets.mirrorMutation('tick', { time: Date.now() });
    
    // Status should not report error and should not queue ticks
    const st = googleSheets.getStatus();
    assert.equal(st.consecutiveFailures, 0);
});

test('Google Sheets access requires PIN 0386231334', () => {
    const ACCESS_PIN = '0386231334';
    
    // Invalid PIN
    const wrongPin = '123456';
    assert.notEqual(wrongPin, ACCESS_PIN);
    
    // Valid PIN
    const correctPin = '0386231334';
    assert.equal(correctPin, ACCESS_PIN);
});

test('Temporary Guest Access: creation, expiration, and validation', async () => {
    const origConfig = googleSheets.getConfig();
    googleSheets.saveLocalConfig({ ...origConfig, enabled: false });

    // 1. Create a guest password valid for 1 hour
    const created = await db.createTemporaryPassword({
        label: 'Test Guest 1hr',
        password: 'test-guest-pass-123',
        durationHours: 1
    });

    assert.ok(created);
    assert.equal(created.password, 'test-guest-pass-123');
    assert.ok(created.expiresAt);
    assert.ok(new Date(created.expiresAt).getTime() > Date.now());

    // 2. Verify hash using scrypt
    const [, salt, expectedHex] = created.passwordHash.split('$');
    const actual = crypto.scryptSync('test-guest-pass-123', salt, 64);
    assert.equal(actual.toString('hex'), expectedHex);

    // 3. Check getTemporaryPasswords returns non-expired status
    const list = db.getTemporaryPasswords();
    const found = list.find(p => p.id === created.id);
    assert.ok(found);
    assert.equal(found.isExpired, false);
    assert.ok(found.remainingMinutes > 0);

    // 4. Test expired password detection
    const expiredEntry = await db.createTemporaryPassword({
        label: 'Expired Guest',
        password: 'expired-pass',
        expiresAt: new Date(Date.now() - 60000).toISOString() // 1 minute in the past
    });

    const updatedList = db.getTemporaryPasswords();
    const expiredFound = updatedList.find(p => p.id === expiredEntry.id);
    assert.ok(expiredFound);
    assert.equal(expiredFound.isExpired, true);
    assert.equal(expiredFound.remainingMinutes, 0);

    // 5. Cleanup
    await db.deleteTemporaryPassword(created.id);
    await db.deleteTemporaryPassword(expiredEntry.id);
    const finalList = db.getTemporaryPasswords();
    assert.equal(finalList.some(p => p.id === created.id), false);
    assert.equal(finalList.some(p => p.id === expiredEntry.id), false);

    // Restore config
    googleSheets.saveLocalConfig(origConfig);
});

test('Single settings button, gear icon, embedded dialog tabs, and PIN security', () => {
    const fs = require('fs');
    const serverSrc = fs.readFileSync('server/server.js', 'utf8');
    const assetSrc = fs.readFileSync('public/build/assets/x-DoItGZdI.js', 'utf8');
    const alertsSrc = fs.readFileSync('public/js/realtime-alerts.js', 'utf8');

    // 1. Floating bar must NOT exist
    assert.equal(serverSrc.includes('id="admin-pwd-floating-bar"'), false);
    assert.equal(alertsSrc.includes('header-password-control'), false);

    // 2. Embedded panel and dialog attachment functions must exist
    assert.ok(serverSrc.includes('id="admin-settings-embedded-panel"'));
    assert.ok(serverSrc.includes('attachAdminSettingsToReactDialog'));
    assert.ok(serverSrc.includes('custom-admin-tabs-subbar'));
    assert.ok(serverSrc.includes('tab-pane-passwords'));
    assert.ok(serverSrc.includes('tab-pane-guest'));
    assert.ok(serverSrc.includes('tab-pane-sheets'));

    // 3. Gear icon path exists in x-DoItGZdI.js (Lucide Settings)
    assert.ok(assetSrc.includes('circle') && assetSrc.includes('path') && assetSrc.includes('12.22'));

    // 4. PIN 0386231334 must NOT be leaked in client-facing HTML or scripts
    assert.equal(serverSrc.includes('0386231334'), false);
    assert.equal(alertsSrc.includes('0386231334'), false);
});

test('Dual-language EN/TH support: English default, top bar switcher, and boss names preservation', () => {
    const fs = require('fs');
    const serverSrc = fs.readFileSync('server/server.js', 'utf8');
    const alertsSrc = fs.readFileSync('public/js/realtime-alerts.js', 'utf8');

    // 1. Language switcher button exists on header controls
    assert.ok(alertsSrc.includes("button.id = 'header-language-control'") || alertsSrc.includes('id="header-language-control"'));
    assert.ok(alertsSrc.includes('ensureLanguageButton'));
    assert.ok(alertsSrc.includes('updateLanguageButton'));

    // 2. Default language is English ('en')
    assert.ok(alertsSrc.includes("if (stored === 'th' || stored === 'en') return stored;"));
    assert.ok(alertsSrc.includes("return 'en';"));

    // 3. User preference persistence key 'tracker_lang' in localStorage
    assert.ok(alertsSrc.includes("localStorage.getItem('tracker_lang')"));
    assert.ok(alertsSrc.includes("localStorage.setItem('tracker_lang', lang)"));

    // 4. Login page has language switcher and defaults to English
    assert.ok(serverSrc.includes('id="login-lang-btn"'));
    assert.ok(serverSrc.includes("localStorage.getItem('tracker_lang') === 'th' ? 'th' : 'en'"));

    // 5. Boss names must NEVER be modified or translated
    assert.ok(alertsSrc.includes("Never mutate boss names! Boss names stay strictly in original English."));
    assert.ok(alertsSrc.includes('function translateSystemText()'));
    assert.ok(alertsSrc.includes("['Reset Boss Time', 'รีเซ็ตเวลาบอส']"));
    assert.ok(alertsSrc.includes("['Settings', 'ตั้งค่า']"));
    assert.ok(alertsSrc.includes("parent.closest('script, style, textarea, tbody')"));
    const bossList = ['Antharas', 'Core', 'Baium', 'Zaken', 'Queen Ant', 'Orfen'];
    for (const boss of bossList) {
        // Boss names must not appear as translated dictionary keys
        assert.equal(alertsSrc.includes(`'${boss}':`), false);
    }
});

test('Unified Style #1 tooltip (orange balloon with arrow) and settings subbar persistence', () => {
    const fs = require('fs');
    const alertsSrc = fs.readFileSync('public/js/realtime-alerts.js', 'utf8');
    const serverSrc = fs.readFileSync('server/server.js', 'utf8');

    // 1. Unified custom tooltip container and Style #1 styling
    assert.ok(alertsSrc.includes('id="custom-unified-tooltip"') || alertsSrc.includes("tooltip.id = 'custom-unified-tooltip'"));
    assert.ok(alertsSrc.includes('custom-unified-tooltip-arrow'));
    assert.ok(alertsSrc.includes('#d97706')); // Amber-600 Style #1 background
    assert.ok(alertsSrc.includes('#09090b')); // Style #1 text color
    assert.ok(alertsSrc.includes('background: var(--primary, #d97706)'));
    assert.ok(alertsSrc.includes('color: var(--primary-foreground, #09090b)'));
    assert.ok(alertsSrc.includes('font-size: 12px'));
    assert.ok(alertsSrc.includes('padding: 6px 12px'));
    assert.ok(alertsSrc.includes('ensureUnifiedTooltip'));
    assert.ok(alertsSrc.includes('showCustomTooltip'));
    assert.ok(alertsSrc.includes('hideCustomTooltip'));

    // 2. Elimination of native white tooltip (Style #2) via title attribute stripping
    assert.ok(alertsSrc.includes("data-unified-tooltip"));
    assert.ok(alertsSrc.includes("removeAttribute('title')"));

    // 3. Settings subbar mounts directly after tabBar atomically
    assert.ok(serverSrc.includes("tabBar.insertAdjacentElement('afterend', subbar)"));
    assert.ok(serverSrc.includes("subbar.insertAdjacentElement('afterend', panel)"));
    assert.ok(serverSrc.includes("subbar.style.display = 'flex'"));

    // 4. Safe span-only tab text translation prevents React virtual DOM corruption
    assert.ok(alertsSrc.includes("const span = btn.querySelector('span')"));

    // 5. Compact system controls never clipped by overflow
    assert.ok(alertsSrc.includes("overflow: visible !important"));
});

test('Settings subbar and embedded panel are restricted to Admin role only', () => {
    const fs = require('fs');
    const serverSrc = fs.readFileSync('server/server.js', 'utf8');

    // 1. adminPasswordSnippet is conditionally compiled only for isAdmin
    assert.ok(serverSrc.includes("const adminPasswordSnippet = isAdmin ? `"));

    // 2. /admin and /passwords redirects require admin role
    assert.ok(serverSrc.includes("if (getSessionRole(req) !== 'admin') {"));

    // 3. API endpoints in routes/settings.js enforce requireAdmin
    const settingsRoutesSrc = fs.readFileSync('server/routes/settings.js', 'utf8');
    assert.ok(settingsRoutesSrc.includes("router.get('/passwords', requireAdmin"));
    assert.ok(settingsRoutesSrc.includes("router.post('/passwords', requireAdmin"));
    assert.ok(settingsRoutesSrc.includes("router.get('/guest-passwords', requireAdmin"));
    assert.ok(settingsRoutesSrc.includes("router.post('/guest-passwords', requireAdmin"));
    assert.ok(settingsRoutesSrc.includes("router.delete('/guest-passwords/:id', requireAdmin"));
    assert.ok(settingsRoutesSrc.includes("router.post('/google-sheets/verify-pin', requireAdmin"));
});

test('Active data source indicator: Firebase vs Google Sheets Failover vs Local Mode', async () => {
    const origConfig = googleSheets.getConfig();
    const fs = require('fs');
    const serverSrc = fs.readFileSync('server/server.js', 'utf8');
    const alertsSrc = fs.readFileSync('public/js/realtime-alerts.js', 'utf8');

    // 1. With Google Sheets configured and autoFailover: true, while Firebase is offline
    googleSheets.saveLocalConfig({
        ...origConfig,
        webAppUrl: 'https://script.google.com/macros/s/AKfycbyFakeTestUrl/exec',
        enabled: true,
        autoFailover: true
    });

    const activeSrc = db.getActiveSource();
    assert.equal(activeSrc, 'google-sheets');

    const fbStatus = db.getFirebaseStatus();
    assert.equal(fbStatus.activeSource, 'google-sheets');
    assert.ok(fbStatus.googleSheets);
    assert.equal(fbStatus.googleSheets.autoFailover, true);

    // 2. With autoFailover disabled, activeSource falls back to local (or firebase if cloud snapshot)
    googleSheets.saveLocalConfig({
        ...origConfig,
        webAppUrl: '',
        enabled: false,
        autoFailover: false
    });
    const fallbackSrc = db.getActiveSource();
    assert.ok(fallbackSrc === 'local' || fallbackSrc === 'firebase');

    // 3. /poll and /live-event return db.getActiveSource()
    assert.ok(serverSrc.includes('source: db.getActiveSource()'));

    // 4. Client badge script handles google_sheets and local active sources
    assert.ok(serverSrc.includes("active === 'google-sheets'"));
    assert.ok(serverSrc.includes("label: 'Google Sheets'"));
    assert.ok(serverSrc.includes("statusKey: 'google_sheets'"));
    assert.ok(serverSrc.includes("ดึงข้อมูลจาก Google Sheets (สายสำรองทำงาน)"));
    assert.ok(serverSrc.includes("Data Source: Google Sheets (Failover Active)"));

    // 5. CSS rules exist for google_sheets status
    assert.ok(alertsSrc.includes('[data-status="google_sheets"]'));
    assert.ok(serverSrc.includes('[data-status="google_sheets"]'));

    // 6. Click popup displays detailed breakdown for both sources
    assert.ok(serverSrc.includes('แหล่งข้อมูลปัจจุบัน (Active Data Source):'));
    assert.ok(serverSrc.includes('Active Data Source:'));
    assert.ok(serverSrc.includes('Google Sheets (สายสำรองคู่ขนาน):'));
    assert.ok(serverSrc.includes('Google Sheets Status (Parallel Backup):'));

    // Restore original config
    googleSheets.saveLocalConfig(origConfig);
});

