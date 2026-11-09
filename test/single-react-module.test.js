const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The entry script, its modulepreload, and the dashboard chunk's import must use the exact
// same URL. A different query string (such as ?v=) makes the browser load React twice, and
// the dashboard then fails with React error #308 (seen on the iPhone Home Screen app).
test('dashboard entry, preload, and chunk import share one React module URL', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
    const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'build', 'assets', 'dashboard-B9CVP--8.js'), 'utf8');
    const entry = server.match(/<script type="module" src="([^"]+)"/)?.[1];
    const preload = server.match(/<link rel="modulepreload" as="script" href="([^"]+)"/)?.[1];
    const imported = dashboard.match(/from["']\.\/(app-[^"']+\.js)["']/)?.[1];
    assert.ok(entry && preload && imported);
    assert.equal(entry, preload);
    assert.equal(entry, `/build/assets/${imported}`);
});
