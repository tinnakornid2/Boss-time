const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('realtime alert bridge does not reorder React-managed boss rows', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    assert.doesNotMatch(source, /function\s+pinNowBossRows\s*\(/);
    assert.doesNotMatch(source, /insertBefore\(fragment,\s*body\.firstChild\)/);
});

test('realtime alert popup stays away from top boss names', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    assert.match(source, /left:12px;bottom:12px;right:auto;top:auto/);
    assert.doesNotMatch(source, /left:50%;top:52px;transform:translateX\(-50%\)/);
    assert.match(source, /setTimeout\(\(\) => toast\.remove\(\), 10000\)/);
});

test('Kill Now captures first-click time and requires a second click before submitting', () => {
    const bundle = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'build', 'assets', 'dashboard-B9CVP--8.js'),
        'utf8'
    );

    assert.match(bundle, /if\(!s\)\{o\.killTime=window\.getTrackerServerNow\?window\.getTrackerServerNow\(\):new Date,r\(!0\).*setTimeout\(\(\)=>\{r\(!1\),o\.killTime=null\},1500\);return\}/);
    assert.match(bundle, /i\(n,o\.killTime\?\?new Date\),o\.killTime=null/);
    assert.match(bundle, /last_kill_time:Aa\(Ee\?\?new Date\)/);
    assert.doesNotMatch(bundle, /a=function\(\)\{i\(n\),r\(!0\)/);
});

test('Kill Now uses the shared server clock offset instead of the device clock', () => {
    const bridge = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    assert.match(bridge, /window\.getTrackerServerNow = function \(\) \{/);
    assert.match(bridge, /new Date\(Date\.now\(\) \+ state\.serverOffset\)/);
    assert.match(bridge, /page\.props\?\.serverTime/);
    assert.match(bridge, /state\.serverOffset = Number\(data\.serverTime\) - Date\.now\(\)/);
});

test('event actions retain genuine two-click confirmation', () => {
    const bundle = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'build', 'assets', 'dashboard-B9CVP--8.js'),
        'utf8'
    );

    assert.match(bundle, /function \$s\(t\).*l\?\(.*a\(\)\):\(u\(!0\).*setTimeout\(\(\)=>u\(!1\),3e3\)\)/);
    assert.match(bundle, /Mark event done \(click 2x\)/);
    assert.match(bundle, /Skip today \(click 2x\)/);
    assert.match(bundle, /Pin still alive \(click 2x\)/);
});

test('status action tooltips describe their real single-click behavior', () => {
    const bundle = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'build', 'assets', 'dashboard-B9CVP--8.js'),
        'utf8'
    );
    const bridge = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    for (const label of ['Still alive', 'Spawn in 5 min', 'Spawn in 1 min', 'Not spawned']) {
        assert.match(bundle, new RegExp(`tooltip:\\"${label}\\",confirmedTooltip:\\"Applied\\"`));
        assert.doesNotMatch(bundle, new RegExp(`tooltip:\\"${label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')} \\(click 2x\\)`));
    }
    assert.match(bridge, /tooltip_action_applied: 'ดำเนินการแล้ว'/);
});

test('boss color rules survive React row replacement and stay keyed by boss id', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );
    const start = source.indexOf('    function getEffectiveBossColor(');
    const end = source.indexOf('    function applyRowBossColor(', start);
    assert.ok(start >= 0 && end > start);

    const styles = new Map();
    const state = {
        settings: { invasionColor: '#a855f7' },
        bosses: new Map([
            [10, { id: 10, name: 'Medusa', color: '#38bdf8', is_invasion: false }],
            [65, { id: 65, name: 'Medusa', color: '#ffffff', is_invasion: true }],
            [42, { id: 42, name: 'Talakin', color: null, is_invasion: false }]
        ])
    };
    const document = {
        head: { appendChild(element) { styles.set(element.id, element); } },
        getElementById(id) { return styles.get(id) || null; },
        createElement() { return { id: '', textContent: '' }; }
    };
    const context = { state, document, localStorage: { getItem() { return null; } } };
    vm.runInNewContext(`${source.slice(start, end)}\nsyncBossColorStyles();`, context);

    const css = styles.get('boss-name-colors-by-id').textContent;
    assert.match(css, /tr\[data-boss-id="10"\].*color:#38bdf8!important/);
    assert.match(css, /tr\[data-boss-id="65"\].*color:#a855f7!important/);
    assert.doesNotMatch(css, /data-boss-id="42"/);
    assert.doesNotMatch(css, /data-event-id|Medusa|Talakin/);
});

