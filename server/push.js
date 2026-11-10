// Web Push alerts for phones (iOS 16.4+ Home Screen apps, Android, desktop browsers).
//
// - Alert timing is computed in memory from the same boss/event state the dashboard uses.
//   A one-minute external trigger calls tick(); it never reads Firebase on a warm instance
//   and never writes Firebase on a timer.
// - Firebase is written only when a device subscribes, changes its preferences, or a dead
//   subscription is removed. Subscriptions live outside the tracker root (push/...), so the
//   cold-start tracker snapshot does not grow with the number of devices.
// - Preferences are per device. They are stored server-side only because the server must
//   send while the app is closed; they are never part of the shared settings.
const crypto = require('crypto');
const firebase = require('./firebase');

const LEAD_CHOICES = [1, 5, 10, 15, 30, 60];
const DEFAULT_PREFS = Object.freeze({
    leads: [5],
    atSpawn: true,
    adminAlerts: true,
    events: true,
    invasion: true,
    announcements: true,
    mutedIds: [],
    quietStart: null,
    quietEnd: null,
    lang: 'en'
});
const TICK_INTERVAL_MS = 60 * 1000;
const MAX_WINDOW_MS = 180 * 1000;
const SENT_KEY_TTL_MS = 3 * 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 5000;
const ADMIN_ALERT_TIMEOUT_MS = 4000;
const TEST_COOLDOWN_MS = 10 * 1000;
const BOSS_NOW_WINDOW_MS = 5 * 60 * 1000;

let webpush = null;
let getPasswordFingerprint = () => null;
const subscriptions = new Map();
let subscriptionsLoaded = false;
let stopWatching = null;
const sentKeys = new Map();
const lastTestAt = new Map();

function configure(options = {}) {
    if (typeof options.getPasswordFingerprint === 'function') getPasswordFingerprint = options.getPasswordFingerprint;
}

function getVapidKeys() {
    const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
    const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
    return publicKey && privateKey ? { publicKey, privateKey } : null;
}

function isConfigured() {
    return Boolean(getVapidKeys());
}

function getWebPush() {
    if (!webpush) webpush = require('web-push');
    return webpush;
}

// Preview and local servers share the production Firebase project, so keep their
// subscriptions apart from production devices.
function storageBase() {
    if (process.env.VERCEL_ENV === 'production') return 'push';
    if (process.env.VERCEL_ENV === 'preview') return 'push_preview';
    return 'push_local';
}

function subscriptionId(endpoint) {
    return crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);
}

function isBase64Url(value, maxLength) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength && /^[A-Za-z0-9_-]+={0,2}$/.test(value);
}

function validateSubscription(sub) {
    if (!sub || typeof sub !== 'object') return null;
    const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint.trim() : '';
    if (!endpoint || endpoint.length > 1000) return null;
    try {
        if (new URL(endpoint).protocol !== 'https:') return null;
    } catch (_) {
        return null;
    }
    const p256dh = sub.keys?.p256dh;
    const auth = sub.keys?.auth;
    if (!isBase64Url(p256dh, 200) || !isBase64Url(auth, 100)) return null;
    return { endpoint, keys: { p256dh, auth } };
}

function normalizeClock(value) {
    if (value === null || value === undefined || value === '') return null;
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
    if (!match) return undefined;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 23 || m > 59) return undefined;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Merge a partial preference update onto a base, ignoring invalid fields.
function normalizePrefs(input = {}, base = DEFAULT_PREFS) {
    const prefs = {
        ...DEFAULT_PREFS,
        ...base,
        leads: [...(base.leads || DEFAULT_PREFS.leads)],
        mutedIds: [...(base.mutedIds || [])]
    };
    if (!input || typeof input !== 'object') return prefs;
    if (Array.isArray(input.leads)) {
        prefs.leads = [...new Set(input.leads.map(Number).filter(n => LEAD_CHOICES.includes(n)))].sort((a, b) => b - a);
    }
    for (const key of ['atSpawn', 'adminAlerts', 'events', 'invasion', 'announcements']) {
        if (typeof input[key] === 'boolean') prefs[key] = input[key];
    }
    if (Array.isArray(input.mutedIds)) {
        prefs.mutedIds = [...new Set(input.mutedIds.map(String).filter(id => /^(boss|event)_\d{1,9}$/.test(id)))].slice(0, 1000);
    }
    for (const key of ['quietStart', 'quietEnd']) {
        if (key in input) {
            const clock = normalizeClock(input[key]);
            if (clock !== undefined) prefs[key] = clock;
        }
    }
    if (input.lang === 'en' || input.lang === 'th') prefs.lang = input.lang;
    return prefs;
}

const clockFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });

function thaiClock(ms) {
    return clockFormatter.format(new Date(ms));
}

function thaiMinutesOfDay(ms) {
    const [h, m] = thaiClock(ms).split(':').map(Number);
    return (h % 24) * 60 + m;
}

function inQuietHours(prefs, ms) {
    if (!prefs.quietStart || !prefs.quietEnd || prefs.quietStart === prefs.quietEnd) return false;
    const toMinutes = (clock) => {
        const [h, m] = clock.split(':').map(Number);
        return h * 60 + m;
    };
    const start = toMinutes(prefs.quietStart);
    const end = toMinutes(prefs.quietEnd);
    const now = thaiMinutesOfDay(ms);
    return start < end ? now >= start && now < end : now >= start || now < end;
}

// Invasion bosses carry the same label as the dashboard badge (shared setting, e.g. "K1"),
// placed in front of the name. Normal bosses and events show the name alone.
function displayName(item) {
    return item.label ? `${item.label} ${item.name}` : item.name;
}

function invasionLabelOf(boss, invasionLabel) {
    return boss && boss.is_invasion ? String(invasionLabel || 'L3').trim() : '';
}

function effectiveBossSpawnMs(boss, nowMs, calculateBossAutoAdvance) {
    const advance = typeof calculateBossAutoAdvance === 'function' ? calculateBossAutoAdvance(boss, nowMs) : null;
    const spawnMs = new Date(advance?.next_spawn || boss.next_spawn).getTime();
    if (!Number.isFinite(spawnMs)) return null;
    // Fallback when no advance helper is supplied: a spawn whose NOW window passed is stale.
    if (!advance && spawnMs + BOSS_NOW_WINDOW_MS <= nowMs) return null;
    return spawnMs;
}

// Flatten bosses and events into alertable items with an effective spawn time.
function collectItems({ bosses = [], events = [], hideInvasion = false, invasionLabel = '', nowMs, calculateBossAutoAdvance }) {
    const items = [];
    for (const boss of bosses) {
        if (!boss || !boss.next_spawn || boss.pinned_alive || boss.post_maintenance) continue;
        if (boss.is_invasion && hideInvasion) continue;
        const spawnMs = effectiveBossSpawnMs(boss, nowMs, calculateBossAutoAdvance);
        if (spawnMs === null) continue;
        items.push({ key: `boss_${boss.id}`, kind: 'boss', id: boss.id, invasion: Boolean(boss.is_invasion), label: invasionLabelOf(boss, invasionLabel), name: String(boss.name || ''), location: String(boss.location || ''), spawnMs });
    }
    for (const event of events) {
        if (!event || !event.next_spawn || event.pinned_alive || event.post_maintenance) continue;
        const spawnMs = new Date(event.next_spawn).getTime();
        if (!Number.isFinite(spawnMs)) continue;
        items.push({ key: `event_${event.id}`, kind: 'event', id: event.id, label: '', name: String(event.name || ''), location: String(event.location || ''), spawnMs });
    }
    return items;
}

