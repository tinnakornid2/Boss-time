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

    if (adminPassword && typeof adminPassword === 'string' && adminPassword.trim().length >= 8) {
        const clean = adminPassword.trim();
        updates.adminPassword = null;
        updates.adminPasswordHash = hashPassword(clean);
    }

    if (memberPassword && typeof memberPassword === 'string' && memberPassword.trim().length >= 8) {
        const clean = memberPassword.trim();
        updates.memberPassword = null;
        updates.memberPasswordHash = hashPassword(clean);
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร' });
    }

    await db.updateSettings(updates);
    res.json({
        success: true,
        message: 'บันทึกรหัสผ่านใหม่เรียบร้อยแล้ว'
    });
});

// GUEST PASSWORDS (Admin only)
router.get('/guest-passwords', requireAdmin, (req, res) => {
    res.json({
        success: true,
        passwords: db.getTemporaryPasswords()
    });
});

router.post('/guest-passwords', requireAdmin, async (req, res) => {
    const { label, password, durationHours, expiresAt } = req.body;
    try {
        const created = await db.createTemporaryPassword({ label, password, durationHours, expiresAt });
        res.json({
            success: true,
            message: 'สร้างรหัสผ่านชั่วคราวเรียบร้อยแล้ว',
            password: created
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

router.delete('/guest-passwords/:id', requireAdmin, async (req, res) => {
    const success = await db.deleteTemporaryPassword(req.params.id);
    if (!success) {
        return res.status(404).json({ success: false, message: 'ไม่พบรหัสผ่านที่ต้องการลบ' });
    }
    res.json({ success: true, message: 'ลบรหัสผ่านชั่วคราวเรียบร้อยแล้ว' });
});

// GOOGLE SHEETS PARALLEL DB (Admin + PIN 0386231334 required)
const GOOGLE_SHEETS_ACCESS_PIN = '0386231334';

router.post('/google-sheets/verify-pin', requireAdmin, (req, res) => {
    const { pin } = req.body || {};
    if (pin && String(pin).trim() === GOOGLE_SHEETS_ACCESS_PIN) {
        return res.json({
            success: true,
            authorized: true,
            message: 'ยืนยันรหัสผ่านสำเร็จ'
        });
    }
    return res.status(401).json({
        success: false,
        authorized: false,
        message: 'รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง'
    });
});

router.get('/google-sheets', requireAdmin, (req, res) => {
    const st = db.getGoogleSheetsStatus();
    res.json({
        success: true,
        ...st
    });
});

router.post('/google-sheets', requireAdmin, async (req, res) => {
    const { webAppUrl, secretToken, enabled, autoFailover, pin } = req.body || {};
    if (pin !== GOOGLE_SHEETS_ACCESS_PIN) {
        return res.status(401).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง กรุณายืนยันรหัสผ่านเพื่อแก้ไขการตั้งค่า' });
    }

    const current = db.getSettings().googleSheets || {};
    const updates = {
        webAppUrl: webAppUrl !== undefined ? String(webAppUrl).trim() : current.webAppUrl,
        secretToken: secretToken !== undefined ? String(secretToken).trim() : current.secretToken,
        enabled: enabled !== undefined ? Boolean(enabled) : current.enabled,
        autoFailover: autoFailover !== undefined ? Boolean(autoFailover) : current.autoFailover
    };

    await db.updateSettings({ googleSheets: updates });
    res.json({
        success: true,
        message: 'บันทึกการตั้งค่า Google Sheets เรียบร้อยแล้ว',
        status: db.getGoogleSheetsStatus()
    });
});

router.post('/google-sheets/test', requireAdmin, async (req, res) => {
    const { webAppUrl, secretToken, pin } = req.body || {};
    if (pin && pin !== GOOGLE_SHEETS_ACCESS_PIN) {
        return res.status(401).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' });
    }

    const result = await db.testGoogleSheets(webAppUrl, secretToken);
    res.json(result);
});

router.post('/google-sheets/sync', requireAdmin, async (req, res) => {
    const { pin } = req.body || {};
    if (pin && pin !== GOOGLE_SHEETS_ACCESS_PIN) {
        return res.status(401).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' });
    }

    const result = await db.syncGoogleSheetsFull();
    res.json(result);
});

router.get('/', (req, res) => {
    const s = db.getSettings();
    // Do not return password hash or sensitive config
    const {
        adminPasswordHash,
        memberPasswordHash,
        adminPassword,
        memberPassword,
        temporaryPasswords,
        googleSheets,
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
