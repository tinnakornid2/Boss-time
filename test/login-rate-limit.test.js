const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/server');

test('Login limiter blocks after 10 failed attempts and counts only failures', async () => {
    const server = app.listen(0);
    const { port } = server.address();
    const post = (password) => fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password })
    });
    try {
        for (let i = 0; i < 10; i++) {
            assert.equal((await post(`wrong-${i}`)).status, 401);
        }
        const blocked = await post('wrong-final');
        assert.equal(blocked.status, 429);
        assert.match((await blocked.json()).message, /Too many failed attempts/);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