// Alerts due in (windowStart, windowEnd] for one device, grouped by kind/type/minutes.
function dueAlertsForPrefs(prefs, items, windowStart, windowEnd) {
    if (inQuietHours(prefs, windowEnd)) return [];
    const muted = new Set(prefs.mutedIds || []);
    const groups = new Map();
    const add = (item, type, minutes) => {
        const groupKey = `${item.kind}|${type}|${minutes}`;
        if (!groups.has(groupKey)) groups.set(groupKey, { kind: item.kind, type, minutes, items: [] });
        groups.get(groupKey).items.push(item);
    };
    for (const item of items) {
        if (muted.has(item.key)) continue;
        if (item.kind === 'event' && !prefs.events) continue;
        if (item.invasion && prefs.invasion === false) continue;
        for (const lead of prefs.leads || []) {
            const at = item.spawnMs - lead * 60000;
            if (at > windowStart && at <= windowEnd) add(item, 'pre', lead);
        }
        if (prefs.atSpawn && item.spawnMs > windowStart && item.spawnMs <= windowEnd) add(item, 'spawn', 0);
    }
    return [...groups.values()].map(group => ({
        ...group,
        items: group.items.sort((a, b) => a.spawnMs - b.spawnMs || a.name.localeCompare(b.name))
    }));
}

function shortTag(text) {
    return crypto.createHash('sha256').update(text).digest('base64url').slice(0, 24);
}

// Owner's choice of icons and wording (one icon per kind of alert, no boss colours, no
// location). Boss names are never translated.
//   boss soon     ⏳ Valefar in 5 min           / Spawns at 10:43
//   boss spawned  🔥 Valefar has spawned        / 10:43
//   event soon    📅 Castle Siege in 5 min      / Starts at 20:00
//   event start   🎉 Castle Siege has started   / 20:00
// Several at once: all names in the title (earliest spawn first), times in the body.
const ALERT_ICONS = Object.freeze({ bossPre: '⏳', bossSpawn: '🔥', eventPre: '📅', eventStart: '🎉', admin: '⚡', announcement: '📢', urgent: '⚠️' });
const ANNOUNCEMENT_TITLE_MAX = 100;
const ANNOUNCEMENT_BODY_MAX = 180;

function buildAlertMessage(alert, lang = 'en') {
    const th = lang === 'th';
    const { kind, type, minutes, items } = alert;
    const many = items.length > 1;
    const names = items.map(displayName).join(', ');
    const clock = thaiClock(items[0].spawnMs);
    const pre = type === 'pre';
    let icon;
    let title;
    let body;
    if (kind === 'boss') {
        icon = pre ? ALERT_ICONS.bossPre : ALERT_ICONS.bossSpawn;
        if (pre) title = th ? `${names} อีก ${minutes} นาที` : `${names} in ${minutes} min`;
        else title = th ? `${names} เกิดแล้ว` : `${names} ${many ? 'have' : 'has'} spawned`;
        body = pre && !many ? (th ? `เกิด ${clock}` : `Spawns at ${clock}`) : clock;
    } else {
        icon = pre ? ALERT_ICONS.eventPre : ALERT_ICONS.eventStart;
        if (pre) title = th ? `${names} อีก ${minutes} นาที` : `${names} in ${minutes} min`;
        else title = th ? `${names} เริ่มแล้ว` : `${names} ${many ? 'have' : 'has'} started`;
        body = pre && !many ? (th ? `เริ่ม ${clock}` : `Starts at ${clock}`) : clock;
    }
    if (many) body = items.map(item => thaiClock(item.spawnMs)).join(' · ');
    const identity = items.map(item => `${item.key}@${item.spawnMs}`).join('.');
    return { title: `${icon} ${title}`, body, tag: shortTag(`${kind}|${type}|${minutes}|${identity}`), url: '/' };
}

function buildAdminMessage(boss, lang = 'en', invasionLabel = '') {
    const name = displayName({ name: String(boss.name || ''), label: invasionLabelOf(boss, invasionLabel) });
    const th = lang === 'th';
    const spawnMs = new Date(boss.next_spawn || NaN).getTime();
    return {
        title: `${ALERT_ICONS.admin} ${th ? `กำลังจะเกิด ${name}` : `About to spawn: ${name}`}`,
        // Spawn time when known, otherwise a short prompt.
        body: Number.isFinite(spawnMs) ? thaiClock(spawnMs) : (th ? 'เตรียมตัวได้เลย' : 'Get ready'),
        tag: shortTag(`admin|boss_${boss.id}|${boss.pre_spawn_expires_at || ''}`),
        url: '/'
    };
}

