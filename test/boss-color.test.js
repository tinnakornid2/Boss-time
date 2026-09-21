const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const db = require('../server/db');
const { _test } = require('../server/db');
const googleSheets = require('../server/google-sheets');

const origConfig = googleSheets.getConfig();
googleSheets.saveLocalConfig({ ...origConfig, enabled: false });

test('Boss color: createBoss saves color property', async () => {
    const created = await db.createBoss({
        name: 'Test Color Boss 1',
        location: 'Test Location',
        interval: 120,
        color: '#f59e0b'
    });

    assert.ok(created);
    assert.equal(created.name, 'Test Color Boss 1');
    assert.equal(created.color, '#f59e0b');

    // Verify in db.getBoss
    const fetched = db.getBoss(created.id);
    assert.ok(fetched);
    assert.equal(fetched.color, '#f59e0b');

    // Clean up
    await db.deleteBoss(created.id);
});

test('Boss color: updateBoss updates color and allows resetting to null', async () => {
    const created = await db.createBoss({
        name: 'Test Color Boss 2',
        location: 'Test Zone',
        interval: 60
    });

    assert.equal(created.color, null);

    // Update color to Purple
    const updated = await db.updateBoss(created.id, { color: '#a855f7' });
    assert.ok(updated);
    assert.equal(updated.color, '#a855f7');

    const fetched = db.getBoss(created.id);
    assert.equal(fetched.color, '#a855f7');

    // Update color back to null (Default)
    const reset = await db.updateBoss(created.id, { color: null });
    assert.ok(reset);
    assert.equal(reset.color, null);

    // Clean up
    await db.deleteBoss(created.id);
});

test('Boss color: color property does not affect auto-advance or countdown calculation', () => {
    const spawn = Date.parse('2026-09-14T00:00:00.000Z');
    const bossWithColor = {
        name: 'Colored Antharas',
        next_spawn: new Date(spawn).toISOString(),
        interval: 60,
        pinned_alive: false,
        color: '#f59e0b'
    };

    // Before 5 minutes: still NOW, not auto-advanced
    assert.equal(_test.calculateBossAutoAdvance(bossWithColor, spawn + 4 * 60 * 1000), null);

    // At 5 minutes: auto-advances cycle exactly like standard boss
    const result = _test.calculateBossAutoAdvance(bossWithColor, spawn + 5 * 60 * 1000);
    assert.ok(result);
    assert.equal(result.last_kill_time, new Date(spawn).toISOString());
    assert.equal(result.next_spawn, new Date(spawn + 60 * 60 * 1000).toISOString());
});

test('Boss color: Client realtime alerts bridge and Color Picker architecture contract', () => {
    const fs = require('fs');
    const alertsSrc = fs.readFileSync('public/js/realtime-alerts.js', 'utf8');
    const serverSrc = fs.readFileSync('server/server.js', 'utf8');
    const gasSrc = fs.readFileSync('google_apps_script/Code.gs', 'utf8');

    // 1. Color palette and injection definitions exist
    assert.ok(alertsSrc.includes('PRESET_BOSS_COLORS'));
    assert.ok(alertsSrc.includes('attachBossColorPickerToDialog'));
    assert.ok(alertsSrc.includes('custom-boss-color-picker-container'));
    assert.ok(alertsSrc.includes('custom-boss-color-preview'));
    assert.ok(alertsSrc.includes('applyRowBossColor'));
    assert.ok(alertsSrc.includes('data-boss-custom-color'));

    // 2. Server PUT /bosses/:id/color endpoint exists and requires admin
    assert.ok(serverSrc.includes("app.put('/bosses/:id/color', requireAdmin"));

    // 3. I18N translations exist for color picker
    assert.ok(alertsSrc.includes('boss_font_color'));
    assert.ok(alertsSrc.includes('color_preview'));

    // 4. Google Sheets mirror maintains Color column
    assert.ok(gasSrc.includes("'Color'"));
    assert.ok(gasSrc.includes("b.color || ''"));
    assert.ok(gasSrc.includes("boss.color || ''"));
});

test('Boss color: handles multiple bosses with same name (e.g. Invasion vs Normal Valefar) independently', async () => {
    // Create Normal Boss
    const normalBoss = await db.createBoss({
        name: 'Valefar Test',
        location: 'Morgue',
        interval: 210,
        is_invasion: false,
        color: null
    });

    // Create Invasion Boss with identical name and location
    const invasionBoss = await db.createBoss({
        name: 'Valefar Test',
        location: 'Morgue',
        interval: 210,
        is_invasion: true,
        color: null
    });

    assert.notEqual(normalBoss.id, invasionBoss.id);

    // Update normal boss color to #3e91fe
    await db.updateBoss(normalBoss.id, { color: '#3e91fe' });

    // Normal boss has #3e91fe, invasion boss remains null
    assert.equal(db.getBoss(normalBoss.id).color, '#3e91fe');
    assert.equal(db.getBoss(invasionBoss.id).color, null);

    // Update invasion boss color to #ef4444
    await db.updateBoss(invasionBoss.id, { color: '#ef4444' });

    // Both retain their respective colors independently
    assert.equal(db.getBoss(normalBoss.id).color, '#3e91fe');
    assert.equal(db.getBoss(invasionBoss.id).color, '#ef4444');

    // Clean up
    await db.deleteBoss(normalBoss.id);
    await db.deleteBoss(invasionBoss.id);
});

