const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');
const { _test } = require('../server/db');

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
