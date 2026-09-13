const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const broadcaster = require('../broadcaster');

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const digest = crypto.scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${digest}`;
}
function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') return next();
    return res.status(403).json({ success: false, message: 'Admin access required' });
}

// GET /api/settings/passwords (Admin only)
router.get('/passwords', requireAdmin, (req, res) => {
    res.json({
        success: true,
        adminPasswordConfigured: true,
        memberPasswordConfigured: true
    });
});

// POST /api/settings/passwords (Admin only)
router.post('/passwords', requireAdmin, async (req, res) => {
    const { adminPassword, memberPassword } = req.body;
    const updates = {};

    if (adminPassword && typeof adminPassword === 'string' && adminPassword.trim().length >= 4) {
        const clean = adminPassword.trim();
        updates.adminPassword = null;
        updates.adminPasswordHash = hashPassword(clean);
    }

    if (memberPassword && typeof memberPassword === 'string' && memberPassword.trim().length >= 4) {
        const clean = memberPassword.trim();
        updates.memberPassword = null;
        updates.memberPasswordHash = hashPassword(clean);
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมีความยาวอย่างน้อย 4 ตัวอักษร' });
    }

    await db.updateSettings(updates);
    res.json({
        success: true,
        message: 'บันทึกรหัสผ่านใหม่เรียบร้อยแล้ว'
    });
});

router.get('/', (req, res) => {
    const s = db.getSettings();
    // Do not return password hash
    const {
        adminPasswordHash,
        memberPasswordHash,
        adminPassword,
        memberPassword,
        discordWebhook,
        ...publicSettings
    } = s;
    res.json(publicSettings);
});

router.put('/', requireAdmin, async (req, res) => {
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

    const updated = await db.updateSettings(updates);
    const {
        adminPasswordHash,
        memberPasswordHash,
        adminPassword: storedAdminPassword,
        memberPassword: storedMemberPassword,
        discordWebhook: storedDiscordWebhook,
        ...cleanSettings
    } = updated;
    broadcaster.broadcast('settings:updated', cleanSettings);
    res.json({ success: true, settings: cleanSettings });
});

router.post('/announcement', requireAdmin, async (req, res) => {
    const { announcement } = req.body;
    await db.updateSettings({ announcement: announcement || null });
    broadcaster.broadcast('announcement:updated', { announcement: announcement || null });
    res.json({ success: true, announcement });
});

router.post('/announcement/clear', requireAdmin, async (req, res) => {
    await db.updateSettings({ announcement: null });
    broadcaster.broadcast('announcement:updated', { announcement: null });
    res.json({ success: true });
});

router.get('/history', (req, res) => {
    res.json(db.getKillHistory(100));
});

module.exports = router;
