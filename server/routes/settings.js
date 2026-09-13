const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const broadcaster = require('../broadcaster');
const { authMiddleware } = require('./auth');

function requireAdmin(req, res, next) {
    authMiddleware(req, res, () => {
        if (req.user && req.user.role === 'admin') {
            return next();
        }
        return res.status(403).json({ success: false, message: 'Admin access required' });
    });
}

// GET /api/settings/passwords (Admin only)
router.get('/passwords', requireAdmin, (req, res) => {
    const s = db.getSettings();
    res.json({
        success: true,
        adminPassword: s.adminPassword || '@777999',
        memberPassword: s.memberPassword || 'password777999'
    });
});

// POST /api/settings/passwords (Admin only)
router.post('/passwords', requireAdmin, (req, res) => {
    const { adminPassword, memberPassword } = req.body;
    const updates = {};

    if (adminPassword && typeof adminPassword === 'string' && adminPassword.trim().length >= 4) {
        const clean = adminPassword.trim();
        updates.adminPassword = clean;
        updates.adminPasswordHash = crypto.createHash('sha256').update(clean).digest('hex');
    }

    if (memberPassword && typeof memberPassword === 'string' && memberPassword.trim().length >= 4) {
        const clean = memberPassword.trim();
        updates.memberPassword = clean;
        updates.memberPasswordHash = crypto.createHash('sha256').update(clean).digest('hex');
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมีความยาวอย่างน้อย 4 ตัวอักษร' });
    }

    const updated = db.updateSettings(updates);
    res.json({
        success: true,
        message: 'บันทึกรหัสผ่านใหม่เรียบร้อยแล้ว',
        adminPassword: updated.adminPassword,
        memberPassword: updated.memberPassword
    });
});

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
