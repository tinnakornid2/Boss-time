require('./helpers/isolated-data');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const push = require('../server/push');
const { calculateBossAutoAdvance } = require('../server/db');

const MIN = 60 * 1000;
// 2026-11-09 21:30 Thailand time.
const SPAWN = Date.parse('2026-11-09T14:30:00.000Z');

function boss(overrides = {}) {
    return {
        id: 7, name: 'Valefar', location: 'Morgue', interval: 210, is_invasion: false,
        next_spawn: new Date(SPAWN).toISOString(), pinned_alive: false, post_maintenance: false,
        ...overrides
    };
}

function prefs(overrides = {}) {
    return push.normalizePrefs({ ...overrides });
}

function due(items, p, start, end) {
    return push.dueAlertsForPrefs(p, items, start, end);
}

test('defaults are 5 minutes before, at NOW, admin alerts, events, English', () => {
    const p = prefs();
    assert.deepEqual(p.leads, [5]);
    assert.equal(p.atSpawn, true);
    assert.equal(p.adminAlerts, true);
    assert.equal(p.events, true);
    assert.equal(p.lang, 'en');
});

test('preference input is validated and unknown values are ignored', () => {
    const p = push.normalizePrefs({
        leads: [5, 7, '10', 60, 5],
        mutedIds: ['boss_1', 'event_2', 'x', '<script>', 3],
        quietStart: '1:00', quietEnd: '25:00', lang: 'fr', atSpawn: 'yes'
    });
    assert.deepEqual(p.leads, [60, 10, 5]);
    assert.deepEqual(p.mutedIds, ['boss_1', 'event_2']);
    assert.equal(p.quietStart, '01:00');
    assert.equal(p.quietEnd, null, 'invalid clock keeps the previous value');
    assert.equal(p.lang, 'en');
    assert.equal(p.atSpawn, true);
});

test('a pre-spawn alert fires once, in the minute window that contains it', () => {
    const items = push.collectItems({ bosses: [boss()], nowMs: SPAWN - 5 * MIN, calculateBossAutoAdvance });
    const p = prefs({ leads: [5], atSpawn: false });
    assert.equal(due(items, p, SPAWN - 7 * MIN, SPAWN - 6 * MIN).length, 0);
    const hit = due(items, p, SPAWN - 6 * MIN, SPAWN - 5 * MIN);
    assert.equal(hit.length, 1);
    assert.equal(hit[0].type, 'pre');
    assert.equal(hit[0].minutes, 5);
    assert.equal(due(items, p, SPAWN - 5 * MIN, SPAWN - 4 * MIN).length, 0);
});

test('several lead times and the NOW alert are all delivered', () => {
    const items = push.collectItems({ bosses: [boss()], nowMs: SPAWN - 30 * MIN, calculateBossAutoAdvance });
    const p = prefs({ leads: [10, 1], atSpawn: true });
    const kinds = [];
    for (let t = SPAWN - 15 * MIN; t <= SPAWN + MIN; t += MIN) {
        for (const alert of due(items, p, t - MIN, t)) kinds.push(`${alert.type}:${alert.minutes}`);
    }
    assert.deepEqual(kinds, ['pre:10', 'pre:1', 'spawn:0']);
});

test('Unset, Still alive, maintenance and hidden invasion bosses never alert', () => {
    const now = SPAWN - 5 * MIN;
    const bosses = [
        boss({ id: 1, next_spawn: null }),
        boss({ id: 2, pinned_alive: true }),
        boss({ id: 3, post_maintenance: true }),
        boss({ id: 4, is_invasion: true })
    ];
    const items = push.collectItems({ bosses, hideInvasion: true, nowMs: now, calculateBossAutoAdvance });
    assert.deepEqual(items.map(i => i.id), []);
    const shown = push.collectItems({ bosses: [boss({ id: 4, is_invasion: true })], hideInvasion: false, nowMs: now, calculateBossAutoAdvance });
    assert.deepEqual(shown.map(i => i.id), [4]);
});