function clip(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// The announcement text is the title so it reads straight off the lock screen; the body
// says what it is. Text too long for the title continues in the body.
function buildAnnouncementMessage(announcement, lang = 'en') {
    const th = lang === 'th';
    const urgent = Boolean(announcement.urgent);
    const text = String(announcement.message || '').replace(/\s+/g, ' ').trim();
    const kindLabel = urgent ? (th ? 'ด่วน' : 'Urgent') : (th ? 'ประกาศ' : 'Announcement');
    const fits = text.length <= ANNOUNCEMENT_TITLE_MAX;
    return {
        title: `${urgent ? ALERT_ICONS.urgent : ALERT_ICONS.announcement} ${clip(text, ANNOUNCEMENT_TITLE_MAX)}`,
        body: fits ? kindLabel : clip(`${kindLabel}: ${text}`, ANNOUNCEMENT_BODY_MAX),
        // A resend gets a new tag so it alerts again; duplicates of one send replace each other.
        tag: shortTag(`announcement|${text}|${announcement.resent_at || ''}`),
        url: '/'
    };
}

function buildTestMessage(lang = 'en') {
    return {
        title: 'Boss Tracker',
        body: lang === 'th' ? 'การแจ้งเตือนใช้งานได้แล้ว' : 'Notifications are working',
        tag: shortTag(`test|${Date.now()}`),
        url: '/'
    };
}

// ---------- Subscription storage ----------

function applyRemoteSubscriptions(value) {
    subscriptions.clear();
    if (value && typeof value === 'object') {
        for (const [id, record] of Object.entries(value)) {
            if (record && validateSubscription(record)) subscriptions.set(id, record);
        }
    }
    subscriptionsLoaded = true;
}

async function ensureLoaded() {
    if (subscriptionsLoaded) return;
    if (!firebase.isReady()) {
        subscriptionsLoaded = true;
        return;
    }
    await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        stopWatching = firebase.watchOutsideTracker(`${storageBase()}/subscriptions`, (value) => {
            applyRemoteSubscriptions(value);
            finish();
        });
        if (!stopWatching) finish();
        setTimeout(finish, 8000);
    });
    subscriptionsLoaded = true;
}

async function persist(id, record) {
    if (record) subscriptions.set(id, record);
    else subscriptions.delete(id);
    if (firebase.isReady()) {
        await firebase.syncOutsideTracker(`${storageBase()}/subscriptions/${id}`, record || null);
    }
}

function platformLabel(userAgent = '') {
    const ua = String(userAgent);
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
}

async function upsertSubscription(session, rawSubscription, rawPrefs, userAgent) {
    const sub = validateSubscription(rawSubscription);
    if (!sub) return { ok: false, status: 400, message: 'Invalid subscription' };
    await ensureLoaded();
    const id = subscriptionId(sub.endpoint);
    const existing = subscriptions.get(id);
    const now = new Date().toISOString();
    const record = {
        ...sub,
        prefs: normalizePrefs(rawPrefs, existing?.prefs || DEFAULT_PREFS),
        role: session.role,
        guestId: session.guestId || null,
        pfp: session.pfp || '',
        platform: platformLabel(userAgent),
        createdAt: existing?.createdAt || now,
        updatedAt: now
    };
    await persist(id, record);
    return { ok: true, id, prefs: record.prefs };
}

async function updatePrefs(session, endpoint, rawPrefs) {
    await ensureLoaded();
    const id = subscriptionId(endpoint || '');
    const existing = subscriptions.get(id);
    if (!existing) return { ok: false, status: 404, message: 'Subscription not found' };
    const prefs = normalizePrefs(rawPrefs, existing.prefs);
    const sameSession = existing.role === session.role && existing.guestId === (session.guestId || null) && existing.pfp === (session.pfp || '');
    if (sameSession && JSON.stringify(prefs) === JSON.stringify(existing.prefs)) {
        return { ok: true, id, prefs, unchanged: true };
    }
    const record = {
        ...existing,
        prefs,
        role: session.role,
        guestId: session.guestId || null,
        pfp: session.pfp || '',
        updatedAt: new Date().toISOString()
    };
    await persist(id, record);
    return { ok: true, id, prefs };
}

async function getStatus(endpoint) {
    await ensureLoaded();
    const record = subscriptions.get(subscriptionId(endpoint || ''));
    return record ? { subscribed: true, prefs: record.prefs } : { subscribed: false, prefs: null };
}

