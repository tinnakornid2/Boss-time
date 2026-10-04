const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync, spawn } = require('child_process');

// Automatically elevate to Administrator on Windows if not already elevated
if (process.platform === 'win32' && !process.argv.includes('--elevated')) {
    try {
        execSync('fltmc >nul 2>&1');
    } catch (_) {
        try {
            const exePath = process.execPath.replace(/'/g, "''");
            execSync(`powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '${exePath}' -ArgumentList '--elevated' -Verb RunAs"`);
            app.exit(0);
        } catch (_) {}
    }
}

// Disable hardware acceleration to eliminate Windows GPU 0xC0000005 crashes with transparent windows
app.disableHardwareAcceleration();

// Ensure audio alerts and timers continue unthrottled even when occluded by fullscreen games/apps
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// Force native <input type="datetime-local"> to display dd/mm/yyyy (ว/ด/ป) and 24-hour clock
app.commandLine.appendSwitch('lang', 'en-GB');

const PRODUCTION_URL = 'https://boss-time-eloni.vercel.app/';

let mainWindow = null;
let hudWindow = null;
let toastOverlayWindow = null;
let tray = null;
let isClickThrough = false;
let isHudVisible = true;
let isUserLoggedIn = false;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
        if (hudWindow && isHudVisible && isUserLoggedIn) {
            hudWindow.showInactive();
        }
    });
}

function isBoundsVisibleOnAnyDisplay(bounds, minWidth = 100, minHeight = 100) {
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
    const width = bounds.width || minWidth;
    const height = bounds.height || minHeight;
    const displays = screen.getAllDisplays();
    return displays.some(display => {
        const area = display.workArea;
        // Check if at least 50x50 pixels of the window are visible inside any display work area
        const overlapX = Math.max(0, Math.min(bounds.x + width, area.x + area.width) - Math.max(bounds.x, area.x));
        const overlapY = Math.max(0, Math.min(bounds.y + height, area.y + area.height) - Math.max(bounds.y, area.y));
        return (overlapX >= 50 && overlapY >= 50);
    });
}

function getBoundsFile() {
    return path.join(app.getPath('userData'), 'hud-bounds.json');
}

function loadSavedHudBounds() {
    try {
        const file = getBoundsFile();
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (_) {}
    return null;
}

function saveHudBounds(bounds) {
    try {
        fs.writeFileSync(getBoundsFile(), JSON.stringify(bounds), 'utf8');
    } catch (_) {}
}

function persistHudBounds() {
    if (!hudWindow || hudWindow.isDestroyed()) return;
    if (hudWindow.isMinimized()) return;
    const bounds = hudWindow.getBounds();
    if (bounds && bounds.width >= 100 && bounds.height >= 100 && bounds.x > -10000 && bounds.y > -10000) {
        saveHudBounds(bounds);
    }
}

function getMainWindowBoundsFile() {
    return path.join(app.getPath('userData'), 'main-window-bounds.json');
}

function loadSavedMainWindowBounds() {
    try {
        const file = getMainWindowBoundsFile();
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (_) {}
    return null;
}

function saveMainWindowBounds(bounds) {
    try {
        fs.writeFileSync(getMainWindowBoundsFile(), JSON.stringify(bounds), 'utf8');
    } catch (_) {}
}

function persistMainWindowBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) return; // Never save minimized -32000 coordinates
    const bounds = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    if (bounds && bounds.width >= 300 && bounds.height >= 300 && bounds.x > -10000 && bounds.y > -10000) {
        saveMainWindowBounds({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            isMaximized: mainWindow.isMaximized()
        });
    }
}