test('after the five-minute NOW window the next cycle is used (same auto-advance as the dashboard)', () => {
    const now = SPAWN + 6 * MIN;
    const [item] = push.collectItems({ bosses: [boss()], nowMs: now, calculateBossAutoAdvance });
    assert.equal(item.spawnMs, SPAWN + 210 * MIN);
});

test('muted bosses and disabled events are skipped per device', () => {
    const events = [{ id: 3, name: 'Siege', next_spawn: new Date(SPAWN).toISOString() }];
    const items = push.collectItems({ bosses: [boss()], events, nowMs: SPAWN - 5 * MIN, calculateBossAutoAdvance });
    const window = [SPAWN - 6 * MIN, SPAWN - 5 * MIN];
    assert.equal(due(items, prefs({ mutedIds: ['boss_7'] }), ...window).length, 1);
    assert.equal(due(items, prefs({ mutedIds: ['boss_7'], events: false }), ...window).length, 0);
});

test('quiet hours use Thailand time, including ranges that cross midnight', () => {
    const at2130 = SPAWN;
    assert.equal(push.inQuietHours(prefs({ quietStart: '21:00', quietEnd: '22:00' }), at2130), true);
    assert.equal(push.inQuietHours(prefs({ quietStart: '23:00', quietEnd: '08:00' }), at2130), false);
    assert.equal(push.inQuietHours(prefs({ quietStart: '21:00', quietEnd: '08:00' }), at2130), true);
    const items = push.collectItems({ bosses: [boss()], nowMs: SPAWN - 5 * MIN, calculateBossAutoAdvance });
    assert.equal(due(items, prefs({ quietStart: '21:00', quietEnd: '22:00' }), SPAWN - 6 * MIN, SPAWN - 5 * MIN).length, 0);
});

test('bosses due in the same minute are grouped into one short message', () => {
    const bosses = [boss(), boss({ id: 8, name: 'Orfen', location: 'Sea of Spores' })];
    const items = push.collectItems({ bosses, nowMs: SPAWN - 5 * MIN, calculateBossAutoAdvance });
    const [alert] = due(items, prefs({ atSpawn: false }), SPAWN - 6 * MIN, SPAWN - 5 * MIN);
    assert.equal(alert.items.length, 2);
    assert.deepEqual(push.buildAlertMessage(alert, 'en'), { ...push.buildAlertMessage(alert, 'en'), title: '⏳ Orfen, Valefar in 5 min', body: '21:30 · 21:30' });
    assert.equal(push.buildAlertMessage(alert, 'th').title, '⏳ Orfen, Valefar อีก 5 นาที');
});

test('short messages in English and Thai keep boss names untranslated', () => {
    const items = push.collectItems({ bosses: [boss()], nowMs: SPAWN - 5 * MIN, calculateBossAutoAdvance });
    const [pre] = due(items, prefs({ atSpawn: false }), SPAWN - 6 * MIN, SPAWN - 5 * MIN);
    assert.equal(push.buildAlertMessage(pre, 'en').title, '⏳ Valefar in 5 min');
    assert.equal(push.buildAlertMessage(pre, 'en').body, 'Spawns at 21:30', 'spawn time only, no location');
    assert.equal(push.buildAlertMessage(pre, 'th').title, '⏳ Valefar อีก 5 นาที');
    assert.equal(push.buildAlertMessage(pre, 'th').body, 'เกิด 21:30');
    const [now] = due(items, prefs({ leads: [] }), SPAWN - MIN, SPAWN);
    assert.equal(push.buildAlertMessage(now, 'en').title, '🔥 Valefar has spawned');
    assert.equal(push.buildAlertMessage(now, 'en').body, '21:30');
    assert.equal(push.buildAlertMessage(now, 'th').title, '🔥 Valefar เกิดแล้ว');
    assert.equal(push.buildAdminMessage(boss(), 'en').title, '⚡ About to spawn: Valefar');
    assert.equal(push.buildAdminMessage(boss(), 'th').title, '⚡ กำลังจะเกิด Valefar');
    assert.equal(push.buildAlertMessage(pre, 'en').tag, push.buildAlertMessage(pre, 'th').tag, 'same alert, same tag');
});