async function removeSubscription(endpoint) {
    await ensureLoaded();
    const id = subscriptionId(endpoint || '');
    if (!subscriptions.has(id)) return { ok: true, removed: false };
    await persist(id, null);
    return { ok: true, removed: true };
}

// A device stops receiving alerts when its guest pass expires or the password it logged in
// with changes (same rule that ends dashboard sessions).
function isRecordAuthorized(record) {
    if (!record || !['admin', 'member', 'guest'].includes(record.role)) return false;
    const current = getPasswordFingerprint(record.role, record.guestId || null);
    return Boolean(current) && current === record.pfp;
}

// ---------- Sending ----------

async function sendToRecord(id, record, message) {
    const keys = getVapidKeys();
    if (!keys) return false;
    const payload = JSON.stringify({ ...message, timestamp: Date.now() });
    try {
        await getWebPush().sendNotification({ endpoint: record.endpoint, keys: record.keys }, payload, {
            TTL: 600,
            urgency: 'high',
            timeout: SEND_TIMEOUT_MS,
            vapidDetails: { subject: 'https://boss-time-eloni.vercel.app', publicKey: keys.publicKey, privateKey: keys.privateKey }
        });
        return true;
    } catch (error) {
        const status = Number(error?.statusCode);
        if (status === 404 || status === 410) {
            await persist(id, null).catch(() => {});
        } else {
            console.error(`[Push] send failed (${Number.isFinite(status) ? status : 'network'})`);
        }
        return false;
    }
}

function pruneSentKeys(nowMs) {
    for (const [key, expires] of sentKeys) {
        if (expires <= nowMs) sentKeys.delete(key);
    }
}

// Start of the alert window for one tick. Vercel spreads ticks over several instances, so
// a per-instance "last tick" made instances re-send alerts another instance had already sent.
// The trigger is the single authority: it passes back the `until` of its last successful tick
// as `since`, so consecutive windows never overlap. Without it, cover exactly one interval.
function tickWindowStart(since, nowMs) {
    const value = since === null || since === undefined || since === '' ? NaN : Number(since);
    if (!Number.isFinite(value)) return nowMs - TICK_INTERVAL_MS;
    return Math.max(value, nowMs - MAX_WINDOW_MS);
}

// Called once a minute by the external trigger.
async function tick({ bosses, events, hideInvasion, invasionLabel = '', calculateBossAutoAdvance, since = null, nowMs = Date.now() }) {
    if (!isConfigured()) return { enabled: false, sent: 0, until: nowMs };
    await ensureLoaded();
    const windowEnd = nowMs;
    const windowStart = tickWindowStart(since, nowMs);
    if (windowStart >= windowEnd) return { enabled: true, sent: 0, until: Math.max(windowStart, nowMs) };

    const items = collectItems({ bosses, events, hideInvasion, invasionLabel, nowMs, calculateBossAutoAdvance });
    const jobs = [];
    for (const [id, record] of [...subscriptions.entries()]) {
        // Skip rather than delete: settings may not be loaded yet on a cold instance, and a
        // device that logs in again refreshes its record.
        if (!isRecordAuthorized(record)) continue;
        const prefs = normalizePrefs(record.prefs);
        for (const alert of dueAlertsForPrefs(prefs, items, windowStart, windowEnd)) {
            const message = buildAlertMessage(alert, prefs.lang);
            const sentKey = `${id}|${message.tag}`;
            if (sentKeys.has(sentKey)) continue;
            sentKeys.set(sentKey, nowMs + SENT_KEY_TTL_MS);
            jobs.push(sendToRecord(id, record, message));
        }
    }
    const results = await Promise.allSettled(jobs);
    pruneSentKeys(nowMs);
    return { enabled: true, sent: results.filter(r => r.status === 'fulfilled' && r.value === true).length, until: windowEnd };
}

