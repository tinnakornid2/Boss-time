const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('boss color rules survive React row replacement and stay keyed by boss id', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );
    const start = source.indexOf('    function getEffectiveBossColor(');
    const end = source.indexOf('    function applyRowBossColor(', start);
    assert.ok(start >= 0 && end > start);

    const styles = new Map();
    const state = {
        settings: { invasionColor: '#a855f7' },
        bosses: new Map([
            [10, { id: 10, name: 'Medusa', color: '#38bdf8', is_invasion: false }],
            [65, { id: 65, name: 'Medusa', color: '#ffffff', is_invasion: true }],
            [42, { id: 42, name: 'Talakin', color: null, is_invasion: false }]
        ])
    };
    const document = {
        head: { appendChild(element) { styles.set(element.id, element); } },
        getElementById(id) { return styles.get(id) || null; },
        createElement() { return { id: '', textContent: '' }; }
    };
    const context = { state, document, localStorage: { getItem() { return null; } } };
    vm.runInNewContext(`${source.slice(start, end)}\nsyncBossColorStyles();`, context);

    const css = styles.get('boss-name-colors-by-id').textContent;
    assert.match(css, /tr\[data-boss-id="10"\].*color:#38bdf8!important/);
    assert.match(css, /tr\[data-boss-id="65"\].*color:#a855f7!important/);
    assert.doesNotMatch(css, /data-boss-id="42"/);
    assert.doesNotMatch(css, /data-event-id|Medusa|Talakin/);
});

test('old live events cannot replace a newer boss color from the full poll snapshot', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js'),
        'utf8'
    );
    const start = source.indexOf('    function consumeLiveEvent(');
    const end = source.indexOf('    // Reuse the dashboard', start);
    assert.ok(start >= 0 && end > start);

    const current = { id: 28, name: 'Medusa', color: '#38bdf8', updated_at: '2026-09-24T06:00:00.000Z' };
    const oldEvent = {
        id: 'old-color', type: 'boss_updated', bossId: 28,
        boss: { ...current, color: null, updated_at: '2026-09-24T05:00:00.000Z' },
        createdAt: 0
    };
    const state = {
        bosses: new Map([[28, current]]), events: new Map(), seenEventIds: new Set(),
        initialEventsLoaded: true, serverOffset: 0, settings: {}
    };
    const context = {
        state,
        sessionStorage: { setItem() {}, getItem() { return null; } },
        reconcileBossRows() {}, updateStatus() {}, Date, Number,
        document: { visibilityState: 'visible' }
    };
    vm.runInNewContext(source.slice(start, end), context);

    context.consumeLiveEvent(oldEvent, true, true);
    assert.equal(state.bosses.get(28).color, '#38bdf8');
    context.consumeLiveEvent({ ...oldEvent, id: 'old-stream' }, true);
    assert.equal(state.bosses.get(28).color, '#38bdf8');
    context.consumeLiveEvent({
        ...oldEvent, id: 'same-time-stream',
        boss: { ...current, color: null }
    }, true);
    assert.equal(state.bosses.get(28).color, '#38bdf8');
    context.consumeLiveEvent({
        ...oldEvent, id: 'new-stream',
        boss: { ...current, color: '#a855f7', updated_at: '2026-09-24T07:00:00.000Z' }
    }, true);
    assert.equal(state.bosses.get(28).color, '#a855f7');
});
