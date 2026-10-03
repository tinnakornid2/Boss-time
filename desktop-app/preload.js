const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isDesktop: true,
    getClickThrough: () => ipcRenderer.invoke('get-click-through'),
    toggleClickThrough: () => ipcRenderer.invoke('toggle-click-through'),
    setClickThrough: (val) => ipcRenderer.invoke('set-click-through', val),
    setIgnoreMouseEvents: (ignore, options) => ipcRenderer.invoke('set-ignore-mouse-events', ignore, options),
    killBossNow: (payload) => ipcRenderer.invoke('kill-boss-now', payload),
    setBossKillTime: (payload) => ipcRenderer.invoke('set-boss-kill-time', payload),
    toggleBossAlert: (bossId) => ipcRenderer.invoke('toggle-boss-alert', bossId),
    syncInvasionVisibility: (hide) => ipcRenderer.invoke('sync-invasion-visibility', hide),
    getTrackerData: () => ipcRenderer.invoke('get-tracker-data'),
    onTrackerDataUpdated: (callback) => {
        ipcRenderer.on('tracker-data-updated', (_, data) => callback(data));
    },
    showMainWindow: () => ipcRenderer.invoke('show-main-window'),
    toggleHudVisibility: () => ipcRenderer.invoke('toggle-hud-visibility'),
    onClickThroughChanged: (callback) => {
        ipcRenderer.on('click-through-changed', (_, isClickThrough) => callback(isClickThrough));
    },
    syncFontSettings: (settings) => ipcRenderer.invoke('sync-font-settings', settings),
    onFontSettingsChanged: (callback) => {
        ipcRenderer.on('font-settings-changed', (_, settings) => callback(settings));
    },
    reloadApp: () => ipcRenderer.invoke('reload-app'),
    onReloadRequested: (callback) => {
        ipcRenderer.on('reload-requested', () => callback());
    },
    getHudSettings: () => ipcRenderer.invoke('get-hud-settings'),
    setHudHotkey: (payload) => ipcRenderer.invoke('set-hud-hotkey', payload),
    saveHudSettings: (settings) => ipcRenderer.invoke('save-hud-settings', settings),
    setPanelWidth: (rem) => ipcRenderer.invoke('set-panel-width', rem),
    onPanelWidthChanged: (callback) => {
        ipcRenderer.on('panel-width-changed', (_, rem) => callback(rem));
    },
    syncLanguage: (lang) => ipcRenderer.invoke('sync-language', lang),
    onLanguageChanged: (callback) => {
        ipcRenderer.on('language-changed', (_, lang) => callback(lang));
    },
    showDesktopNotification: (payload) => ipcRenderer.invoke('show-desktop-notification', payload),
    showTopToast: (payload) => ipcRenderer.invoke('show-top-toast', payload),
    hideToastOverlay: () => ipcRenderer.invoke('hide-toast-overlay'),
    onDisplayToast: (callback) => {
        ipcRenderer.on('display-toast', (_, payload) => callback(payload));
    }
});
