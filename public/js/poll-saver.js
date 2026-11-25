// Cuts Vercel traffic for /poll (shared by the dashboard, the report panel and the desktop HUD):
//  - concurrent and back-to-back polls from one page share a single request;
//  - the request carries the last payload tag (?v=), so an unchanged state comes back as a tiny
//    reply that is expanded here into the full snapshot every caller already expects;
//  - a server or network failure is shared the same way, so an outage does not raise traffic.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BossTrackerPollSaver = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const MIN_INTERVAL_MS = 4500;

    function jsonResponse(data) {
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
    }

    function createPollSaver({ fetchImpl, now = () => Date.now(), minIntervalMs = MIN_INTERVAL_MS }) {
        let snapshot = null;   // last complete payload, including pollTag
        let offset = 0;        // serverTime - local time
        let fetchedAt = -Infinity;
        let failure = null;    // last 5xx or network error: { response | error, at }
        let inFlight = null;
        let generation = 0;

        function isPoll(url) {
            return String(url || '').replace(/^https?:\/\/[^/]+/, '') === '/poll';
        }

        function invalidate() {
            generation += 1;
            fetchedAt = -Infinity;
            failure = null;
            inFlight = null;
        }

        async function load(url, options) {
            const startedIn = generation;
            const base = snapshot;
            const target = base && base.pollTag ? url + '?v=' + encodeURIComponent(base.pollTag) : url;
            let response;
            try {
                response = await fetchImpl(target, options);
            } catch (error) {
                if (startedIn === generation) failure = error?.name === 'AbortError' ? null : { error, at: now() };
                throw error;
            }
            if (startedIn === generation) failure = response.status >= 500 ? { response, at: now() } : null;
            if (!response.ok) return response;
            let data;
            try { data = await response.clone().json(); } catch (_) { return response; }
            if (data.unchanged && base) data = { ...base, serverTime: data.serverTime };
            if (data.stale || data.notReady || !Array.isArray(data.bosses)) return response;
            const older = snapshot && Number(data.dataRevision) < Number(snapshot.dataRevision);
            if (!older) {
                snapshot = data;
                offset = Number(data.serverTime) - now();
                // A change made while this request was in flight must be re-read at once.
                if (startedIn === generation) fetchedAt = now();
            }
            return jsonResponse(data);
        }

        async function poll(url, options) {
            const age = now() - fetchedAt;
            // A negative age means the PC clock was moved back: never freeze on an old snapshot.
            if (snapshot && age >= 0 && age < minIntervalMs) {
                return jsonResponse({ ...snapshot, serverTime: now() + offset });
            }
            // An outage must not raise traffic: callers share a failure like they share a snapshot.
            // Never before the first snapshot (cold start), and never for sign-out (401/403).
            const failureAge = failure ? now() - failure.at : -1;
            if (snapshot && failureAge >= 0 && failureAge < minIntervalMs) {
                if (failure.error) throw failure.error;
                return failure.response.clone();
            }
            if (!inFlight) {
                const request = load(url, options).finally(() => {
                    if (inFlight === request) inFlight = null;
                });
                inFlight = request;
            }
            return (await inFlight).clone();
        }

        return { isPoll, poll, invalidate };
    }

    return { createPollSaver, MIN_INTERVAL_MS };
});
