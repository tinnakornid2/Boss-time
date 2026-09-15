const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../server/firebase');

test('Firebase errors are classified without exposing raw credentials or messages', () => {
    assert.equal(_test.classifyFirebaseError({ code: 'resource-exhausted' }), 'quota_exceeded');
    assert.equal(_test.classifyFirebaseError({ code: 'database/limit-exceeded' }), 'quota_exceeded');
    assert.equal(_test.classifyFirebaseError(new Error('429 quota limit exceeded')), 'quota_exceeded');
    assert.equal(_test.classifyFirebaseError({ code: 'PERMISSION_DENIED' }), 'permission_denied');
    assert.equal(_test.classifyFirebaseError(new Error('socket timeout')), 'unavailable');
    assert.equal(_test.classifyFirebaseError(new Error('invalid private key')), 'configuration_error');
    assert.equal(_test.classifyFirebaseError(new Error('unknown failure')), 'firebase_error');
});
