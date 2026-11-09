require('./helpers/isolated-data');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const firebase = require('../server/firebase');
const db = require('../server/db');

test('settings writes touch only the changed keys, never the whole settings object', () => {
    assert.deepEqual(firebase.settingsUpdatePayload({ announcement: null, hideInvasionBosses: true }), {
        'settings/announcement': null,
        'settings/hideInvasionBosses': true
    });
    assert.deepEqual(firebase.settingsUpdatePayload({ 'bad/key': 1, 'a.b': 2 }), {});
    const dbSource = fs.readFileSync(path.join(__dirname, '../server/db.js'), 'utf8');
    assert.match(dbSource, /await firebase\.syncSettingsUpdates\(updates\)/);
    assert.doesNotMatch(dbSource, /firebase\.syncSettings\(store\.settings\)/);
});

test('a cold instance without the cloud snapshot refuses to write settings (passwords stay untouched)', async () => {
    const original = {
        isReady: firebase.isReady,
        fetchOnce: firebase.fetchOnce,
        syncSettingsUpdates: firebase.syncSettingsUpdates
    };
    const writes = [];
    firebase.isReady = () => true;
    firebase.fetchOnce = async () => { throw new Error('network blip'); };
    firebase.syncSettingsUpdates = async (updates) => { writes.push(updates); return true; };
    const before = JSON.stringify(db.getSettings());
    try {
        await assert.rejects(db.updateSettings({ announcement: { text: 'hello' } }), (error) => error.code === 'CLOUD_NOT_READY');
        assert.equal(writes.length, 0, 'nothing reached Firebase');
        assert.equal(JSON.stringify(db.getSettings()), before, 'cached settings unchanged');
    } finally {
        Object.assign(firebase, original);
    }
});

test('local mode (no Firebase) still saves settings', async () => {
    assert.equal(firebase.isReady(), false);
    const settings = await db.updateSettings({ invasionLabel: 'L3-test' });
    assert.equal(settings.invasionLabel, 'L3-test');
});

test('Vercel cold start: writes are refused and login does not check bundled passwords', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
    assert.match(server, /if \(!db\.isCloudDataReady\(\) && isCloudWriteRequest\(req\)\) \{[\s\S]*?status\(503\)/);
    assert.match(server, /const cloudNotReady = Boolean\(process\.env\.VERCEL\) && !db\.isCloudDataReady\(\);/);
    assert.match(server, /const isAdminPass = !cloudNotReady && verifyPassword/);
    assert.match(server, /const isMemberPass = !cloudNotReady && verifyPassword/);
    assert.match(server, /const tempPasswords = cloudNotReady \? \[\] :/);
});
