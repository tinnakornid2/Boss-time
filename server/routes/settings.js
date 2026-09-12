const express = require('express');
const router = express.Router();
const db = require('../db');
const broadcaster = require('../broadcaster');
const { authMiddleware } = require('./auth');

router.get('/', (req, res) => {
    const s = db.getSettings();
    // Do not return password hash
    const { adminPasswordHash, ...publicSettings } = s;
    res.json(publicSettings);
});

router.put('/', authMiddleware, (req, res) => {
    const {
        serverName,
        invasionLabel,
        invasionEmoji,
        invasionColor,
        invasionPosition,
        hideInvasionBosses,
        alertBeforeMinutes,
        discordWebhook
    } = req.body;

    const updates = {};
    if (serverName !== undefined) updates.serverName = serverName;
    if (invasionLabel !== undefined) updates.invasionLabel = invasionLabel;
    if (invasionEmoji !== undefined) updates.invasionEmoji = invasionEmoji;
    if (invasionColor !== undefined) updates.invasionColor = invasionColor;
    if (invasionPosition !== undefined) updates.invasionPosition = invasionPosition;
    if (hideInvasionBosses !== undefined) updates.hideInvasionBosses = Boolean(hideInvasionBosses);
    if (alertBeforeMinutes !== undefined) updates.alertBeforeMinutes = Number(alertBeforeMinutes) || 5;
    if (discordWebhook !== undefined) updates.discordWebhook = discordWebhook;

    const updated = db.updateSettings(updates);
    const { adminPasswordHash, ...cleanSettings } = updated;
    broadcaster.broadcast('settings:updated', cleanSettings);
    res.json({ success: true, settings: cleanSettings });
});

router.post('/announcement', authMiddleware, (req, res) => {
    const { announcement } = req.body;
    db.updateSettings({ announcement: announcement || null });
    broadcaster.broadcast('announcement:updated', { announcement: announcement || null });
    res.json({ success: true, announcement });
});

router.post('/announcement/clear', authMiddleware, (req, res) => {
    db.updateSettings({ announcement: null });
    broadcaster.broadcast('announcement:updated', { announcement: null });
    res.json({ success: true });
});

router.get('/history', (req, res) => {
    res.json(db.getKillHistory(100));
});

module.exports = router;
