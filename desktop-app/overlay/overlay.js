const POLL_URL = 'https://boss-time-eloni.vercel.app/poll';

// Exact Lucide SVG icons matching the web dashboard
const ICONS = {
    zap: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"></path></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><path d="M20 6 9 17l-5-5"></path></svg>`,
    clock: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
    lock: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lock"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
    unlock: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-unlock"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`,
    appWindow: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-app-window"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="M10 4v4"></path><path d="M2 8h20"></path></svg>`,
    bell: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bell"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>`,
    flame: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flame"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>`,
    type: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-type"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>`
};

// Available 7 Fonts matching Web Dashboard
const AVAILABLE_FONTS = [
    { value: 'Google Sans Flex', label: 'Aa' },
    { value: 'Open Sans', label: 'Aa' },
    { value: 'New Rocker', label: 'Aa' },
    { value: 'Google Sans Code', label: 'Aa' },
    { value: 'PT Serif', label: 'Aa' },
    { value: 'Sancreek', label: 'Aa' },
    { value: 'Arbutus', label: 'Aa' }
];

const state = {
    serverOffset: 0,
    bosses: [],
    events: [],
    settings: {},
    alerted: new Set(),
    isClickThrough: false,
    isHoveringInteractive: false,
    fontSize: 11,
    font: 'Google Sans Flex',
    opacity: 65,
    clickThroughHotkey: 'Alt+F12',
    panelWidth: 36,
    isAdmin: false,
    appVersion: null,
    isFontPanelOpen: false,
    showLocation: false,
    announcement: null,
    lang: 'th'
};

// Boss Color Cache to ensure custom font colors never revert to white
const bossColorCache = new Map();

function cacheBossColor(id, color) {
    if (!id) return;
    const numId = Number(id);
    const clean = color && String(color).trim();
    if (clean && clean !== '#ffffff') {
        bossColorCache.set(numId, clean);
        try { localStorage.setItem(`boss_color_${numId}`, clean); } catch (_) {}
    }
}

function getCachedBossColor(id) {
    if (!id) return null;
    const numId = Number(id);
    if (bossColorCache.has(numId)) return bossColorCache.get(numId);
    try {
        const stored = localStorage.getItem(`boss_color_${numId}`);
        if (stored && stored !== '#ffffff') {
            bossColorCache.set(numId, stored);
            return stored;
        }
    } catch (_) {}
    return null;
}

const I18N_HUD = {
    th: {
        boss_hud: 'BOSS HUD',
        group_spawned: '🔥 บอสเกิดแล้ว',
        group_upcoming: '⏳ บอสกำลังจะเกิด',
        group_unset: '💤 ยังไม่ตั้งเวลา',
        empty: 'ไม่มีข้อมูลบอส',
        connecting: 'กำลังเชื่อมต่อข้อมูลบอส...',
        label_font_size: 'ขนาดตัวอักษร:',
        label_font_family: 'แบบอักษร:',
        label_show_location: 'แสดงสถานที่:',
        label_show_invasion: 'บอสอินเวชั่น:',
        label_panel_width: 'ความกว้างโปรแกรมหลัก:',
        label_opacity: 'ความโปร่งแสง:',
        label_hotkey: 'ปุ่มลัดโปร่งแสง:',
        label_custom_key: 'กดคีย์บนคีย์บอร์ด:',
        loc_show: 'แสดง',
        loc_hide: 'ซ่อน',
        tooltip_settings: 'ตั้งค่า HUD (ตัวอักษร, ขนาด, โปร่งแสง, สถานที่)',
        tooltip_clickthrough: 'สลับโหมดคลิกทะลุโปร่งแสง',
        tooltip_openmain: 'เปิดหน้าต่างหลัก (Full Dashboard)',
        tooltip_killnow: 'Kill now (คลิก 2 ครั้ง)',
        tooltip_killnow_confirm: 'คลิกอีกครั้งเพื่อยืนยัน Kill Now',
        tooltip_manual_time: 'กำหนดเวลาตายเอง (Admin)',
        tooltip_alert: 'คลิกเพื่อแจ้งเตือนสมาชิก (Admin Alert)',
        time_drawer_title: '🕒 ใส่เวลาตายเอง: ',
        time_preset_now: 'ตอนนี้',
        time_preset_save: '✓ บันทึก',
        toast_alert_sent: '🔔 แจ้งเตือนบอส [{name}] ให้สมาชิกเรียบร้อย!',
        toast_alert_cleared: '🔕 ยกเลิกการแจ้งเตือนบอส [{name}] แล้ว',
        toast_alert_fail: '⚠️ ไม่สามารถส่งแจ้งเตือนได้ ({error})',
        toast_kill_confirm: '⚡ คลิก Kill Now อีกครั้งเพื่อยืนยัน [{name}]',
        toast_kill_success: '⚔️ บันทึกการฆ่า [{name}] สำเร็จ!',
        toast_kill_fail: '⚠️ Kill Now ไม่สำเร็จ: {error}',
        toast_time_success: '🕒 บันทึกเวลา {time} ของ [{name}] สำเร็จ!',
        toast_time_fail: '⚠️ บันทึกเวลาไม่สำเร็จ: {error}',
        toast_hotkey_success: '✨ ตั้งปุ่มลัดโปร่งแสงเป็น [{key}] สำเร็จ!',
        toast_hotkey_fail: '⚠️ ไม่สามารถตั้งปุ่ม {key} ได้ ({error})'
    },
    en: {
        boss_hud: 'BOSS HUD',
        group_spawned: '🔥 SPAWNED',
        group_upcoming: '⏳ UPCOMING',
        group_unset: '💤 UNSET',
        empty: 'No boss data available',
        connecting: 'Connecting boss data...',
        label_font_size: 'Font Size:',
        label_font_family: 'Font Family:',
        label_show_location: 'Show Location:',
        label_show_invasion: 'Invasion Bosses:',
        label_panel_width: 'Main Window Width:',
        label_opacity: 'HUD Opacity:',
        label_hotkey: 'Click-Thru Hotkey:',
        label_custom_key: 'Press Keyboard Keys:',
        loc_show: 'Show',
        loc_hide: 'Hide',
        tooltip_settings: 'HUD Settings (Font, Size, Opacity, Location)',
        tooltip_clickthrough: 'Toggle Click-Through Mode',
        tooltip_openmain: 'Open Main Dashboard',
        tooltip_killnow: 'Kill Now (Click 2x)',
        tooltip_killnow_confirm: 'Click again to confirm Kill Now',
        tooltip_manual_time: 'Set Custom Kill Time (Admin)',
        tooltip_alert: 'Click to alert members (Admin Alert)',
        time_drawer_title: '🕒 Custom kill time: ',
        time_preset_now: 'Now',
        time_preset_save: '✓ Save',
        toast_alert_sent: '🔔 Boss alert sent for [{name}]!',
        toast_alert_cleared: '🔕 Cleared alert for [{name}]',
        toast_alert_fail: '⚠️ Failed to send alert ({error})',
        toast_kill_confirm: '⚡ Click Kill Now again to confirm [{name}]',
        toast_kill_success: '⚔️ Recorded kill for [{name}]!',
        toast_kill_fail: '⚠️ Failed to Kill Now: {error}',
        toast_time_success: '🕒 Saved time {time} for [{name}]!',
        toast_time_fail: '⚠️ Failed to save time: {error}',
        toast_hotkey_success: '✨ Click-through hotkey set to [{key}]!',
        toast_hotkey_fail: '⚠️ Failed to set hotkey {key} ({error})'
    }
};

