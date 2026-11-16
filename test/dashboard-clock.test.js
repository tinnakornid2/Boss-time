const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bundle = fs.readFileSync(path.join(__dirname, '../public/build/assets/dashboard-B9CVP--8.js'), 'utf8');

test('dashboard local countdown follows the shared server clock when device time differs', () => {
    const clockSource = bundle.match(/F1=\(\)=>[^;]+;function uc/)?.[0].replace(/;function uc$/, '');
    assert.ok(clockSource);
    const context = { window: { getTrackerServerNow: () => new Date(123000) }, Date: { now: () => 100000 } };
    const clock = vm.runInNewContext(`let ${clockSource}; F1`, context);
    assert.equal(clock(), 123000);
    context.window.getTrackerServerNow = () => new Date(95000);
    assert.equal(clock(), 95000);
    delete context.window.getTrackerServerNow;
    assert.equal(clock(), 100000);
});

test('countdown rendering and boss grouping share that clock without extra requests', () => {
    assert.match(bundle, /const t=F1\(\);aa\.forEach/);
    assert.match(bundle, /uc\(i,s,u,F1\(\)\)/);
    assert.match(bundle, /aS\(Yi,F1\(\),Tn\)/);
    assert.match(bundle, /function G1\(\)\{return Math\.floor\(F1\(\)\/1e3\)\}/);
});

test('dashboard and Mini HUD change their seconds on the same server-clock boundary', () => {
    assert.equal(bundle.split('1e3-F1()%1e3').length - 1, 2, 'both dashboard tickers align to the server clock');
    assert.doesNotMatch(bundle, /1e3-Date\.now\(\)%1e3/);
    const hud = fs.readFileSync(path.join(__dirname, '../desktop-app/overlay/overlay.js'), 'utf8');
    assert.match(hud, /const serverNow = Date\.now\(\) \+ state\.serverOffset;\s+const wait = 1000 - \(\(\(serverNow % 1000\) \+ 1000\) % 1000\) \+ 5;/);
    assert.doesNotMatch(hud, /setInterval\(\(\) => \{\s+renderBossList\(\);\s+\}, 1000\);/);
    // Same rounding on both sides: whole seconds rounded down.
    assert.match(hud, /const totalSec = Math\.floor\(ms \/ 1000\);/);
    assert.match(bundle, /a=Math\.floor\(s%6e4\/1e3\)/);
});