test('subscriptions are validated before storage', () => {
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    assert.ok(push.validateSubscription({ endpoint: 'https://web.push.apple.com/abc', keys }));
    assert.equal(push.validateSubscription({ endpoint: 'http://insecure.example/abc', keys }), null);
    assert.equal(push.validateSubscription({ endpoint: 'https://x/abc', keys: { p256dh: 'bad key!', auth: 'x' } }), null);
    assert.equal(push.validateSubscription(null), null);
});

test('tick sends each alert once, honours preferences, and skips logged-out devices', async () => {
    const original = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
    process.env.VAPID_PUBLIC_KEY = 'test-public';
    process.env.VAPID_PRIVATE_KEY = 'test-private';
    push._resetForTests();
    const sent = [];
    push._setWebPushForTests({ sendNotification: async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); } });
    push.configure({ getPasswordFingerprint: (role) => (role === 'member' ? 'pfp-member' : null) });
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    try {
        await push.upsertSubscription({ role: 'member', pfp: 'pfp-member' }, { endpoint: 'https://push.example/th', keys }, { lang: 'th' }, 'iPhone');
        await push.upsertSubscription({ role: 'member', pfp: 'old-password' }, { endpoint: 'https://push.example/stale', keys }, {}, 'Android');
        const args = { bosses: [boss()], events: [], hideInvasion: false, calculateBossAutoAdvance };

        await push.tick({ ...args, nowMs: SPAWN - 6 * MIN });
        await push.tick({ ...args, nowMs: SPAWN - 5 * MIN });
        await push.tick({ ...args, nowMs: SPAWN - 5 * MIN + 1000 });
        assert.deepEqual(sent.map(s => [s.endpoint, s.title]), [['https://push.example/th', '⏳ Valefar อีก 5 นาที']]);

        sent.length = 0;
        const result = await push.sendAdminAlert(boss({ pre_spawned: true, pre_spawn_expires_at: 'x' }), { nowMs: SPAWN - 3 * MIN });
        assert.equal(result.sent, 1);
        assert.equal(sent[0].title, '⚡ กำลังจะเกิด Valefar');
    } finally {
        process.env.VAPID_PUBLIC_KEY = original.pub || '';
        process.env.VAPID_PRIVATE_KEY = original.priv || '';
        if (!original.pub) delete process.env.VAPID_PUBLIC_KEY;
        if (!original.priv) delete process.env.VAPID_PRIVATE_KEY;
        push._resetForTests();
    }
});

test('ticks on different server instances never repeat an alert', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-public';
    process.env.VAPID_PRIVATE_KEY = 'test-private';
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    const sent = [];
    // A fresh module state per tick is a different Vercel instance with no memory.
    async function onNewInstance(tickArgs) {
        push._resetForTests();
        push._setWebPushForTests({ sendNotification: async (sub, payload) => { sent.push(JSON.parse(payload).title); } });
        push.configure({ getPasswordFingerprint: () => 'pfp' });
        await push.upsertSubscription({ role: 'member', pfp: 'pfp' }, { endpoint: 'https://push.example/one', keys }, { leads: [1], atSpawn: true }, 'iPhone');
        return push.tick({ bosses: [boss()], events: [], hideInvasion: false, calculateBossAutoAdvance, ...tickArgs });
    }
    try {
        // Trigger passes back each tick's `until`, with uneven spacing like Apps Script.
        let since = null;
        for (const offset of [-3 * MIN, -2 * MIN + 5000, -MIN - 3000, 2000, MIN + 4000, 2 * MIN, 3 * MIN + 1000]) {
            since = (await onNewInstance({ since, nowMs: SPAWN + offset })).until;
        }
        assert.deepEqual(sent, ['⏳ Valefar in 1 min', '🔥 Valefar has spawned']);

        // Old trigger without `since`: each tick covers exactly the last minute.
        sent.length = 0;
        for (const offset of [-3 * MIN, -2 * MIN, -MIN, 0, MIN, 2 * MIN, 3 * MIN]) {
            await onNewInstance({ nowMs: SPAWN + offset + 500 });
        }
        assert.deepEqual(sent, ['⏳ Valefar in 1 min', '🔥 Valefar has spawned']);

        assert.equal(push.tickWindowStart(null, SPAWN), SPAWN - MIN);
        assert.equal(push.tickWindowStart(SPAWN - 30000, SPAWN), SPAWN - 30000);
        assert.equal(push.tickWindowStart(SPAWN - 60 * MIN, SPAWN), SPAWN - 3 * MIN, 'a long outage does not replay old alerts');
    } finally {
        delete process.env.VAPID_PUBLIC_KEY;
        delete process.env.VAPID_PRIVATE_KEY;
        push._resetForTests();
    }
});

