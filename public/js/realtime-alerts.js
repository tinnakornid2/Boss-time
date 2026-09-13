(function () {
    'use strict';

    const DB_URL = 'https://boss-timel2m-default-rtdb.asia-southeast1.firebasedatabase.app';
    const LIVE_URL = `${DB_URL}/tracker/liveEvent.json`;
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
        audioPlaying: false
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
        `;
        document.head.appendChild(style);
        const button = document.createElement('button');
        button.id = 'realtime-audio-status';
        button.type = 'button';
        button.textContent = '🔇 กดเปิดเสียงแจ้งเตือน';
        button.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:100000;padding:8px 12px;border:1px solid #f59e0b;border-radius:999px;background:#18181b;color:#fff;font:600 12px system-ui;box-shadow:0 4px 18px #0008;cursor:pointer';
        button.addEventListener('click', unlockAudio);
        document.body.appendChild(button);
        updateStatus();
    }

    function updateStatus(message) {
        const button = document.getElementById('realtime-audio-status');
        if (!button) return;
        if (message) button.textContent = message;
        else if (state.audioUnlocked) {
            button.textContent = state.streamConnected
                ? '🔊 Realtime — เชื่อมต่อแล้ว'
                : state.streamFailed
                    ? '🔊 Polling — เชื่อมต่อสำรอง'
                    : '🔊 Connecting — กำลังเชื่อมต่อ';
            button.style.borderColor = state.streamConnected ? '#22c55e' : '#f59e0b';
        }
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
            updateStatus('⚠️ เบราว์เซอร์บล็อกเสียง — กดอีกครั้ง');
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
            updateStatus('⚠️ เสียงถูกบล็อก — คลิกเพื่อเปิด');
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
            if (!boss.next_spawn && !boss.pre_spawned && !boss.pinned_alive) showBossAsUnset(boss);
        }
    }

    function showBossAsUnset(boss) {
        if (!boss?.name) return;
        for (const row of document.querySelectorAll('tr')) {
            const rowText = row.textContent || '';
            if (!rowText.includes(boss.name)) continue;
            if (boss.location && !rowText.includes(boss.location)) continue;
            for (const node of row.querySelectorAll('span, td')) {
                const label = (node.textContent || '').trim();
                if (label === 'NOW' || label === 'Spawned') {
                    node.textContent = 'Unset';
                    node.className = String(node.className || '')
                        .replace(/text-red-\d+/g, '')
                        .replace(/font-bold/g, '');
                }
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
            if (!initial && fresh && !isMuted(event.bossId, 'boss')) {
                const key = setting('preSpawnSound', 'pop2');
                playSound(soundPath(key, '/pop2.mp3'));
                showNotice(`⚠️ ${event.bossName} กำลังจะเกิด`, true);
            }
        } else if (event.type === 'boss_pre_spawn_cleared') {
            if (event.boss) state.bosses.set(Number(event.boss.id), event.boss);
            reconcileBossRows();
        } else if (event.type === 'boss_time_unset') {
            showBossAsUnset(event.boss);
            reconcileBossRows();
        }
    }

    // Reuse the dashboard's existing /poll response as a no-extra-request fallback.
    // This keeps working even when anonymous RTDB streaming is disabled by rules.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
        const response = await nativeFetch(...args);
        const requestUrl = String(args[0]?.url || args[0] || '');
        if (requestUrl.endsWith('/poll') || requestUrl.includes('/poll?')) {
            response.clone().json().then(data => {
                if (Number.isFinite(Number(data.serverTime))) state.serverOffset = Number(data.serverTime) - Date.now();
                for (const boss of data.bosses || []) {
                    state.bosses.set(Number(boss.id), boss);
                }
                for (const event of data.events || []) state.events.set(Number(event.id), event);
                const initial = !state.initialEventsLoaded;
                for (const event of data.recentLiveEvents || []) consumeLiveEvent(event, initial);
                consumeLiveEvent(data.liveEvent, initial);
                state.initialEventsLoaded = true;
                reconcileBossRows();
                updateStatus();
            }).catch(() => {});
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
            for (const boss of page.props?.bosses || []) state.bosses.set(Number(boss.id), boss);
            for (const event of page.props?.events || []) state.events.set(Number(event.id), event);
        } catch (_) {}
    }

    const TOOLTIP_TRANSLATIONS = [
        [/still alive/i, 'Still Alive — บอสยังไม่ตาย'],
        [/unset/i, 'Unset Time — ล้างเวลาบอส'],
        [/edit/i, 'Edit — แก้ไข'],
        [/delete/i, 'Delete — ลบ'],
        [/mute/i, 'Mute Alert — ปิดเสียงแจ้งเตือน'],
        [/settings/i, 'Settings — ตั้งค่า'],
        [/reset/i, 'Reset Time — รีเซ็ตเวลา'],
        [/notify|pre-spawn/i, 'Notify Members — แจ้งเตือนสมาชิก']
    ];

    function enhanceUi() {
        for (const link of document.querySelectorAll('a[href="/download"]')) link.style.display = 'none';
        for (const element of document.querySelectorAll('button, [role="button"], a')) {
            const source = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '';
            const match = TOOLTIP_TRANSLATIONS.find(([pattern]) => pattern.test(source));
            if (match) element.setAttribute('title', match[1]);
        }
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
                showNotice(`🔔 ${item.name} จะเกิดใน ${Math.max(0, Math.ceil(diff / 60000))} นาที`, false);
            }
            if (!handledByDashboard && diff <= 0 && diff > -90000 && !state.alerted.has(spawnKey)) {
                state.alerted.add(spawnKey);
                const selected = setting('justSpawnedSound', 'default');
                const path = selected === 'default' ? '/just-spawned.mp3' : soundPath(selected, '/just-spawned.mp3');
                playSound(path);
                showNotice(`🔥 ${item.name} เกิดแล้ว`, true);
            }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        readInitialData();
        ensureStatusButton();
        enhanceUi();
        reconcileBossRows();
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
                reconcileBossRows();
            });
        }).observe(document.body, { childList: true, subtree: true });
    });
})();