function createMainWindow() {
    const savedBounds = loadSavedMainWindowBounds();
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const defaultWidth = 592;
    const defaultHeight = Math.min(840, screenHeight - 60);

    let initialWidth = defaultWidth;
    let initialHeight = defaultHeight;
    let initialX = undefined;
    let initialY = undefined;

    // Validate bounds across all displays (allows negative X for multi-monitors or snapped left edges)
    if (savedBounds && isBoundsVisibleOnAnyDisplay(savedBounds, 300, 300)) {
        initialX = savedBounds.x;
        initialY = savedBounds.y;
        if (Number.isFinite(savedBounds.width) && savedBounds.width >= 400) initialWidth = savedBounds.width;
        if (Number.isFinite(savedBounds.height) && savedBounds.height >= 400) initialHeight = savedBounds.height;
    }

    mainWindow = new BrowserWindow({
        width: initialWidth,
        height: initialHeight,
        x: initialX,
        y: initialY,
        minWidth: 420,
        minHeight: 450,
        backgroundColor: '#090d16',
        show: true,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false // Keep timers and audio active when occluded by other windows/games
        }
    });

    if (savedBounds?.isMaximized) {
        mainWindow.maximize();
    }

    mainWindow.loadURL(PRODUCTION_URL);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // Detect navigation to /login or dashboard to instantly toggle HUD visibility
    mainWindow.webContents.on('did-navigate', (_, url) => {
        handleMainWindowNavigation(url);
    });

    mainWindow.webContents.on('did-navigate-in-page', (_, url) => {
        handleMainWindowNavigation(url);
    });

    mainWindow.webContents.on('did-finish-load', () => {
        const url = mainWindow.webContents.getURL() || '';
        handleMainWindowNavigation(url);
    });

    mainWindow.on('moved', persistMainWindowBounds);
    mainWindow.on('resized', persistMainWindowBounds);

    // Hide instead of close when user clicks 'X'
    mainWindow.on('close', (event) => {
        persistMainWindowBounds();
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function updateHudAuthState(loggedIn) {
    const isNowLoggedIn = Boolean(loggedIn);
    const stateChanged = (isUserLoggedIn !== isNowLoggedIn);
    isUserLoggedIn = isNowLoggedIn;

    if (!isUserLoggedIn) {
        // Not logged in -> hide HUD completely and immediately
        if (hudWindow && !hudWindow.isDestroyed() && hudWindow.isVisible()) {
            hudWindow.hide();
        }
    } else {
        // Logged in -> if user HUD visibility is enabled, show HUD
        if (isHudVisible && hudWindow && !hudWindow.isDestroyed() && !hudWindow.isVisible()) {
            hudWindow.showInactive();
            hudWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        }
    }

    if (stateChanged) {
        updateTray();
    }
}

function handleMainWindowNavigation(url) {
    if (!url) return;
    if (url.includes('/login')) {
        updateHudAuthState(false);
    } else {
        checkAuthAndSyncNow();
    }
}

async function checkAuthAndSyncNow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        const currentUrl = mainWindow.webContents.getURL() || '';
        if (currentUrl.includes('/login')) {
            updateHudAuthState(false);
            return;
        }
        const result = await fetchTrackerDataFromMainWindow();
        if (result && result.ok && result.data) {
            updateHudAuthState(true);
            if (hudWindow && !hudWindow.isDestroyed()) {
                hudWindow.webContents.send('tracker-data-updated', result);
            }
        } else {
            updateHudAuthState(false);
        }
    } catch (_) {
        updateHudAuthState(false);
    }
}

function createHudWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const savedBounds = loadSavedHudBounds();
    const defaultWidth = 320;
    const defaultHeight = 380;
    const defaultX = screenWidth - defaultWidth - 24;
    const defaultY = 48;

    let targetWidth = defaultWidth;
    let targetHeight = defaultHeight;
    let targetX = defaultX;
    let targetY = defaultY;

    if (savedBounds && isBoundsVisibleOnAnyDisplay(savedBounds, 120, 120)) {
        targetX = savedBounds.x;
        targetY = savedBounds.y;
        if (Number.isFinite(savedBounds.width) && savedBounds.width >= 120) targetWidth = savedBounds.width;
        if (Number.isFinite(savedBounds.height) && savedBounds.height >= 120) targetHeight = savedBounds.height;
    }

    hudWindow = new BrowserWindow({
        width: targetWidth,
        height: targetHeight,
        x: targetX,
        y: targetY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true, // Keep HUD as overlay only, single window on taskbar
        resizable: true,
        minimizable: false,   // Prevents Windows from minimizing the HUD when switching apps
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        show: false, // Never show until user has authenticated in mainWindow
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false
        }
    });

    // Use 'screen-saver' level so HUD stays above all games, fullscreens, and active windows
    hudWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    hudWindow.loadFile(path.join(__dirname, 'overlay', 'index.html'));

    hudWindow.once('ready-to-show', () => {
        if (isHudVisible && isUserLoggedIn) {
            hudWindow.showInactive();
        }
    });

    hudWindow.on('moved', persistHudBounds);
    hudWindow.on('resized', persistHudBounds);

    // Prevent HUD from minimizing when Windows switches apps or Win+D is used
    hudWindow.on('minimize', (e) => {
        e.preventDefault();
        hudWindow.restore();
        if (isHudVisible && isUserLoggedIn) hudWindow.showInactive();
    });

    // Guard against unintended OS hides when switching apps (only auto-restore if authenticated)
    hudWindow.on('hide', () => {
        if (isHudVisible && isUserLoggedIn && !app.isQuitting) {
            hudWindow.showInactive();
        }
    });

    // Re-assert topmost z-order whenever focus changes
    hudWindow.on('blur', () => {
        if (isHudVisible && isUserLoggedIn && hudWindow && !hudWindow.isDestroyed()) {
            hudWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        }
    });
}

