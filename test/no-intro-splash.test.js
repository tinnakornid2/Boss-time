const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Dashboard opens directly without the timed intro splash', () => {
    const bundle = fs.readFileSync(path.join(__dirname, '..', 'public', 'build', 'assets', 'dashboard-B9CVP--8.js'), 'utf8');

    // Splash visibility state starts hidden and has no timer that turns it on
    assert.ok(bundle.includes('[re]=M.useState(!1),[ue]=M.useState(!1),[T]=M.useState(0);'));
    assert.equal(bundle.includes('[re,ge]=M.useState(!0)'), false);
    assert.equal(bundle.includes('const P=2500,X=Date.now()'), false);
});
