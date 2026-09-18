(function () {
    'use strict';

    const DB_URL = 'https://boss-timel2m-default-rtdb.asia-southeast1.firebasedatabase.app';
    const LIVE_URL = `${DB_URL}/tracker/liveEvent.json`;
    const suppressInitialPreSpawnAudio = performance.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
    if (suppressInitialPreSpawnAudio) {
        const originalPlay = HTMLMediaElement.prototype.play;
        const suppressUntil = Date.now() + 3000;
        const guardedPlay = function (...args) {
            const src = String(this.currentSrc || this.src || '');
            if (Date.now() < suppressUntil && /\/(?:pop2|ultraman)\.mp3(?:\?|$)/i.test(src)) {
                return Promise.resolve();
            }
            return originalPlay.apply(this, args);
        };
        HTMLMediaElement.prototype.play = guardedPlay;
        setTimeout(() => {
            if (HTMLMediaElement.prototype.play === guardedPlay) HTMLMediaElement.prototype.play = originalPlay;
        }, 3100);
    }
    const SOUND_FILES = {
        alert: '/alert.mp3', bell: '/bell.mp3', flute: '/flute.mp3', guitar: '/guitar.mp3',
        warHorn: '/warHorn.mp3', levelUp: '/game.wav', ratedRSuperstar: '/rated-r.mp3',
        jokowi: '/jokowi.mp3', virus: '/virus.mp3', walls: '/walls.mp3', shaq: '/shaq.mp3',
        hey: '/hey.mp3', kaget: '/kaget.mp3', kontlo: '/kontlo.mp3', kukuku: '/kukuku.mp3',
        lawan: '/lawan.mp3', ultraman: '/ultraman.mp3', kuntilanak: '/kuntilanak.mp3',
        justSpawned: '/just-spawned.mp3', pop2: '/pop2.mp3', notification: '/notification.mp3'
    };

    const state = {
        bosses: new Map(),
        events: new Map(),
        lastEventId: sessionStorage.getItem('bossTracker.lastLiveEvent') || '',
        seenEventIds: new Set(sessionStorage.getItem('bossTracker.lastLiveEvent') ? [sessionStorage.getItem('bossTracker.lastLiveEvent')] : []),
        audioUnlocked: false,
        streamConnected: false,
        streamFailed: false,
        alerted: new Set(),
        lastPlayedAt: 0,
        serverOffset: 0,
        initialEventsLoaded: false,
        audioQueue: [],
        audioPlaying: false,
        highestDataRevision: 0,
        lastGoodPollData: null
    };

    function setting(key, fallback) {
        const raw = localStorage.getItem(`dashboard.${key}`);
        if (raw === null) return fallback;
        try { return JSON.parse(raw); } catch (_) { return raw; }
    }

    function isMuted(id, kind) {
        const muted = setting('mutedBossIds', []);
        const values = Array.isArray(muted) ? muted.map(String) : [];
        return values.includes(`${kind}_${id}`) || values.includes(String(id));
    }

    function soundPath(key, fallback) {
        if (!key || key === 'off') return null;
        return SOUND_FILES[key] || (String(key).startsWith('/') ? key : fallback);
    }

    const I18N = {
        en: {
            lang_code: 'EN',
            lang_toggle_title: 'Language: English (Click to switch to Thai)',
            search_placeholder: 'Search...',
            bosses_tab: 'Bosses',
            invasion_tab: 'Invasion',
            events_tab: 'Events',
            show_muted: 'Show Muted',
            hide_muted: 'Hide Muted',
            settings: 'Settings',
            audio_status_connected: 'Realtime Audio Connected',
            audio_status_fallback: 'Polling Audio (Fallback)',
            audio_status_connecting: 'Audio Connecting...',
            audio_status_blocked: 'Audio Blocked — Click again to enable',
            audio_status_enable: 'Enable Audio',
            tz_title: 'Time Zone GMT+{offset} (Click to switch)',
            tz_notice: '🕐 Time Zone GMT+{offset}',
            guest_badge_title: 'Guest Access — Temporary session',
            spawn_soon_notice: '🔔 Spawn Soon — {name} will spawn in {min} min',
            spawned_notice: '🔥 Spawned — {name} has spawned!',
            offline_notice: '⚠️ Offline — Connection lost',
            lang_switched: '🌐 Language changed to English',
            tooltip_kill_now: 'Kill Now (2 Clicks)',
            tooltip_confirm_kill: 'Confirm Kill Now',
            tooltip_still_alive_2x: 'Still Alive (2 Clicks)',
            tooltip_spawn_5m: 'Spawn in 5 Minutes (2 Clicks)',
            tooltip_spawn_1m: 'Spawn in 1 Minute (2 Clicks)',
            tooltip_not_spawned: 'Not Spawned (2 Clicks)',
            tooltip_event_done: 'Mark Event Done (2 Clicks)',
            tooltip_skip_today: 'Skip Today (2 Clicks)',
            tooltip_pin_still_alive: 'Pin Still Alive (2 Clicks)',
            tooltip_confirm_2nd: 'Confirm with Second Click',
            tooltip_pre_spawn_notify: 'Double-click to notify members',
            tooltip_pre_spawn_clear: 'Double-click to clear pre-spawn alert',
            tooltip_edit_boss: 'Edit Boss',
            tooltip_delete_boss: 'Delete Boss',
            tooltip_delete: 'Delete',
            tooltip_custom_kill: 'Custom Kill Time',
            tooltip_more_options: 'More Options',
            tooltip_advance_cycle: 'Advance Cycle',
            tooltip_unpin: 'Unpin',
            tooltip_pin: 'Pin',
            tooltip_unmute: 'Unmute Alert',
            tooltip_mute: 'Mute Alert',
            tooltip_update_spawn: 'Update Spawn',
            tooltip_reset_time: 'Reset Time',
            tooltip_undo: 'Undo',
            tooltip_close: 'Close',
            tooltip_save: 'Save',
            tooltip_cancel: 'Cancel',
            tooltip_passwords: 'Manage Passwords',
            tab_display: 'Display',
            tab_audio: 'Audio',
            tab_invasion: 'Invasion',
            tab_events: 'Events',
            tab_admin: 'Admin',
            system_label: 'System:',
            tab_passwords: 'System Passwords',
            tab_guest: 'Guest Access',
            tab_sheets: 'Google Sheets',
            pre_spawn_toast: '⚠️ Boss Alert — {name} is about to spawn!',
            verify_admin_title: '🛡️ Admin Verification',
            verify_admin_desc: 'Currently in Member/Guest mode. Please enter Admin password to unlock:',
            verify_admin_ph: 'Current Admin password',
            verify_btn_title: 'Verify Admin',
            verify_btn: '🔓 Verify',
            admin_pwd_label: '🛡️ Admin Password',
            admin_badge: 'System Control',
            admin_pwd_ph: 'New password (min 8 chars)',
            admin_pwd_hint: 'For Admin mode: record boss kill times, add/delete bosses, manage events',
            member_pwd_label: '👥 Member Password',
            member_badge: 'View Access',
            member_pwd_ph: 'New password (min 8 chars)',
            member_pwd_hint: 'For clan members: view boss timetable, countdown timers, and audio alerts',
            pwd_cloud_notice: 'Changes will sync to Firebase Cloud automatically',
            cancel_btn: 'Cancel',
            save_pwd_btn: '💾 Save Passwords',
            guest_section_title: 'Generate Temporary Passwords (Guest Access)',
            guest_label_field: 'Name / Note',
            guest_label_ph: 'e.g. Guest #1 / Friend',
            guest_duration_field: 'Expiration Duration',
            guest_dur_1: '1 Hour (1 hr)',
            guest_dur_6: '6 Hours (6 hrs)',
            guest_dur_12: '12 Hours (12 hrs)',
            guest_dur_24: '1 Day (24 hrs)',
            guest_dur_72: '3 Days (72 hrs)',
            guest_dur_168: '7 Days (1 week)',
            guest_pwd_field: 'Guest Password (or generate random)',
            guest_pwd_ph: 'Type password or generate random',
            guest_random_btn: '🎲 Random',
            guest_create_btn: '➕ Create',
            guest_table_title: '📋 All Temporary Passwords',
            guest_refresh_btn: '🔄 Refresh',
            guest_col_name: 'Name / Note',
            guest_col_pwd: 'Password',
            guest_col_expires: 'Expires',
            guest_col_status: 'Status',
            guest_col_action: 'Actions',
            guest_loading: 'Loading...',
            sheets_lock_title: 'Protected Configuration Area',
            sheets_lock_desc: 'Parallel Google Sheets database settings are protected. Enter password to access:',
            sheets_lock_ph: 'Enter password...',
            sheets_unlock_btn: '🔓 Unlock',
            sheets_unlocked_badge: '🔓 Unlocked',
            sheets_lock_btn: '🔒 Lock',
            sheets_url_label: '🌐 Google Apps Script Web App URL',
            sheets_url_hint: 'Web app URL from Google Sheets Deployment (must end with /exec)',
            sheets_token_label: '🔑 Secret Token',
            sheets_token_hint: 'Must match SECRET_TOKEN in Code.gs',
            sheets_mirror_label: 'Enable Parallel Mirror',
            sheets_mirror_hint: 'Sync bosses and events to Google Sheets in background on every update',
            sheets_failover_label: 'Enable Auto Failover',
            sheets_failover_hint: 'Serve data from Google Sheets if Firebase is offline or quota exceeded',
            sheets_test_btn: '⚡ Test Connection',
            sheets_sync_btn: '🔄 Sync All Now',
            sheets_save_btn: '💾 Save Settings',
            sheets_script_guide: '📖 <b>Script file:</b> located at <code>google_apps_script/Code.gs</code> with guide in <code>google_apps_script/README.md</code>',
            boss_font_color: 'Boss Font Color',
            color_preview: 'Preview',
            color_default: 'Default',
            color_custom: 'Custom Color'
        },
        th: {
            lang_code: 'TH',
            lang_toggle_title: 'ภาษา: ไทย (กดเพื่อเปลี่ยนเป็น English)',
            search_placeholder: 'ค้นหา...',
            bosses_tab: 'บอส',
            invasion_tab: 'สงครามบุกรุก',
            events_tab: 'กิจกรรม',
            show_muted: 'แสดงรายการปิดเสียง',
            hide_muted: 'ซ่อนรายการปิดเสียง',
            settings: 'ตั้งค่า',
            boss_font_color: 'สีตัวอักษรบอส',
            color_preview: 'ตัวอย่าง',
            color_default: 'ค่าเริ่มต้น',
            color_custom: 'เลือกสีเอง',
            audio_status_connected: 'เสียงเรียลไทม์เชื่อมต่อแล้ว',
            audio_status_fallback: 'เสียงเชื่อมต่อสำรอง',
            audio_status_connecting: 'กำลังเชื่อมต่อเสียง...',
            audio_status_blocked: 'เบราว์เซอร์บล็อกเสียง กรุณากดอีกครั้ง',
            audio_status_enable: 'เปิดเสียงแจ้งเตือน',
            tz_title: 'เขตเวลา GMT+{offset} (กดเพื่อสลับ)',
            tz_notice: '🕐 เปลี่ยนเขตเวลาเป็น GMT+{offset}',
            guest_badge_title: 'เข้าใช้งานด้วยรหัสชั่วคราว',
            spawn_soon_notice: '🔔 บอสใกล้เกิด — {name} จะเกิดใน {min} นาที',
            spawned_notice: '🔥 บอสเกิดแล้ว — {name} เกิดแล้ว!',
            offline_notice: '⚠️ ออฟไลน์ — การเชื่อมต่อขาดหาย',
            lang_switched: '🌐 เปลี่ยนภาษาเป็น ภาษาไทย เรียบร้อย',
            tooltip_kill_now: 'บันทึกเวลาตายตอนนี้ (คลิก 2 ครั้ง)',
            tooltip_confirm_kill: 'คลิกครั้งที่ 2 เพื่อยืนยันเวลาตาย',
            tooltip_still_alive_2x: 'บอสยังไม่ตาย (คลิก 2 ครั้ง)',
            tooltip_spawn_5m: 'บอสเกิดใน 5 นาที (คลิก 2 ครั้ง)',
            tooltip_spawn_1m: 'บอสเกิดใน 1 นาที (คลิก 2 ครั้ง)',
            tooltip_not_spawned: 'บอสยังไม่เกิด (คลิก 2 ครั้ง)',
            tooltip_event_done: 'กิจกรรมเสร็จแล้ว (กด 2 ครั้ง)',
            tooltip_skip_today: 'ข้ามกิจกรรมวันนี้ (กด 2 ครั้ง)',
            tooltip_pin_still_alive: 'ปักหมุดว่ายังไม่จบ (กด 2 ครั้ง)',
            tooltip_confirm_2nd: 'กดครั้งที่ 2 เพื่อยืนยัน',
            tooltip_pre_spawn_notify: 'ดับเบิลคลิกชื่อบอสเพื่อแจ้งเตือนสมาชิก',
            tooltip_pre_spawn_clear: 'ดับเบิลคลิกชื่อบอสเพื่อยกเลิกการแจ้งเตือน',
            tooltip_edit_boss: 'แก้ไขบอส',
            tooltip_delete_boss: 'ลบบอส',
            tooltip_delete: 'ลบ',
            tooltip_custom_kill: 'กำหนดเวลาตายเอง',
            tooltip_more_options: 'ตัวเลือกเพิ่มเติม',
            tooltip_advance_cycle: 'ข้ามรอบ',
            tooltip_unpin: 'ยกเลิกปักหมุด',
            tooltip_pin: 'ปักหมุด',
            tooltip_unmute: 'เปิดเสียงแจ้งเตือน',
            tooltip_mute: 'ปิดเสียงแจ้งเตือน',
            tooltip_update_spawn: 'อัปเดตเวลาเกิด',
            tooltip_reset_time: 'รีเซ็ตเวลา',
            tooltip_undo: 'ย้อนกลับ',
            tooltip_close: 'ปิด',
            tooltip_save: 'บันทึก',
            tooltip_cancel: 'ยกเลิก',
            tooltip_passwords: 'จัดการรหัสผ่าน',
            tab_display: 'การแสดงผล',
            tab_audio: 'เสียงแจ้งเตือน',
            tab_invasion: 'สงครามบุกรุก',
            tab_events: 'กิจกรรม',
            tab_admin: 'ผู้ดูแลระบบ',
            system_label: 'ระบบ:',
            tab_passwords: 'รหัสผ่านระบบ',
            tab_guest: 'ไอดีชั่วคราว (Guest)',
            tab_sheets: 'Google Sheets',
            pre_spawn_toast: '⚠️ แจ้งเตือนบอส — {name} กำลังจะเกิด!',
            verify_admin_title: '🛡️ ยืนยันตัวตนผู้ดูแลระบบ',
            verify_admin_desc: 'ปัจจุบันอยู่ในโหมด สมาชิก/ผู้เยี่ยมชม กรุณากรอกรหัสผ่าน Admin เพื่อปลดล็อก:',
            verify_admin_ph: 'รหัสผ่าน Admin ปัจจุบัน',
            verify_btn_title: 'ยืนยัน Admin',
            verify_btn: '🔓 ยืนยัน',
            admin_pwd_label: '🛡️ รหัสผ่าน Admin',
            admin_badge: 'ควบคุมระบบ',
            admin_pwd_ph: 'รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)',
            admin_pwd_hint: 'สำหรับโหมด Admin: บันทึกเวลาตาย เพิ่ม/ลบบอส และจัดการกิจกรรม',
            member_pwd_label: '👥 รหัสผ่าน Member',
            member_badge: 'ดูข้อมูล',
            member_pwd_ph: 'รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)',
            member_pwd_hint: 'สำหรับสมาชิกแคลน: ดูตารางเวลาบอส นับถอยหลัง และรับเสียงแจ้งเตือน',
            pwd_cloud_notice: 'การเปลี่ยนแปลงจะซิงค์ไปยัง Firebase Cloud อัตโนมัติ',
            cancel_btn: 'ยกเลิก',
            save_pwd_btn: '💾 บันทึกรหัสผ่าน',
            guest_section_title: 'สร้างรหัสผ่านชั่วคราว (Guest Access)',
            guest_label_field: 'ชื่อผู้ใช้ / บันทึกช่วยจำ',
            guest_label_ph: 'เช่น Guest #1 / เพื่อน',
            guest_duration_field: 'ระยะเวลาหมดอายุ',
            guest_dur_1: '1 ชั่วโมง (1 ชม.)',
            guest_dur_6: '6 ชั่วโมง (6 ชม.)',
            guest_dur_12: '12 ชั่วโมง (12 ชม.)',
            guest_dur_24: '1 วัน (24 ชม.)',
            guest_dur_72: '3 วัน (72 ชม.)',
            guest_dur_168: '7 วัน (1 สัปดาห์)',
            guest_pwd_field: 'รหัสผ่าน Guest (หรือสุ่มอัตโนมัติ)',
            guest_pwd_ph: 'พิมพ์รหัสผ่าน หรือกดสุ่ม',
            guest_random_btn: '🎲 สุ่ม',
            guest_create_btn: '➕ สร้าง',
            guest_table_title: '📋 รายการรหัสผ่านชั่วคราวทั้งหมด',
            guest_refresh_btn: '🔄 รีเฟรช',
            guest_col_name: 'ชื่อ / หมายเหตุ',
            guest_col_pwd: 'รหัสผ่าน',
            guest_col_expires: 'หมดอายุ',
            guest_col_status: 'สถานะ',
            guest_col_action: 'การกระทำ',
            guest_loading: 'กำลังโหลด...',
            sheets_lock_title: 'พื้นที่ตั้งค่าที่มีการป้องกัน',
            sheets_lock_desc: 'การตั้งค่าฐานข้อมูลคู่ขนาน Google Sheets ถูกป้องกัน กรุณากรอกรหัสผ่านเพื่อเข้าใช้งาน:',
            sheets_lock_ph: 'กรอกรหัสผ่าน...',
            sheets_unlock_btn: '🔓 ปลดล็อก',
            sheets_unlocked_badge: '🔓 ปลดล็อกแล้ว',
            sheets_lock_btn: '🔒 ล็อก',
            sheets_url_label: '🌐 Google Apps Script Web App URL',
            sheets_url_hint: 'URL เว็บแอปจากการ Deploy ใน Google Sheets (ต้องลงท้ายด้วย /exec)',
            sheets_token_label: '🔑 Secret Token',
            sheets_token_hint: 'ต้องตรงกับ SECRET_TOKEN ใน Code.gs',
            sheets_mirror_label: 'เปิดการคัดลอกฐานข้อมูลคู่ขนาน',
            sheets_mirror_hint: 'ซิงค์บอสและกิจกรรมไปยัง Google Sheets ในเบื้องหลังทุกครั้งที่มีการอัปเดต',
            sheets_failover_label: 'เปิดการสลับสายข้อมูลอัตโนมัติ (Auto Failover)',
            sheets_failover_hint: 'ดึงข้อมูลจาก Google Sheets หาก Firebase ออฟไลน์หรือโควตาเต็ม',
            sheets_test_btn: '⚡ ทดสอบการเชื่อมต่อ',
            sheets_sync_btn: '🔄 ซิงค์ข้อมูลทั้งหมดเดี๋ยวนี้',
            sheets_save_btn: '💾 บันทึกการตั้งค่า',
            sheets_script_guide: '📖 <b>ไฟล์สคริปต์:</b> อยู่ที่ <code>google_apps_script/Code.gs</code> พร้อมคู่มือใน <code>google_apps_script/README.md</code>'
        }
    };

    function getLanguage() {
        const stored = localStorage.getItem('tracker_lang');
        if (stored === 'th' || stored === 'en') return stored;
        return 'en';
    }

    function setLanguage(lang) {
        if (lang !== 'en' && lang !== 'th') lang = 'en';
        localStorage.setItem('tracker_lang', lang);
        document.documentElement.lang = lang;
        updateLanguageButton();
        updateTimezoneButton();
        updateStatus();
        if (typeof window.updateFbBadge === 'function') window.updateFbBadge();
        if (window.attachAdminSettingsToReactDialog && document.querySelector('[role="dialog"]')) {
            window.attachAdminSettingsToReactDialog();
        }
        translateVisibleUi();
        enhanceUi();
    }

    function t(key, params) {
        const lang = getLanguage();
        let str = (I18N[lang] && I18N[lang][key]) || (I18N.en && I18N.en[key]) || key;
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
            }
        }
        return str;
    }

    window.getLanguage = getLanguage;
    window.setLanguage = setLanguage;
    window.t = t;

    function ensureStatusButton() {
        if (document.getElementById('realtime-audio-status')) return;
        const style = document.createElement('style');
        style.textContent = `
            @keyframes realtimeBossPulse {
                0%, 100% { background-color: rgba(220, 38, 38, .12); box-shadow: inset 0 0 0 1px rgba(239, 68, 68, .25); }
                50% { background-color: rgba(239, 68, 68, .48); box-shadow: inset 0 0 0 2px #f87171, 0 0 18px rgba(239, 68, 68, .7); }
            }
            .realtime-pre-spawn-flash { animation: realtimeBossPulse .8s ease-in-out infinite !important; }
            #compact-system-controls {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                min-width: 0;
                margin-left: 2px;
                padding-left: 3px;
                border-left: 1px solid rgba(255,255,255,.08);
                overflow: visible !important;
                white-space: nowrap;
                flex-shrink: 0 !important;
            }
            #compact-system-controls .compact-system-control {
                position: relative !important;
                inset: auto !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 20px !important;
                height: 20px !important;
                min-width: 20px !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 0 !important;
                border-radius: 5px !important;
                background: transparent !important;
                color: rgba(255,255,255,.55) !important;
                box-shadow: none !important;
                animation: none !important;
                backdrop-filter: none !important;
                font: 11px/1 system-ui !important;
                cursor: pointer;
                opacity: 1 !important;
                transform: none !important;
            }
            #compact-system-controls .compact-system-control:hover {
                background: rgba(255,255,255,.07) !important;
                color: rgba(255,255,255,.92) !important;
            }
            #compact-system-controls .compact-system-control[hidden] { display: none !important; }
            #compact-system-controls #header-firebase-status-badge,
            #compact-system-controls #header-version-control,
            #compact-system-controls #header-timezone-control,
            #compact-system-controls #header-language-control {
                width: auto !important;
                min-width: 0 !important;
                max-width: none !important;
                height: 22px !important;
                padding: 0 6px !important;
                gap: 4px !important;
                border: 1px solid rgba(255,255,255,.16) !important;
                border-radius: 6px !important;
                background: rgba(255,255,255,.055) !important;
                font: 600 9px/1 system-ui !important;
                letter-spacing: 0 !important;
                flex: 0 0 auto !important;
            }
            #compact-system-controls #header-language-control {
                color: #38bdf8 !important;
                font-weight: 700 !important;
                min-width: 44px !important;
                cursor: pointer;
            }
            #compact-system-controls #header-language-control:hover {
                background: rgba(56, 189, 248, 0.16) !important;
                border-color: rgba(56, 189, 248, 0.35) !important;
                color: #7dd3fc !important;
            }
            #compact-system-controls #header-firebase-status-badge .system-badge-label,
            #compact-system-controls #header-version-control .system-badge-label,
            #compact-system-controls #header-timezone-control .system-badge-label,
            #compact-system-controls #header-language-control .system-badge-label {
                display: block;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #compact-system-controls #header-firebase-status-badge[data-status="connected"] { color: #34d399 !important; }
            #compact-system-controls #header-firebase-status-badge[data-status="google_sheets"] { color: #34d399 !important; border-color: rgba(52, 211, 153, 0.45) !important; }
            #compact-system-controls #header-firebase-status-badge[data-status="local"] { color: #fbbf24 !important; border-color: rgba(251, 191, 36, 0.45) !important; }
            #compact-system-controls #header-firebase-status-badge[data-status="connecting"] { color: #60a5fa !important; }
            #compact-system-controls #header-firebase-status-badge[data-status="stale"] { color: #fbbf24 !important; }
            #compact-system-controls #header-firebase-status-badge[data-status="quota_exceeded"],
            #compact-system-controls #header-firebase-status-badge[data-status="configuration_error"] { color: #f87171 !important; }
            #compact-system-controls #header-firebase-status-badge[data-status="offline"] { color: #f59e0b !important; }
            #compact-system-controls #header-timezone-control {
                width: 58px !important;
                min-width: 58px !important;
                max-width: 58px !important;
                flex: 0 0 58px !important;
                color: #fbbf24 !important;
            }
            #compact-system-controls #header-timezone-control .system-badge-label {
                overflow: visible;
                text-overflow: clip;
            }
            #compact-system-controls #pwd-pill-label { display: none !important; }
            #admin-pwd-floating-bar, #top-floating-status-bar { display: none !important; }

            /* Style #1 Universal Balloon Tooltip */
            #custom-unified-tooltip {
                position: fixed;
                z-index: 999999;
                pointer-events: none;
                background: #d97706;
                color: #09090b;
                font-family: var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.01em;
                line-height: 1.2;
                padding: 4px 8px;
                border-radius: 6px;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.3);
                white-space: nowrap;
                opacity: 0;
                transform: scale(0.96);
                transition: opacity 0.12s cubic-bezier(0.16, 1, 0.3, 1), transform 0.12s cubic-bezier(0.16, 1, 0.3, 1);
                display: none;
                max-width: 320px;
            }
            #custom-unified-tooltip.active {
                display: block;
                opacity: 1;
                transform: scale(1);
            }
            #custom-unified-tooltip .custom-unified-tooltip-arrow {
                position: absolute;
                width: 8px;
                height: 8px;
                background: #d97706;
                transform: rotate(45deg);
            }
            #custom-unified-tooltip[data-side="top"] .custom-unified-tooltip-arrow {
                bottom: -4px;
            }
            #custom-unified-tooltip[data-side="bottom"] .custom-unified-tooltip-arrow {
                top: -4px;
            }

            @media (max-width: 430px) {
                #compact-system-controls { gap: 2px; }
                #compact-system-controls #header-firebase-status-badge,
                #compact-system-controls #header-version-control,
                #compact-system-controls #header-timezone-control,
                #compact-system-controls #header-language-control { padding-inline: 4px !important; font-size: 8px !important; }
            }
        `;
        document.head.appendChild(style);
        ensureUnifiedTooltip();
        const button = document.createElement('button');
        button.id = 'realtime-audio-status';
        button.type = 'button';
        button.textContent = '🔇';
        button.setAttribute('data-unified-tooltip', t('audio_status_enable'));
        button.setAttribute('aria-label', t('audio_status_enable'));
        button.className = 'compact-system-control';
        button.addEventListener('click', unlockAudio);
        document.body.appendChild(button);
        ensureTimezoneButton();
        ensureLanguageButton();
        updateStatus();
    }

    function ensureUnifiedTooltip() {
        if (document.getElementById('custom-unified-tooltip')) return;
        const tooltip = document.createElement('div');
        tooltip.id = 'custom-unified-tooltip';
        tooltip.className = 'custom-unified-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.setAttribute('aria-hidden', 'true');
        tooltip.innerHTML = '<span class="custom-unified-tooltip-arrow"></span><span class="custom-unified-tooltip-text"></span>';
        document.body.appendChild(tooltip);
    }

    function selectedTimezoneOffset() {
        return localStorage.getItem('dashboard.timeZoneOffset') === '8' ? 8 : 7;
    }

    function ensureTimezoneButton() {
        if (document.getElementById('header-timezone-control')) return;
        const button = document.createElement('button');
        button.id = 'header-timezone-control';
        button.type = 'button';
        button.className = 'compact-system-control no-drag';
        button.addEventListener('click', () => {
            const next = selectedTimezoneOffset() === 7 ? 8 : 7;
            localStorage.setItem('dashboard.timeZoneOffset', String(next));
            updateTimezoneButton();
            applyTimezoneDisplay(true);
            showNotice(t('tz_notice', { offset: next }), false);
        });
        document.body.appendChild(button);
        updateTimezoneButton();
    }

    function updateTimezoneButton() {
        const button = document.getElementById('header-timezone-control');
        if (!button) return;
        const offset = selectedTimezoneOffset();
        button.innerHTML = `<span aria-hidden="true">🕐</span><span class="system-badge-label">GMT+${offset}</span>`;
        const titleText = t('tz_title', { offset });
        button.setAttribute('data-unified-tooltip', titleText);
        button.setAttribute('aria-label', titleText);
        button.removeAttribute('title');
    }

    function ensureLanguageButton() {
        if (document.getElementById('header-language-control')) return;
        const button = document.createElement('button');
        button.id = 'header-language-control';
        button.type = 'button';
        button.className = 'compact-system-control no-drag';
        button.addEventListener('click', () => {
            const next = getLanguage() === 'en' ? 'th' : 'en';
            setLanguage(next);
            showNotice(t('lang_switched'), false);
        });
        document.body.appendChild(button);
        updateLanguageButton();
    }

    function updateLanguageButton() {
        const button = document.getElementById('header-language-control');
        if (!button) return;
        const current = getLanguage();
        if (current === 'th') {
            button.innerHTML = '<span class="system-badge-label" style="font-weight:700; color:#38bdf8;">🌐 TH</span>';
        } else {
            button.innerHTML = '<span class="system-badge-label" style="font-weight:700; color:#38bdf8;">🌐 EN</span>';
        }
        const titleText = t('lang_toggle_title');
        button.setAttribute('data-unified-tooltip', titleText);
        button.setAttribute('aria-label', titleText);
        button.removeAttribute('title');
    }

    function shiftClockText(text, deltaMinutes) {
        return String(text).replace(/\b([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/g, (match, hour, minute, second) => {
            const totalMinutes = (Number(hour) * 60 + Number(minute) + deltaMinutes + 1440) % 1440;
            const shiftedHour = Math.floor(totalMinutes / 60);
            const shiftedMinute = totalMinutes % 60;
            return `${String(shiftedHour).padStart(2, '0')}:${String(shiftedMinute).padStart(2, '0')}${second === undefined ? '' : `:${second}`}`;
        });
    }

    function applyTimezoneDisplay(force) {
        const browserOffset = -new Date().getTimezoneOffset() / 60;
        const deltaMinutes = Math.round((selectedTimezoneOffset() - browserOffset) * 60);
        for (const element of document.querySelectorAll('span, time, td, p, div')) {
            if (element.childElementCount || element.closest('#compact-system-controls, [role="tooltip"]')) continue;
            const current = element.textContent || '';
            if (!/\b(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/.test(current)) continue;
            const previousRendered = element.dataset.timezoneRenderedText;
            const source = previousRendered && current === previousRendered
                ? (element.dataset.timezoneSourceText || current)
                : current;
            if (!force && previousRendered === current && element.dataset.timezoneOffset === String(selectedTimezoneOffset())) continue;
            const rendered = shiftClockText(source, deltaMinutes);
            element.dataset.timezoneSourceText = source;
            element.dataset.timezoneRenderedText = rendered;
            element.dataset.timezoneOffset = String(selectedTimezoneOffset());
            if (rendered !== current) element.textContent = rendered;
        }
    }

    function updateStatus(message) {
        const button = document.getElementById('realtime-audio-status');
        if (!button) return;
        if (message) {
            button.textContent = '⚠️';
            button.setAttribute('data-unified-tooltip', message);
            button.setAttribute('aria-label', message);
            button.removeAttribute('title');
        }
        else if (state.audioUnlocked) {
            button.textContent = state.streamConnected ? '🔊' : state.streamFailed ? '📡' : '🔉';
            const title = state.streamConnected
                ? t('audio_status_connected')
                : state.streamFailed
                    ? t('audio_status_fallback')
                    : t('audio_status_connecting');
            button.setAttribute('data-unified-tooltip', title);
            button.setAttribute('aria-label', title);
            button.removeAttribute('title');
            button.style.borderColor = state.streamConnected ? '#22c55e' : '#f59e0b';
        } else {
            button.textContent = '🔇';
            const title = t('audio_status_enable');
            button.setAttribute('data-unified-tooltip', title);
            button.setAttribute('aria-label', title);
            button.removeAttribute('title');
        }
    }

    function mountCompactHeaderControls() {
        const header = document.querySelector('[data-tauri-drag-region]');
        const leftControls = header?.firstElementChild;
        if (!leftControls) return false;

        let controls = document.getElementById('compact-system-controls');
        if (!controls) {
            controls = document.createElement('div');
            controls.id = 'compact-system-controls';
            controls.className = 'no-drag';
            leftControls.appendChild(controls);
        } else if (controls.parentElement !== leftControls) {
            leftControls.appendChild(controls);
        }

        const firebase = document.getElementById('header-firebase-status-badge');
        const version = document.getElementById('header-version-control');
        const timezone = document.getElementById('header-timezone-control');
        const langBtn = document.getElementById('header-language-control');
        const audio = document.getElementById('realtime-audio-status');
        for (const element of [firebase, version, timezone, langBtn, audio]) {
            if (!element) continue;
            element.classList.add('compact-system-control', 'no-drag');
            if (element.parentElement !== controls) controls.appendChild(element);
        }

        // Display Guest badge if current user is temporary guest
        try {
            const root = document.getElementById('app');
            const page = JSON.parse(root?.getAttribute('data-page') || '{}');
            if (page.props?.auth?.user?.role === 'guest') {
                let guestBadge = document.getElementById('header-guest-badge');
                if (!guestBadge) {
                    guestBadge = document.createElement('span');
                    guestBadge.id = 'header-guest-badge';
                    guestBadge.className = 'compact-system-control no-drag';
                    guestBadge.style.cssText = 'width:auto!important; padding:0 6px!important; background:rgba(168,85,247,0.18)!important; border:1px solid rgba(168,85,247,0.45)!important; border-radius:6px!important; color:#c084fc!important; font-size:9.5px!important; font-weight:700!important;';
                    guestBadge.textContent = '🎟️ GUEST';
                    controls.appendChild(guestBadge);
                }
                const guestTitle = t('guest_badge_title');
                guestBadge.setAttribute('data-unified-tooltip', guestTitle);
                guestBadge.setAttribute('aria-label', guestTitle);
                guestBadge.removeAttribute('title');
            }
        } catch (_) {}

        return true;
    }

    async function unlockAudio() {
        const audio = new Audio('/notification.mp3');
        audio.volume = 0.01;
        try {
            await audio.play();
            audio.pause();
            audio.currentTime = 0;
            state.audioUnlocked = true;
            localStorage.setItem('dashboard.audioUnlocked', 'true');
            updateStatus();
        } catch (_) {
            state.audioUnlocked = false;
            updateStatus(t('audio_status_blocked'));
        }
    }

    async function playSoundNow(path) {
        if (!path || Number(setting('alertVolume', 0.8)) <= 0) return false;
        const now = Date.now();
        const audio = new Audio(path);
        audio.volume = Math.max(0, Math.min(1, Number(setting('alertVolume', 0.8))));
        try {
            await audio.play();
            state.audioUnlocked = true;
            state.lastPlayedAt = now;
            updateStatus();
            return true;
        } catch (_) {
            state.audioUnlocked = false;
            updateStatus(t('audio_status_blocked'));
            return false;
        }
    }

    function playSound(path) {
        if (!path) return;
        state.audioQueue.push(path);
        if (state.audioPlaying) return;
        state.audioPlaying = true;
        (async function drain() {
            while (state.audioQueue.length) {
                await playSoundNow(state.audioQueue.shift());
                await new Promise(resolve => setTimeout(resolve, 400));
            }
            state.audioPlaying = false;
        })();
    }

    function showNotice(message, urgent) {
        const old = document.getElementById('realtime-alert-toast');
        if (old) old.remove();
        const toast = document.createElement('div');
        toast.id = 'realtime-alert-toast';
        toast.textContent = message;
        toast.style.cssText = `position:fixed;left:50%;top:52px;transform:translateX(-50%);z-index:100001;max-width:90vw;padding:10px 16px;border-radius:10px;background:${urgent ? '#7f1d1d' : '#172554'};border:1px solid ${urgent ? '#ef4444' : '#3b82f6'};color:white;font:700 14px system-ui;box-shadow:0 8px 30px #000a`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 8000);
    }

    function bossRows(boss) {
        if (!boss?.name) return [];
        if (boss.id) {
            const byId = document.querySelectorAll(`tr[data-boss-id="${boss.id}"]`);
            if (byId.length > 0) return Array.from(byId);
        }
        return Array.from(document.querySelectorAll('tr')).filter(row => {
            const text = row.textContent || '';
            if (!text.includes(boss.name)) return false;
            const hasInvBadge = text.includes('INV') || text.includes('L3') || Boolean(row.querySelector('.bg-purple-900\\/50, .border-purple-500\\/50'));
            if (boss.is_invasion) return hasInvBadge;
            return !hasInvBadge;
        });
    }

    function applyRowBossColor(row, boss) {
        if (!row || !boss) return;
        const color = boss.color ? String(boss.color).trim() : '';
        const tds = row.querySelectorAll('td');
        for (const td of tds) {
            if (td.textContent && td.textContent.includes(boss.name)) {
                if (color) {
                    td.style.setProperty('color', color, 'important');
                    td.setAttribute('data-boss-custom-color', color);
                    const spans = td.querySelectorAll('span');
                    for (const sp of spans) {
                        if (sp.classList.contains('pre-spawn-flash-label') ||
                            sp.classList.contains('bg-yellow-400/20') ||
                            sp.classList.contains('tracking-wide') ||
                            sp.classList.contains('text-[0.72em]') ||
                            sp.textContent.trim() === 'INV' ||
                            sp.textContent.trim() === 'L3' ||
                            sp.textContent.trim() === 'Pre-spawning') {
                            continue;
                        }
                        sp.style.setProperty('color', color, 'important');
                        if (color !== '#ffffff' && color !== '#f4f4f5') {
                            sp.style.setProperty('text-shadow', `0 0 10px ${color}80`, 'important');
                        } else {
                            sp.style.removeProperty('text-shadow');
                        }
                    }
                } else if (td.hasAttribute('data-boss-custom-color')) {
                    td.removeAttribute('data-boss-custom-color');
                    td.style.removeProperty('color');
                    const spans = td.querySelectorAll('span');
                    for (const sp of spans) {
                        sp.style.removeProperty('color');
                        sp.style.removeProperty('text-shadow');
                    }
                }
                break;
            }
        }
    }

    function reconcileBossRows() {
        const now = Date.now() + state.serverOffset;
        for (const row of document.querySelectorAll('tr.realtime-pre-spawn-flash')) {
            row.classList.remove('realtime-pre-spawn-flash');
        }
        for (const boss of state.bosses.values()) {
            const expiry = new Date(boss.pre_spawn_expires_at || 0).getTime();
            const active = boss.pre_spawned && (!Number.isFinite(expiry) || expiry === 0 || expiry > now);
            for (const row of bossRows(boss)) {
                row.classList.toggle('realtime-pre-spawn-flash', active);
                applyRowBossColor(row, boss);
            }
        }
    }

    function consumeLiveEvent(event, initial) {
        if (!event || !event.id) return;
        if (event.boss) state.bosses.set(Number(event.boss.id), event.boss);
        if (event.event) state.events.set(Number(event.event.id), event.event);
        if (state.seenEventIds.has(event.id)) return;
        const fresh = Math.abs(Date.now() - Number(event.createdAt || 0)) < 45000;
        state.lastEventId = event.id;
        state.seenEventIds.add(event.id);
        if (state.seenEventIds.size > 100) state.seenEventIds.delete(state.seenEventIds.values().next().value);
        sessionStorage.setItem('bossTracker.lastLiveEvent', event.id);
        if (event.type === 'boss_pre_spawn_started') {
            if (event.boss) state.bosses.set(Number(event.boss.id), event.boss);
            reconcileBossRows();
            if (!initial && fresh && document.visibilityState !== 'visible' && !isMuted(event.bossId, 'boss')) {
                const key = setting('preSpawnSound', 'pop2');
                playSound(soundPath(key, '/pop2.mp3'));
                showNotice(t('pre_spawn_toast', { name: event.bossName }), true);
            }
        } else if (event.type === 'boss_pre_spawn_cleared') {
            if (event.boss) state.bosses.set(Number(event.boss.id), event.boss);
            reconcileBossRows();
        } else if (event.type === 'boss_time_unset' || event.type === 'boss_updated') {
            if (event.boss) state.bosses.set(Number(event.boss.id), event.boss);
            reconcileBossRows();
        }
    }

    function processPollData(data) {
        if (Number.isFinite(Number(data.serverTime))) state.serverOffset = Number(data.serverTime) - Date.now();
        for (const boss of data.bosses || []) {
            state.bosses.set(Number(boss.id), boss);
            const pendingKey = `pending_new_boss_color_${(boss.name || '').toLowerCase()}`;
            const pendingColor = sessionStorage.getItem(pendingKey);
            if (pendingColor !== null) {
                sessionStorage.removeItem(pendingKey);
                if (pendingColor && boss.color !== pendingColor) {
                    boss.color = pendingColor;
                    fetch(`/bosses/${boss.id}/color`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ color: pendingColor })
                    }).catch(() => {});
                }
            }
        }
        for (const event of data.events || []) state.events.set(Number(event.id), event);
        const initial = !state.initialEventsLoaded;
        for (const event of data.recentLiveEvents || []) consumeLiveEvent(event, initial);
        consumeLiveEvent(data.liveEvent, initial);
        state.initialEventsLoaded = true;
        reconcileBossRows();
        updateStatus();
    }

    // Reuse the dashboard's existing /poll response as a no-extra-request fallback.
    // This keeps working even when anonymous RTDB streaming is disabled by rules.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
        const response = await nativeFetch(...args);
        const requestUrl = String(args[0]?.url || args[0] || '');
        if (requestUrl.endsWith('/poll') || requestUrl.includes('/poll?')) {
            if (!response.ok) return response;
            try {
                const data = await response.clone().json();
                const revision = Number(data.dataRevision);
                const isOlder = Number.isFinite(revision) && revision < state.highestDataRevision;
                if (data.stale || isOlder) {
                    if (state.lastGoodPollData) {
                        return new Response(JSON.stringify(state.lastGoodPollData), {
                            status: 200,
                            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
                        });
                    }
                    return new Response(JSON.stringify({ notReady: true, stale: true }), {
                        status: 503,
                        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '2' }
                    });
                }
                if (!data.stale) {
                    if (Number.isFinite(revision)) state.highestDataRevision = Math.max(state.highestDataRevision, revision);
                    state.lastGoodPollData = data;
                    processPollData(data);
                }
            } catch (_) {}
        }
        return response;
    };

    function connectStream() {
        if (!window.EventSource) return;
        const source = new EventSource(LIVE_URL);
        let first = true;
        source.addEventListener('put', (message) => {
            try {
                const packet = JSON.parse(message.data);
                consumeLiveEvent(packet.data, first);
                first = false;
                state.streamConnected = true;
                updateStatus();
            } catch (_) {}
        });
        source.addEventListener('patch', (message) => {
            try {
                const packet = JSON.parse(message.data);
                consumeLiveEvent(packet.data, false);
            } catch (_) {}
        });
        source.onopen = () => { state.streamConnected = true; updateStatus(); };
        source.onerror = () => {
            state.streamConnected = false;
            state.streamFailed = true;
            source.close();
            updateStatus();
        };
    }

    async function pollLiveEventFallback() {
        if (!state.streamFailed || document.visibilityState === 'visible') return;
        try {
            const response = await nativeFetch('/live-event', { cache: 'no-store' });
            if (!response.ok) return;
            const data = await response.json();
            if (Number.isFinite(Number(data.serverTime))) state.serverOffset = Number(data.serverTime) - Date.now();
            const initial = !state.initialEventsLoaded;
            for (const event of data.recentLiveEvents || []) consumeLiveEvent(event, initial);
            consumeLiveEvent(data.liveEvent, initial);
            state.initialEventsLoaded = true;
        } catch (_) {}
    }

    function readInitialData() {
        const root = document.getElementById('app');
        if (!root) return;
        try {
            const page = JSON.parse(root.getAttribute('data-page') || '{}');
            state.highestDataRevision = Number(page.props?.dataRevision) || 0;
            for (const boss of page.props?.bosses || []) state.bosses.set(Number(boss.id), boss);
            for (const event of page.props?.events || []) state.events.set(Number(event.id), event);
        } catch (_) {}
    }

    const TOOLTIP_KEYS = {
        'Search': 'search_placeholder',
        'Search...': 'search_placeholder',
        'ค้นหา...': 'search_placeholder',
        'Kill now (click 2x)': 'tooltip_kill_now',
        'Click again to confirm kill now': 'tooltip_confirm_kill',
        'Still alive (click 2x)': 'tooltip_still_alive_2x',
        'Spawn in 5 min (click 2x)': 'tooltip_spawn_5m',
        'Spawn in 1 min (click 2x)': 'tooltip_spawn_1m',
        'Not spawned (click 2x)': 'tooltip_not_spawned',
        'Mark event done (click 2x)': 'tooltip_event_done',
        'Skip today (click 2x)': 'tooltip_skip_today',
        'Pin still alive (click 2x)': 'tooltip_pin_still_alive',
        'Click again to confirm': 'tooltip_confirm_2nd',
        'Double-click to mark as pre-spawned': 'tooltip_pre_spawn_notify',
        'Double-click to clear pre-spawned': 'tooltip_pre_spawn_clear',
        'Show muted': 'show_muted',
        'Hide muted': 'hide_muted',
        'Settings': 'settings',
        'Edit Boss': 'tooltip_edit_boss',
        'Delete Boss': 'tooltip_delete_boss',
        'Delete': 'tooltip_delete',
        'Still alive': 'tooltip_still_alive_2x',
        'Pre-spawning': 'tooltip_pre_spawn_notify',
        'Update spawn': 'tooltip_update_spawn',
        'Reset Boss Time': 'tooltip_reset_time',
        'Reset Time': 'tooltip_reset_time',
        'Undo': 'tooltip_undo',
        'Close': 'tooltip_close',
        'Save': 'tooltip_save',
        'Cancel': 'tooltip_cancel',
        'Manage Passwords': 'tooltip_passwords'
    };

    const TOOLTIP_PATTERNS = [
        [/search|ค้นหา/i, 'search_placeholder'],
        [/show muted|แสดงรายการปิดเสียง/i, 'show_muted'],
        [/hide muted|ซ่อนรายการปิดเสียง/i, 'hide_muted'],
        [/still alive|ยังไม่ตาย/i, 'tooltip_still_alive_2x'],
        [/unset/i, 'tooltip_reset_time'],
        [/edit|แก้ไข/i, 'tooltip_edit_boss'],
        [/delete|ลบ/i, 'tooltip_delete'],
        [/unmute|เปิดเสียง/i, 'tooltip_unmute'],
        [/mute|ปิดเสียง/i, 'tooltip_mute'],
        [/settings|ตั้งค่า/i, 'settings'],
        [/reset/i, 'tooltip_reset_time'],
        [/notify|pre-spawn|แจ้งเตือน/i, 'tooltip_pre_spawn_notify'],
        [/more|menu|ตัวเลือก/i, 'tooltip_more_options'],
        [/unpin|ยกเลิกปักหมุด/i, 'tooltip_unpin'],
        [/pin|ปักหมุด/i, 'tooltip_pin'],
        [/close|ปิด/i, 'tooltip_close'],
        [/save|บันทึก/i, 'tooltip_save'],
        [/cancel|ยกเลิก/i, 'tooltip_cancel'],
        [/password|รหัสผ่าน/i, 'tooltip_passwords'],
        [/advance cycle|ข้ามรอบ/i, 'tooltip_advance_cycle']
    ];

    const ICON_TOOLTIP_PATTERNS = [
        [/lucide-zap\b/, 'tooltip_kill_now'],
        [/lucide-skull\b/, 'tooltip_custom_kill'],
        [/lucide-ellipsis(?:-vertical)?\b|lucide-more-vertical\b/, 'tooltip_more_options'],
        [/lucide-search\b/, 'search_placeholder'],
        [/lucide-settings\b|lucide-cog\b/, 'settings'],
        [/lucide-pencil\b|lucide-edit\b/, 'tooltip_edit_boss'],
        [/lucide-trash(?:-2)?\b/, 'tooltip_delete_boss'],
        [/lucide-pin-off\b/, 'tooltip_unpin'],
        [/lucide-pin\b/, 'tooltip_pin'],
        [/lucide-bell-off\b|lucide-volume-x\b/, 'tooltip_unmute'],
        [/lucide-bell\b|lucide-volume-2\b/, 'tooltip_mute'],
        [/lucide-clock\b/, 'tooltip_update_spawn'],
        [/lucide-rotate-ccw\b|lucide-refresh-ccw\b/, 'tooltip_reset_time'],
        [/lucide-chevrons-right\b|lucide-skip-forward\b/, 'tooltip_advance_cycle'],
        [/lucide-check\b/, 'tooltip_confirm_2nd'],
        [/lucide-x\b/, 'tooltip_close'],
        [/lucide-key-round\b|lucide-key\b/, 'tooltip_passwords']
    ];

    function bilingualTooltip(source) {
        const clean = String(source || '').trim();
        if (!clean) return '';
        const directKey = TOOLTIP_KEYS[clean];
        if (directKey) return t(directKey);
        const match = TOOLTIP_PATTERNS.find(([pattern]) => pattern.test(clean));
        if (match) return t(match[1]);
        return '';
    }

    function tooltipFromIcon(element) {
        const svg = element.querySelector('svg');
        if (!svg) return '';
        const className = typeof svg.className === 'string' ? svg.className : (svg.className?.baseVal || '');
        const match = ICON_TOOLTIP_PATTERNS.find(([pattern]) => pattern.test(className));
        return match ? t(match[1]) : '';
    }

    function translateVisibleTooltips() {
        for (const element of document.querySelectorAll('[role="tooltip"], [role="tooltip"] *')) {
            if (element.children.length > 0) continue;
            const original = (element.textContent || '').trim();
            const translated = bilingualTooltip(original);
            if (translated && original !== translated) element.textContent = translated;
        }
    }

    let customTooltipActiveEl = null;

    function getTooltipText(interactive) {
        if (!interactive) return '';
        let text = interactive.getAttribute('data-unified-tooltip');
        if (!text && interactive.getAttribute('data-i18n-title')) {
            text = t(interactive.getAttribute('data-i18n-title'));
        }
        if (!text && interactive.getAttribute('title')) {
            text = interactive.getAttribute('title');
        }
        if (!text) {
            const aria = interactive.getAttribute('aria-label');
            const tr = bilingualTooltip(aria || interactive.textContent) || tooltipFromIcon(interactive);
            text = tr || aria || '';
        }
        return (text || '').trim();
    }

    function showCustomTooltip(target) {
        ensureUnifiedTooltip();
        const tooltipEl = document.getElementById('custom-unified-tooltip');
        if (!tooltipEl || !target) return;

        // Strip native title immediately so browser never shows the native OS white box
        if (target.hasAttribute && target.hasAttribute('title')) {
            const val = target.getAttribute('title');
            if (val && !target.getAttribute('data-unified-tooltip')) {
                target.setAttribute('data-unified-tooltip', val);
            }
            target.removeAttribute('title');
        }

        // If target is inside a Radix Tooltip trigger, Radix renders its own balloon
        if (target.closest('[data-slot="tooltip-trigger"]')) {
            hideCustomTooltip();
            return;
        }

        const text = getTooltipText(target);
        if (!text) {
            hideCustomTooltip();
            return;
        }

        customTooltipActiveEl = target;
        const textEl = tooltipEl.querySelector('.custom-unified-tooltip-text');
        if (textEl) textEl.textContent = text;

        tooltipEl.style.display = 'block';
        tooltipEl.classList.add('active');

        const rect = target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            hideCustomTooltip();
            return;
        }

        const tipRect = tooltipEl.getBoundingClientRect();
        let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
        const padding = 8;
        const maxLeft = window.innerWidth - tipRect.width - padding;
        left = Math.max(padding, Math.min(maxLeft, left));

        const arrowEl = tooltipEl.querySelector('.custom-unified-tooltip-arrow');
        if (arrowEl) {
            const targetCenterX = rect.left + (rect.width / 2);
            const arrowX = Math.max(8, Math.min(tipRect.width - 16, targetCenterX - left - 4));
            arrowEl.style.left = arrowX + 'px';
        }

        let top;
        if (rect.top >= tipRect.height + 8) {
            top = rect.top - tipRect.height - 6;
            tooltipEl.setAttribute('data-side', 'top');
        } else {
            top = rect.bottom + 6;
            tooltipEl.setAttribute('data-side', 'bottom');
        }

        tooltipEl.style.left = Math.round(left) + 'px';
        tooltipEl.style.top = Math.round(top) + 'px';
    }

    function hideCustomTooltip() {
        customTooltipActiveEl = null;
        const tooltipEl = document.getElementById('custom-unified-tooltip');
        if (tooltipEl) {
            tooltipEl.classList.remove('active');
            tooltipEl.style.display = 'none';
        }
    }

    // Global capturing listeners to strip native title and show Style #1 custom tooltip
    document.addEventListener('mouseover', (e) => {
        const el = e.target;
        if (!el || el.nodeType !== 1) return;
        if (el.hasAttribute && el.hasAttribute('title')) {
            const tVal = el.getAttribute('title');
            if (tVal && !el.getAttribute('data-unified-tooltip')) el.setAttribute('data-unified-tooltip', tVal);
            el.removeAttribute('title');
        }
    }, true);

    document.addEventListener('pointerenter', (e) => {
        const target = e.target;
        if (!target || target.nodeType !== 1) return;
        if (target.hasAttribute && target.hasAttribute('title')) {
            const tVal = target.getAttribute('title');
            if (tVal && !target.getAttribute('data-unified-tooltip')) target.setAttribute('data-unified-tooltip', tVal);
            target.removeAttribute('title');
        }
        const interactive = target.closest('button, a, [role="button"], [data-unified-tooltip], [data-i18n-title], .compact-system-control, .app-version-badge, .firebase-mini-badge');
        if (interactive) {
            showCustomTooltip(interactive);
        } else if (customTooltipActiveEl && !customTooltipActiveEl.contains(target)) {
            hideCustomTooltip();
        }
    }, true);

    document.addEventListener('pointerleave', (e) => {
        if (customTooltipActiveEl && (!e.relatedTarget || !customTooltipActiveEl.contains(e.relatedTarget))) {
            hideCustomTooltip();
        }
    }, true);

    document.addEventListener('pointerdown', hideCustomTooltip, true);
    window.addEventListener('scroll', hideCustomTooltip, true);

    function translateVisibleUi() {
        // 1. Search inputs
        for (const input of document.querySelectorAll('input[type="search"], input[frimousse-search]')) {
            const ph = t('search_placeholder');
            if (input.placeholder !== ph) input.placeholder = ph;
        }

        // 2. Main section headers & tabs (Bosses, Invasion, Events, Muted filters)
        // IMPORTANT: Never mutate boss names! Boss names stay strictly in original English.
        for (const el of document.querySelectorAll('button, [role="tab"], span')) {
            if (el.children.length > 0) continue;
            const text = (el.textContent || '').trim();
            if (text === 'Bosses' || text === 'บอส') {
                const next = t('bosses_tab');
                if (el.textContent !== next) el.textContent = next;
            } else if (text === 'Invasion' || text === 'สงครามบุกรุก') {
                const next = t('invasion_tab');
                if (el.textContent !== next) el.textContent = next;
            } else if (text === 'Events' || text === 'กิจกรรม') {
                const next = t('events_tab');
                if (el.textContent !== next) el.textContent = next;
            } else if (text === 'Show Muted' || text === 'แสดงรายการปิดเสียง' || text === 'Show muted') {
                const next = t('show_muted');
                if (el.textContent !== next) el.textContent = next;
            } else if (text === 'Hide Muted' || text === 'ซ่อนรายการปิดเสียง' || text === 'Hide muted') {
                const next = t('hide_muted');
                if (el.textContent !== next) el.textContent = next;
            }
        }

        // 3. Settings modal tabs (Display, Audio, Invasion, Events, Admin)
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
            const nativeTabs = dialog.querySelectorAll('.flex.gap-1.overflow-x-auto > button, .overflow-x-auto > button');
            const tabMap = {
                'Display': 'tab_display',
                'การแสดงผล': 'tab_display',
                'Audio': 'tab_audio',
                'เสียงแจ้งเตือน': 'tab_audio',
                'Invasion': 'tab_invasion',
                'สงครามบุกรุก': 'tab_invasion',
                'Events': 'tab_events',
                'กิจกรรม': 'tab_events',
                'Admin': 'tab_admin',
                'ผู้ดูแลระบบ': 'tab_admin'
            };
            nativeTabs.forEach(btn => {
                const span = btn.querySelector('span');
                if (span) {
                    const current = (span.textContent || '').trim();
                    if (tabMap[current]) {
                        const next = t(tabMap[current]);
                        if (span.textContent !== next) span.textContent = next;
                    }
                }
            });
        }

        // 4. Custom Sub-Bar in Settings Dialog
        const subbar = document.getElementById('custom-admin-tabs-subbar');
        if (subbar) {
            const sysLabel = subbar.querySelector('.select-none span:last-child');
            const nextSys = t('system_label');
            if (sysLabel && sysLabel.textContent !== nextSys) sysLabel.textContent = nextSys;

            const updateTab = (tabId, key) => {
                const btn = subbar.querySelector(`[data-tab-id="${tabId}"]`);
                if (!btn) return;
                const txt = t(key);
                if (btn.getAttribute('data-unified-tooltip') !== txt) {
                    btn.setAttribute('data-unified-tooltip', txt);
                    btn.setAttribute('aria-label', txt);
                    btn.removeAttribute('title');
                }
                const span = btn.querySelector('span:last-child');
                if (span && span.textContent !== txt) span.textContent = txt;
            };

            updateTab('passwords', 'tab_passwords');
            updateTab('guest', 'tab_guest');
            updateTab('sheets', 'tab_sheets');
        }

        // 5. Embedded Admin Panel
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                const val = t(key);
                if (/<[a-z][\s\S]*>/i.test(val)) {
                    if (el.innerHTML !== val) el.innerHTML = val;
                } else {
                    if (el.textContent !== val) el.textContent = val;
                }
            }
        });
        document.querySelectorAll('[data-i18n-ph]').forEach(el => {
            const key = el.getAttribute('data-i18n-ph');
            if (key) {
                const val = t(key);
                if (el.placeholder !== val) el.placeholder = val;
            }
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key) {
                const val = t(key);
                if (el.getAttribute('data-unified-tooltip') !== val) {
                    el.setAttribute('data-unified-tooltip', val);
                    el.setAttribute('aria-label', val);
                    el.removeAttribute('title');
                }
            }
        });

        // 6. Header Badges: Version and Guest
        const verBadge = document.getElementById('header-version-control');
        if (verBadge) {
            const vText = verBadge.querySelector('.system-badge-label')?.textContent || '';
            const vTitle = getLanguage() === 'th' ? `เวอร์ชัน ${vText}` : `Version ${vText}`;
            if (verBadge.getAttribute('data-unified-tooltip') !== vTitle) {
                verBadge.setAttribute('data-unified-tooltip', vTitle);
                verBadge.setAttribute('aria-label', vTitle);
                verBadge.removeAttribute('title');
            }
        }
        const guestBadge = document.getElementById('header-guest-badge');
        if (guestBadge) {
            const gTitle = t('guest_badge_title');
            if (guestBadge.getAttribute('data-unified-tooltip') !== gTitle) {
                guestBadge.setAttribute('data-unified-tooltip', gTitle);
                guestBadge.setAttribute('aria-label', gTitle);
                guestBadge.removeAttribute('title');
            }
        }
    }

    const PRESET_BOSS_COLORS = [
        { key: 'default', color: '', label_en: 'Default', label_th: 'ค่าเริ่มต้น', bg: '#27272a', border: '#71717a', dot: '#ffffff' },
        { key: 'gold', color: '#f59e0b', label_en: 'Gold', label_th: 'ทอง', bg: '#78350f', border: '#f59e0b', dot: '#f59e0b' },
        { key: 'orange', color: '#f97316', label_en: 'Orange', label_th: 'ส้ม', bg: '#7c2d12', border: '#f97316', dot: '#f97316' },
        { key: 'red', color: '#ef4444', label_en: 'Red', label_th: 'แดง', bg: '#7f1d1d', border: '#ef4444', dot: '#ef4444' },
        { key: 'purple', color: '#a855f7', label_en: 'Purple', label_th: 'ม่วงนีออน', bg: '#581c87', border: '#a855f7', dot: '#a855f7' },
        { key: 'cyan', color: '#06b6d4', label_en: 'Cyan', label_th: 'ฟ้าไซแอน', bg: '#164e63', border: '#06b6d4', dot: '#06b6d4' },
        { key: 'emerald', color: '#10b981', label_en: 'Emerald', label_th: 'เขียวมรกต', bg: '#064e3b', border: '#10b981', dot: '#10b981' },
        { key: 'pink', color: '#ec4899', label_en: 'Pink', label_th: 'ชมพู', bg: '#831843', border: '#ec4899', dot: '#ec4899' },
        { key: 'yellow', color: '#eab308', label_en: 'Yellow', label_th: 'เหลืองนีออน', bg: '#713f12', border: '#eab308', dot: '#eab308' }
    ];

    function attachBossColorPickerToDialog() {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return;

        const editNameInput = dialog.querySelector('#shared-edit-name');
        const addNameInput = dialog.querySelector('#b-name');
        const nameInput = editNameInput || addNameInput;
        if (!nameInput) return;

        const form = nameInput.closest('form');
        if (!form) return;

        const isEdit = Boolean(editNameInput);
        const bossName = nameInput.value.trim();
        const formBossId = form.getAttribute('data-boss-id');
        const isInv = form.querySelector('#shared-edit-inv')?.checked;
        const currentBoss = isEdit
            ? ((formBossId && state.bosses.get(Number(formBossId))) ||
               Array.from(state.bosses.values()).find(b =>
                   b.name.toLowerCase() === bossName.toLowerCase() &&
                   (isInv === undefined || Boolean(b.is_invasion) === Boolean(isInv))
               ) || null)
            : null;

        const bossKeyId = currentBoss?.id ? String(currentBoss.id) : (bossName || 'new');
        let picker = form.querySelector('#custom-boss-color-picker-container');
        if (picker) {
            if (picker.getAttribute('data-for-boss-id') !== bossKeyId) {
                picker.remove();
                picker = null;
            } else {
                const preview = picker.querySelector('#custom-boss-color-preview');
                if (preview && nameInput.value && preview.textContent !== nameInput.value) {
                    preview.textContent = nameInput.value;
                }
                return;
            }
        }

        let activeColor = (currentBoss?.color ? String(currentBoss.color).trim() : '');

        picker = document.createElement('div');
        picker.id = 'custom-boss-color-picker-container';
        picker.setAttribute('data-for-boss-id', bossKeyId);
        picker.style.cssText = 'margin-top: 6px; margin-bottom: 4px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.12);';

        const isTh = getLanguage() === 'th';
        const titleText = isTh ? 'สีตัวอักษรบอส (Boss Font Color)' : 'Boss Font Color';
        const previewText = isTh ? 'ตัวอย่าง:' : 'Preview:';

        picker.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
                <label style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.9);display:flex;align-items:center;gap:5px;">
                    <span>🎨</span>
                    <span>${titleText}</span>
                </label>
                <div style="font-size:11px;color:rgba(255,255,255,0.55);display:flex;align-items:center;gap:5px;">
                    <span>${previewText}</span>
                    <span id="custom-boss-color-preview" style="display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:4px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.15);transition:all 0.15s ease;color:${activeColor || '#ffffff'};${activeColor ? `text-shadow:0 0 10px ${activeColor}99;` : ''}">${nameInput.value || (isTh ? 'ชื่อบอส' : 'Boss Name')}</span>
                </div>
            </div>
            <div id="custom-boss-swatches-row" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;">
            </div>
            <input type="hidden" id="custom-boss-selected-color-val" value="${activeColor}">
        `;

        const swatchesRow = picker.querySelector('#custom-boss-swatches-row');
        const previewEl = picker.querySelector('#custom-boss-color-preview');
        const hiddenVal = picker.querySelector('#custom-boss-selected-color-val');

        function updateSelectedColor(hex) {
            activeColor = hex ? hex.trim() : '';
            hiddenVal.value = activeColor;
            previewEl.style.color = activeColor || '#ffffff';
            previewEl.style.textShadow = activeColor ? `0 0 10px ${activeColor}aa` : '';

            swatchesRow.querySelectorAll('.boss-color-swatch').forEach(btn => {
                const btnColor = btn.getAttribute('data-color') || '';
                const isMatch = btnColor.toLowerCase() === activeColor.toLowerCase();
                btn.style.boxShadow = isMatch ? `0 0 10px ${btnColor || '#ffffff'}, 0 0 0 2px #ffffff` : 'none';
                btn.style.transform = isMatch ? 'scale(1.15)' : 'scale(1)';
                btn.style.zIndex = isMatch ? '2' : '1';
            });

            if (currentBoss) {
                currentBoss.color = activeColor || null;
                reconcileBossRows();
            }
        }

        for (const item of PRESET_BOSS_COLORS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'boss-color-swatch';
            btn.setAttribute('data-color', item.color);
            const label = isTh ? item.label_th : item.label_en;
            btn.setAttribute('data-unified-tooltip', label);
            btn.setAttribute('aria-label', label);
            const isMatch = item.color.toLowerCase() === activeColor.toLowerCase();

            btn.style.cssText = `
                width: 24px;
                height: 24px;
                border-radius: 5px;
                border: 2px solid ${item.border};
                background: ${item.bg};
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                transition: all 0.15s ease;
                box-shadow: ${isMatch ? `0 0 10px ${item.border}, 0 0 0 2px #ffffff` : 'none'};
                transform: ${isMatch ? 'scale(1.15)' : 'scale(1)'};
                position: relative;
            `;

            if (item.color === '') {
                btn.innerHTML = `<span style="font-size:10px;color:#ffffff;font-weight:700;">⚪</span>`;
            } else {
                btn.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${item.dot};"></span>`;
            }

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                updateSelectedColor(item.color);
            });

            swatchesRow.appendChild(btn);
        }

        const customPickerLabel = document.createElement('label');
        customPickerLabel.className = 'boss-color-swatch-custom';
        customPickerLabel.setAttribute('data-unified-tooltip', isTh ? 'เลือกสีกำหนดเอง' : 'Custom Color');
        customPickerLabel.setAttribute('aria-label', isTh ? 'เลือกสีกำหนดเอง' : 'Custom Color');
        customPickerLabel.style.cssText = `
            position: relative;
            width: 24px;
            height: 24px;
            border-radius: 5px;
            border: 2px dashed rgba(255,255,255,0.4);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            background: rgba(255,255,255,0.08);
            font-size: 11px;
            transition: all 0.15s ease;
        `;
        customPickerLabel.innerHTML = `
            <span>🌈</span>
            <input type="color" id="custom-boss-color-input-field" value="${activeColor || '#ffffff'}" style="position:absolute;opacity:0;inset:0;width:100%;height:100%;cursor:pointer;">
        `;
        const colorInput = customPickerLabel.querySelector('input');
        colorInput.addEventListener('input', (e) => {
            updateSelectedColor(e.target.value);
        });
        swatchesRow.appendChild(customPickerLabel);

        nameInput.addEventListener('input', () => {
            if (previewEl) previewEl.textContent = nameInput.value.trim() || (isTh ? 'ชื่อบอส' : 'Boss Name');
        });

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn && submitBtn.parentElement) {
            submitBtn.parentElement.parentElement.insertBefore(picker, submitBtn.parentElement);
        } else {
            form.appendChild(picker);
        }

        const triggerSaveColor = async () => {
            const finalColor = hiddenVal.value ? hiddenVal.value.trim() : null;
            if (isEdit) {
                const targetName = nameInput.value.trim();
                const formBossId = form.getAttribute('data-boss-id');
                const isInv = form.querySelector('#shared-edit-inv')?.checked;
                const targetBoss = (formBossId && state.bosses.get(Number(formBossId))) ||
                    Array.from(state.bosses.values()).find(b =>
                        b.name.toLowerCase() === targetName.toLowerCase() &&
                        (isInv === undefined || Boolean(b.is_invasion) === Boolean(isInv))
                    ) || currentBoss;
                if (targetBoss && targetBoss.id) {
                    targetBoss.color = finalColor;
                    reconcileBossRows();
                    try {
                        await fetch(`/bosses/${targetBoss.id}/color`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                'Accept': 'application/json'
                            },
                            body: JSON.stringify({ color: finalColor })
                        });
                    } catch (err) {
                        console.error('Failed to update boss color:', err);
                    }
                }
            } else {
                const newName = nameInput.value.trim();
                if (newName) {
                    sessionStorage.setItem(`pending_new_boss_color_${newName.toLowerCase()}`, finalColor || '');
                }
            }
        };

        if (submitBtn) {
            submitBtn.addEventListener('click', triggerSaveColor, { capture: true });
        }
        form.addEventListener('submit', triggerSaveColor, { capture: true });
    }

    function enhanceUi() {
        for (const link of document.querySelectorAll('a[href="/download"]')) link.style.display = 'none';
        for (const element of document.querySelectorAll('button, [role="button"], a, [title], [data-unified-tooltip], [data-i18n-title]')) {
            const existingTitle = element.getAttribute('title');
            if (existingTitle) {
                element.setAttribute('data-unified-tooltip', existingTitle);
                element.removeAttribute('title');
            }
            const source = element.getAttribute('data-unified-tooltip') || element.getAttribute('aria-label') || element.textContent || '';
            const translated = bilingualTooltip(source) || tooltipFromIcon(element);
            if (translated) {
                if (element.getAttribute('data-unified-tooltip') !== translated) {
                    element.setAttribute('data-unified-tooltip', translated);
                }
                if (element.getAttribute('aria-label') !== translated) {
                    element.setAttribute('aria-label', translated);
                }
            }
            if (element.hasAttribute('title')) {
                element.removeAttribute('title');
            }
        }
        if (window.attachAdminSettingsToReactDialog && document.querySelector('[role="dialog"]')) {
            window.attachAdminSettingsToReactDialog();
        }
        attachBossColorPickerToDialog();
        translateVisibleTooltips();
        translateVisibleUi();
    }

    function checkScheduledAlerts() {
        const now = Date.now() + state.serverOffset;
        const threshold = Number(setting('alertBeforeMinutes', 1)) * 60000;
        const globallyMuted = setting('muted', false) === true;
        if (globallyMuted) return;

        const items = [
            ...Array.from(state.bosses.values()).map(item => ({ item, kind: 'boss' })),
            ...Array.from(state.events.values()).map(item => ({ item, kind: 'event' }))
        ];
        for (const { item, kind } of items) {
            if (!item.next_spawn || item.post_maintenance || isMuted(item.id, kind)) continue;
            const spawnAt = new Date(item.next_spawn).getTime();
            const diff = spawnAt - now;
            const preKey = `pre:${kind}:${item.id}:${item.next_spawn}`;
            const spawnKey = `spawn:${kind}:${item.id}:${item.next_spawn}`;
            // The existing dashboard already handles visible boss alerts. This bridge
            // covers game events and background tabs without playing the same sound twice.
            const handledByDashboard = kind === 'boss' && document.visibilityState === 'visible';
            if (!handledByDashboard && diff <= threshold && diff > -30000 && !state.alerted.has(preKey)) {
                state.alerted.add(preKey);
                playSound(soundPath(setting('alertSound', 'alert'), '/alert.mp3'));
                const minLeft = Math.max(0, Math.ceil(diff / 60000));
                showNotice(t('spawn_soon_notice', { name: item.name, min: minLeft }), false);
            }
            if (!handledByDashboard && diff <= 0 && diff > -90000 && !state.alerted.has(spawnKey)) {
                state.alerted.add(spawnKey);
                const selected = setting('justSpawnedSound', 'default');
                const path = selected === 'default' ? '/just-spawned.mp3' : soundPath(selected, '/just-spawned.mp3');
                playSound(path);
                showNotice(t('spawned_notice', { name: item.name }), true);
            }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        readInitialData();
        ensureStatusButton();
        ensureLanguageButton();
        mountCompactHeaderControls();
        translateVisibleUi();
        enhanceUi();
        reconcileBossRows();
        applyTimezoneDisplay(false);
        state.audioUnlocked = localStorage.getItem('dashboard.audioUnlocked') === 'true';
        updateStatus();
        const unlockOnFirstInteraction = () => unlockAudio();
        document.addEventListener('pointerdown', unlockOnFirstInteraction, { once: true, passive: true });
        document.addEventListener('keydown', unlockOnFirstInteraction, { once: true });
        connectStream();
        checkScheduledAlerts();
        setInterval(checkScheduledAlerts, 1000);
        setInterval(pollLiveEventFallback, 5000);
        setInterval(reconcileBossRows, 1000);
        window.addEventListener('offline', () => updateStatus(t('offline_notice')));
        window.addEventListener('online', () => updateStatus());
        let uiRefreshPending = false;
        new MutationObserver(() => {
            if (uiRefreshPending) return;
            uiRefreshPending = true;
            requestAnimationFrame(() => {
                uiRefreshPending = false;
                enhanceUi();
                mountCompactHeaderControls();
                reconcileBossRows();
                applyTimezoneDisplay(false);
            });
        }).observe(document.body, { childList: true, characterData: true, subtree: true });
    });
})();