function createToastOverlayWindow() {
    if (toastOverlayWindow && !toastOverlayWindow.isDestroyed()) return toastOverlayWindow;
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const overlayWidth = 460;
    const overlayHeight = 240;
    const targetX = 12;
    const targetY = Math.max(0, screenHeight - overlayHeight - 24);

    toastOverlayWindow = new BrowserWindow({
        width: overlayWidth,
        height: overlayHeight,
        x: targetX,
        y: targetY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        resizable: false,
        hasShadow: false,
        show: false,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false
        }
    });

    toastOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
    toastOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    toastOverlayWindow.setIgnoreMouseEvents(true, { forward: true });

    toastOverlayWindow.loadFile(path.join(__dirname, 'overlay', 'toast.html'));
    return toastOverlayWindow;
}

function setClickThrough(enable) {
    isClickThrough = enable;
    if (hudWindow && !hudWindow.isDestroyed()) {
        if (enable) {
            hudWindow.setIgnoreMouseEvents(true, { forward: true });
        } else {
            hudWindow.setIgnoreMouseEvents(false);
        }
        hudWindow.webContents.send('click-through-changed', isClickThrough);
    }
    updateTray();
}

function toggleClickThrough() {
    setClickThrough(!isClickThrough);
}

function toggleHudVisibility() {
    isHudVisible = !isHudVisible;
    if (hudWindow && !hudWindow.isDestroyed()) {
        if (isHudVisible && isUserLoggedIn) {
            hudWindow.showInactive();
            hudWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        } else {
            hudWindow.hide();
        }
    }
    updateTray();
}

function createTray() {
    try {
        const iconPath = path.join(__dirname, 'assets', 'icon.png');
        if (fs.existsSync(iconPath)) {
            const icon = nativeImage.createFromPath(iconPath);
            tray = new Tray(icon.resize({ width: 16, height: 16 }));
            tray.setToolTip('Lineage 2 Boss Tracker');
            updateTray();

            tray.on('double-click', () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            });
        }
    } catch (err) {
        console.warn('Tray creation skipped:', err.message);
    }
}

function updateTray() {
    if (!tray) return;
    const hudLabel = !isUserLoggedIn
        ? '🎯 Mini Game HUD (รอเข้าสู่ระบบที่หน้าต่างหลัก)'
        : (isHudVisible ? '🎯 ซ่อน Mini Game HUD (F9)' : '🎯 แสดง Mini Game HUD (F9)');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '🪟 เปิดหน้าต่างหลัก (Full Dashboard)',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: hudLabel,
            click: () => {
                if (!isUserLoggedIn) {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                } else {
                    toggleHudVisibility();
                }
            }
        },
        {
            label: isClickThrough ? '🔓 ปลดล็อกการคลิก (Interactive)' : '🔒 เปิดโหมดคลิกทะลุ (Click-Through: Alt+F12)',
            click: toggleClickThrough
        },
        { type: 'separator' },
        {
            label: '❌ ออกจากโปรแกรม (Quit)',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setContextMenu(contextMenu);
}

function reloadAllWindows() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
    }
    if (hudWindow && !hudWindow.isDestroyed()) {
        hudWindow.webContents.reloadIgnoringCache();
    }
}

function getSettingsFile() {
    return path.join(app.getPath('userData'), 'hud-settings.json');
}

