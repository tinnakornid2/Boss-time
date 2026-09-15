const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('realtime alert bridge does not reorder React-managed boss rows', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    assert.doesNotMatch(source, /function\s+pinNowBossRows\s*\(/);
    assert.doesNotMatch(source, /insertBefore\(fragment,\s*body\.firstChild\)/);
});