function t(key, params = {}) {
    const lang = state.lang === 'th' ? 'th' : 'en';
    let text = (I18N_HUD[lang] && I18N_HUD[lang][key]) || (I18N_HUD.en && I18N_HUD.en[key]) || key;
    for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return text;
}

function formatHotkeyForDisplay(accelerator) {
    if (!accelerator) return 'Alt+F12';
    return accelerator
        .replace('CommandOrControl', 'Ctrl')
        .replace('Control', 'Ctrl');
}

const dom = {
    hudPanel: document.getElementById('hudPanel'),
    bossListContainer: document.getElementById('bossListContainer'),
    toastContainer: document.getElementById('toastContainer'),
    hudAnnouncement: document.getElementById('hudAnnouncement'),
    hudAnnouncementText: document.getElementById('hudAnnouncementText'),
    btnClickThrough: document.getElementById('btnClickThrough'),
    clickThroughIcon: document.getElementById('clickThroughIcon'),
    clickThroughLabel: document.getElementById('clickThroughLabel'),
    btnOpenMain: document.getElementById('btnOpenMain'),
    btnFontSettings: document.getElementById('btnFontSettings'),
    fontSizeDisplay: document.getElementById('fontSizeDisplay'),
    hudFontPanel: document.getElementById('hudFontPanel'),
    btnFontSizeMinus: document.getElementById('btnFontSizeMinus'),
    btnFontSizePlus: document.getElementById('btnFontSizePlus'),
    stepperValue: document.getElementById('stepperValue'),
    fontPillsContainer: document.getElementById('fontPillsContainer'),
    btnPanelWidthMinus: document.getElementById('btnPanelWidthMinus'),
    btnPanelWidthPlus: document.getElementById('btnPanelWidthPlus'),
    panelWidthDisplay: document.getElementById('panelWidthDisplay'),
    opacitySlider: document.getElementById('opacitySlider'),
    opacityDisplay: document.getElementById('opacityDisplay'),
    hotkeySelect: document.getElementById('hotkeySelect'),
    customHotkeyRow: document.getElementById('customHotkeyRow'),
    customHotkeyInput: document.getElementById('customHotkeyInput'),
    btnSaveCustomHotkey: document.getElementById('btnSaveCustomHotkey'),
    chkShowLocation: document.getElementById('chkShowLocation'),
    locationStatusText: document.getElementById('locationStatusText'),
    chkShowInvasion: document.getElementById('chkShowInvasion'),
    invasionStatusText: document.getElementById('invasionStatusText'),
    labelFontSize: document.getElementById('labelFontSize'),
    labelFontFamily: document.getElementById('labelFontFamily'),
    labelShowLocation: document.getElementById('labelShowLocation'),
    labelShowInvasion: document.getElementById('labelShowInvasion'),
    labelPanelWidth: document.getElementById('labelPanelWidth'),
    labelOpacity: document.getElementById('labelOpacity'),
    labelHotkey: document.getElementById('labelHotkey'),
    labelCustomKey: document.getElementById('labelCustomKey')
};

