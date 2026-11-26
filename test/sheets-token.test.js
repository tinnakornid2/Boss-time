// The Google Sheets web-app token must never live in this public repository.
// Code.gs reads it from Script Properties (SHEETS_SECRET_TOKEN), the server from its saved
// settings or GOOGLE_SCRIPT_SECRET_TOKEN, and nothing falls back to a built-in value.
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Test-only PIN for the PIN-protected Sheets settings routes (read when the routes load).
const TEST_PIN = 'test-pin-4821';
const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
process.env.GOOGLE_SHEETS_PIN_HASH = `scrypt$${salt}$${crypto.scryptSync(TEST_PIN, salt, 64).toString('hex')}`;
delete process.env.GOOGLE_SCRIPT_SECRET_TOKEN;

require('./helpers/isolated-data');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const OLD_PUBLIC_TOKEN = ['boss', 'parallel', 'secret', '777999'].join('-');

// ---------- Code.gs ----------

function loadCodeGs(properties) {
    const source = fs.readFileSync(path.join(root, 'google_apps_script/Code.gs'), 'utf8');
    const sheet = { getName: () => 'Test Sheet', getSheetByName: () => null };
    const context = {
        PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in properties ? properties[k] : null) }) },
        SpreadsheetApp: { getActiveSpreadsheet: () => sheet },
        ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ setMimeType: () => ({ body: JSON.parse(text) }) }) },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        Utilities: {}, UrlFetchApp: {}, console
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context;
}

const get = (gs, params) => gs.doGet({ parameter: params }).body;
const post = (gs, payload) => gs.doPost({ postData: { contents: JSON.stringify(payload) }, parameter: {} }).body;
const GOOD = 'n3w-T0ken-for-tests-only-9f2c7a';

test('Code.gs holds no token and no longer accepts the old public one', () => {
    const source = fs.readFileSync(path.join(root, 'google_apps_script/Code.gs'), 'utf8');
    assert.doesNotMatch(source, /777999/);
    assert.match(source, /getProperty\('SHEETS_SECRET_TOKEN'\)/);
    const gs = loadCodeGs({ SHEETS_SECRET_TOKEN: GOOD });
    assert.equal(get(gs, { action: 'get_store', token: OLD_PUBLIC_TOKEN }).success, false);
    assert.equal(post(gs, { action: 'sync_full', token: OLD_PUBLIC_TOKEN }).success, false);
});

test('Code.gs fails closed while SHEETS_SECRET_TOKEN is missing or too short', () => {
    for (const props of [{}, { SHEETS_SECRET_TOKEN: '' }, { SHEETS_SECRET_TOKEN: 'short' }]) {
        const gs = loadCodeGs(props);
        assert.equal(get(gs, { action: 'get_store', token: '' }).success, false, JSON.stringify(props));
        assert.equal(get(gs, { action: 'get_store', token: props.SHEETS_SECRET_TOKEN || '' }).success, false);
        assert.equal(post(gs, { action: 'sync_full', token: '' }).success, false);
        const ping = get(gs, { action: 'ping', token: '' });
        assert.equal(ping.tokenVerified, false);
        assert.equal(ping.tokenConfigured, false);
    }
});

test('Code.gs ping tells the server whether the token matches, without leaking the sheet name', () => {
    const gs = loadCodeGs({ SHEETS_SECRET_TOKEN: GOOD });
    const wrong = get(gs, { action: 'ping', token: 'wrong-token-wrong-token' });
    assert.equal(wrong.success, true);
    assert.equal(wrong.tokenVerified, false);
    assert.equal(wrong.spreadsheetName, undefined);
    const right = get(gs, { action: 'ping', token: GOOD });
    assert.equal(right.tokenVerified, true);
    assert.equal(right.tokenConfigured, true);
    assert.equal(right.spreadsheetName, 'Test Sheet');
    assert.notEqual(get(gs, { action: 'get_store', token: GOOD }).message, 'Unauthorized: Invalid token');
});

// ---------- server ----------

const googleSheets = require('../server/google-sheets');

test('the server has no built-in token', () => {
    assert.equal(googleSheets.getConfig({}).secretToken, '');
    assert.equal(googleSheets.getConfig({ googleSheets: { secretToken: GOOD } }).secretToken, GOOD);
    assert.equal(googleSheets.getStatus({}).tokenSet, false);
    assert.equal(googleSheets.getStatus({ googleSheets: { secretToken: GOOD } }).tokenSet, true);
    for (const file of ['server/google-sheets.js', 'server/google-sheets-config.example.json', 'server/server.js', 'google_apps_script/README.md']) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /777999/, file);
    }
});

async function withFakeScript(respond, fn) {
    const seen = [];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        seen.push(url.searchParams.get('token'));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(respond(url.searchParams.get('token'))));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    try {
        await fn(`http://127.0.0.1:${server.address().port}/exec`, seen);
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
    }
}

test('Test connection fails when Apps Script does not verify the token', async () => {
    await withFakeScript(token => ({ success: true, tokenVerified: token === GOOD, tokenConfigured: true }), async (url) => {
        const bad = await googleSheets.testConnection(url, 'wrong-token-wrong-token');
        assert.equal(bad.success, false);
        const good = await googleSheets.testConnection(url, GOOD);
        assert.equal(good.success, true);
    });
});

test('Test connection with an empty token field uses the saved token', async () => {
    await withFakeScript(token => ({ success: true, tokenVerified: token === GOOD, tokenConfigured: true }), async (url, seen) => {
        const res = await googleSheets.testConnection(url, '', { googleSheets: { webAppUrl: url, secretToken: GOOD } });
        assert.equal(res.success, true);
        assert.equal(seen.at(-1), GOOD);
    });
});

// ---------- settings route and UI ----------

const app = require('../server/server');
const db = require('../server/db');

async function withServer(fn) {
    const server = app.listen(0);
    try {
        await fn(`http://127.0.0.1:${server.address().port}`);
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
    }
}
const save = (base, body) => fetch(`${base}/api/settings/google-sheets`, {
    method: 'POST',
    headers: { Cookie: `boss_session=${app.createSession('admin')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ pin: TEST_PIN, ...body })
});

test('saving Sheets settings with an empty token keeps the saved token, and the token is never sent back', async () => {
    await withServer(async (base) => {
        assert.equal((await save(base, { webAppUrl: 'https://script.google.com/macros/s/x/exec', secretToken: GOOD, enabled: false })).status, 200);
        assert.equal(db.getSettings().googleSheets.secretToken, GOOD);
        const res = await save(base, { webAppUrl: 'https://script.google.com/macros/s/x/exec', secretToken: '', enabled: false });
        assert.equal(res.status, 200);
        assert.equal(db.getSettings().googleSheets.secretToken, GOOD, 'blank field = keep');
        const text = await (await fetch(`${base}/api/settings/google-sheets`, { headers: { Cookie: `boss_session=${app.createSession('admin')}`, Accept: 'application/json' } })).text();
        assert.ok(!text.includes(GOOD), 'status never returns the token');
        assert.equal((await save(base, { secretToken: 'short' })).status, 400, 'too short to be a real secret');
    });
});

test('the Sheets settings form is not prefilled with a token and can generate a new one', () => {
    const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
    const input = server.match(/<input[^>]*id="sheets-input-token"[^>]*>/)[0];
    assert.doesNotMatch(input, /value="[^"]+"/);
    assert.match(server, /id="btn-generate-sheets-token"/);
    assert.match(server, /crypto\.getRandomValues/);
    assert.match(server, /if \(secretToken\) body\.secretToken = secretToken;/);
});
