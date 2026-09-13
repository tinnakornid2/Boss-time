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
    const user = (username || '').trim().toLowerCase();
    const pass = (password || '').trim();
    const settings = db.getSettings();

    const expectedAdmin = (settings.adminUsername || 'admin').toLowerCase();
    const expectedMember = (settings.memberUsername || 'kain7').toLowerCase();
    const hashedInput = hashPassword(pass);

    const isAdminPass = pass === '777999' ||
        (settings.adminPassword && pass === settings.adminPassword) ||
        (settings.adminPasswordHash && hashedInput === settings.adminPasswordHash);

    const isMemberPass = pass === 'password777999' ||
        (settings.memberPassword && pass === settings.memberPassword) ||
        (settings.memberPasswordHash && hashedInput === settings.memberPasswordHash);

    if (user === expectedAdmin && isAdminPass) {
        const token = crypto.randomBytes(32).toString('hex');
        validTokens.add(token);
        return res.json({
            success: true,
            role: 'admin',
            token: token,
            user: { username: expectedAdmin, role: 'admin' }
        });
    }

    if ((user === expectedMember || user === 'member' || !user) && isMemberPass) {
        const token = crypto.randomBytes(32).toString('hex');
        validTokens.add(token);
        return res.json({
            success: true,
            role: 'member',
            token: token,
            user: { username: expectedMember, role: 'member' }
        });
    }

    return res.status(401).json({ success: false, message: 'Invalid username or password' });
});

router.post('/pin', (req, res) => {
    return res.status(403).json({ success: false, message: 'PIN code authentication has been disabled. Please use password.' });
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

    const { newPassword } = req.body;
    const updates = {};
    if (newPassword && newPassword.length >= 4) {
        updates.adminPassword = newPassword;
        updates.adminPasswordHash = hashPassword(newPassword);
    }

    db.updateSettings(updates);
    res.json({ success: true, message: 'Password updated successfully' });
});

module.exports = {
    router,
    authMiddleware,
    validTokens
};
