require('./helpers/isolated-data');
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/server');

async function withServer(fn) {
    const server = app.listen(0);
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

function memberCookie() {
    return `boss_session=${app.createSession('member')}`;
}

test('push device routes require a logged-in session', async () => {
    await withServer(async (base) => {
        assert.equal((await fetch(`${base}/api/v1/push/config`, { headers: { Accept: 'application/json' } })).status, 401);
        const post = await fetch(`${base}/api/v1/push/subscription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ subscription: {} })
        });
        assert.equal(post.status, 401);
    });
});

test('a member can read the push config; without VAPID keys it reports disabled', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/v1/push/config`, { headers: { Cookie: memberCookie(), Accept: 'application/json' } });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.enabled, false);
        assert.equal(data.publicKey, null);
        const sub = await fetch(`${base}/api/v1/push/subscription`, {
            method: 'POST',
            headers: { Cookie: memberCookie(), 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ subscription: {} })
        });
        assert.equal(sub.status, 503);
    });
});

test('the minute trigger is refused without the configured secret', async () => {
    const original = process.env.PUSH_TICK_SECRET;
    await withServer(async (base) => {
        delete process.env.PUSH_TICK_SECRET;
        assert.equal((await fetch(`${base}/api/push/tick`, { method: 'POST' })).status, 503);
        process.env.PUSH_TICK_SECRET = 'correct-secret';
        assert.equal((await fetch(`${base}/api/push/tick`, { method: 'POST' })).status, 401);
        assert.equal((await fetch(`${base}/api/push/tick`, { method: 'POST', headers: { 'x-push-tick-secret': 'wrong' } })).status, 401);
        const ok = await fetch(`${base}/api/push/tick`, { method: 'POST', headers: { 'x-push-tick-secret': 'correct-secret' } });
        assert.equal(ok.status, 200);
        assert.equal((await ok.json()).enabled, false, 'no VAPID keys: nothing is sent');
    });
    if (original === undefined) delete process.env.PUSH_TICK_SECRET; else process.env.PUSH_TICK_SECRET = original;
});

test('members still cannot send the shared admin alert', async () => {
    await withServer(async (base) => {
        const res = await fetch(`${base}/bosses/1/notify`, { method: 'POST', headers: { Cookie: memberCookie(), Accept: 'application/json' } });
        assert.equal(res.status, 403);
    });
});