// Electron Bridge Integration
if (window.electronAPI) {
    window.electronAPI.getClickThrough().then(updateClickThroughUI);
    window.electronAPI.onClickThroughChanged(updateClickThroughUI);

    dom.btnClickThrough.addEventListener('click', () => {
        window.electronAPI.toggleClickThrough();
    });

    dom.btnOpenMain.addEventListener('click', () => {
        window.electronAPI.showMainWindow();
    });

    if (typeof window.electronAPI.onFontSettingsChanged === 'function') {
        window.electronAPI.onFontSettingsChanged((s) => {
            if (s && (s.fontSize || s.font)) {
                applyFontSettings(s.fontSize || state.fontSize, s.font || state.font, false);
            }
        });
    }

    if (typeof window.electronAPI.onPanelWidthChanged === 'function') {
        window.electronAPI.onPanelWidthChanged((rem) => {
            applyPanelWidth(rem, false);
        });
    }

    if (typeof window.electronAPI.onTrackerDataUpdated === 'function') {
        window.electronAPI.onTrackerDataUpdated((res) => {
            if (res && res.ok && res.data) {
                if (typeof res.isAdmin === 'boolean') state.isAdmin = res.isAdmin;
                if (res.lang && (res.lang === 'en' || res.lang === 'th') && res.lang !== state.lang) {
                    setHudLanguage(res.lang);
                }
                if (typeof res.showLocation === 'boolean' && res.showLocation !== state.showLocation) {
                    applyShowLocation(res.showLocation, false);
                }
                applyTrackerSnapshot(res.data);
            }
        });
    }

    if (typeof window.electronAPI.onLanguageChanged === 'function') {
        window.electronAPI.onLanguageChanged((lang) => {
            if (lang && (lang === 'en' || lang === 'th')) {
                setHudLanguage(lang);
            }
        });
    }

    if (typeof window.electronAPI.getHudSettings === 'function') {
        window.electronAPI.getHudSettings().then(settings => {
            if (settings) {
                if (settings.opacity) applyOpacity(Math.round(settings.opacity * 100), false);
                if (settings.clickThroughHotkey) applyHotkey(settings.clickThroughHotkey, false);
            }
        });
    }
}

function updateClickThroughUI(active) {
    state.isClickThrough = Boolean(active);
    if (state.isClickThrough) {
        dom.btnClickThrough.classList.add('active');
        dom.hudPanel.classList.add('click-through-active');
        document.body.classList.add('click-through-active');
        dom.clickThroughIcon.innerHTML = ICONS.lock;
        dom.clickThroughLabel.textContent = 'Click-Thru';
    } else {
        dom.btnClickThrough.classList.remove('active');
        dom.hudPanel.classList.remove('click-through-active');
        document.body.classList.remove('click-through-active');
        dom.clickThroughIcon.innerHTML = ICONS.unlock;
        dom.clickThroughLabel.textContent = formatHotkeyForDisplay(state.clickThroughHotkey);
    }
}

// Smart Hit-Testing:
// In Click-Through mode, mouse clicks pass through to Lineage 2.
// Controls in the top bar and settings panel remain interactive.
document.addEventListener('mousemove', (e) => {
    if (!state.isClickThrough || !window.electronAPI) return;
    const target = e.target.closest('.hud-header, .hud-font-panel, .btn-icon, .btn-stepper, .btn-font-pill, .hud-slider, .hud-switch, .opacity-slider, .hotkey-select, .custom-hotkey-input');
    if (target) {
        if (!state.isHoveringInteractive) {
            state.isHoveringInteractive = true;
            window.electronAPI.setIgnoreMouseEvents(false);
        }
    } else {
        if (state.isHoveringInteractive) {
            state.isHoveringInteractive = false;
            window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
        }
    }
});

function applyShowLocation(val, save = true) {
    state.showLocation = Boolean(val);
    if (dom.chkShowLocation) dom.chkShowLocation.checked = state.showLocation;
    if (dom.locationStatusText) {
        dom.locationStatusText.textContent = state.showLocation ? t('loc_show') : t('loc_hide');
    }
    if (save) {
        try {
            localStorage.setItem('dashboard.showLocation_hud_local', 'true');
            localStorage.setItem('dashboard.showLocation', state.showLocation ? 'true' : 'false');
        } catch (_) {}
    }
    renderBossList();
}

function applyShowInvasion(val, save = true) {
    const show = Boolean(val);
    state.settings.hideInvasionBosses = !show;
    if (dom.chkShowInvasion) dom.chkShowInvasion.checked = show;
    if (dom.invasionStatusText) {
        dom.invasionStatusText.textContent = show ? t('loc_show') : t('loc_hide');
    }
    if (save) {
        try {
            localStorage.setItem('dashboard.hideInvasionBosses', !show ? 'true' : 'false');
        } catch (_) {}
    }
    renderBossList();
}

