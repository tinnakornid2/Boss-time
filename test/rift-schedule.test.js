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

// ---------- Not spawned (the 50% rift did not appear) ----------
const { skipRun } = require('../public/js/rift-schedule');

test('Not spawned during the run: the next start is 6 h after the missed start, without the hour of play', () => {
    const rift = normalizeRift({ open_at: iso(at('10:00')) });
    const skipped = skipRun(rift, at('10:20'));
    assert.equal(skipped.close_at, iso(at('10:00')));
    assert.equal(skipped.open_at, null);
    assert.equal(skipped.skip, true);
    const next = riftState(skipped, at('10:21'));
    assert.equal(next.phase, 'CLOSED');
    assert.equal(next.startAt, at('16:00'));
    assert.equal(next.lobbyAt, at('15:55'));
});

test('Not spawned during the lobby skips that run, never inventing an earlier one', () => {
    const skipped = skipRun(normalizeRift({ open_at: iso(at('10:00')) }), at('09:57'));
    const state = riftState(skipped, at('09:58'));
    assert.equal(state.phase, 'CLOSED');
    assert.equal(state.startAt, at('16:00'));
});

test('Not spawned after the run closed (pressed late) skips the run that just showed NOW', () => {
    const skipped = skipRun(normalizeRift({ open_at: iso(at('10:00')) }), at('12:00'));
    assert.equal(riftState(skipped, at('12:00')).startAt, at('16:00'));
});

test('pressed later than the would-be next start, that run is already in progress', () => {
    const skipped = skipRun(normalizeRift({ open_at: iso(at('10:00')) }), at('16:10'));
    // Before the normal next lobby (16:56), so the 10:00 run is the one marked; its skip start 16:00 has passed.
    const state = riftState(skipped, at('16:10'));
    assert.equal(state.phase, 'OPEN');
    assert.equal(state.startAt, at('16:00'));
});

test('Not spawned twice in a row keeps adding 6 h per missed run', () => {
    const once = skipRun(normalizeRift({ open_at: iso(at('10:00')) }), at('10:20'));
    const twice = skipRun(once, at('16:10'));
    assert.equal(riftState(twice, at('16:11')).startAt, at('22:00'));
});

test('a second press right after a skip has nothing to skip', () => {
    const once = skipRun(normalizeRift({ open_at: iso(at('10:00')) }), at('10:20'));
    assert.equal(skipRun(once, at('10:30')), null);
    assert.equal(skipRun(normalizeRift({}), at('10:30')), null, 'Unset rift');
});

test('editing durations keeps the skip; entering a time clears it', () => {
    const once = skipRun(normalizeRift({ open_at: iso(at('10:00')) }), at('10:20'));
    assert.equal(normalizeRift({ run_min: 50 }, once).skip, true);
    assert.equal(normalizeRift({ open_at: iso(at('18:00')) }, once).skip, undefined);
});

const { confirmRun } = require('../public/js/rift-schedule');

test('Spawned anchors the open time to the run in progress (normal hour of play, 6 h after close)', () => {
    const skipped = skipRun(normalizeRift({ open_at: iso(at('10:00')) }), at('10:20'));
    const confirmed = confirmRun(skipped, at('16:10'));
    assert.equal(confirmed.open_at, iso(at('16:00')));
    assert.equal(confirmed.close_at, null);
    assert.equal(confirmed.skip, undefined);
    assert.equal(riftState(confirmed, at('17:02')).startAt, at('23:01'));
    assert.equal(confirmRun(normalizeRift({}), at('10:00')), null);
});

test('Spawned right after a mistaken Not spawned restores the normal timeline', () => {
    const skipped = skipRun(normalizeRift({ open_at: iso(at('10:00')) }), at('10:20'));
    const undone = confirmRun(skipped, at('10:21'));
    assert.equal(undone.open_at, iso(at('10:00')));
    assert.equal(riftState(undone, at('10:21')).phase, 'OPEN');
});