test('a dead subscription (410) is removed; other errors keep it', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-public';
    process.env.VAPID_PRIVATE_KEY = 'test-private';
    push._resetForTests();
    push.configure({ getPasswordFingerprint: () => 'pfp' });
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    try {
        await push.upsertSubscription({ role: 'admin', pfp: 'pfp' }, { endpoint: 'https://push.example/gone', keys }, {}, '');
        await push.upsertSubscription({ role: 'admin', pfp: 'pfp' }, { endpoint: 'https://push.example/flaky', keys }, {}, '');
        push._setWebPushForTests({ sendNotification: async (sub) => {
            const error = new Error('push failed');
            error.statusCode = sub.endpoint.endsWith('gone') ? 410 : 500;
            throw error;
        } });
        await push.sendAdminAlert(boss({ pre_spawned: true }));
        assert.equal((await push.getStatus('https://push.example/gone')).subscribed, false);
        assert.equal((await push.getStatus('https://push.example/flaky')).subscribed, true);
    } finally {
        delete process.env.VAPID_PUBLIC_KEY;
        delete process.env.VAPID_PRIVATE_KEY;
        push._resetForTests();
    }
});

test('preview and local servers never write production push subscriptions', () => {
    const original = process.env.VERCEL_ENV;
    try {
        process.env.VERCEL_ENV = 'production';
        assert.equal(push.storageBase(), 'push');
        process.env.VERCEL_ENV = 'preview';
        assert.equal(push.storageBase(), 'push_preview');
        delete process.env.VERCEL_ENV;
        assert.equal(push.storageBase(), 'push_local');
    } finally {
        if (original === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = original;
    }
});

test('routes: device endpoints need a session, the tick needs its secret, admin alert hook is wired', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
    const tickAt = server.indexOf("app.post('/api/push/tick'");
    const sessionAt = server.indexOf('app.use(requireSession);');
    const pushRoutesAt = server.indexOf("app.use('/api/v1/push'");
    assert.ok(tickAt > 0 && tickAt < sessionAt, 'tick is authenticated by its own secret');
    assert.ok(pushRoutesAt > sessionAt, 'device routes sit behind requireSession');
    assert.match(server, /if \(process\.env\.VERCEL && !db\.isCloudDataReady\(\)\) return res\.status\(503\)/);
    assert.match(server, /await push\.sendAdminAlert\(updated/);
    assert.match(server, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(server, /push-notifications\.js\?v=\$\{APP_VERSION\}/);
});

test('the service worker shows every push and caches nothing', () => {
    const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
    assert.match(sw, /showNotification/);
    assert.doesNotMatch(sw, /addEventListener\('fetch'/);
    assert.doesNotMatch(sw, /caches\./);
});

test('push code never changes passwords or shared settings', () => {
    for (const file of ['../server/push.js', '../server/routes/push.js', '../public/js/push-notifications.js']) {
        const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assert.doesNotMatch(source, /updateSettings|syncSettings|adminPassword|memberPassword|temporaryPasswords/, file);
    }
});

test('Home Screen launch opens an instant static page instead of waiting on a cold server', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.id, '/', 'same app identity for existing installs');
    assert.equal(manifest.start_url, '/splash-start.html');
    const splash = fs.readFileSync(path.join(__dirname, '../public/splash-start.html'), 'utf8');
    assert.match(splash, /location\.replace\('\/'\)/);
    assert.match(splash, /setTimeout\(go, 60\)/);
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
    const toFunction = new RegExp(`^${vercel.rewrites[0].source}$`);
    assert.equal(toFunction.test('/splash-start.html'), false, 'served by the CDN, not the server');
    assert.equal(toFunction.test('/'), true);
});

test('invasion bosses: per-device switch, and paused while hidden on the dashboard', () => {
    const now = SPAWN - 5 * MIN;
    const bosses = [boss({ id: 1, name: 'Normal' }), boss({ id: 2, name: 'Invader', is_invasion: true })];
    const window = [SPAWN - 6 * MIN, SPAWN - 5 * MIN];
    const names = (alerts) => alerts.flatMap(a => a.items.map(i => i.name)).sort();

    const shown = push.collectItems({ bosses, hideInvasion: false, nowMs: now, calculateBossAutoAdvance });
    assert.equal(prefs().invasion, true, 'on by default');
    assert.deepEqual(names(due(shown, prefs({ atSpawn: false }), ...window)), ['Invader', 'Normal']);
    assert.deepEqual(names(due(shown, prefs({ atSpawn: false, invasion: false }), ...window)), ['Normal']);

    const hidden = push.collectItems({ bosses, hideInvasion: true, nowMs: now, calculateBossAutoAdvance });
    assert.deepEqual(names(due(hidden, prefs({ atSpawn: false, invasion: true }), ...window)), ['Normal'], 'dashboard visibility wins');
});

test('admin alert for an invasion boss respects the device invasion switch', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-public';
    process.env.VAPID_PRIVATE_KEY = 'test-private';
    push._resetForTests();
    const sent = [];
    push._setWebPushForTests({ sendNotification: async (sub) => { sent.push(sub.endpoint); } });
    push.configure({ getPasswordFingerprint: () => 'pfp' });
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    try {
        await push.upsertSubscription({ role: 'member', pfp: 'pfp' }, { endpoint: 'https://push.example/on', keys }, {}, '');
        await push.upsertSubscription({ role: 'member', pfp: 'pfp' }, { endpoint: 'https://push.example/off', keys }, { invasion: false }, '');
        const invader = boss({ id: 2, is_invasion: true, pre_spawned: true });
        await push.sendAdminAlert(invader, { hideInvasion: false });
        assert.deepEqual(sent, ['https://push.example/on']);
        sent.length = 0;
        await push.sendAdminAlert(invader, { hideInvasion: true });
        assert.deepEqual(sent, [], 'hidden on the dashboard: nobody is alerted');
    } finally {
        delete process.env.VAPID_PUBLIC_KEY;
        delete process.env.VAPID_PRIVATE_KEY;
        push._resetForTests();
    }
});

