'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    normalizeResetConfigs,
    getResetConfig
} = require('../server/reset-time-configs');

test('reset configs keep duplicate boss names separate by boss id', () => {
    const configs = normalizeResetConfigs([
        { boss_id: 10, boss_name: 'Behemoth', delay_hours: 2, delay_minutes: 5 },
        { boss_id: 50, boss_name: 'Behemoth', delay_hours: 7, delay_minutes: 30 }
    ]);

    assert.deepEqual(getResetConfig(configs, { id: 10, name: 'Behemoth' }), { hours: 2, minutes: 5 });
    assert.deepEqual(getResetConfig(configs, { id: 50, name: 'Behemoth' }), { hours: 7, minutes: 30 });
});

test('legacy name-keyed reset configs remain supported', () => {
    const configs = { Behemoth: { hours: 4, minutes: 0 } };
    assert.deepEqual(getResetConfig(configs, { id: 10, name: 'Behemoth' }), { hours: 4, minutes: 0 });
});

test('admin reset UI keys rows and submissions by boss id', () => {
    const bundle = fs.readFileSync(
        path.join(__dirname, '../public/build/assets/dashboard-B9CVP--8.js'),
        'utf8'
    );
    assert.match(bundle, /function eM\(t\)\{return`boss_\$\{t\.id\}`\}/);
    assert.match(bundle, /boss_id:resetBossByKey\[me\]\?\.id/);
    assert.match(bundle, /\?"· Invasion":"· Normal"/);
});