function setHudLanguage(lang) {
    if (lang !== 'th' && lang !== 'en') lang = 'th';
    if (state.lang === lang) {
        updateHudLanguageUI();
        return;
    }
    state.lang = lang;
    try {
        localStorage.setItem('tracker_lang', lang);
    } catch (_) {}
    updateHudLanguageUI();
    renderBossList();
}

function updateHudLanguageUI() {
    const l = state.lang === 'en' ? 'en' : 'th';
    document.documentElement.lang = l;
    if (dom.labelFontSize) dom.labelFontSize.textContent = t('label_font_size');
    if (dom.labelFontFamily) dom.labelFontFamily.textContent = t('label_font_family');
    if (dom.labelShowLocation) dom.labelShowLocation.textContent = t('label_show_location');
    if (dom.labelShowInvasion) dom.labelShowInvasion.textContent = t('label_show_invasion');
    if (dom.labelPanelWidth) dom.labelPanelWidth.textContent = t('label_panel_width');
    if (dom.labelOpacity) dom.labelOpacity.textContent = t('label_opacity');
    if (dom.labelHotkey) dom.labelHotkey.textContent = t('label_hotkey');
    if (dom.labelCustomKey) dom.labelCustomKey.textContent = t('label_custom_key');
    if (dom.locationStatusText) dom.locationStatusText.textContent = state.showLocation ? t('loc_show') : t('loc_hide');
    if (dom.invasionStatusText) dom.invasionStatusText.textContent = !state.settings.hideInvasionBosses ? t('loc_show') : t('loc_hide');
    if (dom.btnFontSettings) dom.btnFontSettings.title = t('tooltip_settings');
    if (dom.btnClickThrough) dom.btnClickThrough.title = t('tooltip_clickthrough');
    if (dom.btnOpenMain) dom.btnOpenMain.title = t('tooltip_openmain');
}

// -------------------------------------------------------------
// Font & Display Settings System
// -------------------------------------------------------------
function initFontSettings() {
    renderFontPills();

    dom.btnFontSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        state.isFontPanelOpen = !state.isFontPanelOpen;
        dom.hudFontPanel.classList.toggle('active', state.isFontPanelOpen);
        dom.btnFontSettings.classList.toggle('active', state.isFontPanelOpen);
    });

    document.addEventListener('click', (e) => {
        if (state.isFontPanelOpen && !dom.hudFontPanel.contains(e.target) && !dom.btnFontSettings.contains(e.target)) {
            state.isFontPanelOpen = false;
            dom.hudFontPanel.classList.remove('active');
            dom.btnFontSettings.classList.remove('active');
        }
    });

    dom.btnFontSizeMinus.addEventListener('click', (e) => {
        e.stopPropagation();
        applyFontSettings(state.fontSize - 1, state.font, true);
    });

    dom.btnFontSizePlus.addEventListener('click', (e) => {
        e.stopPropagation();
        applyFontSettings(state.fontSize + 1, state.font, true);
    });

    // Location toggle listener
    if (dom.chkShowLocation) {
        dom.chkShowLocation.addEventListener('change', () => {
            applyShowLocation(dom.chkShowLocation.checked, true);
        });
    }

    // Invasion toggle listener
    if (dom.chkShowInvasion) {
        dom.chkShowInvasion.addEventListener('change', () => {
            applyShowInvasion(dom.chkShowInvasion.checked, true);
        });
    }

    // Load initial showLocation
    try {
        const savedLoc = localStorage.getItem('dashboard.showLocation');
        if (savedLoc !== null) {
            applyShowLocation(savedLoc === 'true', false);
        } else {
            applyShowLocation(false, false);
        }
    } catch (_) {
        applyShowLocation(false, false);
    }

    // Load initial showInvasion
    try {
        const savedHideInv = localStorage.getItem('dashboard.hideInvasionBosses');
        if (savedHideInv !== null) {
            applyShowInvasion(savedHideInv !== 'true', false);
        } else {
            applyShowInvasion(true, false);
        }
    } catch (_) {
        applyShowInvasion(true, false);
    }

    // Load initial font settings
    try {
        const savedSize = Number(localStorage.getItem('dashboard.fontSize'));
        const savedFont = localStorage.getItem('dashboard.appFont');
        applyFontSettings(
            Number.isFinite(savedSize) ? savedSize : 11,
            savedFont || 'Google Sans Flex',
            false
        );
    } catch (_) {
        applyFontSettings(11, 'Google Sans Flex', false);
    }

    // Load initial language
    try {
        const savedLang = localStorage.getItem('tracker_lang');
        if (savedLang === 'en' || savedLang === 'th') {
            setHudLanguage(savedLang);
        } else {
            setHudLanguage('th');
        }
    } catch (_) {
        setHudLanguage('th');
    }

    // Opacity slider listener
    if (dom.opacitySlider) {
        dom.opacitySlider.addEventListener('input', (e) => {
            applyOpacity(e.target.value, true);
        });
    }

    // Hotkey selector listeners
    if (dom.hotkeySelect) {
        dom.hotkeySelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'custom') {
                if (dom.customHotkeyRow) dom.customHotkeyRow.style.display = 'flex';
                if (dom.customHotkeyInput) dom.customHotkeyInput.focus();
            } else {
                if (dom.customHotkeyRow) dom.customHotkeyRow.style.display = 'none';
                applyHotkey(val, true);
            }
        });
    }

    if (dom.customHotkeyInput) {
        dom.customHotkeyInput.addEventListener('keydown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const parts = [];
            if (e.ctrlKey) parts.push('CommandOrControl');
            if (e.altKey) parts.push('Alt');
            if (e.shiftKey) parts.push('Shift');

            let keyName = e.key;
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(keyName)) return;
            if (keyName.startsWith('Key')) keyName = keyName.slice(3);
            if (keyName.length === 1) keyName = keyName.toUpperCase();
            parts.push(keyName);

            dom.customHotkeyInput.value = parts.join('+');
        });
    }

    if (dom.btnSaveCustomHotkey) {
        dom.btnSaveCustomHotkey.addEventListener('click', (e) => {
            e.stopPropagation();
            const customKey = dom.customHotkeyInput?.value?.trim();
            if (customKey) {
                applyHotkey(customKey, true);
            }
        });
    }

    // Panel width stepper listeners
    if (dom.btnPanelWidthMinus) {
        dom.btnPanelWidthMinus.addEventListener('click', (e) => {
            e.stopPropagation();
            let cur = state.panelWidth === 0 ? 100 : state.panelWidth;
            let next = Math.max(28, cur - 2);
            applyPanelWidth(next, true);
        });
    }

    if (dom.btnPanelWidthPlus) {
        dom.btnPanelWidthPlus.addEventListener('click', (e) => {
            e.stopPropagation();
            let cur = state.panelWidth;
            let next = (cur === 100 || cur === 0) ? 0 : cur + 2;
            applyPanelWidth(next, true);
        });
    }

    if (dom.panelWidthDisplay) {
        dom.panelWidthDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            applyPanelWidth(state.panelWidth === 0 ? 36 : 0, true);
        });
    }

    // Load initial panel width
    try {
        const savedRem = Number(localStorage.getItem('dashboard.webMaxWidthRem'));
        if (Number.isFinite(savedRem)) {
            applyPanelWidth(savedRem, false);
        } else {
            applyPanelWidth(36, false);
        }
    } catch (_) {
        applyPanelWidth(36, false);
    }

    // Load initial opacity
    try {
        const savedOp = Number(localStorage.getItem('dashboard.wrapperOpacity'));
        if (Number.isFinite(savedOp) && savedOp > 0) {
            applyOpacity(Math.round(savedOp * 100), false);
        } else {
            applyOpacity(65, false);
        }
    } catch (_) {
        applyOpacity(65, false);
    }
}