test('old live events cannot replace a newer boss color from the full poll snapshot', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );
    const start = source.indexOf('    function consumeLiveEvent(');
    const end = source.indexOf('    // Reuse the dashboard', start);
    assert.ok(start >= 0 && end > start);

    const current = { id: 28, name: 'Medusa', color: '#38bdf8', updated_at: '2026-09-24T06:00:00.000Z' };
    const oldEvent = {
        id: 'old-color', type: 'boss_updated', bossId: 28,
        boss: { ...current, color: null, updated_at: '2026-09-24T05:00:00.000Z' },
        createdAt: 0
    };
    const state = {
        bosses: new Map([[28, current]]), events: new Map(), seenEventIds: new Set(),
        initialEventsLoaded: true, serverOffset: 0, settings: {}
    };
    const context = {
        state,
        sessionStorage: { setItem() {}, getItem() { return null; } },
        reconcileBossRows() {}, updateStatus() {}, Date, Number,
        document: { visibilityState: 'visible' }
    };
    vm.runInNewContext(source.slice(start, end), context);

    context.consumeLiveEvent(oldEvent, true, true);
    assert.equal(state.bosses.get(28).color, '#38bdf8');
    context.consumeLiveEvent({ ...oldEvent, id: 'old-stream' }, true);
    assert.equal(state.bosses.get(28).color, '#38bdf8');
    context.consumeLiveEvent({
        ...oldEvent, id: 'same-time-stream',
        boss: { ...current, color: null }
    }, true);
    assert.equal(state.bosses.get(28).color, '#38bdf8');
    context.consumeLiveEvent({
        ...oldEvent, id: 'new-stream',
        boss: { ...current, color: '#a855f7', updated_at: '2026-09-24T07:00:00.000Z' }
    }, true);
    assert.equal(state.bosses.get(28).color, '#a855f7');
});
test('Action toast (kill and event undo) sits at bottom-left corner of screen', () => {
    const bundle = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'build', 'assets', 'dashboard-B9CVP--8.js'),
        'utf8'
    );

    assert.match(bundle, /className:"fixed bottom-4 left-4 z-50 flex items-center gap-3/);
    assert.doesNotMatch(bundle, /className:"fixed bottom-4 left-1\/2 z-50 flex -translate-x-1\/2 items-center gap-3/);
});
test('checkScheduledAlerts triggers showNotice for both bosses and events regardless of tab visibility', () => {
    const alertsSource = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    assert.match(alertsSource, /left:12px;bottom:12px;right:auto;top:auto/);
    assert.match(alertsSource, /Notification\.permission === 'granted'/);
    assert.match(alertsSource, /if \(!handledByDashboard\) \{\s*playSound/);
});
test('Realtime alerts stack multiple toasts vertically with earlier boss floating upward', () => {
    const alertsSource = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    // Verify container uses flex column anchored at bottom-left
    assert.match(alertsSource, /id = 'realtime-toast-container'/);
    assert.match(alertsSource, /left:12px;bottom:12px;right:auto;top:auto;display:flex;flex-direction:column;gap:6px/);
    assert.match(alertsSource, /container\.appendChild\(toast\)/);
    // Verify max 3 items to avoid blocking game UI
    assert.match(alertsSource, /container\.children\.length >= 3/);
    assert.match(alertsSource, /container\.firstElementChild\.remove\(\)/);
});
test('Spawned alert replaces earlier pre-spawn alert for the same boss without competing for space', () => {
    const alertsSource = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    // Verify removeTargetNotice helper exists
    assert.match(alertsSource, /function removeTargetNotice\(targetId\)/);
    // Verify showNotice removes prior alert for same target
    assert.match(alertsSource, /if \(targetId !== null\) \{\s*removeTargetNotice\(targetId\);/);
    // Verify targetId is tagged on toast DOM
    assert.match(alertsSource, /toast\.setAttribute\('data-alert-target', String\(targetId\)\)/);
    // Verify checkScheduledAlerts passes targetId
    assert.match(alertsSource, /showNotice\(\s*t\('spawn_soon_notice'[^)]+\),\s*false,\s*`\${kind}_\${item\.id}`,\s*'spawn_soon'/);
    assert.match(alertsSource, /showNotice\(\s*t\('spawned_notice'[^)]+\),\s*true,\s*`\${kind}_\${item\.id}`,\s*'spawned'/);
});

test('Realtime alert differentiates invasion bosses with tag, invasion color, and custom boss font colors', () => {
    const alertsSource = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    // Verify getItemAlertDisplay helper exists and formats invasion label & colors
    assert.match(alertsSource, /function getItemAlertDisplay\(item, kind\)/);
    assert.match(alertsSource, /const isInvasion = kind === 'boss' && Boolean\(item\.is_invasion\)/);
    assert.ok(alertsSource.includes("prefixTag = `[${invLabel}] `;"));
    assert.match(alertsSource, /color = getEffectiveBossColor\(item\)/);

    // Verify negative diff guard (strictly diff > 0 for spawn soon notice)
    assert.match(alertsSource, /if \(diff > 0 && diff <= threshold && !state\.alerted\.has\(preKey\)\)/);

    // Verify cold page load stale alert suppression
    assert.match(alertsSource, /const isFirstScan = !state\.initialAlertScanDone/);
    assert.match(alertsSource, /if \(isFirstScan\) \{\s*if \(diff <= 0\) state\.alerted\.add\(spawnKey\)/);

    // Verify invasion filter respect
    assert.match(alertsSource, /if \(kind === 'boss' && item\.is_invasion\) \{\s*if \(isInvasionHidden\(\)\) \{\s*continue;/);

    // Verify rich toast styling supports invasion & custom font colors
    assert.match(alertsSource, /if \(options && \(customColor \|\| isInvasion/);
    assert.match(alertsSource, /borderStyle = invColor/);
});

test('Strict invasion visibility: alerts are completely forbidden when invasion bosses are hidden', () => {
    const alertsSource = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    // Verify isInvasionHidden helper inspects state.settings, localStorage, and data-page
    assert.match(alertsSource, /function isInvasionHidden\(\)/);
    assert.match(alertsSource, /state\.settings && typeof state\.settings\.hideInvasionBosses === 'boolean'/);
    assert.match(alertsSource, /localStorage\.getItem\('dashboard\.hideInvasionBosses'\)/);

    // Verify consumeLiveEvent forbids pre-spawn alert for invasion bosses when hidden
    assert.match(alertsSource, /if \(boss\?\.is_invasion && isInvasionHidden\(\)\) \{\s*return;\s*\/\/\s*FORBID alert when invasion visibility is off/);

    // Verify poll captures hideInvasionBosses
    assert.match(alertsSource, /if \(data\.hideInvasionBosses !== undefined\) \{\s*if \(!state\.settings\) state\.settings = \{\};\s*state\.settings\.hideInvasionBosses = Boolean\(data\.hideInvasionBosses\);/);

    // Verify initial data read captures hideInvasionBosses
    assert.match(alertsSource, /if \(page\.props\?\.hideInvasionBosses !== undefined\) \{\s*state\.settings\.hideInvasionBosses = Boolean\(page\.props\.hideInvasionBosses\);/);

    // Verify window.fetch intercepts /settings/invasion-visibility
    assert.match(alertsSource, /requestUrl\.includes\('\/settings\/invasion-visibility'\)/);
});

test('Functional check: isInvasionHidden correctly reflects settings and suppresses invasion display', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );
    const startInvasion = source.indexOf('        function isInvasionHidden(');
    const endDisplay = source.indexOf('    function showNotice(', startInvasion);
    const startColor = source.indexOf('    function getEffectiveBossColor(');
    const endColor = source.indexOf('    function syncBossColorStyles(', startColor);
    assert.ok(startInvasion >= 0 && endDisplay > startInvasion, 'isInvasionHidden and getItemAlertDisplay found');
    assert.ok(startColor >= 0 && endColor > startColor, 'getEffectiveBossColor found');

    const store = new Map();
    const context = {
        state: {
            settings: { hideInvasionBosses: true, invasionLabel: 'L3', invasionColor: '#facc15' },
            bosses: new Map()
        },
        document: {
            getElementById() { return null; }
        },
        localStorage: {
            getItem(key) { return store.get(key) || null; },
            setItem(key, val) { store.set(key, String(val)); }
        },
        String,
        Boolean
    };

    const codeToRun = source.slice(startInvasion, endDisplay) + '\n' + source.slice(startColor, endColor);
    vm.runInNewContext(codeToRun, context);

    // 1. When settings.hideInvasionBosses is true
    assert.equal(context.isInvasionHidden(), true);

    // 2. When settings.hideInvasionBosses is false
    context.state.settings.hideInvasionBosses = false;
    assert.equal(context.isInvasionHidden(), false);

    // 3. Fallback to localStorage
    delete context.state.settings.hideInvasionBosses;
    store.set('dashboard.hideInvasionBosses', 'true');
    assert.equal(context.isInvasionHidden(), true);
    store.set('dashboard.hideInvasionBosses', 'false');
    assert.equal(context.isInvasionHidden(), false);

    // 4. getItemAlertDisplay formatting
    const invBoss = { id: 128, name: 'Chertuba', location: 'Swamp', is_invasion: true };
    const normalBoss = { id: 10, name: 'Medusa', location: 'Cave', is_invasion: false, color: '#38bdf8' };
    const eventItem = { id: 1, name: 'Siege', location: '', color: '#ec4899' };

    const invDisplay = context.getItemAlertDisplay(invBoss, 'boss');
    assert.equal(invDisplay.isInvasion, true);
    assert.equal(invDisplay.prefixTag, '[L3] ');
    assert.equal(invDisplay.plainName, '[L3] Chertuba (Swamp)');
    assert.equal(invDisplay.invColor, '#facc15');

    const normalDisplay = context.getItemAlertDisplay(normalBoss, 'boss');
    assert.equal(normalDisplay.isInvasion, false);
    assert.equal(normalDisplay.prefixTag, '');
    assert.equal(normalDisplay.plainName, 'Medusa (Cave)');
    assert.equal(normalDisplay.color, '#38bdf8');

    const eventDisplay = context.getItemAlertDisplay(eventItem, 'event');
    assert.equal(eventDisplay.isInvasion, false);
    assert.equal(eventDisplay.plainName, 'Siege');
    assert.equal(eventDisplay.color, '#ec4899');
});

test('Single-line compact toast format (Option 1): no wrapping and dot separator', () => {
    const alertsSource = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    // Verify container width is expanded to avoid wrapping
    assert.match(alertsSource, /max-width:min\(440px,92vw\)/);

    // Verify toast uses white-space:nowrap
    assert.match(alertsSource, /white-space:nowrap;/);

    // Verify bullet dot separator • and compact action text
    assert.match(alertsSource, /•<\/span><span style="font-weight:600;flex-shrink:0;">/);
    assert.match(alertsSource, /actionText = isThai \? 'เกิดแล้ว!' : 'Spawned!'/);
    assert.match(alertsSource, /actionText = isThai \? `อีก \${options\.minLeft} นาที` : `in \${options\.minLeft} min`/);
});

test('Header download app control button and download modal', () => {
    const alertsSource = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    // Verify header-download-app-control exists
    assert.match(alertsSource, /id = 'header-download-app-control'/);
    assert.match(alertsSource, /ensureDownloadAppButton\(\)/);
    assert.match(alertsSource, /updateDownloadAppButton\(\)/);

    // Verify mountCompactHeaderControls includes downloadBtn
    assert.match(alertsSource, /const downloadBtn = document\.getElementById\('header-download-app-control'\);/);

    // Verify openDownloadAppModal exists and includes portable badge
    assert.match(alertsSource, /function openDownloadAppModal\(\)/);
    assert.match(alertsSource, /download_modal_badge/);
    assert.match(alertsSource, /download_modal_cta/);
});

test('Realtime auto-update: detects version update in poll data and reloads clients automatically', () => {
    const alertsSource = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );
    const serverSource = fs.readFileSync(
        path.join(__dirname, '..', 'server', 'server.js'),
        'utf8'
    );

    // Verify server sends appVersion in poll response
    assert.match(serverSource, /appVersion:\s*APP_VERSION/);

    // Verify realtime-alerts checks data.appVersion and triggers reload
    assert.match(alertsSource, /if \(data\.appVersion\) \{/);
    assert.match(alertsSource, /sessionStorage\.getItem\('bossTracker\.appVersion'\)/);
    assert.match(alertsSource, /window\.location\.reload\(true\)/);
});

test('Mini HUD Overlay: font and text size adjustment matching web dashboard (7 Google fonts + stepper 10-18px)', () => {
    const overlayHtml = fs.readFileSync(
        path.join(__dirname, '..', 'desktop-app', 'overlay', 'index.html'),
        'utf8'
    );
    const overlayCss = fs.readFileSync(
        path.join(__dirname, '..', 'desktop-app', 'overlay', 'overlay.css'),
        'utf8'
    );
    const overlayJs = fs.readFileSync(
        path.join(__dirname, '..', 'desktop-app', 'overlay', 'overlay.js'),
        'utf8'
    );

    // Verify Google Fonts link includes all 7 fonts
    assert.ok(overlayHtml.includes('Google+Sans+Flex'));
    assert.ok(overlayHtml.includes('Open+Sans'));
    assert.ok(overlayHtml.includes('New+Rocker'));
    assert.ok(overlayHtml.includes('Google+Sans+Code'));
    assert.ok(overlayHtml.includes('PT+Serif'));
    assert.ok(overlayHtml.includes('Sancreek'));
    assert.ok(overlayHtml.includes('Arbutus'));

    // Verify font controls exist in HTML
    assert.ok(overlayHtml.includes('id="btnFontSettings"'));
    assert.ok(overlayHtml.includes('id="hudFontPanel"'));
    assert.ok(overlayHtml.includes('id="btnFontSizeMinus"'));
    assert.ok(overlayHtml.includes('id="btnFontSizePlus"'));
    assert.ok(overlayHtml.includes('id="fontPillsContainer"'));

    // Verify CSS variables and scaling
    assert.ok(overlayCss.includes('--hud-font:'));
    assert.ok(overlayCss.includes('--hud-font-size:'));
    assert.ok(overlayCss.includes('.btn-font-pill'));
    assert.ok(overlayCss.includes('.size-stepper'));

    // Verify overlay JS font list and bounds
    assert.ok(overlayJs.includes("'Google Sans Flex'"));
    assert.ok(overlayJs.includes("'Open Sans'"));
    assert.ok(overlayJs.includes("'New Rocker'"));
    assert.ok(overlayJs.includes("'Google Sans Code'"));
    assert.ok(overlayJs.includes("'PT Serif'"));
    assert.ok(overlayJs.includes("'Sancreek'"));
    assert.ok(overlayJs.includes("'Arbutus'"));
    assert.match(overlayJs, /Math\.max\(10,\s*Math\.min\(18,/);
    assert.ok(overlayJs.includes("localStorage.setItem('dashboard.fontSize'"));
    assert.ok(overlayJs.includes("localStorage.setItem('dashboard.appFont'"));

    // Verify overlay JS auto-update check
    assert.match(overlayJs, /if \(data\.appVersion\) \{/);
    assert.ok(overlayJs.includes("localStorage.getItem('bossTracker.overlayAppVersion')"));
});

test('Desktop App: Main window shrinks and expands dynamically according to Panel width (webMaxWidthRem)', () => {
    const dashboardJs = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'build', 'assets', 'dashboard-B9CVP--8.js'),
        'utf8'
    );
    const serverJs = fs.readFileSync(
        path.join(__dirname, '..', 'server', 'server.js'),
        'utf8'
    );
    const preloadJs = fs.readFileSync(
        path.join(__dirname, '..', 'desktop-app', 'preload.js'),
        'utf8'
    );
    const mainJs = fs.readFileSync(
        path.join(__dirname, '..', 'desktop-app', 'main.js'),
        'utf8'
    );
    const overlayHtml = fs.readFileSync(
        path.join(__dirname, '..', 'desktop-app', 'overlay', 'index.html'),
        'utf8'
    );
    const overlayJs = fs.readFileSync(
        path.join(__dirname, '..', 'desktop-app', 'overlay', 'overlay.js'),
        'utf8'
    );

    // 1. Dashboard settings exposes Panel width in desktop mode
    assert.ok(dashboardJs.includes('true&&c.jsx(Pn,{label:"Panel width"'));

    // 2. Server injects applyPanelWidth and electronAPI bridge
    assert.match(serverJs, /function applyPanelWidth\(val\)/);
    assert.match(serverJs, /window\.electronAPI\.setPanelWidth\(num\)/);
    assert.match(serverJs, /window\.electronAPI\.onPanelWidthChanged/);

    // 3. Preload bridges setPanelWidth and onPanelWidthChanged
    assert.match(preloadJs, /setPanelWidth:\s*\(rem\)\s*=>\s*ipcRenderer\.invoke\('set-panel-width',\s*rem\)/);
    assert.match(preloadJs, /onPanelWidthChanged:\s*\(callback\)\s*=>/);

    // 4. Main process handles set-panel-width and resizes window
    assert.match(mainJs, /minWidth:\s*420/);
    assert.match(mainJs, /ipcMain\.handle\('set-panel-width'/);
    assert.match(mainJs, /mainWindow\.setBounds|mainWindow\.setSize/);
    assert.match(mainJs, /hudWindow\.webContents\.send\('panel-width-changed'/);

    // 5. Mini HUD has panel width stepper controls
    assert.ok(overlayHtml.includes('id="btnPanelWidthMinus"'));
    assert.ok(overlayHtml.includes('id="btnPanelWidthPlus"'));
    assert.ok(overlayHtml.includes('id="panelWidthDisplay"'));

    // 6. Mini HUD overlay.js syncs panel width
    assert.match(overlayJs, /function applyPanelWidth\(val,/);
    assert.match(overlayJs, /window\.electronAPI\.onPanelWidthChanged/);
});

test('Mini HUD Overlay: authentication-gated display (hidden until login at main window, auto-closes on logout)', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '../desktop-app/main.js'), 'utf8');
    const overlayJs = fs.readFileSync(path.join(__dirname, '../desktop-app/overlay/overlay.js'), 'utf8');

    // 1. Initial state has isUserLoggedIn = false and hudWindow created with show: false
    assert.match(mainJs, /let\s+isUserLoggedIn\s*=\s*false;/);
    assert.match(mainJs, /hudWindow\s*=\s*new\s+BrowserWindow\(\{[\s\S]*show:\s*false/);

    // 2. updateHudAuthState hides HUD when unauthenticated and restores when authenticated
    assert.match(mainJs, /function\s+updateHudAuthState\(loggedIn\)/);
    assert.match(mainJs, /if\s*\(!isUserLoggedIn\)\s*\{[\s\S]*hudWindow\.hide\(\)/);
    assert.match(mainJs, /if\s*\(isHudVisible\s*&&\s*isUserLoggedIn\)/);

    // 3. Navigation listeners detect /login and update auth state
    assert.match(mainJs, /mainWindow\.webContents\.on\('did-navigate'/);
    assert.match(mainJs, /function\s+handleMainWindowNavigation\(url\)/);
    assert.match(mainJs, /url\.includes\('\/login'\)/);

    // 4. Polling tracker sync checks authentication and auto-updates HUD state
    assert.match(mainJs, /function\s+startTrackerSync\(\)/);
    assert.match(mainJs, /updateHudAuthState\(true\)/);
    assert.match(mainJs, /updateHudAuthState\(false\)/);

    // 5. Overlay clears cards and displays nothing if not authenticated
    assert.match(overlayJs, /state\.bosses\s*=\s*\[\];/);
    assert.match(overlayJs, /state\.events\s*=\s*\[\];/);
    assert.match(overlayJs, /dom\.bossListContainer\.innerHTML\s*=\s*''/);
});