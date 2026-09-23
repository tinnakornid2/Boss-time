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

test('realtime alert popup stays away from top boss names', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    assert.match(source, /right:10px;bottom:10px;left:auto;top:auto/);
    assert.doesNotMatch(source, /left:50%;top:52px;transform:translateX\(-50%\)/);
    assert.match(source, /setTimeout\(\(\) => toast\.remove\(\), 5000\)/);
});

test('Kill Now captures first-click time and requires a second click before submitting', () => {
    const bundle = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'build', 'assets', 'dashboard-B9CVP--8.js'),
        'utf8'
    );

    assert.match(bundle, /if\(!s\)\{o\.killTime=window\.getTrackerServerNow\?window\.getTrackerServerNow\(\):new Date,r\(!0\).*setTimeout\(\(\)=>\{r\(!1\),o\.killTime=null\},1500\);return\}/);
    assert.match(bundle, /i\(n,o\.killTime\?\?new Date\),o\.killTime=null/);
    assert.match(bundle, /last_kill_time:Aa\(Ee\?\?new Date\)/);
    assert.doesNotMatch(bundle, /a=function\(\)\{i\(n\),r\(!0\)/);
});

test('Kill Now uses the shared server clock offset instead of the device clock', () => {
    const bridge = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    assert.match(bridge, /window\.getTrackerServerNow = function \(\) \{/);
    assert.match(bridge, /new Date\(Date\.now\(\) \+ state\.serverOffset\)/);
    assert.match(bridge, /page\.props\?\.serverTime/);
    assert.match(bridge, /state\.serverOffset = Number\(data\.serverTime\) - Date\.now\(\)/);
});

test('event actions retain genuine two-click confirmation', () => {
    const bundle = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'build', 'assets', 'dashboard-B9CVP--8.js'),
        'utf8'
    );

    assert.match(bundle, /function \$s\(t\).*l\?\(.*a\(\)\):\(u\(!0\).*setTimeout\(\(\)=>u\(!1\),3e3\)\)/);
    assert.match(bundle, /Mark event done \(click 2x\)/);
    assert.match(bundle, /Skip today \(click 2x\)/);
    assert.match(bundle, /Pin still alive \(click 2x\)/);
});

test('status action tooltips describe their real single-click behavior', () => {
    const bundle = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'build', 'assets', 'dashboard-B9CVP--8.js'),
        'utf8'
    );
    const bridge = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );

    for (const label of ['Still alive', 'Spawn in 5 min', 'Spawn in 1 min', 'Not spawned']) {
        assert.match(bundle, new RegExp(`tooltip:\\"${label}\\",confirmedTooltip:\\"Applied\\"`));
        assert.doesNotMatch(bundle, new RegExp(`tooltip:\\"${label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')} \\(click 2x\\)`));
    }
    assert.match(bridge, /tooltip_action_applied: 'ดำเนินการแล้ว'/);
});
