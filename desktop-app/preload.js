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
    },
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    startDesktopUpdate: () => ipcRenderer.invoke('start-desktop-update'),
    getCurrentAppVersion: () => ipcRenderer.invoke('get-current-app-version'),
    onUpdateAvailable: (callback) => {
        ipcRenderer.on('app-update-available', (_, info) => callback(info));
    },
    onUpdateNotAvailable: (callback) => {
        ipcRenderer.on('app-update-not-available', () => callback());
    },
    onUpdateProgress: (callback) => {
        ipcRenderer.on('update-download-progress', (_, progress) => callback(progress));
    },
    onUpdateComplete: (callback) => {
        ipcRenderer.on('update-download-complete', (_, data) => callback(data));
    },
    onUpdateError: (callback) => {
        ipcRenderer.on('update-download-error', (_, err) => callback(err));
    }
});

// Main Window Desktop Update Banner Handler
window.addEventListener('DOMContentLoaded', () => {
    // Only mount on main dashboard (not on HUD or toast overlay)
    if (document.getElementById('hudPanel') || window.location.pathname.includes('toast.html')) return;

    ipcRenderer.on('app-update-available', (_, info) => {
        let banner = document.getElementById('desktop-app-update-banner');
        if (banner) return;

        banner = document.createElement('div');
        banner.id = 'desktop-app-update-banner';
        banner.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            max-width: 440px;
            width: calc(100% - 40px);
            background: linear-gradient(135deg, #090d16, #0f172a);
            border: 1px solid rgba(56, 189, 248, 0.4);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 25px rgba(56, 189, 248, 0.25);
            border-radius: 12px;
            padding: 16px;
            z-index: 999999;
            color: #f8fafc;
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            flex-direction: column;
            gap: 10px;
            animation: fadeIn 0.3s ease-out;
        `;

        banner.innerHTML = `
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#0284c7,#38bdf8);display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 12px rgba(56,189,248,0.5);">🚀</div>
                    <div>
                        <div style="font-size:13.5px;font-weight:700;color:#f8fafc;">มีการอัปเดตเวอร์ชันใหม่!</div>
                        <div style="font-size:11.5px;color:#38bdf8;font-weight:600;">Boss Tracker v${info.version || ''} (เวอร์ชันปัจจุบัน: v${info.currentVersion || ''})</div>
                    </div>
                </div>
                <button type="button" id="btnDismissUpdateBanner" style="background:none;border:none;color:#94a3b8;font-size:16px;cursor:pointer;padding:4px;" title="ปิด">✕</button>
            </div>
            <div style="font-size:11.5px;color:#cbd5e1;line-height:1.4;">
                กดปุ่มด้านล่างเพื่อเริ่มดาวน์โหลดและติดตั้งตัวอัปเดตอัตโนมัติ โปรแกรมจะเปิดเวอร์ชันใหม่ให้ทันที
            </div>
            <div id="updateProgressArea" style="display:none;margin-top:2px;">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-bottom:4px;">
                    <span id="updateProgressStatusText">กำลังดาวน์โหลด...</span>
                    <span id="updateProgressPercentText">0%</span>
                </div>
                <div style="height:6px;background:rgba(255,255,255,0.1);border-radius:999px;overflow:hidden;">
                    <div id="updateProgressBarFill" style="height:100%;width:0%;background:linear-gradient(90deg,#0284c7,#38bdf8);border-radius:999px;transition:width 0.2s ease;"></div>
                </div>
            </div>
            <div id="updateActionArea" style="display:flex;gap:8px;margin-top:4px;">
                <button type="button" id="btnStartUpdateNow" style="flex:1;background:linear-gradient(135deg,#0284c7,#2563eb);color:#fff;border:1px solid rgba(147,197,253,0.3);padding:8px 14px;border-radius:7px;font-size:12.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 0 15px rgba(37,99,235,0.4);transition:all 0.2s;">
                    <span>📥</span><span>อัปเดตทันที (อัตโนมัติ)</span>
                </button>
                <button type="button" id="btnPostponeUpdate" style="background:rgba(255,255,255,0.06);color:#94a3b8;border:1px solid rgba(255,255,255,0.1);padding:8px 12px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;">
                    ไว้ภายหลัง
                </button>
            </div>
        `;

        document.body.appendChild(banner);

        const btnDismiss = banner.querySelector('#btnDismissUpdateBanner');
        const btnPostpone = banner.querySelector('#btnPostponeUpdate');
        const btnStart = banner.querySelector('#btnStartUpdateNow');
        const progressArea = banner.querySelector('#updateProgressArea');
        const actionArea = banner.querySelector('#updateActionArea');
        const fillBar = banner.querySelector('#updateProgressBarFill');
        const statusText = banner.querySelector('#updateProgressStatusText');
        const percentText = banner.querySelector('#updateProgressPercentText');

        const closeBanner = () => { banner.remove(); };
        btnDismiss.addEventListener('click', closeBanner);
        btnPostpone.addEventListener('click', closeBanner);

        btnStart.addEventListener('click', async () => {
            btnStart.disabled = true;
            btnStart.style.opacity = '0.6';
            actionArea.style.display = 'none';
            progressArea.style.display = 'block';
            statusText.textContent = 'กำลังเชื่อมต่อเพื่อดาวน์โหลด...';

            ipcRenderer.invoke('start-desktop-update');
        });

        ipcRenderer.on('update-download-progress', (_, p) => {
            if (!banner.parentElement) return;
            progressArea.style.display = 'block';
            actionArea.style.display = 'none';
            const pct = p.percent || 0;
            fillBar.style.width = pct + '%';
            percentText.textContent = pct + '%';
            if (p.downloadedMb && p.totalMb) {
                statusText.textContent = `กำลังดาวน์โหลด ${p.downloadedMb} MB / ${p.totalMb} MB (${pct}%)`;
            } else {
                statusText.textContent = `กำลังดาวน์โหลด ${pct}%...`;
            }
        });

        ipcRenderer.on('update-download-complete', () => {
            if (!banner.parentElement) return;
            fillBar.style.width = '100%';
            percentText.textContent = '100%';
            statusText.textContent = '✅ ดาวน์โหลดสำเร็จ กำลังติดตั้งและรีสตาร์ท...';
        });

        ipcRenderer.on('update-download-error', (_, err) => {
            if (!banner.parentElement) return;
            statusText.textContent = '⚠️ ดาวน์โหลดไม่สำเร็จ: ' + (err || 'เกิดข้อผิดพลาด');
            statusText.style.color = '#ef4444';
            actionArea.style.display = 'flex';
            btnStart.disabled = false;
            btnStart.style.opacity = '1';
        });
    });
});
