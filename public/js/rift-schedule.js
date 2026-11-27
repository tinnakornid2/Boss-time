// Rift dungeon schedule (boss kind "rift"), shared by the dashboard, the server, push and the HUD.
// A rift has no kill time. Admin enters either the open (start) time or the actual close time of
// one run; every later run is derived from that single anchor, so nothing is written on a timer.
// One run: LOBBY (lobby_min) -> OPEN (run_min) -> CLOSING (closing_min) -> CLOSED (cooldown_min).
// Owner's rule: the anchored run (an entered time, or Spawned) happened, so the next run starts
// cooldown_min after its close. A later run nobody marks counts as Not spawned: the one after it
// starts cooldown_min after its start. Only Spawned (confirmed) pins NOW until the real close.
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
     * k = 0 is the anchored run; runs k >= 1 follow it. Returns null when Unset.
     */
    function riftState(rift, nowMs) {
        const closeMs = anchorCloseMs(rift);
        if (closeMs === null) return null;
        const d = durations(rift);
        const lobbyMs = d.lobby_min * MINUTE;
        const runMs = d.run_min * MINUTE;
        const closingMs = d.closing_min * MINUTE;
        const spanMs = runMs + closingMs;
        // Start to start for runs nobody marked (Not spawned); never shorter than one whole run.
        const stepMs = Math.max(d.cooldown_min * MINUTE, lobbyMs + spanMs);
        // A skipped run (Not spawned) is stored as close_at = its start, so in both cases the
        // first following run starts cooldown_min after close_at.
        const skipped = rift.skip === true;
        const anchorStart = skipped ? closeMs : closeMs - spanMs;
        const firstStart = closeMs + d.cooldown_min * MINUTE;
        let k;
        let startAt;
        if (!skipped && nowMs < closeMs) {
            k = 0;
            startAt = anchorStart;
        } else {
            k = nowMs < firstStart + spanMs ? 1 : Math.floor((nowMs - firstStart - spanMs) / stepMs) + 2;
            startAt = firstStart + (k - 1) * stepMs;
        }
        const prevStartAt = k === 0 ? null : k === 1 ? anchorStart : startAt - stepMs;
        const lobbyAt = startAt - lobbyMs;
        const endAt = startAt + runMs;
        const closeAt = endAt + closingMs;
        const phase = nowMs < lobbyAt ? 'CLOSED' : nowMs < startAt ? 'LOBBY' : nowMs < endAt ? 'OPEN' : 'CLOSING';
        return { phase, lobbyAt, startAt, endAt, closeAt, stepMs, prevStartAt, k, confirmed: k === 0 && rift.confirmed === true };
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
        // Editing durations keeps a skip or a Spawned; entering a time replaces both.
        if (!entersTime && base.skip === true && out.close_at) out.skip = true;
        if (!entersTime && base.confirmed === true && (out.open_at || out.close_at)) out.confirmed = true;
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
        return s.prevStartAt;
    }

    function cleanDurations(rift) {
        const out = normalizeRift({ open_at: null }, rift);
        delete out.skip;
        delete out.confirmed;
        return out;
    }

    // Not spawned (the rift did not appear): the next start is cooldown_min after the missed
    // start, without the play and closing time.
    function skipRun(rift, nowMs) {
        const startMs = markedRunStart(rift, nowMs);
        if (startMs === null) return null;
        return { ...cleanDurations(rift), open_at: null, close_at: new Date(startMs).toISOString(), skip: true };
    }

    // Spawned: the run happened, so the normal timeline follows from its start, and only a
    // Spawned run pins NOW until its real close.
    function confirmRun(rift, nowMs) {
        const startMs = markedRunStart(rift, nowMs, true); // also undoes a Not spawned pressed by mistake
        if (startMs === null) return null;
        return { ...cleanDurations(rift), open_at: new Date(startMs).toISOString(), close_at: null, confirmed: true };
    }

    const NOW_WINDOW_MS = 5 * MINUTE;
    const iso = (ms) => new Date(ms).toISOString();

    /**
     * The boss as every screen sees it. The stored rift keeps next_spawn null; outbound lists get
     * next_spawn = lobby of the run shown, so the dashboard, alerts, push and HUD need no rift code.
     * A Spawned run is pinned (NOW) from the end of its lobby's NOW window until the real close,
     * with rift_close_at for the countdown. Any other run shows NOW only for the lobby's five
     * minutes, then the next run is shown. rift_phase is the real phase. Non-rift bosses unchanged.
     */
    function projectRift(boss, nowMs) {
        if (!isRift(boss)) return boss;
        const rift = boss.rift || {};
        const d = durations(rift);
        const s = riftState(rift, nowMs);
        const base = {
            ...boss,
            interval: Math.max(d.cooldown_min, d.lobby_min + d.run_min + d.closing_min), // start to start when nobody marks a run
            last_kill_time: null,
            auto_advanced: false,
            post_maintenance: false,
            is_invasion: false
        };
        if (!s) {
            return { ...base, next_spawn: null, pinned_alive: false, rift_phase: null, rift_confirmed: false, rift_lobby_at: null, rift_start_at: null, rift_end_at: null, rift_close_at: null };
        }
        const afterNowWindow = s.phase !== 'CLOSED' && nowMs >= s.lobbyAt + NOW_WINDOW_MS;
        const pinned = afterNowWindow && s.confirmed;
        const shown = afterNowWindow && !pinned ? riftState(rift, s.closeAt) : s;
        return {
            ...base,
            next_spawn: iso(shown.lobbyAt),
            pinned_alive: pinned,
            rift_phase: s.phase,
            rift_confirmed: s.confirmed,
            rift_lobby_at: iso(shown.lobbyAt),
            rift_start_at: iso(shown.startAt),
            rift_end_at: iso(shown.endAt),
            rift_close_at: iso(shown.closeAt)
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
