// Phone alerts (Web Push): the 🔔 header button, per-device settings, and the bilingual
// how-to guide. Text follows the dashboard EN/TH switch; boss names are never translated.
// The desktop app has its own HUD alerts, so this stays off inside Electron.
(function () {
    'use strict';
    if (window.electronAPI || window.__bossTrackerPushLoaded) return;
    window.__bossTrackerPushLoaded = true;

    const STR = {
        en: {
            title: 'Phone alerts',
            intro: 'Get a notification over your game when a boss is about to spawn. These settings apply to this device only.',
            enable: 'Enable notifications on this device',
            enabling: 'Turning on…',
            guide_btn: 'How to enable alerts',
            back: 'Back',
            close: 'Close',
            loading: 'Loading…',
            install_title: 'Add Boss Tracker to your Home Screen first',
            install_body: 'On iPhone, alerts only work when you open Boss Tracker from its Home Screen icon.',
            unsupported_ios: 'This iPhone needs iOS 16.4 or later for alerts. Update in Settings → General → Software Update.',
            unsupported: "This browser can't receive alerts. On Android, use Chrome, Edge, Samsung Internet, or Firefox.",
            not_configured: "Phone alerts aren't set up on the server yet.",
            denied: 'Notifications are blocked for Boss Tracker. Allow them in your phone settings, then come back.',
            denied_ios: 'iPhone: Settings → Notifications → Boss Tracker → Allow Notifications.',
            denied_android: 'Android: tap the icon next to the address bar → Permissions → Notifications → Allow.',
            enabled_ok: 'Notifications are on for this device',
            section_when: 'Alert before spawn',
            min: '{n} min',
            at_spawn: 'Alert when it spawns (NOW)',
            admin_alerts: 'Admin alerts (double-click)',
            events: 'Events',
            quiet: 'Quiet hours (Thailand time)',
            quiet_from: 'No alerts from',
            quiet_to: 'to',
            bosses: 'Bosses to alert',
            events_list: 'Events to alert',
            search: 'Search',
            all: 'All',
            none: 'None',
            save: 'Save',
            saved: 'Saved',
            test: 'Test',
            test_sent: 'Test sent. Check the top of your screen.',
            turn_off: 'Turn off on this device',
            off_ok: 'Notifications are off for this device',
            lang_note: 'Alerts use the dashboard language. Switch EN/TH at the top to change it.',
            error: 'Something went wrong. Try again.',
            guide_iphone: 'iPhone (iOS 16.4 or later)',
            guide_iphone_steps: [
                'Open boss-time-eloni.vercel.app in Safari (recommended) and log in.',
                'Tap Share (square with an up arrow), then "Add to Home Screen" → "Add".',
                'Open Boss Tracker from the new Home Screen icon and log in again.',
                'Tap 🔔, then "Enable notifications on this device" → "Allow".',
                'Pick your alert times and bosses, then tap "Test".'
            ],
            guide_iphone_tip: 'Keep alerts visible while gaming: Settings → Notifications → Boss Tracker → Banners. If you use a Focus or Game mode, add Boss Tracker to its allowed apps.',
            guide_android: 'Android',
            guide_android_steps: [
                'Open boss-time-eloni.vercel.app in Chrome and log in.',
                'Optional: menu ⋮ → "Add to Home screen" or "Install app".',
                'Tap 🔔, then "Enable notifications on this device" → "Allow".',
                'Pick your alert times and bosses, then tap "Test".'
            ],
            guide_android_tip: 'Xiaomi, OPPO, vivo, realme: set Chrome battery use to "No restrictions" so alerts aren\'t delayed. Game Turbo or Game Space can hide pop-up alerts; allow them there.',
            guide_fix: 'No alerts?',
            guide_fix_steps: [
                'iPhone: open from the Home Screen icon, not Safari.',
                'Check that notifications are allowed for Boss Tracker in your phone settings.',
                'Check that Do Not Disturb or a Focus mode isn\'t blocking them.',
                'Still nothing: turn alerts off here, then enable them again.'
            ],
            guide_lang: 'For Thai alerts, switch the EN/TH button at the top to TH.'
        },
        th: {
            title: 'แจ้งเตือนบนมือถือ',
            intro: 'รับแจ้งเตือนเด้งทับเกมเมื่อบอสใกล้เกิด การตั้งค่านี้ใช้กับเครื่องนี้เท่านั้น',
            enable: 'เปิดแจ้งเตือนบนเครื่องนี้',
            enabling: 'กำลังเปิด…',
            guide_btn: 'วิธีเปิดแจ้งเตือน',
            back: 'กลับ',
            close: 'ปิด',
            loading: 'กำลังโหลด…',
            install_title: 'เพิ่ม Boss Tracker ลงหน้าจอโฮมก่อน',
            install_body: 'บน iPhone จะรับแจ้งเตือนได้เมื่อเปิด Boss Tracker จากไอคอนบนหน้าจอโฮมเท่านั้น',
            unsupported_ios: 'iPhone เครื่องนี้ต้องใช้ iOS 16.4 ขึ้นไปจึงจะรับแจ้งเตือนได้ อัปเดตได้ที่ ตั้งค่า → ทั่วไป → รายการอัปเดตซอฟต์แวร์',
            unsupported: 'เบราว์เซอร์นี้รับแจ้งเตือนไม่ได้ บน Android ให้ใช้ Chrome, Edge, Samsung Internet หรือ Firefox',
            not_configured: 'ระบบแจ้งเตือนบนมือถือยังไม่ได้เปิดใช้งานที่ server',
            denied: 'การแจ้งเตือนของ Boss Tracker ถูกปิดไว้ เปิดอนุญาตในการตั้งค่ามือถือแล้วกลับมาใหม่',
            denied_ios: 'iPhone: ตั้งค่า → การแจ้งเตือน → Boss Tracker → อนุญาตการแจ้งเตือน',
            denied_android: 'Android: แตะไอคอนข้างช่องที่อยู่ → สิทธิ์ → การแจ้งเตือน → อนุญาต',
            enabled_ok: 'เปิดแจ้งเตือนบนเครื่องนี้แล้ว',
            section_when: 'เตือนก่อนเกิด',
            min: '{n} นาที',
            at_spawn: 'เตือนตอนเกิด (NOW)',
            admin_alerts: 'เมื่อ Admin กดเตือน (ดับเบิลคลิก)',
            events: 'กิจกรรม',
            quiet: 'ช่วงไม่รบกวน (เวลาไทย)',
            quiet_from: 'ไม่แจ้งเตือนตั้งแต่',
            quiet_to: 'ถึง',
            bosses: 'บอสที่จะเตือน',
            events_list: 'กิจกรรมที่จะเตือน',
            search: 'ค้นหา',
            all: 'ทั้งหมด',
            none: 'ไม่เลือก',
            save: 'บันทึก',
            saved: 'บันทึกแล้ว',
            test: 'ทดสอบ',
            test_sent: 'ส่งทดสอบแล้ว ดูแจ้งเตือนด้านบนจอ',
            turn_off: 'ปิดแจ้งเตือนบนเครื่องนี้',
            off_ok: 'ปิดแจ้งเตือนบนเครื่องนี้แล้ว',
            lang_note: 'แจ้งเตือนใช้ภาษาเดียวกับหน้าเว็บ เปลี่ยนได้ที่ปุ่ม EN/TH ด้านบน',
            error: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง',
            guide_iphone: 'iPhone (iOS 16.4 ขึ้นไป)',
            guide_iphone_steps: [
                'เปิด boss-time-eloni.vercel.app ใน Safari (แนะนำ) แล้วล็อกอิน',
                'กดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) → "เพิ่มไปยังหน้าจอโฮม" → "เพิ่ม"',
                'เปิด Boss Tracker จากไอคอนบนหน้าจอโฮม แล้วล็อกอินอีกครั้ง',
                'กด 🔔 → "เปิดแจ้งเตือนบนเครื่องนี้" → "อนุญาต"',
                'เลือกเวลาเตือนและบอสที่ต้องการ แล้วกด "ทดสอบ"'
            ],
            guide_iphone_tip: 'ให้แจ้งเตือนขึ้นตอนเล่นเกม: ตั้งค่า → การแจ้งเตือน → Boss Tracker → แบนเนอร์ ถ้าใช้โหมดโฟกัสหรือโหมดเกม ให้เพิ่ม Boss Tracker ในรายการแอปที่อนุญาต',
            guide_android: 'Android',
            guide_android_steps: [
                'เปิด boss-time-eloni.vercel.app ใน Chrome แล้วล็อกอิน',
                'ไม่บังคับ: เมนู ⋮ → "เพิ่มลงในหน้าจอหลัก" หรือ "ติดตั้งแอป"',
                'กด 🔔 → "เปิดแจ้งเตือนบนเครื่องนี้" → "อนุญาต"',
                'เลือกเวลาเตือนและบอสที่ต้องการ แล้วกด "ทดสอบ"'
            ],
            guide_android_tip: 'Xiaomi, OPPO, vivo, realme: ตั้งค่าแบตเตอรี่ของ Chrome เป็น "ไม่จำกัด" เพื่อไม่ให้แจ้งเตือนมาช้า ถ้า Game Turbo หรือ Game Space ซ่อนแจ้งเตือน ให้อนุญาตในโหมดนั้น',
            guide_fix: 'ไม่มีแจ้งเตือน?',
            guide_fix_steps: [
                'iPhone: ต้องเปิดจากไอคอนบนหน้าจอโฮม ไม่ใช่จาก Safari',
                'เช็กว่าอนุญาตการแจ้งเตือนของ Boss Tracker ในการตั้งค่ามือถือแล้ว',
                'เช็กว่าไม่ได้เปิดโหมดห้ามรบกวนหรือโหมดโฟกัสอยู่',
                'ถ้ายังไม่ได้: ปิดแจ้งเตือนที่หน้านี้ แล้วเปิดใหม่อีกครั้ง'
            ],
            guide_lang: 'ถ้าต้องการแจ้งเตือนภาษาไทย ให้กดปุ่ม EN/TH ด้านบนเป็น TH'
        }
    };

    function lang() {
        try { return localStorage.getItem('tracker_lang') === 'th' ? 'th' : 'en'; } catch (_) { return 'en'; }
    }

    function tr(key, params) {
        let text = STR[lang()][key] ?? STR.en[key] ?? key;
        if (typeof text === 'string' && params) {
            for (const [name, value] of Object.entries(params)) text = text.replace(`{${name}}`, value);
        }
        return text;
    }

    function detect() {
        const ua = navigator.userAgent || '';
        const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const match = /OS (\d+)[_.](\d+)/.exec(ua);
        const iosVersion = ios && match ? Number(match[1]) + Number(match[2]) / 100 : null;
        const standalone = Boolean(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);
        const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        return { ios, iosVersion, standalone, android: /Android/i.test(ua), supported };
    }

    const env = detect();
    let config = null;
    let subscription = null;
    let prefs = null;
    let view = 'main';
    let notice = null;
    let catalog = null;
    let modal = null;

    async function api(method, url, body) {
        const res = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: body ? JSON.stringify(body) : undefined
        });
        let data = {};
        try { data = await res.json(); } catch (_) {}
        if (!res.ok) {
            const error = new Error(data.message || 'Request failed');
            error.status = res.status;
            throw error;
        }
        return data;
    }

    function urlBase64ToUint8Array(value) {
        const padding = '='.repeat((4 - (value.length % 4)) % 4);
        const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from(raw, char => char.charCodeAt(0));
    }

    async function getRegistration() {
        if (!('serviceWorker' in navigator)) return null;
        try {
            return (await navigator.serviceWorker.getRegistration('/')) || (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
        } catch (_) {
            return null;
        }
    }

    function localMutedIds() {
        try {
            const muted = JSON.parse(localStorage.getItem('dashboard.mutedBossIds') || '[]');
            return Array.isArray(muted) ? muted.map(String).map(id => (/^\d+$/.test(id) ? `boss_${id}` : id)).filter(id => /^(boss|event)_\d+$/.test(id)) : [];
        } catch (_) {
            return [];
        }
    }

    // ---------- DOM helpers ----------

    function h(tag, attrs, ...children) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs || {})) {
            if (value === null || value === undefined || value === false) continue;
            if (key === 'style') el.style.cssText = value;
            else if (key === 'class') el.className = value;
            else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
            else if (value === true) el.setAttribute(key, '');
            else el.setAttribute(key, value);
        }
        for (const child of children.flat()) {
            if (child === null || child === undefined || child === false) continue;
            el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        }
        return el;
    }

    function injectStyles() {
        if (document.getElementById('push-alerts-style')) return;
        const style = document.createElement('style');
        style.id = 'push-alerts-style';
        style.textContent = `
            #push-alerts-overlay{position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
            #push-alerts-panel{width:min(420px,100%);max-height:86vh;overflow:auto;background:#101012;color:#f4f4f5;border:1px solid #3f3f46;border-radius:16px;padding:16px;box-sizing:border-box;font:14px/1.5 system-ui,sans-serif}
            #push-alerts-panel h2{margin:0;font-size:17px;font-weight:700}
            #push-alerts-panel h3{margin:14px 0 6px;font-size:13px;font-weight:700;color:#a1a1aa}
            #push-alerts-panel p{margin:8px 0;color:#d4d4d8}
            #push-alerts-panel ol{margin:6px 0;padding-left:20px;color:#d4d4d8}
            #push-alerts-panel .pa-btn{display:block;width:100%;margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid #3f3f46;background:#18181b;color:#f4f4f5;font:600 14px system-ui;cursor:pointer}
            #push-alerts-panel .pa-primary{background:#d97706;border-color:#d97706;color:#fff}
            #push-alerts-panel .pa-link{background:none;border:none;color:#38bdf8;padding:6px 0;font:600 13px system-ui;cursor:pointer}
            #push-alerts-panel .pa-chip{display:inline-flex;align-items:center;gap:4px;margin:3px 4px 3px 0;padding:5px 9px;border:1px solid #3f3f46;border-radius:999px;font-size:13px;cursor:pointer}
            #push-alerts-panel .pa-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #27272a;font-size:14px}
            #push-alerts-panel .pa-list{max-height:220px;overflow:auto;border:1px solid #27272a;border-radius:10px;padding:0 10px}
            #push-alerts-panel .pa-note{font-size:12px;color:#a1a1aa}
            #push-alerts-panel .pa-ok{background:rgba(52,211,153,.12);color:#6ee7b7;border-radius:8px;padding:8px 10px;font-size:13px}
            #push-alerts-panel .pa-err{background:rgba(248,113,113,.12);color:#fca5a5;border-radius:8px;padding:8px 10px;font-size:13px}
            #push-alerts-panel input[type=time],#push-alerts-panel input[type=search]{background:#18181b;color:#f4f4f5;border:1px solid #3f3f46;border-radius:8px;padding:6px 8px;font:14px system-ui}
            #push-alerts-panel input[type=search]{width:100%;box-sizing:border-box;margin-bottom:6px}
        `;
        document.head.appendChild(style);
    }

    // ---------- Header button ----------

    function ensureButton() {
        if (document.getElementById('header-push-control')) return;
        const button = h('button', {
            id: 'header-push-control',
            type: 'button',
            class: 'compact-system-control no-drag',
            style: 'width:auto!important;min-width:30px!important;padding:0 6px!important;color:#fbbf24!important;background:rgba(251,191,36,.10)!important;border:1px solid rgba(251,191,36,.32)!important;border-radius:6px!important;cursor:pointer',
            onclick: openModal
        }, '🔔');
        document.body.appendChild(button);
        updateButtonLabel();
    }

    function updateButtonLabel() {
        const button = document.getElementById('header-push-control');
        if (!button) return;
        button.setAttribute('aria-label', tr('title'));
        button.setAttribute('data-unified-tooltip', tr('title'));
        button.removeAttribute('title');
    }

    // ---------- Modal ----------

    function closeModal() {
        if (modal) modal.remove();
        modal = null;
    }

    async function openModal() {
        injectStyles();
        view = 'main';
        notice = null;
        closeModal();
        modal = h('div', { id: 'push-alerts-overlay', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === modal) closeModal(); } },
            h('div', { id: 'push-alerts-panel' }));
        document.body.appendChild(modal);
        render([h('p', null, tr('loading'))]);
        try {
            if (!config) config = await api('GET', '/api/v1/push/config');
            if (env.supported && Notification.permission === 'granted') await loadSubscription();
        } catch (_) {
            notice = { type: 'err', text: tr('error') };
        }
        renderView();
    }

    function render(children) {
        const panel = document.getElementById('push-alerts-panel');
        if (!panel) return;
        panel.replaceChildren(
            h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px' },
                h('h2', null, '🔔 ' + tr('title')),
                h('button', { class: 'pa-link', type: 'button', onclick: closeModal }, tr('close'))),
            notice ? h('p', { class: notice.type === 'ok' ? 'pa-ok' : 'pa-err' }, notice.text) : null,
            ...children
        );
    }

    function guideLink() {
        return h('button', { class: 'pa-link', type: 'button', onclick: () => { view = 'guide'; notice = null; renderView(); } }, tr('guide_btn'));
    }

    function renderView() {
        if (!modal) return;
        if (view === 'guide') return renderGuide();
        if (env.ios && env.iosVersion !== null && env.iosVersion < 16.04) {
            return render([h('p', null, tr('unsupported_ios')), guideLink()]);
        }
        if (env.ios && !env.standalone) {
            return render([h('h3', null, tr('install_title')), h('p', null, tr('install_body')), h('ol', null, STR[lang()].guide_iphone_steps.slice(0, 3).map(step => h('li', null, step))), guideLink()]);
        }
        if (!env.supported) return render([h('p', null, tr('unsupported')), guideLink()]);
        if (!config?.enabled) return render([h('p', null, tr('not_configured'))]);
        if (Notification.permission === 'denied') {
            return render([h('p', null, tr('denied')), h('p', { class: 'pa-note' }, env.ios ? tr('denied_ios') : tr('denied_android')), guideLink()]);
        }
        if (!subscription || !prefs) {
            return render([
                h('p', null, tr('intro')),
                h('button', { class: 'pa-btn pa-primary', type: 'button', onclick: enable }, tr('enable')),
                h('p', { class: 'pa-note' }, tr('lang_note')),
                guideLink()
            ]);
        }
        renderPrefs();
    }

    function renderGuide() {
        const s = STR[lang()];
        render([
            h('button', { class: 'pa-link', type: 'button', onclick: () => { view = 'main'; renderView(); } }, '← ' + tr('back')),
            h('h3', null, s.guide_iphone),
            h('ol', null, s.guide_iphone_steps.map(step => h('li', null, step))),
            h('p', { class: 'pa-note' }, s.guide_iphone_tip),
            h('h3', null, s.guide_android),
            h('ol', null, s.guide_android_steps.map(step => h('li', null, step))),
            h('p', { class: 'pa-note' }, s.guide_android_tip),
            h('h3', null, s.guide_fix),
            h('ol', null, s.guide_fix_steps.map(step => h('li', null, step))),
            h('p', { class: 'pa-note' }, s.guide_lang)
        ]);
    }

    async function loadCatalog() {
        if (catalog) return catalog;
        const data = await api('GET', '/poll');
        const hideInvasion = Boolean(data.hideInvasionBosses);
        const byName = (a, b) => String(a.name).localeCompare(String(b.name));
        catalog = {
            bosses: (data.bosses || []).filter(b => !(b.is_invasion && hideInvasion)).map(b => ({ key: `boss_${b.id}`, name: String(b.name || ''), location: String(b.location || '') })).sort(byName),
            events: (data.allEvents || data.events || []).map(e => ({ key: `event_${e.id}`, name: String(e.name || ''), location: String(e.event_time || '') })).sort(byName)
        };
        return catalog;
    }

    function toggleChip(label, checked, onChange) {
        const input = h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
        return h('label', { class: 'pa-chip' }, input, label);
    }

    function switchRow(label, checked, onChange) {
        return h('label', { class: 'pa-row' }, h('span', null, label), h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }));
    }

    function itemList(title, items, draft) {
        const muted = new Set(draft.mutedIds);
        const rows = items.map(item => {
            const input = h('input', { type: 'checkbox', checked: !muted.has(item.key), onchange: (e) => {
                if (e.target.checked) muted.delete(item.key); else muted.add(item.key);
                draft.mutedIds = [...muted];
            } });
            const row = h('label', { class: 'pa-row', 'data-name': item.name.toLowerCase() },
                h('span', null, item.name, item.location ? h('span', { class: 'pa-note' }, ' · ' + item.location) : null), input);
            row._input = input;
            return row;
        });
        const list = h('div', { class: 'pa-list' }, rows);
        const setAll = (checked) => {
            for (const row of rows) {
                if (row.style.display === 'none') continue;
                row._input.checked = checked;
                row._input.dispatchEvent(new Event('change'));
            }
        };
        return [
            h('div', { style: 'display:flex;align-items:center;justify-content:space-between' },
                h('h3', null, title),
                h('span', null,
                    h('button', { class: 'pa-link', type: 'button', onclick: () => setAll(true) }, tr('all')), ' · ',
                    h('button', { class: 'pa-link', type: 'button', onclick: () => setAll(false) }, tr('none')))),
            items.length > 8 ? h('input', { type: 'search', placeholder: tr('search'), oninput: (e) => {
                const q = e.target.value.trim().toLowerCase();
                for (const row of rows) row.style.display = !q || row.dataset.name.includes(q) ? '' : 'none';
            } }) : null,
            list
        ];
    }

    async function renderPrefs() {
        const draft = { ...prefs, leads: [...prefs.leads], mutedIds: [...prefs.mutedIds] };
        let items = { bosses: [], events: [] };
        try { items = await loadCatalog(); } catch (_) {}
        if (!modal || view !== 'main') return;
        const quietOn = Boolean(draft.quietStart && draft.quietEnd);
        const quietStart = h('input', { type: 'time', value: draft.quietStart || '01:00' });
        const quietEnd = h('input', { type: 'time', value: draft.quietEnd || '08:00' });
        const quietToggle = h('input', { type: 'checkbox', checked: quietOn });
        render([
            h('p', { class: 'pa-ok' }, tr('enabled_ok')),
            h('h3', null, tr('section_when')),
            h('div', null, (config.leadChoices || []).map(n => toggleChip(tr('min', { n }), draft.leads.includes(n), (on) => {
                draft.leads = on ? [...new Set([...draft.leads, n])] : draft.leads.filter(x => x !== n);
            }))),
            switchRow(tr('at_spawn'), draft.atSpawn, (on) => { draft.atSpawn = on; }),
            switchRow(tr('admin_alerts'), draft.adminAlerts, (on) => { draft.adminAlerts = on; }),
            switchRow(tr('events'), draft.events, (on) => { draft.events = on; }),
            h('h3', null, tr('quiet')),
            h('label', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px' },
                quietToggle, tr('quiet_from'), quietStart, tr('quiet_to'), quietEnd),
            ...itemList(tr('bosses'), items.bosses, draft),
            items.events.length ? itemList(tr('events_list'), items.events, draft) : [],
            h('button', { class: 'pa-btn pa-primary', type: 'button', onclick: async () => {
                draft.quietStart = quietToggle.checked ? quietStart.value : null;
                draft.quietEnd = quietToggle.checked ? quietEnd.value : null;
                draft.lang = lang();
                await savePrefs(draft);
            } }, tr('save')),
            h('button', { class: 'pa-btn', type: 'button', onclick: sendTest }, tr('test')),
            h('p', { class: 'pa-note' }, tr('lang_note')),
            h('button', { class: 'pa-link', type: 'button', onclick: disable }, tr('turn_off')),
            ' · ',
            guideLink()
        ]);
    }

    // ---------- Actions ----------

    async function loadSubscription() {
        const registration = await getRegistration();
        subscription = registration ? await registration.pushManager.getSubscription() : null;
        prefs = null;
        if (!subscription) return;
        const status = await api('POST', '/api/v1/push/subscription/status', { endpoint: subscription.endpoint });
        if (status.subscribed) {
            prefs = status.prefs;
        } else {
            // The server lost this device (e.g. it was cleaned up); register it again.
            const result = await api('POST', '/api/v1/push/subscription', { subscription: subscription.toJSON(), prefs: { lang: lang(), mutedIds: localMutedIds() } });
            prefs = result.prefs;
        }
    }

    async function enable(event) {
        const button = event?.currentTarget;
        if (button) { button.disabled = true; button.textContent = tr('enabling'); }
        notice = null;
        try {
            // Must run inside the tap so iOS shows the permission prompt.
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return renderView();
            const registration = await getRegistration();
            if (!registration) throw new Error('no service worker');
            await navigator.serviceWorker.ready;
            subscription = (await registration.pushManager.getSubscription()) ||
                (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) }));
            const result = await api('POST', '/api/v1/push/subscription', {
                subscription: subscription.toJSON(),
                prefs: { ...config.defaults, lang: lang(), mutedIds: localMutedIds() }
            });
            prefs = result.prefs;
        } catch (_) {
            notice = { type: 'err', text: tr('error') };
        }
        renderView();
    }

    async function savePrefs(draft) {
        notice = null;
        try {
            const result = await api('PUT', '/api/v1/push/subscription', { endpoint: subscription.endpoint, prefs: draft });
            prefs = result.prefs;
            notice = { type: 'ok', text: tr('saved') };
        } catch (_) {
            notice = { type: 'err', text: tr('error') };
        }
        renderView();
        document.getElementById('push-alerts-panel')?.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function sendTest() {
        notice = null;
        try {
            await api('POST', '/api/v1/push/test', { endpoint: subscription.endpoint });
            notice = { type: 'ok', text: tr('test_sent') };
        } catch (error) {
            notice = { type: 'err', text: error.message && error.status === 429 ? error.message : tr('error') };
        }
        renderView();
        document.getElementById('push-alerts-panel')?.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function disable() {
        notice = null;
        try {
            if (subscription) {
                await api('DELETE', '/api/v1/push/subscription', { endpoint: subscription.endpoint });
                await subscription.unsubscribe().catch(() => {});
            }
            subscription = null;
            prefs = null;
            notice = { type: 'ok', text: tr('off_ok') };
        } catch (_) {
            notice = { type: 'err', text: tr('error') };
        }
        renderView();
    }

    // Keep the server's copy of this device's language current: once per app open and
    // whenever the EN/TH switch changes. Never on a timer.
    async function syncLanguage() {
        if (!env.supported || Notification.permission !== 'granted') return;
        try {
            if (!subscription) {
                const registration = await navigator.serviceWorker.getRegistration('/');
                subscription = registration ? await registration.pushManager.getSubscription() : null;
            }
            if (!subscription) return;
            const result = await api('PUT', '/api/v1/push/subscription', { endpoint: subscription.endpoint, prefs: { lang: lang() } });
            prefs = result.prefs;
        } catch (error) {
            if (error.status === 404 && subscription) {
                try {
                    const result = await api('POST', '/api/v1/push/subscription', { subscription: subscription.toJSON(), prefs: { lang: lang(), mutedIds: localMutedIds() } });
                    prefs = result.prefs;
                } catch (_) {}
            }
        }
    }

    window.addEventListener('tracker:languagechange', () => {
        updateButtonLabel();
        syncLanguage();
        if (modal) renderView();
    });

    function start() {
        if (!document.getElementById('app')) return; // dashboard only, not the login page
        ensureButton();
        syncLanguage();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
