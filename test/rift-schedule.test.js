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
    // Owner: a run nobody marks counts as Not spawned, so later runs are 6 h start to start.
    const rift = maluk({ open_at: iso(at('10:00')) });
    const first = at('17:01');
    const later = riftState(rift, first + 10 * 360 * 60 * 1000 + 30 * 60 * 1000);
    assert.equal(later.phase, 'OPEN');
    assert.equal(later.startAt, first + 10 * 360 * 60 * 1000);
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

test('entering a time clears Spawned; editing durations keeps it', () => {
    const confirmed = confirmRun(normalizeRift({ open_at: iso(at('10:00')) }), at('10:20'));
    assert.equal(normalizeRift({ run_min: 50 }, confirmed).confirmed, true);
    assert.equal(normalizeRift({ open_at: iso(at('18:00')) }, confirmed).confirmed, undefined);
    assert.equal(skipRun(confirmed, at('10:30')).confirmed, undefined);
});

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

// ---------- No press = Not spawned (owner's rule) ----------
const { projectRift } = require('../public/js/rift-schedule');

test('a run nobody marked counts as Not spawned: the next start is 6 h after its start', () => {
    const rift = normalizeRift({ open_at: iso(at('22:31')) });
    assert.equal(riftState(rift, at('23:40')).startAt, at('05:32', '28'), 'the entered run spawned: 6 h after its close');
    assert.equal(riftState(rift, at('07:00', '28')).startAt, at('11:32', '28'));
    assert.equal(riftState(rift, at('12:40', '28')).startAt, at('17:32', '28'));
});

test('a run nobody marked keeps its phases but is never pinned: NOW only in the lobby five minutes', () => {
    const rift = normalizeRift({ open_at: iso(at('10:00')) });
    assert.equal(riftState(rift, at('16:58')).phase, 'LOBBY');
    assert.equal(riftState(rift, at('17:30')).phase, 'OPEN');
    assert.equal(riftState(rift, at('18:01') + 30 * 1000).phase, 'CLOSING');
    const boss = { id: 1, kind: 'rift', name: 'Maluk', rift };
    assert.equal(projectRift(boss, at('16:58')).next_spawn, iso(at('16:56')));
    const open = projectRift(boss, at('17:30'));
    assert.equal(open.pinned_alive, false);
    assert.equal(open.next_spawn, iso(at('22:56')), 'shows the next run once the lobby NOW is over');
    const after = riftState(rift, at('18:03'));
    assert.equal(after.phase, 'CLOSED');
    assert.equal(after.startAt, at('23:01'));
});

test('Spawned on a run nobody marked: pinned until its close, next start 6 h after the close', () => {
    const rift = normalizeRift({ open_at: iso(at('10:00')) });
    const confirmed = confirmRun(rift, at('17:30'));
    assert.equal(confirmed.open_at, iso(at('17:01')));
    assert.equal(confirmed.confirmed, true);
    const pinned = projectRift({ id: 1, kind: 'rift', name: 'Maluk', rift: confirmed }, at('17:30'));
    assert.equal(pinned.pinned_alive, true);
    assert.equal(pinned.rift_close_at, iso(at('18:02')), 'the dashboard counts down to this close');
    assert.equal(riftState(confirmed, at('18:10')).startAt, at('00:02', '28'));
    // Pressed after that run closed, before the next lobby: still that run.
    assert.equal(confirmRun(rift, at('20:00')).open_at, iso(at('17:01')));
});

test('Not spawned on a run nobody marked ends its NOW at once; the next start is unchanged', () => {
    const rift = normalizeRift({ open_at: iso(at('10:00')) });
    const skipped = skipRun(rift, at('17:30'));
    assert.equal(skipped.close_at, iso(at('17:01')));
    const state = riftState(skipped, at('17:30'));
    assert.equal(state.phase, 'CLOSED');
    assert.equal(state.startAt, at('23:01'));
});

test('a cooldown shorter than one run never lets two runs overlap', () => {
    const rift = { ...normalizeRift({ open_at: iso(at('10:00')) }), cooldown_min: 30 };
    const first = riftState(rift, at('11:02'));
    const second = riftState(rift, first.closeAt + 1000);
    assert.ok(second.lobbyAt >= first.closeAt);
});
