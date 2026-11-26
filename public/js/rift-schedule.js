// Rift dungeon schedule (boss kind "rift"), shared by the dashboard, the server, push and the HUD.
// A rift has no kill time. Admin enters either the open (start) time or the actual close time of
// one run; every later run is derived from that single anchor, so nothing is written on a timer.
// One run: LOBBY (lobby_min) -> OPEN (run_min) -> CLOSING (closing_min) -> CLOSED (cooldown_min),
// and the next run starts cooldown_min after the actual close.
(function (root) {
    'use strict';

    const MINUTE = 60 * 1000;
    const DEFAULTS = Object.freeze({ lobby_min: 5, run_min: 60, closing_min: 1, cooldown_min: 360 });
    const LIMITS = Object.freeze({ lobby_min: [0, 120], run_min: [1, 1440], closing_min: [0, 120], cooldown_min: [0, 10080] });

    const isRift = (boss) => Boolean(boss && boss.kind === 'rift');

    function timeMs(value) {
        if (value === null || value === undefined || value === '') return null;
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : null;
    }

    function durations(rift) {
        const out = {};
        for (const key of Object.keys(DEFAULTS)) {
            const n = Number(rift && rift[key]);
            out[key] = Number.isInteger(n) ? n : DEFAULTS[key];
        }
        return out;
    }

    // Close time of the anchored run. The actual close wins over the open time.
    function anchorCloseMs(rift) {
        const d = durations(rift);
        const close = timeMs(rift && rift.close_at);
        if (close !== null) return close;
        const open = timeMs(rift && rift.open_at);
        return open === null ? null : open + (d.run_min + d.closing_min) * MINUTE;
    }

    /**
     * The run that is in progress at nowMs, or the next one if none is.
     * Returns null when the rift has no anchor (Unset).
     */
    function riftState(rift, nowMs) {
        const closeMs = anchorCloseMs(rift);
        if (closeMs === null) return null;
        const d = durations(rift);
        const runMs = d.run_min * MINUTE;
        const closingMs = d.closing_min * MINUTE;
        const cycleMs = runMs + closingMs + d.cooldown_min * MINUTE;
        const k = nowMs < closeMs ? 0 : Math.floor((nowMs - closeMs) / cycleMs) + 1;
        const startAt = closeMs - runMs - closingMs + k * cycleMs;
        const lobbyAt = startAt - d.lobby_min * MINUTE;
        const endAt = startAt + runMs;
        const closeAt = endAt + closingMs;
        const phase = nowMs < lobbyAt ? 'CLOSED' : nowMs < startAt ? 'LOBBY' : nowMs < endAt ? 'OPEN' : 'CLOSING';
        return { phase, lobbyAt, startAt, endAt, closeAt, cycleMs };
    }

    /**
     * Parse admin input into a stored rift config. Throws Error(message) on bad input.
     * `previous` keeps durations and times that the request leaves out.
     */
    function normalizeRift(input, previous) {
        const src = input || {};
        const base = previous || {};
        const out = {};
        for (const key of Object.keys(DEFAULTS)) {
            const raw = src[key] !== undefined ? src[key] : base[key] !== undefined ? base[key] : DEFAULTS[key];
            const n = Number(raw);
            const [min, max] = LIMITS[key];
            if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${key} must be a whole number from ${min} to ${max}`);
            out[key] = n;
        }
        // Entering one time replaces the old anchor: the other time is derived, not kept from an older run.
        const entersTime = src.open_at !== undefined || src.close_at !== undefined;
        const pick = (key) => (src[key] !== undefined ? src[key] : entersTime ? null : base[key]);
        for (const key of ['open_at', 'close_at']) {
            const raw = pick(key);
            if (raw === null || raw === undefined || raw === '') { out[key] = null; continue; }
            const ms = timeMs(raw);
            if (ms === null) throw new Error(`${key} is not a valid time`);
            out[key] = new Date(ms).toISOString();
        }
        if (out.open_at && out.close_at && Date.parse(out.close_at) < Date.parse(out.open_at)) throw new Error('close_at must not be before open_at');
        return out;
    }

    const NOW_WINDOW_MS = 5 * MINUTE;
    const iso = (ms) => new Date(ms).toISOString();

    /**
     * The boss as every screen sees it. The stored rift keeps next_spawn null; outbound lists get
     * next_spawn = lobby of the current/next run and pinned_alive while the run is in progress, so
     * the dashboard, alerts, push and HUD need no rift code. Non-rift bosses are returned unchanged.
     */
    function projectRift(boss, nowMs) {
        if (!isRift(boss)) return boss;
        const rift = boss.rift || {};
        const d = durations(rift);
        const s = riftState(rift, nowMs);
        const base = {
            ...boss,
            interval: d.run_min + d.closing_min + d.cooldown_min,
            last_kill_time: null,
            auto_advanced: false,
            post_maintenance: false,
            is_invasion: false
        };
        if (!s) {
            return { ...base, next_spawn: null, pinned_alive: false, rift_phase: null, rift_lobby_at: null, rift_start_at: null, rift_end_at: null, rift_close_at: null };
        }
        // NOW from the lobby until the real close: the lobby's own five-minute NOW window, then pinned.
        const pinned = s.phase === 'OPEN' || s.phase === 'CLOSING' || (s.phase === 'LOBBY' && nowMs >= s.lobbyAt + NOW_WINDOW_MS);
        return {
            ...base,
            next_spawn: iso(s.lobbyAt),
            pinned_alive: pinned,
            rift_phase: s.phase,
            rift_lobby_at: iso(s.lobbyAt),
            rift_start_at: iso(s.startAt),
            rift_end_at: iso(s.endAt),
            rift_close_at: iso(s.closeAt)
        };
    }

    function projectBosses(bosses, nowMs) {
        if (!Array.isArray(bosses) || !bosses.some(isRift)) return bosses || [];
        return bosses.map(boss => projectRift(boss, nowMs));
    }

    const api = { DEFAULTS, isRift, riftState, normalizeRift, projectRift, projectBosses };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.RiftSchedule = api;
})(typeof window !== 'undefined' ? window : globalThis);
