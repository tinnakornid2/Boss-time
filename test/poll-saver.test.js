const test = require('node:test');
const assert = require('node:assert');
const { createPollSaver } = require('../public/js/poll-saver.js');
const { pollReply } = require('../server/poll-payload.js');

function setup() {
    const c = { clock: 1000, calls: [], status: 200, payload: { bosses: [{ id: 1, next_spawn: 'a' }], dataRevision: 5, stale: false } };
    c.saver = createPollSaver({
        now: () => c.clock,
        fetchImpl: async url => {
            c.calls.push(url);
            if (c.status !== 200) return new Response('{}', { status: c.status });
            const tag = new URL(url, 'http://x').searchParams.get('v');
            c.lastReply = pollReply(c.payload, tag, c.clock + 50);
            return new Response(JSON.stringify(c.lastReply), { status: 200 });
        }
    });
    c.poll = async () => (await c.saver.poll('/poll', {})).json();
    return c;
}

test('poll: unchanged state is a small reply, expanded for the caller', async () => {
    const c = setup();
    const first = await c.poll();
    c.clock += 5000;
    const second = await c.poll();
    assert.equal(c.lastReply.unchanged, true);
    assert.equal(c.lastReply.bosses, undefined);
    assert.deepEqual(second, { ...first, serverTime: c.clock + 50 });
});

test('poll: changed state is sent in full even when the revision is equal', async () => {
    const c = setup();
    await c.poll();
    c.clock += 5000;
    c.payload = { ...c.payload, bosses: [{ id: 1, next_spawn: 'b' }] };
    assert.equal((await c.poll()).bosses[0].next_spawn, 'b');
});

test('poll: dashboard and HUD share requests, with a live server clock', async () => {
    const c = setup();
    await Promise.all([c.poll(), c.poll()]);
    c.clock += 2000;
    assert.equal((await c.poll()).serverTime, c.clock + 50);
    assert.equal(c.calls.length, 1);
    c.clock += 2500;
    await c.poll();
    assert.equal(c.calls.length, 2);
    c.clock -= 3600000;
    await c.poll();
    assert.equal(c.calls.length, 3);
});

test('poll: a local change forces the next poll to the server, also with one in flight', async () => {
    const c = setup();
    await c.poll();
    c.saver.invalidate();
    await c.poll();
    assert.equal(c.calls.length, 2);
    c.clock += 5000;
    const pending = c.poll();
    c.saver.invalidate();
    await pending;
    await c.poll();
    assert.equal(c.calls.length, 4);
});

test('poll: errors pass through and are never cached', async () => {
    const c = setup();
    await c.poll();
    c.clock += 5000;
    c.status = 401;
    assert.equal((await c.saver.poll('/poll', {})).status, 401);
    c.status = 200;
    await c.poll();
    assert.equal(c.calls.length, 3);
});

test('poll: an older snapshot never replaces a newer one', async () => {
    const c = setup();
    const newer = c.payload;
    await c.poll();
    c.saver.invalidate();
    c.payload = { bosses: [], dataRevision: 4, stale: false };
    await c.poll();
    c.payload = newer;
    assert.equal((await c.poll()).bosses.length, 1);
    assert.equal(c.lastReply.unchanged, true);
});

test('poll: only plain /poll is handled', () => {
    const { saver } = setup();
    assert.ok(saver.isPoll('/poll') && saver.isPoll('https://x.y/poll'));
    assert.ok(!saver.isPoll('/live-event') && !saver.isPoll('/poll?x=1'));
});

test('poll: the real store gives the same tag one second later', async () => {
    const db = require('../server/db');
    const build = () => ({
        bosses: db.getBosses(), events: db.getEvents(), allEvents: db.getAllEvents(),
        resetTimeConfigs: db.getResetConfigs(), dataRevision: db.getDataRevision()
    });
    const first = pollReply(build(), null, 1);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(pollReply(build(), first.pollTag, 2).unchanged, true);
    console.log('payload bytes', JSON.stringify(first).length, 'unchanged', JSON.stringify(pollReply(build(), first.pollTag, 2)).length);
});

test('poll: a server failure is shared too, so an outage does not raise traffic', async () => {
    const c = setup();
    await c.poll();
    c.status = 503;
    const start = c.calls.length;
    // One minute of the desktop app: the dashboard every 3 s, the HUD every 5 s.
    for (let s = 0; s < 120; s++) {
        c.clock += 500;
        if (s % 6 === 0) await c.saver.poll('/poll', {});
        if (s % 10 === 1) await c.saver.poll('/poll', {});
    }
    const sent = c.calls.length - start;
    assert.ok(sent <= 13, `${sent} requests in one minute`);
    c.status = 200;
    c.clock += 5000;
    assert.equal((await c.saver.poll('/poll', {})).status, 200);
});

test('poll: a network failure is shared too, an aborted request is not', async () => {
    let clock = 1000, calls = 0, error = null;
    const saver = createPollSaver({
        now: () => clock,
        fetchImpl: async () => {
            calls++;
            if (error) throw error;
            return new Response(JSON.stringify({ bosses: [], dataRevision: 1, serverTime: clock }));
        }
    });
    await saver.poll('/poll');
    clock += 5000;
    error = new TypeError('offline');
    await assert.rejects(saver.poll('/poll'), /offline/);
    clock += 3000;
    await assert.rejects(saver.poll('/poll'), /offline/);
    assert.equal(calls, 2);
    clock += 2000;
    error = new DOMException('stop', 'AbortError');
    await assert.rejects(saver.poll('/poll'), { name: 'AbortError' });
    error = null;
    assert.equal((await saver.poll('/poll')).status, 200);
    assert.equal(calls, 4);
});

test('poll: sign-out, local changes and the first load are never delayed by a failure', async () => {
    const first = setup();
    first.status = 503;
    await first.saver.poll('/poll');
    await first.saver.poll('/poll');
    assert.equal(first.calls.length, 2, 'no data yet: keep retrying at the caller pace');

    const c = setup();
    await c.poll();
    c.clock += 5000;
    c.status = 401;
    assert.equal((await c.saver.poll('/poll')).status, 401);
    assert.equal((await c.saver.poll('/poll')).status, 401);
    assert.equal(c.calls.length, 3);

    c.status = 503;
    await c.saver.poll('/poll');
    c.saver.invalidate();
    c.status = 200;
    assert.equal((await c.saver.poll('/poll')).status, 200);
});

test('poll: a failure that started before a local change is not remembered', async () => {
    let clock = 1000, calls = 0, release;
    const saver = createPollSaver({
        now: () => clock,
        fetchImpl: async () => {
            calls++;
            if (calls === 2) return new Promise(resolve => { release = () => resolve(new Response('{}', { status: 503 })); });
            return new Response(JSON.stringify({ bosses: [], dataRevision: 1, serverTime: clock }));
        }
    });
    await saver.poll('/poll');
    clock += 5000;
    const old = saver.poll('/poll');
    saver.invalidate();
    release();
    assert.equal((await old).status, 503);
    assert.equal((await saver.poll('/poll')).status, 200);
});
