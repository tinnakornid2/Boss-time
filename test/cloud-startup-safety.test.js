const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const firebaseSource = fs.readFileSync('server/firebase.js', 'utf8');
const dbSource = fs.readFileSync('server/db.js', 'utf8');

function isolatedSeed(existingRoot) {
    const source = firebaseSource.match(/async function seedFullStoreIfEmpty\(store\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(source);
    let root = existingRoot;
    let writes = 0;
    const dbRef = {
        async transaction(transform) {
            const next = transform(root);
            if (next !== undefined) { root = next; writes++; }
            return { committed: next !== undefined, snapshot: { val: () => root } };
        }
    };
    const context = {
        dbRef, isReady: () => true, Date, Number,
        encodeFirebaseKeys: value => value,
        decodeFirebaseKeys: value => value,
        recordFirebaseSuccess() {}, recordFirebaseError() {}
    };
    const seed = vm.runInNewContext(`${source}; seedFullStoreIfEmpty`, context);
    return { seed, getRoot: () => root, getWrites: () => writes };
}

test('Initial seed never replaces a populated or partially populated Firebase root', async () => {
    for (const existing of [
        { bosses: [{ id: 7 }], settings: { serverName: 'Current' } },
        { settings: { serverName: 'Partial but owned' } },
        { bosses: [], settings: { serverName: 'Intentionally empty' } }
    ]) {
        const fixture = isolatedSeed(existing);
        const result = await fixture.seed({ bosses: [{ id: 1 }], settings: { serverName: 'Bundled' } });
        assert.equal(result.seeded, false);
        assert.equal(fixture.getWrites(), 0);
        assert.deepEqual(fixture.getRoot(), existing);
    }
});

test('Only a confirmed null Firebase root is seeded once', async () => {
    const fixture = isolatedSeed(null);
    const bundled = { bosses: [{ id: 1 }], settings: { serverName: 'Initial' } };
    const first = await fixture.seed(bundled);
    assert.equal(first.seeded, true);
    assert.equal(fixture.getWrites(), 1);
    assert.equal(fixture.getRoot().meta.dataRevision, 1);
    const second = await fixture.seed({ bosses: [{ id: 2 }] });
    assert.equal(second.seeded, false);
    assert.equal(fixture.getWrites(), 1);
});

test('Read errors cannot trigger initial seeding or open the cold-start gate', () => {
    assert.match(firebaseSource, /async function fetchOnce\(\)[\s\S]*?catch \(e\) \{\s*recordFirebaseError\('fetchOnce', e\);\s*throw e;/);
    assert.match(dbSource, /if \(remoteStore === null\) \{[\s\S]*?seedFullStoreIfEmpty\(cache\)/);
    assert.match(dbSource, /catch \(_\) \{\s*\/\/ Read failure is not an empty database\. Keep the cold-start gate closed\./);
    assert.doesNotMatch(dbSource, /firebase\.syncFullStore\(cache\)/);
});