function applyPanelWidth(val, syncIPC = true) {
    let num = Number(val);
    if (!Number.isFinite(num)) num = 36;
    state.panelWidth = num;

    if (dom.panelWidthDisplay) {
        dom.panelWidthDisplay.textContent = num === 0 ? '100%' : `${num}rem`;
    }

    try {
        localStorage.setItem('dashboard.webMaxWidthRem', String(num));
    } catch (_) {}

    if (syncIPC && window.electronAPI && typeof window.electronAPI.setPanelWidth === 'function') {
        window.electronAPI.setPanelWidth(num);
    }
}

function applyOpacity(val, save = true) {
    state.opacity = Math.max(20, Math.min(100, Number(val) || 65));
    const normalAlpha = (state.opacity / 100).toFixed(2);
    const clickThroughAlpha = Math.max(0.15, (state.opacity / 100) * 0.75).toFixed(2);

    dom.hudPanel.style.setProperty('--hud-opacity', normalAlpha);
    dom.hudPanel.style.setProperty('--hud-clickthrough-opacity', clickThroughAlpha);

    if (dom.opacitySlider) dom.opacitySlider.value = state.opacity;
    if (dom.opacityDisplay) dom.opacityDisplay.textContent = `${state.opacity}%`;

    if (save) {
        try {
            localStorage.setItem('dashboard.wrapperOpacity', String(normalAlpha));
        } catch (_) {}
        if (window.electronAPI && typeof window.electronAPI.saveHudSettings === 'function') {
            window.electronAPI.saveHudSettings({ opacity: state.opacity / 100 });
        }
    }
}

function applyHotkey(accelerator, save = true) {
    if (!accelerator) return;
    state.clickThroughHotkey = accelerator;
    const displayLabel = formatHotkeyForDisplay(accelerator);
    if (dom.clickThroughLabel && !state.isClickThrough) {
        dom.clickThroughLabel.textContent = displayLabel;
    }

    if (dom.hotkeySelect) {
        const found = Array.from(dom.hotkeySelect.options).some(o => o.value === accelerator);
        if (found) {
            dom.hotkeySelect.value = accelerator;
            if (dom.customHotkeyRow) dom.customHotkeyRow.style.display = 'none';
        } else {
            dom.hotkeySelect.value = 'custom';
            if (dom.customHotkeyRow) dom.customHotkeyRow.style.display = 'flex';
            if (dom.customHotkeyInput) dom.customHotkeyInput.value = accelerator;
        }
    }

    if (save && window.electronAPI && typeof window.electronAPI.setHudHotkey === 'function') {
        window.electronAPI.setHudHotkey({ type: 'clickThrough', hotkey: accelerator }).then((res) => {
            if (res && res.ok) {
                showHudToast(t('toast_hotkey_success', { key: displayLabel }), '#38bdf8');
            } else {
                showHudToast(t('toast_hotkey_fail', { key: displayLabel, error: res?.error || 'Already in use' }), '#f59e0b');
            }
        });
    }
}

