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
        let k = nowMs < closeMs ? 0 : Math.floor((nowMs - closeMs) / cycleMs) + 1;
        // A skipped run (Not spawned) is stored as close_at = its start: no run exists before it.
        if (rift.skip === true && k === 0) k = 1;
        const startAt = closeMs - runMs - closingMs + k * cycleMs;
        const lobbyAt = startAt - d.lobby_min * MINUTE;
        const endAt = startAt + runMs;
        const closeAt = endAt + closingMs;
        const phase = nowMs < lobbyAt ? 'CLOSED' : nowMs < startAt ? 'LOBBY' : nowMs < endAt ? 'OPEN' : 'CLOSING';
        return { phase, lobbyAt, startAt, endAt, closeAt, cycleMs, k };
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
        // Editing durations keeps a skip; entering a time replaces it.
        if (!entersTime && base.skip === true && out.close_at) out.skip = true;
        return out;
    }

    /**
     * Start of the run Admin is answering with Spawned / Not spawned: the run in progress (lobby,
     * open, closing) or, once closed, the run that just showed NOW. Null when there is none
     * (Unset, or right after a skip with nothing run since).
     */
    function markedRunStart(rift, nowMs, includeSkipped) {
        const s = riftState(rift, nowMs);
        if (!s) return null;
        if (s.phase !== 'CLOSED') return s.startAt;
        if (s.k === 1 && rift.skip === true) return includeSkipped ? timeMs(rift.close_at) : null; // the skipped run itself
        return s.k >= 1 ? s.startAt - s.cycleMs : null;
    }

    function cleanDurations(rift) {
        const out = normalizeRift({ open_at: null }, rift);
        delete out.skip;
        return out;
    }

    // Not spawned (the rift did not appear): the next start is cooldown_min after the missed
    // start, without the play and closing time.
    function skipRun(rift, nowMs) {
        const startMs = markedRunStart(rift, nowMs);
        if (startMs === null) return null;
        return { ...cleanDurations(rift), open_at: null, close_at: new Date(startMs).toISOString(), skip: true };
    }

    // Spawned: the run happened, so the normal timeline follows from its start.
    function confirmRun(rift, nowMs) {
        const startMs = markedRunStart(rift, nowMs, true); // also undoes a Not spawned pressed by mistake
        if (startMs === null) return null;
        return { ...cleanDurations(rift), open_at: new Date(startMs).toISOString(), close_at: null };
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

    const api = { DEFAULTS, isRift, riftState, normalizeRift, projectRift, projectBosses, skipRun, confirmRun };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.RiftSchedule = api;
})(typeof window !== 'undefined' ? window : globalThis);