test('panel lists invasion bosses separately and keeps one shared mute list', () => {
    const client = fs.readFileSync(path.join(__dirname, '../public/js/push-notifications.js'), 'utf8');
    assert.match(client, /invasionBosses: bosses\.filter\(b => b\.is_invasion\)/);
    assert.match(client, /bosses: bosses\.filter\(b => !b\.is_invasion\)/);
    assert.match(client, /const muted = new Set\(draft\.mutedIds\);/, 'each toggle reads the shared draft');
    assert.match(client, /invasion_hidden/);
});

test('panel render flattens nested lists and never prints null', () => {
    const client = fs.readFileSync(path.join(__dirname, '../public/js/push-notifications.js'), 'utf8');
    assert.match(client, /\]\.flat\(Infinity\)\.filter\(node => node !== null && node !== undefined && node !== false\);/);
    assert.match(client, /panel\.replaceChildren\(\.\.\.nodes\);/);
});

test('admin announcements are pushed immediately, short, and respect the device switch', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-public';
    process.env.VAPID_PRIVATE_KEY = 'test-private';
    push._resetForTests();
    const sent = [];
    push._setWebPushForTests({ sendNotification: async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); } });
    push.configure({ getPasswordFingerprint: () => 'pfp' });
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    try {
        await push.upsertSubscription({ role: 'member', pfp: 'pfp' }, { endpoint: 'https://push.example/th', keys }, { lang: 'th' }, '');
        await push.upsertSubscription({ role: 'member', pfp: 'pfp' }, { endpoint: 'https://push.example/off', keys }, { announcements: false }, '');
        const long = 'รวมพลที่ Giran 21:00 '.repeat(20);
        await push.sendAnnouncement({ message: long, urgent: true, resent_at: '2026-11-09T14:00:00Z' });
        assert.deepEqual(sent.map(s => s.endpoint), ['https://push.example/th']);
        assert.ok(sent[0].title.startsWith('⚠️ รวมพลที่ Giran') && sent[0].title.endsWith('…'), 'urgent text is the title');
        assert.ok(sent[0].title.length <= 103);
        assert.ok(sent[0].body.startsWith('ด่วน: ') && sent[0].body.length <= 180 && sent[0].body.endsWith('…'));

        const a = push.buildAnnouncementMessage({ message: 'Siege tonight', resent_at: '1' }, 'en');
        const b = push.buildAnnouncementMessage({ message: 'Siege tonight', resent_at: '2' }, 'en');
        assert.deepEqual([a.title, a.body], ['📢 Siege tonight', 'Announcement']);
        assert.deepEqual([push.buildAnnouncementMessage({ message: 'Restart', urgent: true }, 'th').title, push.buildAnnouncementMessage({ message: 'Restart', urgent: true }, 'th').body], ['⚠️ Restart', 'ด่วน']);
        assert.notEqual(a.tag, b.tag, 'a resend alerts again');
        sent.length = 0;
        await push.sendAnnouncement({ message: '   ' });
        assert.equal(sent.length, 0, 'empty or cleared announcements send nothing');
    } finally {
        delete process.env.VAPID_PUBLIC_KEY;
        delete process.env.VAPID_PRIVATE_KEY;
        push._resetForTests();
    }
});