function loadSavedSettings() {
    try {
        const file = getSettingsFile();
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (_) {}
    return {
        clickThroughHotkey: 'Alt+F12',
        hudVisibilityHotkey: 'F9',
        opacity: 0.65
    };
}

function saveSettings(settings) {
    try {
        const current = loadSavedSettings();
        const merged = { ...current, ...settings };
        fs.writeFileSync(getSettingsFile(), JSON.stringify(merged, null, 2), 'utf8');
        return merged;
    } catch (_) {
        return null;
    }
}

let currentClickThroughHotkey = 'Alt+F12';
let currentHudVisibilityHotkey = 'F9';

function registerHotkeys() {
    const saved = loadSavedSettings();
    if (saved.clickThroughHotkey) currentClickThroughHotkey = saved.clickThroughHotkey;
    if (saved.hudVisibilityHotkey) currentHudVisibilityHotkey = saved.hudVisibilityHotkey;

    applyHotkeys();
}

function applyHotkeys() {
    globalShortcut.unregisterAll();

    try {
        globalShortcut.register(currentClickThroughHotkey, () => {
            toggleClickThrough();
        });
    } catch (e) {
        console.warn('Failed to register click-through hotkey:', e);
    }

    try {
        globalShortcut.register(currentHudVisibilityHotkey, () => {
            toggleHudVisibility();
        });
    } catch (e) {
        console.warn('Failed to register HUD visibility hotkey:', e);
    }

    // Ctrl+R and F5 for refreshing/updating windows
    globalShortcut.register('CommandOrControl+R', reloadAllWindows);
    globalShortcut.register('F5', reloadAllWindows);
}

app.whenReady().then(() => {
    createMainWindow();
    createHudWindow();
    createToastOverlayWindow();
    createTray();
    registerHotkeys();
    startTrackerSync();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
            createHudWindow();
            createToastOverlayWindow();
        }
    });
});

app.on('before-quit', () => {
    app.isQuitting = true;
    persistMainWindowBounds();
    persistHudBounds();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// Periodic topmost keeper: ensures HUD never falls behind fullscreen games or other apps
setInterval(() => {
    if (isHudVisible && isUserLoggedIn && hudWindow && !hudWindow.isDestroyed() && !hudWindow.isMinimized()) {
        hudWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }
}, 3000);

// IPC communication between windows and main process
ipcMain.handle('get-click-through', () => isClickThrough);
ipcMain.handle('toggle-click-through', () => {
    toggleClickThrough();
    return isClickThrough;
});
ipcMain.handle('set-click-through', (_, val) => {
    setClickThrough(Boolean(val));
    return isClickThrough;
});
ipcMain.handle('toggle-hud-visibility', () => {
    toggleHudVisibility();
    return isHudVisible;
});
ipcMain.handle('show-main-window', () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
});

ipcMain.handle('sync-invasion-visibility', async (_, hide) => {
    const shouldHide = Boolean(hide);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(`
            try {
                if (typeof window.setInvasionHidden === 'function') {
                    window.setInvasionHidden(${shouldHide});
                } else {
                    localStorage.setItem('dashboard.hideInvasionBosses', '${shouldHide}');
                    fetch('/settings/invasion-visibility', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ hide_invasion_bosses: ${shouldHide} })
                    }).catch(() => {});
                }
            } catch (_) {}
        `).catch(() => {});
    }
    return { ok: true, hideInvasionBosses: shouldHide };
});

ipcMain.handle('show-desktop-notification', (_, { title, body }) => {
    try {
        if (Notification && Notification.isSupported()) {
            const notif = new Notification({
                title: title || 'Boss Tracker',
                body: body || '',
                icon: path.join(__dirname, 'assets', 'icon.png'),
                silent: true // Audio is already handled cleanly by main audio master
            });
            notif.show();
        }
    } catch (_) {}
    return { ok: true };
});

ipcMain.handle('show-top-toast', (_, payload) => {
    try {
        if (!toastOverlayWindow || toastOverlayWindow.isDestroyed()) {
            createToastOverlayWindow();
        }
        if (toastOverlayWindow && !toastOverlayWindow.isDestroyed()) {
            toastOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
            toastOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
            toastOverlayWindow.showInactive();
            toastOverlayWindow.webContents.send('display-toast', payload);
        }
    } catch (_) {}
    return { ok: true };
});

