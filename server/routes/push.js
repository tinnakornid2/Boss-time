// Per-device Web Push endpoints. Any logged-in role (admin, member, guest) may manage the
// subscription of its own device; none of these routes touch boss or event data.
// Endpoints travel in request bodies, never in URLs.
const express = require('express');
const push = require('../push');

module.exports = function createPushRouter(getSessionData) {
    const router = express.Router();

    function session(req, res) {
        const data = getSessionData(req);
        if (!data) {
            res.status(401).json({ success: false, message: 'Authentication required', loginUrl: '/login' });
            return null;
        }
        return data;
    }

    function fail(res, result) {
        return res.status(result.status || 400).json({ success: false, message: result.message || 'Request failed' });
    }

    router.get('/config', (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, ...push.getPublicConfig() });
    });

    router.post('/subscription/status', async (req, res) => {
        if (!session(req, res)) return;
        res.json({ success: true, ...(await push.getStatus(req.body?.endpoint)) });
    });

    router.post('/subscription', async (req, res) => {
        const data = session(req, res);
        if (!data) return;
        if (!push.isConfigured()) return fail(res, { status: 503, message: 'Notifications are not configured' });
        const result = await push.upsertSubscription(data, req.body?.subscription, req.body?.prefs, req.headers['user-agent']);
        if (!result.ok) return fail(res, result);
        res.json({ success: true, prefs: result.prefs });
    });

    router.put('/subscription', async (req, res) => {
        const data = session(req, res);
        if (!data) return;
        const result = await push.updatePrefs(data, req.body?.endpoint, req.body?.prefs);
        if (!result.ok) return fail(res, result);
        res.json({ success: true, prefs: result.prefs });
    });

    router.delete('/subscription', async (req, res) => {
        if (!session(req, res)) return;
        res.json({ success: true, ...(await push.removeSubscription(req.body?.endpoint)) });
    });

    router.post('/test', async (req, res) => {
        if (!session(req, res)) return;
        const result = await push.sendTest(req.body?.endpoint);
        if (!result.ok) return fail(res, result);
        res.json({ success: true });
    });

    return router;
};