test('announcement routes push after saving, and clearing does not push', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
    assert.match(server, /await db\.updateSettings\(\{ announcement: announcementObj \}\);\s*if \(announcementObj\) await push\.sendAnnouncement\(announcementObj\)/);
    assert.match(server, /await db\.updateSettings\(\{ announcement: settings\.announcement \}\);\s*await push\.sendAnnouncement\(settings\.announcement\)/);
    const clear = server.slice(server.indexOf("app.post('/announcement/clear'"), server.indexOf("app.post('/announcement/resend'"));
    assert.doesNotMatch(clear, /sendAnnouncement/);
});

test('one icon per kind of alert, no boss colours, invasion label in front like the dashboard', () => {
    const now = SPAWN - 5 * MIN;
    const items = push.collectItems({
        bosses: [
            boss({ id: 1, name: 'Valefar', color: '#a855f7' }),
            boss({ id: 3, name: 'Kelbim', is_invasion: true, color: '#22c55e' })
        ],
        events: [{ id: 9, name: 'Siege', color: '#ef4444', next_spawn: new Date(SPAWN).toISOString() }],
        invasionLabel: 'K1', nowMs: now, calculateBossAutoAdvance
    });
    const window = [SPAWN - 6 * MIN, SPAWN - 5 * MIN];
    const alerts = due(items, prefs({ atSpawn: false }), ...window);
    const bossAlert = alerts.find(a => a.kind === 'boss');
    assert.equal(push.buildAlertMessage(bossAlert, 'en').title, '⏳ K1 Kelbim, Valefar in 5 min');
    assert.doesNotMatch(JSON.stringify(alerts.map(a => push.buildAlertMessage(a, 'en'))), /[🔴🟠🟡🟢🔵🟣🟤⚫⚪]/u, 'no colour dots');
    const eventAlert = alerts.find(a => a.kind === 'event');
    assert.deepEqual([push.buildAlertMessage(eventAlert, 'en').title, push.buildAlertMessage(eventAlert, 'en').body], ['📅 Siege in 5 min', 'Starts at 21:30']);
    assert.deepEqual([push.buildAlertMessage(eventAlert, 'th').title, push.buildAlertMessage(eventAlert, 'th').body], ['📅 Siege อีก 5 นาที', 'เริ่ม 21:30']);
    const [started] = due(items.filter(i => i.kind === 'event'), prefs({ leads: [] }), SPAWN - MIN, SPAWN);
    assert.deepEqual([push.buildAlertMessage(started, 'en').title, push.buildAlertMessage(started, 'th').title], ['🎉 Siege has started', '🎉 Siege เริ่มแล้ว']);
    const [spawnedMany] = due(items.filter(i => i.kind === 'boss'), prefs({ leads: [] }), SPAWN - MIN, SPAWN);
    assert.deepEqual([push.buildAlertMessage(spawnedMany, 'en').title, push.buildAlertMessage(spawnedMany, 'en').body], ['🔥 K1 Kelbim, Valefar have spawned', '21:30 · 21:30']);
    assert.equal(push.buildAdminMessage(boss({ name: 'Kelbim', is_invasion: true }), 'th', 'K1').title, '⚡ กำลังจะเกิด K1 Kelbim');
    assert.equal(push.buildAdminMessage(boss(), 'en', 'K1').title, '⚡ About to spawn: Valefar', 'normal bosses have no label');
});

