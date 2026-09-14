(function () {
    'use strict';

    const DB_URL = 'https://boss-timel2m-default-rtdb.asia-southeast1.firebasedatabase.app';
    const LIVE_URL = `${DB_URL}/tracker/liveEvent.json`;
    const NOW_PIN_WINDOW_MS = 5 * 60 * 1000;
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
                max-width: min(100%, 330px);
                margin-left: 2px;
                padding-left: 3px;
                border-left: 1px solid rgba(255,255,255,.08);
                overflow: hidden;
                white-space: nowrap;
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
            #compact-system-controls #header-timezone-control {
                width: auto !important;
                min-width: 0 !important;
                max-width: 112px !important;
                height: 22px !important;
                padding: 0 6px !important;
                gap: 4px !important;
                border: 1px solid rgba(255,255,255,.16) !important;
                border-radius: 6px !important;
                background: rgba(255,255,255,.055) !important;
                font: 600 9px/1 system-ui !important;
                letter-spacing: 0 !important;
                flex: 0 1 auto;
            }
            #compact-system-controls #header-firebase-status-badge .system-badge-label,
            #compact-system-controls #header-version-control .system-badge-label,
            #compact-system-controls #header-timezone-control .system-badge-label {
                display: block;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #compact-system-controls #header-firebase-status-badge[data-status="connected"] { color: #34d399 !important; }
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
            @media (max-width: 430px) {
                #compact-system-controls { gap: 2px; max-width: 240px; }
                #compact-system-controls #header-firebase-status-badge,
                #compact-system-controls #header-version-control,
                #compact-system-controls #header-timezone-control { padding-inline: 4px !important; font-size: 8px !important; }
                #compact-system-controls #header-firebase-status-badge { max-width: 72px !important; }
            }
        `;
        document.head.appendChild(style);
        const button = document.createElement('button');
        button.id = 'realtime-audio-status';
        button.type = 'button';
        button.textContent = '🔇';
        button.title = 'Enable Audio — เปิดเสียงแจ้งเตือน';
        button.setAttribute('aria-label', button.title);
        button.className = 'compact-system-control';
        button.addEventListener('click', unlockAudio);
        document.body.appendChild(button);
        ensureTimezoneButton();
        updateStatus();
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
            showNotice(`🕐 Time Zone GMT+${next} — เปลี่ยนเขตเวลาเป็น GMT+${next}`, false);
        });
        document.body.appendChild(button);
        updateTimezoneButton();
    }

    function updateTimezoneButton() {
        const button = document.getElementById('header-timezone-control');
        if (!button) return;
        const offset = selectedTimezoneOffset();
        button.innerHTML = `<span aria-hidden="true">🕐</span><span class="system-badge-label">GMT+${offset}</span>`;
        button.title = `Time Zone GMT+${offset} — เขตเวลา GMT+${offset} (กดเพื่อสลับ)`;
        button.setAttribute('aria-label', button.title);
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
            button.title = message;
            button.setAttribute('aria-label', message);
        }
        else if (state.audioUnlocked) {
            button.textContent = state.streamConnected ? '🔊' : state.streamFailed ? '📡' : '🔉';
            button.title = state.streamConnected
                ? 'Realtime Audio — เสียงเรียลไทม์เชื่อมต่อแล้ว'
                : state.streamFailed
                    ? 'Polling Audio — เสียงเชื่อมต่อสำรอง'
                    : 'Audio Connecting — กำลังเชื่อมต่อเสียง';
            button.setAttribute('aria-label', button.title);
            button.style.borderColor = state.streamConnected ? '#22c55e' : '#f59e0b';
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

        const password = document.getElementById('header-password-control');
        const firebase = document.getElementById('header-firebase-status-badge');
        const version = document.getElementById('header-version-control');
        const timezone = document.getElementById('header-timezone-control');
        const audio = document.getElementById('realtime-audio-status');
        for (const element of [password, firebase, version, timezone, audio]) {
            if (!element) continue;
            element.classList.add('compact-system-control', 'no-drag');
            if (element.parentElement !== controls) controls.appendChild(element);
        }
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
            updateStatus('Audio Blocked — เบราว์เซอร์บล็อกเสียง กรุณากดอีกครั้ง');
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
            updateStatus('Audio Blocked — เสียงถูกบล็อก คลิกเพื่อเปิด');
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
        return Array.from(document.querySelectorAll('tr')).filter(row => {
            const text = row.textContent || '';
            return text.includes(boss.name) && (!boss.location || text.includes(boss.location));
        });
    }

    function reconcileBossRows() {
        const now = Date.now() + state.serverOffset;
        for (const row of document.querySelectorAll('tr.realtime-pre-spawn-flash')) {
            row.classList.remove('realtime-pre-spawn-flash');
        }
        for (const boss of state.bosses.values()) {
            const expiry = new Date(boss.pre_spawn_expires_at || 0).getTime();
            const active = boss.pre_spawned && (!Number.isFinite(expiry) || expiry === 0 || expiry > now);
            for (const row of bossRows(boss)) row.classList.toggle('realtime-pre-spawn-flash', active);
        }
        pinNowBossRows(now);
    }

    function pinNowBossRows(now) {
        const activeBosses = Array.from(state.bosses.values())
            .filter(boss => {
                if (boss.pinned_alive) return true;
                const spawnAt = new Date(boss.next_spawn || 0).getTime();
                return Number.isFinite(spawnAt) && spawnAt > 0 && now >= spawnAt && now < spawnAt + NOW_PIN_WINDOW_MS;
            })
            .sort((a, b) => {
                if (a.pinned_alive !== b.pinned_alive) return a.pinned_alive ? -1 : 1;
                return new Date(b.next_spawn || 0).getTime() - new Date(a.next_spawn || 0).getTime();
            });

        const rowsByBody = new Map();
        for (const boss of activeBosses) {
            for (const row of bossRows(boss)) {
                const body = row.parentElement;
                if (!body || body.tagName !== 'TBODY') continue;
                if (!rowsByBody.has(body)) rowsByBody.set(body, []);
                const rows = rowsByBody.get(body);
                if (!rows.includes(row)) rows.push(row);
            }
        }

        for (const [body, wanted] of rowsByBody) {
            const current = Array.from(body.children).slice(0, wanted.length);
            if (wanted.every((row, index) => current[index] === row)) continue;
            const fragment = document.createDocumentFragment();
            for (const row of wanted) fragment.appendChild(row);
            body.insertBefore(fragment, body.firstChild);
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
                showNotice(`⚠️ Boss Alert — ${event.bossName} กำลังจะเกิด`, true);
            }
        } else if (event.type === 'boss_pre_spawn_cleared') {
            if (event.boss) state.bosses.set(Number(event.boss.id), event.boss);
            reconcileBossRows();
        } else if (event.type === 'boss_time_unset') {
            reconcileBossRows();
        }
    }

    function processPollData(data) {
        if (Number.isFinite(Number(data.serverTime))) state.serverOffset = Number(data.serverTime) - Date.now();
        for (const boss of data.bosses || []) state.bosses.set(Number(boss.id), boss);
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

    const TOOLTIP_TRANSLATIONS = [
        [/search/i, 'Search — ค้นหา'],
        [/show muted/i, 'Show Muted — แสดงรายการปิดเสียง'],
        [/hide muted/i, 'Hide Muted — ซ่อนรายการปิดเสียง'],
        [/still alive/i, 'Still Alive — บอสยังไม่ตาย'],
        [/unset/i, 'Unset Time — ล้างเวลาบอส'],
        [/edit/i, 'Edit — แก้ไข'],
        [/delete/i, 'Delete — ลบ'],
        [/mute/i, 'Mute Alert — ปิดเสียงแจ้งเตือน'],
        [/settings/i, 'Settings — ตั้งค่า'],
        [/reset/i, 'Reset Time — รีเซ็ตเวลา'],
        [/notify|pre-spawn/i, 'Notify Members — แจ้งเตือนสมาชิก'],
        [/more|menu/i, 'More Options — ตัวเลือกเพิ่มเติม'],
        [/pin/i, 'Pin — ปักหมุด'],
        [/close/i, 'Close — ปิด'],
        [/save/i, 'Save — บันทึก'],
        [/cancel/i, 'Cancel — ยกเลิก'],
        [/password/i, 'Manage Passwords — จัดการรหัสผ่าน'],
        [/volume|audio|sound/i, 'Audio Settings — ตั้งค่าเสียง']
    ];

    const ICON_TOOLTIP_TRANSLATIONS = [
        [/lucide-zap\b/, 'Kill Now (2 Clicks) — บันทึกเวลาตายตอนนี้ (คลิก 2 ครั้ง)'],
        [/lucide-skull\b/, 'Custom Kill Time — กำหนดเวลาตายเอง'],
        [/lucide-ellipsis(?:-vertical)?\b|lucide-more-vertical\b/, 'More Options — ตัวเลือกเพิ่มเติม'],
        [/lucide-search\b/, 'Search — ค้นหา'],
        [/lucide-settings\b|lucide-cog\b/, 'Settings — ตั้งค่า'],
        [/lucide-pencil\b|lucide-edit\b/, 'Edit — แก้ไข'],
        [/lucide-trash(?:-2)?\b/, 'Delete — ลบ'],
        [/lucide-pin-off\b/, 'Unpin — ยกเลิกปักหมุด'],
        [/lucide-pin\b/, 'Pin — ปักหมุด'],
        [/lucide-bell-off\b|lucide-volume-x\b/, 'Unmute Alert — เปิดเสียงแจ้งเตือน'],
        [/lucide-bell\b|lucide-volume-2\b/, 'Mute Alert — ปิดเสียงแจ้งเตือน'],
        [/lucide-clock\b/, 'Update Time — อัปเดตเวลา'],
        [/lucide-rotate-ccw\b|lucide-refresh-ccw\b/, 'Reset Time — รีเซ็ตเวลา'],
        [/lucide-chevrons-right\b|lucide-skip-forward\b/, 'Advance Cycle — ข้ามรอบ'],
        [/lucide-check\b/, 'Confirm — ยืนยัน'],
        [/lucide-x\b/, 'Close — ปิด'],
        [/lucide-key-round\b|lucide-key\b/, 'Manage Passwords — จัดการรหัสผ่าน']
    ];

    const TOOLTIP_TEXT = {
        'Search': 'Search — ค้นหา',
        'Kill now (click 2x)': 'Kill Now (2 Clicks) — บันทึกเวลาตายตอนนี้ (คลิก 2 ครั้ง)',
        'Click again to confirm kill now': 'Confirm Kill Now — คลิกครั้งที่ 2 เพื่อยืนยันเวลาตาย',
        'Still alive (click 2x)': 'Still Alive (2 Clicks) — บอสยังไม่ตาย (คลิก 2 ครั้ง)',
        'Spawn in 5 min (click 2x)': 'Spawn in 5 Minutes (2 Clicks) — บอสเกิดใน 5 นาที (คลิก 2 ครั้ง)',
        'Spawn in 1 min (click 2x)': 'Spawn in 1 Minute (2 Clicks) — บอสเกิดใน 1 นาที (คลิก 2 ครั้ง)',
        'Not spawned (click 2x)': 'Not Spawned (2 Clicks) — บอสยังไม่เกิด (คลิก 2 ครั้ง)',
        'Mark event done (click 2x)': 'Mark Event Done (2 Clicks) — กิจกรรมเสร็จแล้ว (กด 2 ครั้ง)',
        'Skip today (click 2x)': 'Skip Today (2 Clicks) — ข้ามกิจกรรมวันนี้ (กด 2 ครั้ง)',
        'Pin still alive (click 2x)': 'Pin Still Alive (2 Clicks) — ปักหมุดว่ายังไม่จบ (กด 2 ครั้ง)',
        'Click again to confirm': 'Confirm with Second Click — กดครั้งที่ 2 เพื่อยืนยัน',
        'Double-click to mark as pre-spawned': 'Double-click Boss Name — ดับเบิลคลิกชื่อบอสเพื่อแจ้งเตือนสมาชิก',
        'Double-click to clear pre-spawned': 'Double-click Boss Name — ดับเบิลคลิกชื่อบอสเพื่อยกเลิกการแจ้งเตือน',
        'Show muted': 'Show Muted — แสดงรายการปิดเสียง',
        'Hide muted': 'Hide Muted — ซ่อนรายการปิดเสียง',
        'Settings': 'Settings — ตั้งค่า',
        'Edit Boss': 'Edit Boss — แก้ไขบอส',
        'Delete Boss': 'Delete Boss — ลบบอส',
        'Delete': 'Delete — ลบ',
        'Still alive': 'Still Alive — บอสยังไม่ตาย',
        'Still alive — pinned': 'Still Alive — ยืนยันว่าบอสยังไม่ตาย',
        'Not spawned': 'Not Spawned — บอสยังไม่เกิด',
        'Pre-spawning': 'Notify Members — แจ้งเตือนสมาชิก',
        'Update spawn': 'Update Spawn — อัปเดตเวลาเกิด',
        'Reset Boss Time': 'Reset Boss Time — รีเซ็ตเวลาบอส',
        'Post Maintenance Mode': 'Maintenance Mode — โหมดหลังปิดปรับปรุง',
        'Resend alert sound': 'Resend Alert — ส่งเสียงแจ้งเตือนอีกครั้ง',
        'Force all users to reload their page': 'Force Reload — ให้ทุกเครื่องโหลดใหม่',
        'Undo': 'Undo — ย้อนกลับ',
        'Alert before spawn': 'Alert Before Spawn — แจ้งก่อนบอสเกิด',
        'Boss alert sound': 'Boss Alert Sound — เสียงแจ้งเตือนบอส',
        'Just-spawned sound': 'Spawn Sound — เสียงเมื่อบอสเกิด',
        'Pre-spawn alert': 'Pre-spawn Alert — เสียงแจ้งก่อนเกิด',
        'Next spawn time': 'Next Spawn — เวลาเกิดครั้งถัดไป',
        'Last Kill Time': 'Last Kill Time — เวลาตายล่าสุด',
        'Location': 'Location — สถานที่',
        'Chance (%)': 'Chance — โอกาสเกิด',
        'Spawn in 1 min': 'Spawn +1 Minute — เพิ่มเวลาเกิด 1 นาที',
        'Spawn in 5 min': 'Spawn +5 Minutes — เพิ่มเวลาเกิด 5 นาที',
        'Show tooltips when hovering action buttons': 'Tooltips — แสดงคำอธิบายเมื่อชี้ปุ่ม',
        'Hides row buttons until you hover the row': 'Hover Actions — ซ่อนปุ่มจนกว่าจะชี้แถว',
        'Replaces kill buttons with status shortcuts': 'Status Buttons — ใช้ปุ่มสถานะแบบย่อ',
        'Split spawn status buttons': 'Split Buttons — แยกปุ่มสถานะบอส'
    };

    function bilingualTooltip(source) {
        const clean = String(source || '').trim();
        if (!clean) return '';
        if (clean.includes('—') && /[ก-๙]/.test(clean)) return clean;
        const direct = TOOLTIP_TEXT[clean];
        if (direct) return direct;
        const match = TOOLTIP_TRANSLATIONS.find(([pattern]) => pattern.test(clean));
        return match ? match[1] : '';
    }

    function tooltipFromIcon(element) {
        const svg = element.querySelector('svg');
        if (!svg) return '';
        const className = typeof svg.className === 'string' ? svg.className : (svg.className?.baseVal || '');
        const match = ICON_TOOLTIP_TRANSLATIONS.find(([pattern]) => pattern.test(className));
        return match ? match[1] : '';
    }

    function translateVisibleTooltips() {
        for (const element of document.querySelectorAll('[role="tooltip"], [role="tooltip"] *')) {
            if (element.children.length > 0) continue;
            const original = (element.textContent || '').trim();
            const direct = bilingualTooltip(original);
            const updateSpawn = original.startsWith('Update spawn —') ? 'Update Spawn — อัปเดตเวลาเกิด' : null;
            const translated = direct || updateSpawn;
            if (translated && original !== translated) element.textContent = translated;
        }
    }

    function enhanceUi() {
        for (const link of document.querySelectorAll('a[href="/download"]')) link.style.display = 'none';
        for (const element of document.querySelectorAll('button, [role="button"], a, [title]')) {
            const source = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '';
            const translated = bilingualTooltip(source) || tooltipFromIcon(element);
            if (translated) {
                element.setAttribute('title', translated);
                element.setAttribute('aria-label', translated);
            }
        }
        translateVisibleTooltips();
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
                showNotice(`🔔 Spawn Soon — ${item.name} จะเกิดใน ${Math.max(0, Math.ceil(diff / 60000))} นาที`, false);
            }
            if (!handledByDashboard && diff <= 0 && diff > -90000 && !state.alerted.has(spawnKey)) {
                state.alerted.add(spawnKey);
                const selected = setting('justSpawnedSound', 'default');
                const path = selected === 'default' ? '/just-spawned.mp3' : soundPath(selected, '/just-spawned.mp3');
                playSound(path);
                showNotice(`🔥 Spawned — ${item.name} เกิดแล้ว`, true);
            }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        readInitialData();
        ensureStatusButton();
        mountCompactHeaderControls();
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
        window.addEventListener('offline', () => updateStatus('⚠️ Offline — การเชื่อมต่อขาดหาย'));
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