ipcMain.handle('hide-toast-overlay', () => {
    try {
        if (toastOverlayWindow && !toastOverlayWindow.isDestroyed()) {
            toastOverlayWindow.hide();
        }
    } catch (_) {}
    return { ok: true };
});

ipcMain.handle('set-ignore-mouse-events', (_, ignore, options) => {
    if (hudWindow && !hudWindow.isDestroyed()) {
        hudWindow.setIgnoreMouseEvents(Boolean(ignore), options || { forward: true });
    }
});

ipcMain.handle('kill-boss-now', async (_, { bossId, killTime }) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return { ok: false, error: 'Main dashboard window is not available' };
    }
    try {
        const timeStr = killTime || new Date().toISOString();
        const result = await mainWindow.webContents.executeJavaScript(`
            (async () => {
                try {
                    const res = await fetch('/bosses/${bossId}', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ last_kill_time: ${JSON.stringify(timeStr)} })
                    });
                    if (!res.ok) {
                        return { ok: false, status: res.status, error: await res.text() };
                    }
                    const data = await res.json();
                    return { ok: true, data };
                } catch (err) {
                    return { ok: false, error: err.message };
                }
            })()
        `);
        return result;
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('set-boss-kill-time', async (_, { bossId, killTime }) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return { ok: false, error: 'Main dashboard window is not available' };
    }
    try {
        const timeStr = killTime || new Date().toISOString();
        const result = await mainWindow.webContents.executeJavaScript(`
            (async () => {
                try {
                    const res = await fetch('/bosses/${bossId}', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ last_kill_time: ${JSON.stringify(timeStr)} })
                    });
                    if (!res.ok) {
                        return { ok: false, status: res.status, error: await res.text() };
                    }
                    const data = await res.json();
                    return { ok: true, data };
                } catch (err) {
                    return { ok: false, error: err.message };
                }
            })()
        `);
        return result;
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('toggle-boss-alert', async (_, bossId) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return { ok: false, error: 'Main dashboard window is not available' };
    }
    try {
        const result = await mainWindow.webContents.executeJavaScript(`
            (async () => {
                try {
                    const res = await fetch('/bosses/${bossId}/alert', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    if (!res.ok) {
                        return { ok: false, status: res.status, error: await res.text() };
                    }
                    const data = await res.json();
                    return { ok: true, data };
                } catch (err) {
                    return { ok: false, error: err.message };
                }
            })()
        `);
        return result;
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

async function fetchTrackerDataFromMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    try {
        const currentUrl = mainWindow.webContents.getURL() || '';
        if (currentUrl.includes('/login')) {
            return { ok: false, status: 401, notAuthenticated: true };
        }
        const result = await mainWindow.webContents.executeJavaScript(`
            (async () => {
                try {
                    const res = await fetch('/poll', { cache: 'no-store' });
                    if (!res.ok) return { ok: false, status: res.status };
                    const data = await res.json();
                    let isAdmin = false;
                    try {
                        if (typeof window.isAdmin === 'function') {
                            isAdmin = Boolean(window.isAdmin());
                        }
                        const pageEl = document.querySelector('[data-page]');
                        if (pageEl) {
                            const page = JSON.parse(pageEl.getAttribute('data-page') || '{}');
                            if (page.props?.auth?.user?.role === 'admin') isAdmin = true;
                        }
                        if (!isAdmin) {
                            isAdmin = document.body.classList.contains('role-admin') || 
                                      Boolean(document.querySelector('.admin-hover-actions, #admin-settings-embedded-panel'));
                        }
                    } catch (_) {}
                    const lang = localStorage.getItem('tracker_lang') || document.documentElement.lang || 'th';
                    const showLocation = localStorage.getItem('dashboard.showLocation') === 'true';
                    const timeZoneOffset = localStorage.getItem('dashboard.timeZoneOffset') === '8' ? 8 : 7;
                    let hideInvasion = Boolean(data.hideInvasionBosses);
                    if (typeof window.isInvasionHidden === 'function') {
                        hideInvasion = Boolean(window.isInvasionHidden());
                    } else {
                        const localHideInvasion = localStorage.getItem('dashboard.hideInvasionBosses');
                        if (localHideInvasion !== null) {
                            hideInvasion = (localHideInvasion === 'true');
                        }
                    }
                    data.hideInvasionBosses = hideInvasion;
                    return { ok: true, data, isAdmin, lang, showLocation, timeZoneOffset, hideInvasionBosses: hideInvasion };
                } catch (err) {
                    return { ok: false, error: err.message };
                }
            })()
        `);
        return result;
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

ipcMain.handle('get-tracker-data', async () => {
    const res = await fetchTrackerDataFromMainWindow();
    if (!res || !res.ok) {
        updateHudAuthState(false);
    } else {
        updateHudAuthState(true);
    }
    return res;
});

ipcMain.handle('sync-language', (_, lang) => {
    if (!lang) return false;
    if (hudWindow && !hudWindow.isDestroyed()) {
        hudWindow.webContents.send('language-changed', lang);
    }
    return true;
});

let trackerPollInterval = null;
function startTrackerSync() {
    if (trackerPollInterval) clearInterval(trackerPollInterval);
    trackerPollInterval = setInterval(async () => {
        const result = await fetchTrackerDataFromMainWindow();
        if (result && result.ok && result.data) {
            updateHudAuthState(true);
            if (hudWindow && !hudWindow.isDestroyed()) {
                hudWindow.webContents.send('tracker-data-updated', result);
            }
        } else {
            updateHudAuthState(false);
        }
    }, 2000);
}

ipcMain.handle('sync-font-settings', (_, settings) => {
    if (!settings) return false;
    const { fontSize, font } = settings;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('font-settings-changed', settings);
        mainWindow.webContents.executeJavaScript(`
            try {
                if (${Number.isFinite(fontSize)}) {
                    localStorage.setItem('dashboard.fontSize', '${fontSize}');
                }
                if ('${font}') {
                    localStorage.setItem('dashboard.appFont', '${font}');
                    document.documentElement.style.setProperty('--dashboard-font', "'${font}'");
                }
            } catch (_) {}
        `).catch(() => {});
    }
    if (hudWindow && !hudWindow.isDestroyed()) {
        hudWindow.webContents.send('font-settings-changed', settings);
    }
    return true;
});

ipcMain.handle('reload-app', () => {
    reloadAllWindows();
    return true;
});

ipcMain.handle('get-hud-settings', () => {
    return {
        ...loadSavedSettings(),
        clickThroughHotkey: currentClickThroughHotkey,
        hudVisibilityHotkey: currentHudVisibilityHotkey
    };
});

ipcMain.handle('set-hud-hotkey', (_, { type, hotkey }) => {
    if (!hotkey) return { ok: false, error: 'Empty hotkey' };
    try {
        if (type === 'clickThrough') {
            globalShortcut.unregister(currentClickThroughHotkey);
            const registered = globalShortcut.register(hotkey, () => toggleClickThrough());
            if (!registered) {
                globalShortcut.register(currentClickThroughHotkey, () => toggleClickThrough());
                return { ok: false, error: 'Cannot register hotkey (already in use by system)' };
            }
            currentClickThroughHotkey = hotkey;
            saveSettings({ clickThroughHotkey: hotkey });
            updateTray();
            if (hudWindow && !hudWindow.isDestroyed()) {
                hudWindow.webContents.send('hotkey-changed', { type: 'clickThrough', hotkey });
            }
            return { ok: true, hotkey };
        } else if (type === 'hudVisibility') {
            globalShortcut.unregister(currentHudVisibilityHotkey);
            const registered = globalShortcut.register(hotkey, () => toggleHudVisibility());
            if (!registered) {
                globalShortcut.register(currentHudVisibilityHotkey, () => toggleHudVisibility());
                return { ok: false, error: 'Cannot register hotkey (already in use by system)' };
            }
            currentHudVisibilityHotkey = hotkey;
            saveSettings({ hudVisibilityHotkey: hotkey });
            updateTray();
            if (hudWindow && !hudWindow.isDestroyed()) {
                hudWindow.webContents.send('hotkey-changed', { type: 'hudVisibility', hotkey });
            }
            return { ok: true, hotkey };
        }
    } catch (err) {
        return { ok: false, error: err.message };
    }
    return { ok: false, error: 'Unknown hotkey type' };
});

ipcMain.handle('save-hud-settings', (_, settings) => {
    return saveSettings(settings);
});

ipcMain.handle('set-panel-width', (_, rem) => {
    const num = Number(rem);
    if (!Number.isFinite(num)) return { ok: false, error: 'Invalid rem' };

    // Broadcast to HUD window so HUD display stays synchronized
    if (hudWindow && !hudWindow.isDestroyed()) {
        hudWindow.webContents.send('panel-width-changed', num);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('panel-width-changed', num);

        const primaryDisplay = screen.getPrimaryDisplay();
        const maxScreenWidth = primaryDisplay.workAreaSize.width;
        const currentBounds = mainWindow.getBounds();

        let targetWidth;
        if (num === 0) {
            // 100% full-width: expand comfortably
            targetWidth = Math.min(1280, maxScreenWidth - 40);
        } else {
            // Convert rem to pixels (1rem = 16px) + 16px buffer for scrollbars and window frame
            targetWidth = Math.max(420, Math.min(maxScreenWidth, Math.round(num * 16) + 16));
        }

        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        }

        // Shift position if expanding would push right edge outside work area
        let targetX = currentBounds.x;
        if (targetX + targetWidth > primaryDisplay.workArea.x + primaryDisplay.workArea.width) {
            targetX = Math.max(primaryDisplay.workArea.x, primaryDisplay.workArea.x + primaryDisplay.workArea.width - targetWidth);
        }

        mainWindow.setBounds({
            x: targetX,
            y: currentBounds.y,
            width: targetWidth,
            height: currentBounds.height
        }, true);

        saveMainWindowBounds(mainWindow.getBounds());
    }

    return { ok: true, rem: num };
});

// ==========================================
// DESKTOP AUTO-UPDATE & NOTIFICATION SYSTEM
// ==========================================

let currentDesktopVersion = '1.3.47';
try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    if (pkg.version) currentDesktopVersion = pkg.version;
} catch (_) {}

let cachedUpdateInfo = null;

function isNewerVersion(remote, local) {
    if (!remote || !local) return false;
    const rParts = String(remote).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const lParts = String(local).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
        const r = rParts[i] || 0;
        const l = lParts[i] || 0;
        if (r > l) return true;
        if (r < l) return false;
    }
    return false;
}