test('owner format: text + name + spawn time, no location, earliest spawn first', () => {
    const bosses = [
        boss({ id: 1, name: 'Late', location: 'Somewhere', next_spawn: new Date(SPAWN + 40 * 1000).toISOString() }),
        boss({ id: 2, name: 'Early', location: 'Elsewhere', next_spawn: new Date(SPAWN - 20 * 1000).toISOString() }),
        boss({ id: 3, name: 'Middle', next_spawn: new Date(SPAWN + 5 * 1000).toISOString() })
    ];
    const items = push.collectItems({ bosses, nowMs: SPAWN - 10 * MIN, calculateBossAutoAdvance });
    const [alert] = due(items, prefs({ leads: [5], atSpawn: false }), SPAWN - 6 * MIN, SPAWN - 4 * MIN);
    const message = push.buildAlertMessage(alert, 'th');
    assert.equal(message.title, '⏳ Early, Middle, Late อีก 5 นาที');
    assert.equal(message.body, '21:29 · 21:30 · 21:30');
    assert.doesNotMatch(JSON.stringify(message), /Somewhere|Elsewhere/);

    const [spawned] = due(items.filter(i => i.name === 'Late'), prefs({ leads: [] }), SPAWN, SPAWN + MIN);
    assert.deepEqual([push.buildAlertMessage(spawned, 'th').title, push.buildAlertMessage(spawned, 'th').body], ['🔥 Late เกิดแล้ว', '21:30']);

    const admin = push.buildAdminMessage(boss({ name: 'Valefar', location: 'Morgue' }), 'th');
    assert.deepEqual([admin.title, admin.body], ['⚡ กำลังจะเกิด Valefar', '21:30']);
    assert.equal(push.buildAdminMessage(boss({ next_spawn: null }), 'th').body, 'เตรียมตัวได้เลย');
});

test('Android status-bar badge is a white stencil on a transparent background', () => {
    const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
    assert.ok(sw.includes("badge: '/badge.png'"));
    assert.ok(sw.includes("icon: '/favicon.png'"));
    const png = fs.readFileSync(path.join(__dirname, '../public/badge.png'));
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]], [96, 96, 8, 6], '96x96 RGBA');
});
