const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMaintenanceEndTime } = require('../server/maintenance-time');
const { _test } = require('../server/db');

test('time-only server opening uses Thailand date and timezone', () => {
    const opening = parseMaintenanceEndTime('09:00', new Date('2026-10-06T18:00:00Z'));
    assert.equal(opening.date.toISOString(), '2026-10-07T02:00:00.000Z'); // 09:00 Thailand
    assert.equal(opening.timeLabel, '09:00');
    // Delay 0h: spawns immediately at opening
    assert.equal(new Date(opening.date.getTime() + 0).toISOString(), opening.date.toISOString());
    // Delay 10h: first spawn at 19:00 Thailand (12:00 UTC)
    const andrasFirstSpawn = new Date(opening.date.getTime() + 10 * 3600000);
    assert.equal(andrasFirstSpawn.toISOString(), '2026-10-07T12:00:00.000Z');
    // After 19:00 (5 min NOW), advances by regular 12-hour interval -> 07:00 Thailand next day (00:00 UTC)
    const andrasNextCycle = _test.calculateBossAutoAdvance(
        { next_spawn: andrasFirstSpawn.toISOString(), interval: 12 * 60 },
        andrasFirstSpawn.getTime() + 5 * 60000
    );
    assert.equal(andrasNextCycle.next_spawn, '2026-10-08T00:00:00.000Z');
});

test('dated opening is Bangkok local unless it includes an explicit offset', () => {
    assert.equal(parseMaintenanceEndTime('2026-10-07T09:00').date.toISOString(), '2026-10-07T02:00:00.000Z');
    assert.equal(parseMaintenanceEndTime('2026-10-07T09:00+07:00').date.toISOString(), '2026-10-07T02:00:00.000Z');
    assert.equal(parseMaintenanceEndTime('2026-10-07T02:00Z').date.toISOString(), '2026-10-07T02:00:00.000Z');
});

test('first spawn delay crosses midnight, then normal boss interval takes over', () => {
    const opening = parseMaintenanceEndTime('20:00', new Date('2026-10-07T10:00:00Z')).date;
    const firstSpawn = new Date(opening.getTime() + 10 * 3600000);
    assert.equal(firstSpawn.toISOString(), '2026-10-07T23:00:00.000Z'); // 06:00 Thailand next day
    const boss = { next_spawn: firstSpawn.toISOString(), interval: 12 * 60 };
    assert.equal(_test.calculateBossAutoAdvance(boss, firstSpawn.getTime() + 5 * 60000).next_spawn,
        '2026-10-08T11:00:00.000Z'); // 18:00 Thailand
});

test('invalid maintenance time is rejected before any reset', () => {
    for (const input of ['25:00', '09:60', '2026-02-30T09:00', 'not a time']) {
        assert.equal(parseMaintenanceEndTime(input), null);
    }
});