function fetchLatestGitHubRelease() {
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.github.com',
            path: '/repos/tinnakornid2/Boss-time/releases/latest',
            method: 'GET',
            headers: {
                'User-Agent': 'BossTracker-Desktop-App',
                'Accept': 'application/vnd.github.v3+json'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
                } else {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.end();
    });
}

async function checkForUpdates(manual = false) {
    try {
        const release = await fetchLatestGitHubRelease();
        if (!release || !release.tag_name) {
            if (manual) {
                if (hudWindow && !hudWindow.isDestroyed()) hudWindow.webContents.send('app-update-not-available');
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app-update-not-available');
            }
            return { hasUpdate: false, currentVersion: currentDesktopVersion };
        }

        const remoteVer = release.tag_name.replace(/^v/, '').trim();
        const hasUpdate = isNewerVersion(remoteVer, currentDesktopVersion);

        if (hasUpdate) {
            // Find Setup.exe asset first, fallback to .exe or .zip
            const setupAsset = release.assets?.find(a => a.name === 'BossTracker-Setup.exe' || a.name.endsWith('-Setup.exe')) ||
                               release.assets?.find(a => a.name.endsWith('.exe')) ||
                               release.assets?.find(a => a.name.endsWith('.zip'));

            cachedUpdateInfo = {
                hasUpdate: true,
                version: remoteVer,
                currentVersion: currentDesktopVersion,
                tagName: release.tag_name,
                releaseName: release.name || release.tag_name,
                releaseBody: release.body || '',
                downloadUrl: setupAsset?.browser_download_url || release.html_url,
                assetName: setupAsset?.name || 'BossTracker-Setup.exe',
                assetSize: setupAsset?.size || 0
            };

            // Notify both Main Window and Mini HUD
            if (hudWindow && !hudWindow.isDestroyed()) {
                hudWindow.webContents.send('app-update-available', cachedUpdateInfo);
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('app-update-available', cachedUpdateInfo);
            }

            return cachedUpdateInfo;
        } else {
            cachedUpdateInfo = null;
            if (manual) {
                if (hudWindow && !hudWindow.isDestroyed()) hudWindow.webContents.send('app-update-not-available');
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app-update-not-available');
            }
            return { hasUpdate: false, currentVersion: currentDesktopVersion };
        }
    } catch (err) {
        return { hasUpdate: false, error: err.message, currentVersion: currentDesktopVersion };
    }
}

