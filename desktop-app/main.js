const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Disable hardware acceleration to eliminate Windows GPU 0xC0000005 crashes with transparent windows
app.disableHardwareAcceleration();

const PRODUCTION_URL = 'https://boss-time-eloni.vercel.app/';

let mainWindow = null;
let hudWindow = null;
let tray = null;
let isClickThrough = false;
let isHudVisible = true;

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
        if (hudWindow) {
            hudWindow.show();
        }
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

function createMainWindow() {
    const savedBounds = loadSavedMainWindowBounds();
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const defaultWidth = 592;
    const defaultHeight = Math.min(840, screenHeight - 60);

    let initialWidth = savedBounds?.width || defaultWidth;
    let initialHeight = savedBounds?.height || defaultHeight;
    let initialX = savedBounds?.x;
    let initialY = savedBounds?.y;

    if (!Number.isFinite(initialX) || initialX < 0 || initialX > screenWidth - 100) initialX = undefined;
    if (!Number.isFinite(initialY) || initialY < 0 || initialY > screenHeight - 100) initialY = undefined;

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
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadURL(PRODUCTION_URL);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    mainWindow.on('moved', () => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
            saveMainWindowBounds(mainWindow.getBounds());
        }
    });
    mainWindow.on('resized', () => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
            saveMainWindowBounds(mainWindow.getBounds());
        }
    });

    // Hide instead of close when user clicks 'X'
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function createHudWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const savedBounds = loadSavedHudBounds();
    const defaultWidth = 320;
    const defaultHeight = 380;
    const defaultX = screenWidth - defaultWidth - 24;
    const defaultY = 48;

    let targetX = savedBounds?.x;
    let targetY = savedBounds?.y;
    if (!Number.isFinite(targetX) || targetX < 0 || targetX > screenWidth - 100) targetX = defaultX;
    if (!Number.isFinite(targetY) || targetY < 0 || targetY > screenHeight - 100) targetY = defaultY;

    hudWindow = new BrowserWindow({
        width: savedBounds?.width || defaultWidth,
        height: savedBounds?.height || defaultHeight,
        x: targetX,
        y: targetY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: false, // Ensure taskbar icon exists so users know app is running
        resizable: true,
        hasShadow: false,
        show: true,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    hudWindow.setAlwaysOnTop(true, 'floating');
    hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    hudWindow.loadFile(path.join(__dirname, 'overlay', 'index.html'));

    hudWindow.once('ready-to-show', () => {
        hudWindow.show();
    });

    hudWindow.on('moved', () => {
        saveHudBounds(hudWindow.getBounds());
    });
    hudWindow.on('resized', () => {
        saveHudBounds(hudWindow.getBounds());
    });
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
        if (isHudVisible) {
            hudWindow.show();
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
            label: isHudVisible ? '🎯 ซ่อน Mini Game HUD (F9)' : '🎯 แสดง Mini Game HUD (F9)',
            click: toggleHudVisibility
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
    createTray();
    registerHotkeys();
    startTrackerSync();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
            createHudWindow();
        }
    });
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

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
        const result = await mainWindow.webContents.executeJavaScript(`
            (async () => {
                try {
                    const res = await fetch('/poll', { cache: 'no-store' });
                    if (!res.ok) return { ok: false, status: res.status };
                    const data = await res.json();
                    let isAdmin = false;
                    try {
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
                    const localHideInvasion = localStorage.getItem('dashboard.hideInvasionBosses');
                    if (localHideInvasion !== null) {
                        data.hideInvasionBosses = (localHideInvasion === 'true');
                    }
                    return { ok: true, data, isAdmin, lang, showLocation };
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
    return await fetchTrackerDataFromMainWindow();
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
        if (hudWindow && !hudWindow.isDestroyed()) {
            const result = await fetchTrackerDataFromMainWindow();
            if (result && result.ok && result.data && hudWindow && !hudWindow.isDestroyed()) {
                hudWindow.webContents.send('tracker-data-updated', result);
            }
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

