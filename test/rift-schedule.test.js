const test = require('node:test');
const assert = require('node:assert/strict');
const { riftState, normalizeRift, DEFAULTS } = require('../public/js/rift-schedule');

const at = (hhmm, day = '27') => Date.parse(`2026-11-${day}T${hhmm}:00+07:00`);
const iso = (ms) => new Date(ms).toISOString();
const maluk = (times) => ({ ...DEFAULTS, ...times });

test('defaults follow the Korean rift timing: 5 lobby, 60 run, 1 closing, 6 h cooldown', () => {
    assert.deepEqual({ ...DEFAULTS }, { lobby_min: 5, run_min: 60, closing_min: 1, cooldown_min: 360 });
});

test('a rift with no open or close time is Unset', () => {
    assert.equal(riftState(maluk({}), at('10:00')), null);
});

test('open time 10:00 gives lobby 09:55, open until 11:00, closing until 11:01', () => {
    const rift = maluk({ open_at: iso(at('10:00')) });
    assert.equal(riftState(rift, at('09:50')).phase, 'CLOSED');
    assert.equal(riftState(rift, at('09:57')).phase, 'LOBBY');
    assert.equal(riftState(rift, at('10:30')).phase, 'OPEN');
    const closing = riftState(rift, at('11:00') + 30 * 1000);
    assert.equal(closing.phase, 'CLOSING');
    assert.equal(closing.closeAt, at('11:01'));
});

test('the next run starts six hours after the close, with its lobby five minutes before', () => {
    const next = riftState(maluk({ open_at: iso(at('10:00')) }), at('11:01'));
    assert.equal(next.phase, 'CLOSED');
    assert.equal(next.lobbyAt, at('16:56'));
    assert.equal(next.startAt, at('17:01'));
    assert.equal(next.closeAt, at('18:02'));
});

test('an entered close time drives the next run', () => {
    const next = riftState(maluk({ close_at: iso(at('10:50')) }), at('11:00'));
    assert.equal(next.startAt, at('16:50'));
    assert.equal(next.lobbyAt, at('16:45'));
});

test('the actual close wins over the open time when both are stored', () => {
    const next = riftState(maluk({ open_at: iso(at('10:00')), close_at: iso(at('10:50')) }), at('12:00'));
    assert.equal(next.startAt, at('16:50'));
});

test('runs keep cycling by themselves across days and after the app was closed', () => {
    const rift = maluk({ open_at: iso(at('10:00')) });
    const cycle = 421 * 60 * 1000;
    const later = riftState(rift, at('10:00') + 10 * cycle + 30 * 60 * 1000);
    assert.equal(later.phase, 'OPEN');
    assert.equal(later.startAt, at('10:00') + 10 * cycle);
    assert.equal(riftState(rift, at('10:00', '30')).startAt % 60000, 0);
});

test('a future open time counts down to its own lobby first', () => {
    const state = riftState(maluk({ open_at: iso(at('20:00')) }), at('12:00'));
    assert.equal(state.phase, 'CLOSED');
    assert.equal(state.lobbyAt, at('19:55'));
});

test('changed durations apply from the same anchor', () => {
    const next = riftState({ ...maluk({ open_at: iso(at('10:00')) }), run_min: 56 }, at('11:00'));
    assert.equal(next.startAt, at('16:57'));
});

test('normalizeRift fills defaults, stores ISO times and rejects bad input', () => {
    const out = normalizeRift({ open_at: '2026-11-27T10:00:00+07:00' });
    assert.deepEqual(out, { ...DEFAULTS, open_at: iso(at('10:00')), close_at: null });
    assert.throws(() => normalizeRift({ run_min: 0 }), /run_min/);
    assert.throws(() => normalizeRift({ cooldown_min: 1.5 }), /cooldown_min/);
    assert.throws(() => normalizeRift({ open_at: 'not a time' }), /open_at/);
    assert.throws(() => normalizeRift({ open_at: iso(at('10:00')), close_at: iso(at('09:00')) }), /close_at/);
});

test('entering one time replaces the old anchor instead of mixing two runs', () => {
    const previous = normalizeRift({ open_at: iso(at('10:00')) });
    const out = normalizeRift({ close_at: iso(at('17:40')) }, previous);
    assert.equal(out.open_at, null);
    assert.equal(out.close_at, iso(at('17:40')));
    const kept = normalizeRift({ run_min: 56 }, previous);
    assert.equal(kept.open_at, iso(at('10:00')));
    assert.equal(kept.run_min, 56);
});
