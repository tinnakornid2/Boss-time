const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Dashboard page shows an error notice with Reload instead of a blank screen when React does not render', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

    assert.ok(source.includes("box.id = 'blank-dashboard-guard'"));
    // Captures script errors, failed loads and rejected imports, then checks #app after 8 seconds
    assert.ok(source.includes("window.addEventListener('unhandledrejection'"));
    assert.ok(source.includes("app.children.length > 0 || document.getElementById('blank-dashboard-guard')"));
    assert.ok(source.includes('}, 8000);'));
    assert.ok(source.includes('btn.onclick = function() { location.reload(); };'));
    // The guard runs before the dashboard bundle is loaded, so it sees its errors
    assert.ok(source.indexOf("box.id = 'blank-dashboard-guard'") < source.indexOf('<script type="module" src="/build/assets/app-'));
});
