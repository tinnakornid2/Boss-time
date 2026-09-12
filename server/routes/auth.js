const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Generate simple secure session tokens
const validTokens = new Set();

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (validTokens.has(token)) {
            req.user = { role: 'admin' };
            return next();
        }
    }
    // Also check session cookie or header
    const cookieToken = req.headers['x-admin-token'];
    if (cookieToken && validTokens.has(cookieToken)) {
        req.user = { role: 'admin' };
        return next();
    }
    req.user = { role: 'guest' };
    next();
}

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const settings = db.getSettings();

    const expectedUser = settings.adminUsername || 'admin';
    const hashedInput = hashPassword(password || '');

    if (username === expectedUser && hashedInput === settings.adminPasswordHash) {
        const token = crypto.randomBytes(32).toString('hex');
        validTokens.add(token);
        return res.json({
            success: true,
            role: 'admin',
            token: token,
            user: { username: expectedUser, role: 'admin' }
        });
    }

    return res.status(401).json({ success: false, message: 'Invalid username or password' });
});

router.post('/pin', (req, res) => {
    const { pin } = req.body;
    const settings = db.getSettings();

    if (pin && String(pin) === String(settings.pinCode || '123456')) {
        const token = crypto.randomBytes(32).toString('hex');
        validTokens.add(token);
        return res.json({
            success: true,
            role: 'admin',
            token: token,
            user: { username: settings.adminUsername || 'admin', role: 'admin' }
        });
    }

    return res.status(401).json({ success: false, message: 'Invalid PIN code' });
});

router.get('/me', (req, res) => {
    const authHeader = req.headers.authorization;
    let isAdmin = false;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (validTokens.has(token)) isAdmin = true;
    }
    const headerToken = req.headers['x-admin-token'];
    if (headerToken && validTokens.has(headerToken)) isAdmin = true;

    res.json({
        role: isAdmin ? 'admin' : 'guest',
        username: isAdmin ? (db.getSettings().adminUsername || 'admin') : 'Guest'
    });
});

router.post('/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        validTokens.delete(authHeader.substring(7));
    }
    const headerToken = req.headers['x-admin-token'];
    if (headerToken) validTokens.delete(headerToken);
    res.json({ success: true });
});

router.post('/change-password', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : req.headers['x-admin-token'];
    if (!token || !validTokens.has(token)) {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { newPassword, newPin } = req.body;
    const updates = {};
    if (newPassword && newPassword.length >= 4) {
        updates.adminPasswordHash = hashPassword(newPassword);
    }
    if (newPin && newPin.length === 6) {
        updates.pinCode = String(newPin);
    }

    db.updateSettings(updates);
    res.json({ success: true, message: 'Security settings updated successfully' });
});

module.exports = {
    router,
    authMiddleware,
    validTokens
};
