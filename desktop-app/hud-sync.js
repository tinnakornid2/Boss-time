// The single data path of the desktop app: the main process asks the dashboard page for the
// tracker state and pushes it to the Mini HUD. The HUD never polls on its own.
const SYNC_INTERVAL_MS = 5000;
const STUCK_AFTER_MS = 15000;

// Only a real sign-out hides the HUD. A timeout, 5xx or cold start keeps the last state.
function isSignedOut(result) {
    return Boolean(result && (result.notAuthenticated || result.status === 401 || result.status === 403));
}

function createHudSync({ fetchState, sendToHud, setLoggedIn, isHudWanted, now = () => Date.now() }) {
    let needsFull = true;   // the HUD has no data yet, so "unchanged" would leave it empty
    let fullRequests = 0;
    let runningSince = null;
    let runId = 0;
    let again = false;

    async function sync({ force = false } = {}) {
        if (!force && !isHudWanted()) return;
        if (runningSince !== null && now() - runningSince < STUCK_AFTER_MS) {
            // A change made during a running sync must still be read afterwards.
            if (force) again = true;
            return;
        }
        const id = ++runId;
        runningSince = now();
        const fullRequestsAtStart = fullRequests;
        try {
            const result = await fetchState({ full: needsFull });
            if (id !== runId) return;
            if (isSignedOut(result)) {
                needsFull = true;
                setLoggedIn(false);
                sendToHud({ ok: false, notAuthenticated: true });
            } else if (result && result.ok && (result.data || result.unchanged)) {
                if (result.data && fullRequestsAtStart === fullRequests) needsFull = false;
                setLoggedIn(true);
                sendToHud(result);
            }
        } catch (_) {
            // Transient: keep the last state and try again on the next tick.
        } finally {
            if (id === runId) runningSince = null;
        }
        if (id === runId && again) {
            again = false;
            await sync({ force: true });
        }
    }

    return {
        sync,
        requestFull() {
            needsFull = true;
            fullRequests += 1;
        }
    };
}

module.exports = { createHudSync, isSignedOut, SYNC_INTERVAL_MS };