// Admin double-click alert: sent immediately, bounded so the request never hangs.
async function sendAdminAlert(boss, { hideInvasion = false, invasionLabel = '', nowMs = Date.now() } = {}) {
    if (!isConfigured() || !boss || !boss.pre_spawned) return { sent: 0 };
    if (boss.is_invasion && hideInvasion) return { sent: 0 };
    const work = (async () => {
        await ensureLoaded();
        const jobs = [];
        for (const [id, record] of subscriptions.entries()) {
            if (!isRecordAuthorized(record)) continue;
            const prefs = normalizePrefs(record.prefs);
            if (!prefs.adminAlerts || prefs.mutedIds.includes(`boss_${boss.id}`) || inQuietHours(prefs, nowMs)) continue;
            if (boss.is_invasion && prefs.invasion === false) continue;
            jobs.push(sendToRecord(id, record, buildAdminMessage(boss, prefs.lang, invasionLabel)));
        }
        const results = await Promise.allSettled(jobs);
        return { sent: results.filter(r => r.status === 'fulfilled' && r.value === true).length };
    })();
    const timeout = new Promise(resolve => setTimeout(() => resolve({ sent: 0, timedOut: true }), ADMIN_ALERT_TIMEOUT_MS));
    return Promise.race([work, timeout]);
}

// Admin announcement: sent immediately when posted or resent, bounded like the admin alert.
async function sendAnnouncement(announcement, { nowMs = Date.now() } = {}) {
    if (!isConfigured() || !announcement || !String(announcement.message || '').trim()) return { sent: 0 };
    const work = (async () => {
        await ensureLoaded();
        const jobs = [];
        for (const [id, record] of subscriptions.entries()) {
            if (!isRecordAuthorized(record)) continue;
            const prefs = normalizePrefs(record.prefs);
            if (prefs.announcements === false || inQuietHours(prefs, nowMs)) continue;
            jobs.push(sendToRecord(id, record, buildAnnouncementMessage(announcement, prefs.lang)));
        }
        const results = await Promise.allSettled(jobs);
        return { sent: results.filter(r => r.status === 'fulfilled' && r.value === true).length };
    })();
    const timeout = new Promise(resolve => setTimeout(() => resolve({ sent: 0, timedOut: true }), ADMIN_ALERT_TIMEOUT_MS));
    return Promise.race([work, timeout]);
}

async function sendTest(endpoint, nowMs = Date.now()) {
    if (!isConfigured()) return { ok: false, status: 503, message: 'Notifications are not configured' };
    await ensureLoaded();
    const id = subscriptionId(endpoint || '');
    const record = subscriptions.get(id);
    if (!record) return { ok: false, status: 404, message: 'Subscription not found' };
    if (nowMs - (lastTestAt.get(id) || 0) < TEST_COOLDOWN_MS) return { ok: false, status: 429, message: 'Wait a few seconds' };
    lastTestAt.set(id, nowMs);
    const sent = await sendToRecord(id, record, buildTestMessage(normalizePrefs(record.prefs).lang));
    return sent ? { ok: true } : { ok: false, status: 502, message: 'Could not deliver the test notification' };
}

function getPublicConfig() {
    const keys = getVapidKeys();
    return { enabled: Boolean(keys), publicKey: keys ? keys.publicKey : null, leadChoices: LEAD_CHOICES, defaults: DEFAULT_PREFS };
}

// Test hook: reset in-memory state between tests.
function _resetForTests() {
    if (typeof stopWatching === 'function') stopWatching();
    stopWatching = null;
    subscriptions.clear();
    subscriptionsLoaded = false;
    sentKeys.clear();
    lastTestAt.clear();
    webpush = null;
}

module.exports = {
    LEAD_CHOICES,
    DEFAULT_PREFS,
    configure,
    isConfigured,
    getPublicConfig,
    storageBase,
    subscriptionId,
    validateSubscription,
    normalizePrefs,
    inQuietHours,
    collectItems,
    dueAlertsForPrefs,
    buildAlertMessage,
    buildAdminMessage,
    buildAnnouncementMessage,
    upsertSubscription,
    updatePrefs,
    getStatus,
    removeSubscription,
    isRecordAuthorized,
    tick,
    tickWindowStart,
    sendAdminAlert,
    sendAnnouncement,
    sendTest,
    _setWebPushForTests(mock) { webpush = mock; },
    _resetForTests
};