function downloadFileWithRedirects(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        function get(urlToFetch, redirectCount = 0) {
            if (redirectCount > 5) return reject(new Error('Too many redirects'));

            https.get(urlToFetch, { headers: { 'User-Agent': 'BossTracker-Desktop-App' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return get(res.headers.location, redirectCount + 1);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`Failed to download: HTTP ${res.statusCode}`));
                }

                const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
                let receivedBytes = 0;
                let lastLoggedMb = 0;
                const fileStream = fs.createWriteStream(destPath);

                res.on('data', (chunk) => {
                    receivedBytes += chunk.length;
                    const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
                    const downloadedMb = (receivedBytes / 1024 / 1024).toFixed(1);
                    const totalMb = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(1) : 0;

                    const curMb = Math.floor(receivedBytes / 1024 / 1024);
                    if (curMb !== lastLoggedMb || percent === 100) {
                        lastLoggedMb = curMb;
                        if (typeof onProgress === 'function') {
                            onProgress({ percent, downloadedMb, totalMb, receivedBytes, totalBytes });
                        }
                    }
                });

                res.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close(() => resolve(destPath));
                });

                fileStream.on('error', (err) => {
                    try { fs.unlinkSync(destPath); } catch (_) {}
                    reject(err);
                });
            }).on('error', (err) => {
                try { fs.unlinkSync(destPath); } catch (_) {}
                reject(err);
            });
        }

        get(url);
    });
}