test('Boss color: Invasion boss font color dynamically derives from invasion settings when boss.color is null', () => {
    const alertsSrc = fs.readFileSync(path.join(__dirname, '../public/js/realtime-alerts.js'), 'utf8');
    assert.ok(alertsSrc.includes('getEffectiveBossColor'));
    assert.ok(alertsSrc.includes('dashboard.invasionColor'));
    assert.ok(alertsSrc.includes('boss.is_invasion'));
});

test('Boss color: Expanded 20+ colors palette and global invasion color synchronization contract', () => {
    const alertsSrc = fs.readFileSync(path.join(__dirname, '../public/js/realtime-alerts.js'), 'utf8');
    const serverSrc = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');

    // 1. Verify 20+ color presets
    assert.ok(alertsSrc.includes("key: 'gold'"));
    assert.ok(alertsSrc.includes("key: 'white'"));
    assert.ok(alertsSrc.includes("key: 'silver'"));
    assert.ok(alertsSrc.includes("key: 'yellow'"));
    assert.ok(alertsSrc.includes("key: 'coral'"));
    assert.ok(alertsSrc.includes("key: 'crimson'"));
    assert.ok(alertsSrc.includes("key: 'rose'"));
    assert.ok(alertsSrc.includes("key: 'fuchsia'"));
    assert.ok(alertsSrc.includes("key: 'violet'"));
    assert.ok(alertsSrc.includes("key: 'indigo'"));
    assert.ok(alertsSrc.includes("key: 'skyblue'"));
    assert.ok(alertsSrc.includes("key: 'teal'"));
    assert.ok(alertsSrc.includes("key: 'lime'"));

    // 2. Verify server PUT /settings/invasion-color endpoint
    assert.ok(serverSrc.includes("app.put('/settings/invasion-color', requireAdmin"));
    assert.ok(serverSrc.includes("invasionColor: settings.invasionColor"));

    // 3. Verify admin lock & live sync in realtime-alerts.js
    assert.ok(alertsSrc.includes('syncInvasionSettingsAdminLock'));
    assert.ok(alertsSrc.includes('/settings/invasion-color'));
});

test('Event color: createEvent and updateEvent save color independently', async () => {
    const created = await db.createEvent({
        name: 'Test Event 1',
        location: 'Event Zone',
        event_time: '20:00',
        occurs_on: ['saturday', 'sunday'],
        color: '#38bdf8'
    });

    assert.ok(created);
    assert.equal(created.name, 'Test Event 1');
    assert.equal(created.color, '#38bdf8');

    const fetched = db.getEvent(created.id);
    assert.ok(fetched);
    assert.equal(fetched.color, '#38bdf8');

    // Update event color to emerald
    const updated = await db.updateEvent(created.id, { color: '#10b981' });
    assert.ok(updated);
    assert.equal(updated.color, '#10b981');
    assert.equal(db.getEvent(created.id).color, '#10b981');

    // Clean up
    await db.deleteEvent(created.id);
});

test('Event color: Event rows and Boss rows isolation contract (No color bleeding on substring names)', () => {
    const alertsSrc = fs.readFileSync(path.join(__dirname, '../public/js/realtime-alerts.js'), 'utf8');
    const serverSrc = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
    const gasSrc = fs.readFileSync(path.join(__dirname, '../google_apps_script/Code.gs'), 'utf8');

    // 1. isRowEvent and strict separation exist in realtime-alerts.js
    assert.ok(alertsSrc.includes('isRowEvent'));
    assert.ok(alertsSrc.includes('eventRows'));
    assert.ok(alertsSrc.includes('applyRowEventColor'));
    assert.ok(alertsSrc.includes('reconcileEventRows'));
    assert.ok(alertsSrc.includes('attachEventColorPickerToDialog'));
    assert.ok(alertsSrc.includes('data-event-custom-color'));

    // 2. Server PUT /events/:id/color endpoint exists and requires admin
    assert.ok(serverSrc.includes("app.put('/events/:id/color', requireAdmin"));

    // 3. Google Sheets mirror maintains Event Color column
    assert.ok(gasSrc.includes("ev.color || ''"));
    assert.ok(gasSrc.includes("color: erow[9] ? String(erow[9]).trim() : null"));
});


