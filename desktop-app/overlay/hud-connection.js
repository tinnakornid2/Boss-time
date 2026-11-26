(function (root) {
    // Two missed syncs (5 s each, see hud-sync.js) plus a slow reply.
    const STALE_AFTER_MS = 12500;

    function getStatus(lastFreshAt, serverStale, now = Date.now()) {
        if (serverStale) return 'stale';
        if (!Number.isFinite(lastFreshAt) || lastFreshAt <= 0) return 'connecting';
        return now - lastFreshAt >= STALE_AFTER_MS ? 'stale' : 'live';
    }

    const api = { getStatus, STALE_AFTER_MS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.HudConnection = api;
})(typeof window !== 'undefined' ? window : globalThis);