let isUpdating = false;

async function startDesktopUpdate() {
    if (isUpdating) return { ok: false, message: 'Update already in progress' };
    isUpdating = true;

    try {
        if (!cachedUpdateInfo?.downloadUrl) {
            await checkForUpdates(true);
        }
        if (!cachedUpdateInfo?.downloadUrl) {
            isUpdating = false;
            throw new Error('No update download URL available');
        }

        const downloadUrl = cachedUpdateInfo.downloadUrl;
        const tempExeName = `BossTracker-Setup-Update-${cachedUpdateInfo.version || Date.now()}.exe`;
        const tempPath = path.join(app.getPath('temp'), tempExeName);

        const broadcastProgress = (progress) => {
            if (hudWindow && !hudWindow.isDestroyed()) hudWindow.webContents.send('update-download-progress', progress);
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-download-progress', progress);
        };

        broadcastProgress({ percent: 1, downloadedMb: '0.1', totalMb: '100' });

        await downloadFileWithRedirects(downloadUrl, tempPath, broadcastProgress);

        if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size < 1000000) {
            throw new Error('Downloaded installer file is incomplete or corrupt');
        }

        if (hudWindow && !hudWindow.isDestroyed()) hudWindow.webContents.send('update-download-complete', { path: tempPath });
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-download-complete', { path: tempPath });

        // Wait 1.2s so UI displays completion message, then launch installer and exit
        setTimeout(() => {
            try {
                // Launch installer silently to update files and automatically restart
                const child = spawn(tempPath, ['/S'], {
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();

                app.isQuitting = true;
                app.quit();
            } catch (err) {
                console.error('Failed to launch installer:', err);
                if (hudWindow && !hudWindow.isDestroyed()) hudWindow.webContents.send('update-download-error', err.message);
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-download-error', err.message);
                isUpdating = false;
            }
        }, 1200);

        return { ok: true, status: 'installing' };
    } catch (err) {
        isUpdating = false;
        if (hudWindow && !hudWindow.isDestroyed()) hudWindow.webContents.send('update-download-error', err.message);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-download-error', err.message);
        return { ok: false, error: err.message };
    }
}

ipcMain.handle('check-for-updates', async () => await checkForUpdates(true));
ipcMain.handle('start-desktop-update', async () => await startDesktopUpdate());
ipcMain.handle('get-current-app-version', () => currentDesktopVersion);

// Periodic update check (starts 7 seconds after boot, checks every 20 minutes)
setTimeout(() => {
    checkForUpdates(false);
}, 7000);
setInterval(() => {
    checkForUpdates(false);
}, 20 * 60 * 1000);