function renderFontPills() {
    if (!dom.fontPillsContainer) return;
    let html = '';
    for (const f of AVAILABLE_FONTS) {
        html += `<button type="button" class="btn-font-pill interactive-element" 
                         data-font="${f.value}" 
                         title="${f.value}" 
                         style="font-family: '${f.value}', serif;">
                     ${f.label}
                 </button>`;
    }
    dom.fontPillsContainer.innerHTML = html;

    dom.fontPillsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-font-pill');
        if (!btn) return;
        e.stopPropagation();
        const selectedFont = btn.getAttribute('data-font');
        if (selectedFont) {
            applyFontSettings(state.fontSize, selectedFont, true);
        }
    });
}

function applyFontSettings(fontSize, font, syncIPC = true) {
    state.fontSize = Math.max(10, Math.min(18, Math.round(fontSize)));
    if (font && AVAILABLE_FONTS.some(x => x.value === font)) {
        state.font = font;
    }

    try {
        localStorage.setItem('dashboard.fontSize', String(state.fontSize));
        localStorage.setItem('dashboard.appFont', state.font);
    } catch (_) {}

    dom.hudPanel.style.setProperty('--hud-font', `'${state.font}', ui-sans-serif, system-ui, sans-serif`);
    dom.hudPanel.style.setProperty('--hud-font-size', `${state.fontSize}px`);

    if (dom.stepperValue) dom.stepperValue.textContent = `${state.fontSize}px`;
    if (dom.fontSizeDisplay) dom.fontSizeDisplay.textContent = `${state.fontSize}px`;

    // Highlight active font pill
    document.querySelectorAll('.btn-font-pill').forEach(btn => {
        if (btn.getAttribute('data-font') === state.font) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    if (syncIPC && window.electronAPI && typeof window.electronAPI.syncFontSettings === 'function') {
        window.electronAPI.syncFontSettings({ fontSize: state.fontSize, font: state.font });
    }
}

// -------------------------------------------------------------
// Real-Time Polling & Zero-Interruption Auto-Update
// -------------------------------------------------------------
function applyTrackerSnapshot(data) {
    if (!data) return;

    if (Number.isFinite(data.serverTime)) {
        state.serverOffset = Number(data.serverTime) - Date.now();
    }

    // Auto-update check: detect when a new version is deployed
    if (data.appVersion) {
        const currentVer = localStorage.getItem('bossTracker.overlayAppVersion');
        if (!currentVer) {
            localStorage.setItem('bossTracker.overlayAppVersion', data.appVersion);
            state.appVersion = data.appVersion;
        } else if (currentVer !== data.appVersion) {
            localStorage.setItem('bossTracker.overlayAppVersion', data.appVersion);
            state.appVersion = data.appVersion;
            showHudToast(`🔄 พบการอัปเดตระบบ (${data.appVersion}) กำลังรีโหลดอัตโนมัติ...`, '#38bdf8');
            setTimeout(() => {
                if (window.electronAPI && typeof window.electronAPI.reloadApp === 'function') {
                    window.electronAPI.reloadApp();
                } else {
                    window.location.reload();
                }
            }, 1500);
            return;
        }
    }

    // Force-reload check
    if (data.forceReloadAt) {
        const lastForce = localStorage.getItem('bossTracker.forceReloadAt');
        if (!lastForce) {
            localStorage.setItem('bossTracker.forceReloadAt', String(data.forceReloadAt));
        } else if (Number(lastForce) < Number(data.forceReloadAt)) {
            localStorage.setItem('bossTracker.forceReloadAt', String(data.forceReloadAt));
            showHudToast('🔄 รีโหลดข้อมูลล่าสุดจากเซิร์ฟเวอร์...', '#38bdf8');
            setTimeout(() => {
                if (window.electronAPI && typeof window.electronAPI.reloadApp === 'function') {
                    window.electronAPI.reloadApp();
                } else {
                    window.location.reload();
                }
            }, 1200);
            return;
        }
    }

    // Server Announcement Banner
    let annText = '';
    if (data.announcement) {
        if (typeof data.announcement === 'string') {
            annText = data.announcement.trim();
        } else if (typeof data.announcement === 'object' && data.announcement !== null) {
            annText = (data.announcement.message || data.announcement.text || '').trim();
        }
    }

    if (annText && annText !== '[object Object]') {
        state.announcement = annText;
        if (dom.hudAnnouncement && dom.hudAnnouncementText) {
            dom.hudAnnouncementText.textContent = annText;
            dom.hudAnnouncement.style.display = 'flex';
        }
    } else {
        state.announcement = null;
        if (dom.hudAnnouncement) {
            dom.hudAnnouncement.style.display = 'none';
        }
    }

    const localHideInv = localStorage.getItem('dashboard.hideInvasionBosses');
    const hideInv = localHideInv !== null ? (localHideInv === 'true') : Boolean(data.hideInvasionBosses);
    state.settings = {
        hideInvasionBosses: hideInv,
        invasionLabel: data.invasionLabel || 'L3',
        invasionColor: data.invasionColor || '#facc15'
    };
    if (dom.chkShowInvasion) dom.chkShowInvasion.checked = !hideInv;
    if (dom.invasionStatusText) dom.invasionStatusText.textContent = !hideInv ? t('loc_show') : t('loc_hide');

    if (Array.isArray(data.bosses)) {
        for (const b of data.bosses) {
            if (b.color && b.color !== '#ffffff') {
                cacheBossColor(b.id, b.color);
            } else {
                const cached = getCachedBossColor(b.id);
                if (cached) b.color = cached;
            }
        }
    }

    state.bosses = data.bosses || [];
    state.events = data.events || [];

    renderBossList();
    checkAlerts();
}

async function fetchPollData() {
    try {
        if (window.electronAPI && typeof window.electronAPI.getTrackerData === 'function') {
            const res = await window.electronAPI.getTrackerData();
            if (res && res.ok && res.data) {
                if (typeof res.isAdmin === 'boolean') state.isAdmin = res.isAdmin;
                if (res.lang && (res.lang === 'en' || res.lang === 'th') && res.lang !== state.lang) {
                    setHudLanguage(res.lang);
                }
                if (typeof res.showLocation === 'boolean' && res.showLocation !== state.showLocation) {
                    applyShowLocation(res.showLocation, false);
                }
                applyTrackerSnapshot(res.data);
                return;
            }
        }

        // Fallback for standalone preview
        const res = await fetch(POLL_URL, { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            applyTrackerSnapshot(data);
        }
    } catch (_) {}
}

function getEffectiveColor(item, isInv) {
    if (isInv) return state.settings.invasionColor || '#facc15';
    if (item.color) {
        const clean = String(item.color).trim();
        if (clean && clean !== '#ffffff') {
            cacheBossColor(item.id, clean);
            return clean;
        }
    }
    const cached = getCachedBossColor(item.id);
    if (cached) return cached;
    return '#ffffff';
}

function formatCountdown(ms) {
    if (ms <= 0) return 'NOW';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderBossList() {
    if (!state.bosses || state.bosses.length === 0) {
        dom.bossListContainer.innerHTML = `
            <div class="hud-empty" style="padding: 24px 12px; text-align: center; color: #949ba4;">
                <div style="font-size: 20px; margin-bottom: 8px;">⏳</div>
                <div style="font-size: 11px; margin-bottom: 12px; line-height: 1.4;">${state.lang === 'th' ? 'กำลังเชื่อมต่อข้อมูลบอส...<br><span style="font-size: 10px; color: #64748b;">(หากยังไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบที่หน้าต่างหลัก)</span>' : 'Connecting to boss tracker...<br><span style="font-size: 10px; color: #64748b;">(Please make sure you are logged in on the main window)</span>'}</div>
                <button type="button" class="btn-time-save interactive-element" onclick="if(window.electronAPI) window.electronAPI.showMainWindow()" style="font-size: 10px; padding: 4px 10px;">🪟 ${state.lang === 'th' ? 'เปิดหน้าต่างหลัก' : 'Open Main Window'}</button>
            </div>
        `;
        return;
    }

    const now = Date.now() + state.serverOffset;

    const nowBosses = [];
    const upcomingBosses = [];
    const unsetBosses = [];

    for (const b of state.bosses) {
        if (b.is_invasion && state.settings.hideInvasionBosses) continue;

        const isInv = Boolean(b.is_invasion);

        if (b.next_spawn) {
            const targetTs = new Date(b.next_spawn).getTime();
            const diff = targetTs - now;
            const isNow = b.pinned_alive || (diff <= 0 && diff > -300000);

            if (isNow) {
                nowBosses.push({ item: b, targetTs, diff, isNow: true, isInv });
            } else if (diff > 0) {
                upcomingBosses.push({ item: b, targetTs, diff, isNow: false, isInv });
            } else {
                // Passed over 5 mins
                upcomingBosses.push({ item: b, targetTs, diff, isNow: false, isInv });
            }
        } else {
            unsetBosses.push({ item: b, targetTs: null, diff: Infinity, isNow: false, isInv });
        }
    }

    // Sort upcoming by diff ascending (nearest spawn first)
    upcomingBosses.sort((a, b) => a.diff - b.diff);

    // Sort unset by name
    unsetBosses.sort((a, b) => a.item.name.localeCompare(b.item.name, state.lang === 'th' ? 'th' : 'en'));

    let html = '';

    function renderItemCard({ item, isNow, diff, isInv }) {
        const fontColor = getEffectiveColor(item, isInv);
        const glow = (fontColor && fontColor !== '#ffffff') ? `text-shadow: 0 0 8px ${fontColor}80;` : '';
        const tag = isInv ? `[${state.settings.invasionLabel}] ` : '';
        const loc = (state.showLocation && item.location) ? `<div class="boss-loc">(${item.location})</div>` : '';

        let timerClass = 'timer-normal';
        let timerText = 'Unset';
        if (isNow) {
            timerClass = 'timer-now';
            timerText = 'NOW';
        } else if (Number.isFinite(diff) && diff !== Infinity) {
            if (diff <= 60000) timerClass = 'timer-soon';
            timerText = formatCountdown(diff);
        } else {
            timerClass = 'timer-unset';
        }

        const isPreSpawned = Boolean(item.pre_spawned);
        const alertBadge = isPreSpawned ? `<span class="badge-alert">🔔 ALERT</span>` : '';
        const maintBadge = item.post_maintenance ? `<span class="badge-alert" style="background:#475569;color:#e2e8f0;">MAINT</span>` : '';
        const cardClass = `boss-card ${isNow ? 'now' : ''} ${isPreSpawned ? 'pre-spawned' : ''}`;

        return `
            <div class="boss-card-wrapper" data-wrapper-boss-id="${item.id}">
                <div class="${cardClass}" data-boss-id="${item.id}">
                    <div class="boss-info">
                        <div class="boss-name" 
                             data-boss-id="${item.id}" 
                             data-boss-name="${item.name}" 
                             style="color: ${fontColor}; ${glow}">
                            ${tag}${item.name}${maintBadge}${alertBadge}
                        </div>
                        ${loc}
                    </div>
                    <div class="boss-actions">
                        <div class="boss-timer ${timerClass}">${timerText}</div>
                    </div>
                </div>
            </div>
        `;
    }

    if (nowBosses.length > 0) {
        html += `<div class="hud-group-header" style="color: #f87171;">${t('group_spawned')} (${nowBosses.length})</div>`;
        for (const b of nowBosses) html += renderItemCard(b);
    }

    if (upcomingBosses.length > 0) {
        for (const b of upcomingBosses) html += renderItemCard(b);
    }

    if (unsetBosses.length > 0) {
        html += `<div class="hud-group-header" style="color: #64748b;">${t('group_unset')} (${unsetBosses.length})</div>`;
        for (const b of unsetBosses) html += renderItemCard(b);
    }

    if (nowBosses.length === 0 && upcomingBosses.length === 0 && unsetBosses.length === 0) {
        html = `<div class="hud-empty">${t('empty')}</div>`;
    }

    dom.bossListContainer.innerHTML = html;
}

function checkAlerts() {
    const now = Date.now() + state.serverOffset;

    for (const b of state.bosses) {
        if (!b.next_spawn || b.post_maintenance) continue;
        if (b.is_invasion && state.settings.hideInvasionBosses) continue;

        const targetTs = new Date(b.next_spawn).getTime();
        const diff = targetTs - now;
        const preKey = `pre:${b.id}:${b.next_spawn}`;
        const spawnKey = `spawn:${b.id}:${b.next_spawn}`;

        const isInv = Boolean(b.is_invasion);
        const fontColor = getEffectiveColor(b, isInv);
        const tag = isInv ? `[${state.settings.invasionLabel}] ` : '';
        const loc = b.location ? ` (${b.location})` : '';

        // 1-minute alert
        if (diff > 0 && diff <= 60000 && !state.alerted.has(preKey)) {
            state.alerted.add(preKey);
            const actionText = state.lang === 'th' ? 'อีก 1 นาที' : 'in 1 min';
            showHudToast(`${ICONS.bell} <span style="color:${fontColor}">${tag}${b.name}${loc}</span> • ${actionText}`, '#38bdf8');
            playAlertSound('alert.mp3');
        }

        // Spawned alert
        if (diff <= 0 && diff > -60000 && !state.alerted.has(spawnKey)) {
            state.alerted.add(spawnKey);
            const actionText = state.lang === 'th' ? 'เกิดแล้ว!' : 'Spawned!';
            showHudToast(`${ICONS.flame} <span style="color:${fontColor}">${tag}${b.name}${loc}</span> • ${actionText}`, '#ef4444');
            playAlertSound('just-spawned.mp3');
        }
    }
}

function showHudToast(htmlMessage, borderColor) {
    if (!dom.toastContainer) return;
    // Keep max 1 active toast at a time in Discord HUD overlay to never block gameplay
    while (dom.toastContainer.firstChild) {
        dom.toastContainer.firstChild.remove();
    }
    const toast = document.createElement('div');
    toast.className = 'toast-item';
    if (borderColor) toast.style.borderLeft = `3px solid ${borderColor}`;
    toast.innerHTML = htmlMessage;

    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(4px)';
        toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}

function playAlertSound(path) {
    // When running in Electron desktop app, mainWindow acts as the single audio master
    // to prevent echo, duplicate audio, or clashing between HUD and main window!
    if (window.electronAPI) return;
    try {
        const audio = new Audio(path);
        audio.volume = 0.85;
        audio.play().catch(() => {});
    } catch (_) {}
}

// Initialize font system
initFontSettings();

// Tick local countdown every second
setInterval(() => {
    renderBossList();
}, 1000);

// Poll server every 2.5 seconds
fetchPollData();
setInterval(fetchPollData, 2500);
