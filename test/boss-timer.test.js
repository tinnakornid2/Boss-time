const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../server/db');

const minute = 60 * 1000;

test('unset boss never advances', () => {
    assert.equal(_test.calculateBossAutoAdvance({ next_spawn: null, interval: 60 }, Date.now()), null);
});

test('NOW remains for exactly one minute', () => {
    const spawn = Date.parse('2026-09-14T00:00:00.000Z');
    const boss = { next_spawn: new Date(spawn).toISOString(), interval: 60, pinned_alive: false };
    assert.equal(_test.calculateBossAutoAdvance(boss, spawn + minute - 1), null);
    const result = _test.calculateBossAutoAdvance(boss, spawn + minute);
    assert.equal(result.last_kill_time, new Date(spawn).toISOString());
    assert.equal(result.next_spawn, new Date(spawn + 60 * minute).toISOString());
});

test('Still alive remains NOW indefinitely', () => {
    const spawn = Date.parse('2026-09-14T00:00:00.000Z');
    const boss = { next_spawn: new Date(spawn).toISOString(), interval: 60, pinned_alive: true };
    assert.equal(_test.calculateBossAutoAdvance(boss, spawn + 24 * 60 * minute), null);
});

test('closed app catches up to the latest completed cycle', () => {
    const spawn = Date.parse('2026-09-14T00:00:00.000Z');
    const boss = { next_spawn: new Date(spawn).toISOString(), interval: 60, pinned_alive: false };
    const result = _test.calculateBossAutoAdvance(boss, spawn + 125 * minute);
    assert.equal(result.last_kill_time, new Date(spawn + 120 * minute).toISOString());
    assert.equal(result.next_spawn, new Date(spawn + 180 * minute).toISOString());
});
