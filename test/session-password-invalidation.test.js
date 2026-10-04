const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../server/db');
const { createSession, readSession, getPasswordFingerprint } = require('../server/server');

test('Session Password Invalidation: session includes password fingerprint and validates', async () => {
    const adminSession = createSession('admin');
    const memberSession = createSession('member');

    const adminData = readSession(adminSession);
    const memberData = readSession(memberSession);

    assert.ok(adminData);
    assert.equal(adminData.role, 'admin');
    assert.ok(adminData.pfp);
    assert.equal(adminData.pfp, getPasswordFingerprint('admin'));

    assert.ok(memberData);
    assert.equal(memberData.role, 'member');
    assert.ok(memberData.pfp);
    assert.equal(memberData.pfp, getPasswordFingerprint('member'));
});

test('Session Password Invalidation: changing member password immediately invalidates old member sessions', async () => {
    // 1. Issue member session with original password
    const origSettings = db.getSettings();
    const origMemberPass = origSettings.memberPassword || 'password777999';
    const oldMemberSession = createSession('member');
    assert.ok(readSession(oldMemberSession), 'Old member session should initially be valid');

    // 2. Admin changes member password
    const salt = crypto.randomBytes(16).toString('hex');
    const newHash = `scrypt$${salt}$${crypto.scryptSync('newPassword999', salt, 64).toString('hex')}`;
    await db.updateSettings({ memberPassword: null, memberPasswordHash: newHash });

    // 3. Old member session MUST now be rejected
    const rejectedSession = readSession(oldMemberSession);
    assert.equal(rejectedSession, null, 'Old member session must be invalidated immediately');

    // 4. New member session with current password should be valid
    const newMemberSession = createSession('member');
    assert.ok(readSession(newMemberSession), 'New member session should be valid');

    // Restore original settings
    await db.updateSettings({
        memberPassword: origMemberPass,
        memberPasswordHash: origSettings.memberPasswordHash || null
    });
});

test('Session Password Invalidation: changing admin password invalidates old admin sessions while allowing re-issued session', async () => {
    const origSettings = db.getSettings();
    const origAdminPass = origSettings.adminPassword || '@777999';
    const oldAdminSession = createSession('admin');
    assert.ok(readSession(oldAdminSession), 'Old admin session should initially be valid');

    // Admin updates admin password
    const salt = crypto.randomBytes(16).toString('hex');
    const newHash = `scrypt$${salt}$${crypto.scryptSync('@newAdminPass777', salt, 64).toString('hex')}`;
    await db.updateSettings({ adminPassword: null, adminPasswordHash: newHash });

    // Old admin session on any other device/browser is rejected
    assert.equal(readSession(oldAdminSession), null, 'Old admin session on another client must be rejected');

    // Newly re-issued admin session for the acting admin is valid
    const freshAdminSession = createSession('admin');
    assert.ok(readSession(freshAdminSession), 'Re-issued admin session must remain valid');

    // Restore original settings
    await db.updateSettings({
        adminPassword: origAdminPass,
        adminPasswordHash: origSettings.adminPasswordHash || null
    });
});

test('Session Password Invalidation: guest session invalidation on expiration or deletion', async () => {
    // Create temporary guest password
    const guestEntry = await db.createTemporaryPassword({
        label: 'Test Guest',
        password: 'g-test-pwd',
        durationHours: 1
    });
    assert.ok(guestEntry && guestEntry.id);

    const guestSession = createSession('guest', 3600, { guestId: guestEntry.id });
    assert.ok(readSession(guestSession), 'Active guest session should be valid');

    // Delete guest password
    await db.deleteTemporaryPassword(guestEntry.id);

    // Guest session must be immediately invalidated
    assert.equal(readSession(guestSession), null, 'Deleted guest session must be immediately invalidated');
});

test('Alert popups overlapping prevention: dynamic offset and stacking CSS', () => {
    const realtimeAlertsCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'), 'utf8');

    // Dynamic offset CSS variable and sibling selector
    assert.match(realtimeAlertsCode, /var\(--realtime-toast-offset,\s*0px\)/);
    assert.match(realtimeAlertsCode, /\.fixed\.bottom-4\.left-4 \+ \.fixed\.bottom-4\.left-4/);
    assert.match(realtimeAlertsCode, /function updateToastStackOffset\(\)/);

    // Desktop app duplicate visual suppression
    assert.match(realtimeAlertsCode, /toast\.style\.display = 'none';/);

    // Overlay toast stacking in Mini HUD
    const hudOverlayCode = fs.readFileSync(path.join(__dirname, '..', 'desktop-app', 'overlay', 'overlay.js'), 'utf8');
    assert.match(hudOverlayCode, /while\s*\(dom\.toastContainer\.children\.length >= 3\)/);
    assert.match(hudOverlayCode, /dom\.toastContainer\.firstElementChild\.remove\(\)/);

    // Overlay toast item flex-shrink prevention in CSS
    const hudCss = fs.readFileSync(path.join(__dirname, '..', 'desktop-app', 'overlay', 'overlay.css'), 'utf8');
    assert.match(hudCss, /flex-shrink:\s*0;/);
});
