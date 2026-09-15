const fs = require('fs');
const path = require('path');
const firebase = require('./firebase');

const dataFile = path.join(__dirname, 'data', 'store.json');
let cache = null;
let isInitializedFirebase = false;
let hasCloudSnapshot = false;
let lastCloudSyncAt = 0;
let cloudRefreshPromise = null;
let autoAdvancePromise = null;

const BOSS_NOW_WINDOW_MS = 5 * 60 * 1000;

function load() {
    if (!cache) {
        try {
            cache = JSON.parse(JSON.stringify(require('./data/store.json')));
        } catch (e) {
            if (!fs.existsSync(dataFile)) {
                throw new Error(`Data store not found at ${dataFile}`);
            }
            cache = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        }
    }
    return cache;
}

function save() {
    if (cache) {
        try {
            const tempPath = `${dataFile}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(cache, null, 2), 'utf8');
            fs.renameSync(tempPath, dataFile);
        } catch (err) {
            // In serverless environments like Vercel, the local filesystem is read-only.
            // Data persistence is handled via Firebase Realtime Database.
        }
    }
}

function calculateBossAutoAdvance(boss, nowMs = Date.now()) {
    // Unset bosses and bosses explicitly marked Still alive never auto-advance.
    if (!boss?.next_spawn || boss.pinned_alive) return null;

    const firstSpawnMs = new Date(boss.next_spawn).getTime();
    const intervalMs = Number(boss.interval) * 60 * 1000;
    if (!Number.isFinite(firstSpawnMs) || !Number.isFinite(intervalMs) || intervalMs <= 0) return null;
    if (nowMs < firstSpawnMs + BOSS_NOW_WINDOW_MS) return null;

    // Advance only cycles whose five-minute NOW window has completed. If the
    // app was closed, this catches up directly to the latest completed cycle.
    const completedCycles = Math.floor((nowMs - firstSpawnMs - BOSS_NOW_WINDOW_MS) / intervalMs) + 1;
    const latestSpawnMs = firstSpawnMs + (completedCycles - 1) * intervalMs;
    const nextSpawnMs = latestSpawnMs + intervalMs;

    return {
        last_kill_time: new Date(latestSpawnMs).toISOString(),
        next_spawn: new Date(nextSpawnMs).toISOString(),
        auto_advanced: true,
        pre_spawned: false,
        pre_spawn_expires_at: null,
        alerted_by: null,
        updated_at: new Date(nowMs).toISOString()
    };
}

function hasOverdueBoss(bosses, nowMs) {
    return (bosses || []).some(boss => calculateBossAutoAdvance(boss, nowMs) !== null);
}

async function autoAdvanceOverdueBosses(nowMs = Date.now()) {
    if (autoAdvancePromise) return autoAdvancePromise;
    if (!hasOverdueBoss(load().bosses, nowMs)) return false;

    autoAdvancePromise = (async () => {
        const result = await firebase.transactionBosses(current => {
            let changed = false;
            for (const key of Object.keys(current)) {
                const boss = current[key];
                const updates = calculateBossAutoAdvance(boss, nowMs);
                if (!updates) continue;
                current[key] = { ...boss, ...updates };
                changed = true;
            }
            return changed ? current : undefined;
        });

        if (!result.committed || !result.value) return false;
        const store = load();
        store.bosses = toArray(result.value);
        save();
        return true;
    })();

    try {
        return await autoAdvancePromise;
    } finally {
        autoAdvancePromise = null;
    }
}

// Convert RTDB object-or-array to standard JS array
function toArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val.filter(Boolean);
    return Object.values(val).filter(Boolean);
}

function applyRemoteStore(remoteData) {
    if (!remoteData) return false;
    if (remoteData.bosses) cache.bosses = toArray(remoteData.bosses);
    if (remoteData.allEvents) cache.allEvents = toArray(remoteData.allEvents);
    if (remoteData.resetTimeConfigs) cache.resetTimeConfigs = remoteData.resetTimeConfigs;
    if (remoteData.settings) cache.settings = remoteData.settings;
    if (remoteData.savedMaintenanceEndTime !== undefined) cache.savedMaintenanceEndTime = remoteData.savedMaintenanceEndTime;
    if (remoteData.killHistory) cache.killHistory = toArray(remoteData.killHistory);
    if (remoteData.liveEvent) cache.liveEvent = remoteData.liveEvent;
    if (remoteData.recentLiveEvents) cache.recentLiveEvents = toArray(remoteData.recentLiveEvents);
    cache.meta = { ...(cache.meta || {}), ...(remoteData.meta || {}) };
    hasCloudSnapshot = Boolean(remoteData.bosses);
    lastCloudSyncAt = Date.now();
    save();
    return hasCloudSnapshot;
}

// Initialize Firebase integration
async function initFirebase(onRemoteChange) {
    if (isInitializedFirebase) return;
    load(); // ensure local cache is loaded

    const connected = firebase.init((remoteData) => {
        if (remoteData) {
            console.log('🔄 [Firebase RTDB] Remote data update received from Firebase');
            applyRemoteStore(remoteData);

            if (typeof onRemoteChange === 'function') {
                onRemoteChange(remoteData);
            }
        }
    });

    if (connected) {
        isInitializedFirebase = true;
        // Check if Firebase RTDB already has data or needs initial seeding
        try {
            const remoteStore = await firebase.fetchOnce();
            if (!remoteStore || !remoteStore.bosses || (Array.isArray(remoteStore.bosses) && remoteStore.bosses.length === 0)) {
                console.log('🌱 [Firebase RTDB] Initial seeding local store to Firebase Realtime Database (Single Source of Truth)...');
                const seeded = await firebase.syncFullStore(cache);
                if (seeded) {
                    cache.meta = { ...(cache.meta || {}), dataRevision: Math.max(1, Number(cache.meta?.dataRevision) || 0) };
                    hasCloudSnapshot = true;
                    lastCloudSyncAt = Date.now();
                    console.log(`✅ [Firebase RTDB] Seeded ${cache.bosses?.length || 0} bosses, ${cache.allEvents?.length || 0} events, and configs to Firebase!`);
                }
            } else {
                console.log('📥 [Firebase RTDB] Cloud database found! Syncing cloud master data to local cache...');
                applyRemoteStore(remoteStore);
                console.log(`✅ [Firebase RTDB] Synced ${cache.bosses.length} bosses from Firebase cloud.`);
            }
        } catch (e) {
            console.error('⚠️ [Firebase RTDB] Initial fetch error:', e.message);
        }
    } else {
        // Watch for serviceAccountKey.json placement
        watchForServiceAccountKey(onRemoteChange);
    }
}

// Watch directory so if user drops serviceAccountKey.json later, it connects automatically
function watchForServiceAccountKey(onRemoteChange) {
    if (process.env.VERCEL) return; // Do not hold timer in serverless functions
    const config = firebase.getConfig();
    if (config.offlineMode || config.enabled === false) return;

    let checkInterval = setInterval(async () => {
        const key = firebase.findServiceAccountKey();
        if (key) {
            console.log(`✨ [Firebase RTDB] Detected new key: ${key}! Connecting to Firebase...`);
            clearInterval(checkInterval);
            await initFirebase(onRemoteChange);
        }
    }, 4000);
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Get current date & time in Thai timezone (UTC+7)
function getThaiDateInfo(d = new Date()) {
    const thaiDate = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return {
        year: thaiDate.getUTCFullYear(),
        month: thaiDate.getUTCMonth(),
        date: thaiDate.getUTCDate(),
        day: thaiDate.getUTCDay(),
        dayName: DAYS[thaiDate.getUTCDay()],
        dateStr: `${thaiDate.getUTCFullYear()}-${String(thaiDate.getUTCMonth() + 1).padStart(2, '0')}-${String(thaiDate.getUTCDate()).padStart(2, '0')}`
    };
}

// Convert Thai (year, month, day, hours, minutes) to UTC Date object
function makeThaiDateTime(y, m, d, h, min) {
    return new Date(Date.UTC(y, m, d, h - 7, min, 0, 0));
}

// Format date into ISO-8601 string with +07:00 timezone offset matching Kain7
function formatThaiIso(y, m, d, h, min) {
    const yStr = String(y);
    const mStr = String(m + 1).padStart(2, '0');
    const dStr = String(d).padStart(2, '0');
    const hStr = String(h).padStart(2, '0');
    const minStr = String(min).padStart(2, '0');
    return `${yStr}-${mStr}-${dStr}T${hStr}:${minStr}:00+07:00`;
}

// Calculate the next spawn ISO timestamp for an event based on its schedule
function calculateNextEventSpawn(event, now = new Date()) {
    if (!event || !event.occurs_on || event.occurs_on.length === 0 || !event.event_time) {
        return null;
    }

    const [hours, minutes] = event.event_time.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return null;

    const thai = getThaiDateInfo(now);
    const targetDays = event.occurs_on.map(d => DAYS.indexOf(d.toLowerCase())).filter(d => d !== -1);
    if (targetDays.length === 0) return null;

    const autoDoneMs = (Number(event.auto_done_minutes) || 10) * 60 * 1000;

    // Check if event is scheduled for today (offset = 0)
    if (targetDays.includes(thai.day)) {
        const todaySpawn = makeThaiDateTime(thai.year, thai.month, thai.date, hours, minutes);
        const expiresAt = todaySpawn.getTime() + autoDoneMs;

        // If pinned alive, today's event remains active
        if (event.pinned_alive) {
            return formatThaiIso(thai.year, thai.month, thai.date, hours, minutes);
        }

        // If not marked done today and hasn't expired yet, today is the spawn!
        if (event.done_on !== thai.dateStr && now.getTime() <= expiresAt) {
            return formatThaiIso(thai.year, thai.month, thai.date, hours, minutes);
        }
    }

    // Otherwise find the next occurrence (offsets 1 through 14)
    for (let offset = 1; offset <= 14; offset++) {
        const futureThaiMs = now.getTime() + 7 * 3600000 + offset * 86400000;
        const futureThaiDate = new Date(futureThaiMs);
        const fYear = futureThaiDate.getUTCFullYear();
        const fMonth = futureThaiDate.getUTCMonth();
        const fDate = futureThaiDate.getUTCDate();
        const fDay = futureThaiDate.getUTCDay();

        if (targetDays.includes(fDay)) {
            return formatThaiIso(fYear, fMonth, fDate, hours, minutes);
        }
    }

    return null;
}

module.exports = {
    getThaiDateInfo,
    calculateNextEventSpawn,
    calculateBossAutoAdvance,
    initFirebase,

    getFirebaseStatus() {
        const store = load();
        const config = firebase.getConfig();
        const health = firebase.getHealthStatus();
        let status = 'offline';
        if (health.lastErrorCode === 'quota_exceeded') status = 'quota_exceeded';
        else if (health.lastErrorCode === 'configuration_error' || health.lastErrorCode === 'permission_denied') status = 'configuration_error';
        else if (health.connected) status = 'connected';
        else if (health.initialized && hasCloudSnapshot && health.lastErrorCode) status = 'stale';
        else if (health.initialized) status = 'connecting';
        return {
            connected: health.connected,
            initialized: health.initialized,
            status,
            lastErrorCode: health.lastErrorCode,
            lastErrorAt: health.lastErrorAt,
            lastSuccessfulOperationAt: health.lastSuccessfulOperationAt,
            strictCloudMode: Boolean(config.strictCloudMode),
            projectId: config.projectId,
            credentialsConfigured: health.initialized,
            totalBosses: (store && store.bosses) ? store.bosses.length : 0,
            cloudDataReady: hasCloudSnapshot,
            dataRevision: Number(store?.meta?.dataRevision) || 0,
            lastCloudSyncAt: lastCloudSyncAt || null
        };
    },

    getStore() {
        return load();
    },

    getBosses() {
        return load().bosses || [];
    },

    isCloudDataReady() {
        return hasCloudSnapshot;
    },

    async ensureCloudDataReady() {
        if (hasCloudSnapshot) return true;
        if (!firebase.isReady()) return false;
        if (cloudRefreshPromise) return cloudRefreshPromise;

        cloudRefreshPromise = (async () => {
            // A freshly started Vercel instance can receive the redirected page
            // before its RTDB value listener has delivered the first snapshot.
            // Retry only during this cold-start path, never on the polling timer.
            for (let attempt = 0; attempt < 2 && !hasCloudSnapshot; attempt++) {
                const remoteStore = await firebase.fetchOnce();
                if (remoteStore?.bosses && applyRemoteStore(remoteStore)) return true;
                if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 150));
            }
            return hasCloudSnapshot;
        })();

        try {
            return await cloudRefreshPromise;
        } finally {
            cloudRefreshPromise = null;
        }
    },

    getDataRevision() {
        return Number(load().meta?.dataRevision) || 0;
    },

    getLastCloudSyncAt() {
        return lastCloudSyncAt;
    },

    autoAdvanceOverdueBosses,

    async expireBossAlerts(nowMs = Date.now()) {
        return this.batchUpdateBosses(boss => {
            if (!boss.pre_spawned || !boss.pre_spawn_expires_at) return null;
            const expiry = new Date(boss.pre_spawn_expires_at).getTime();
            if (!Number.isFinite(expiry) || expiry > nowMs) return null;
            return { pre_spawned: false, pre_spawn_expires_at: null, alerted_by: null };
        });
    },

    getBoss(id) {
        const numId = Number(id);
        return (load().bosses || []).find(b => b.id === numId);
    },

    async createBoss(bossData) {
        const store = load();
        const maxId = store.bosses.reduce((max, b) => Math.max(max, b.id || 0), 0);
        const newBoss = {
            id: maxId + 1,
            name: bossData.name,
            location: bossData.location || '',
            interval: Number(bossData.interval) || 60,
            is_invasion: Boolean(bossData.is_invasion),
            chance_of_appearing: bossData.chance_of_appearing || '100.00',
            last_kill_time: bossData.last_kill_time || null,
            next_spawn: bossData.next_spawn || null,
            auto_advanced: false,
            post_maintenance: false,
            pinned_alive: false,
            pre_spawned: false,
            pre_spawn_expires_at: null,
            alerted_by: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        store.bosses.push(newBoss);
        save();
        await firebase.syncBoss(store.bosses.length - 1, newBoss);
        return newBoss;
    },

    async updateBoss(id, updates) {
        const store = load();
        const numId = Number(id);
        const idx = store.bosses.findIndex(b => b.id === numId);
        if (idx === -1) return null;

        const previous = { ...store.bosses[idx] };

        store.bosses[idx] = {
            ...store.bosses[idx],
            ...updates,
            updated_at: new Date().toISOString()
        };
        const now = Date.now();
        const liveEvent = {
            id: `${now}-${numId}-${Math.random().toString(36).slice(2, 8)}`,
            type: updates.next_spawn === null && updates.last_kill_time === null
                ? 'boss_time_unset'
                : updates.pre_spawned === true && (!previous.pre_spawned || updates.pre_spawn_expires_at !== previous.pre_spawn_expires_at)
                ? 'boss_pre_spawn_started'
                : updates.pre_spawned === false && previous.pre_spawned
                    ? 'boss_pre_spawn_cleared'
                    : 'boss_updated',
            bossId: numId,
            bossName: store.bosses[idx].name,
            boss: store.bosses[idx],
            createdAt: now
        };
        store.liveEvent = liveEvent;
        store.recentLiveEvents = [...(store.recentLiveEvents || []), liveEvent].slice(-20);
        save();
        await firebase.syncBossAndLiveEvent(idx, store.bosses[idx], liveEvent, store.recentLiveEvents);
        return store.bosses[idx];
    },

    async deleteBoss(id) {
        const store = load();
        const numId = Number(id);
        const idx = store.bosses.findIndex(b => b.id === numId);
        if (idx === -1) return false;
        store.bosses.splice(idx, 1);
        save();
        await firebase.syncAllBosses(store.bosses);
        return true;
    },

    async batchUpdateBosses(updaterFn) {
        const store = load();
        let changed = false;
        const firebaseChanges = {};
        for (let i = 0; i < store.bosses.length; i++) {
            const updates = updaterFn(store.bosses[i]);
            if (updates) {
                store.bosses[i] = {
                    ...store.bosses[i],
                    ...updates,
                    updated_at: new Date().toISOString()
                };
                firebaseChanges[i] = store.bosses[i];
                changed = true;
            }
        }
        if (changed) {
            save();
            await firebase.syncBossUpdates(firebaseChanges);
        }
        return store.bosses;
    },

    getAllEvents() {
        const store = load();
        const all = store.allEvents || [];
        const now = new Date();
        return all.map(e => ({
            ...e,
            next_spawn: calculateNextEventSpawn(e, now)
        }));
    },

    getEvents() {
        const store = load();
        const all = store.allEvents || [];
        const now = new Date();
        const thai = getThaiDateInfo(now);

        return all
            .filter(e => {
                if (!e.occurs_on) return true;
                const occursToday = e.occurs_on.map(d => d.toLowerCase()).includes(thai.dayName);
                if (!occursToday) return false;

                // If pinned alive, always keep active
                if (e.pinned_alive) return true;

                // If marked done or skipped today, exclude from today's active table
                if (e.done_on === thai.dateStr) return false;

                // If auto_done_minutes has expired, exclude
                const [hours, minutes] = (e.event_time || '21:00').split(':').map(Number);
                if (!isNaN(hours) && !isNaN(minutes)) {
                    const spawnDate = makeThaiDateTime(thai.year, thai.month, thai.date, hours, minutes);
                    const autoDoneMs = (Number(e.auto_done_minutes) || 10) * 60 * 1000;
                    if (now.getTime() > spawnDate.getTime() + autoDoneMs) {
                        return false;
                    }
                }

                return true;
            })
            .map(e => ({
                ...e,
                next_spawn: calculateNextEventSpawn(e, now)
            }));
    },

    getEvent(id) {
        const numId = Number(id);
        const all = load().allEvents || [];
        const found = all.find(e => e.id === numId);
        if (!found) return null;
        return {
            ...found,
            next_spawn: calculateNextEventSpawn(found, new Date())
        };
    },

    async createEvent(eventData) {
        const store = load();
        if (!store.allEvents) store.allEvents = [];
        const maxId = store.allEvents.reduce((max, e) => Math.max(max, e.id || 0), 0);
        const newEvent = {
            id: maxId + 1,
            name: eventData.name,
            location: eventData.location || '',
            is_invasion: false,
            interval: 0,
            last_kill_time: null,
            auto_advanced: false,
            post_maintenance: false,
            pinned_alive: false,
            pre_spawned: false,
            chance_of_appearing: '100.00',
            next_spawn: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_event: true,
            event_time: eventData.event_time || '21:00',
            occurs_on: eventData.occurs_on || ['saturday', 'sunday'],
            done_on: null,
            auto_done_minutes: Number(eventData.auto_done_minutes) || 10
        };
        newEvent.next_spawn = calculateNextEventSpawn(newEvent, new Date());
        store.allEvents.push(newEvent);
        save();
        await firebase.syncAllEvents(store.allEvents);
        return newEvent;
    },

    async updateEvent(id, updates) {
        const store = load();
        const numId = Number(id);
        if (!store.allEvents) store.allEvents = [];
        const idx = store.allEvents.findIndex(e => e.id === numId);
        if (idx === -1) return null;

        const merged = {
            ...store.allEvents[idx],
            ...updates,
            updated_at: new Date().toISOString()
        };
        merged.next_spawn = calculateNextEventSpawn(merged, new Date());
        store.allEvents[idx] = merged;
        save();
        await firebase.syncAllEvents(store.allEvents);
        return store.allEvents[idx];
    },

    async deleteEvent(id) {
        const store = load();
        const numId = Number(id);
        if (!store.allEvents) return false;
        const idx = store.allEvents.findIndex(e => e.id === numId);
        if (idx === -1) return false;
        store.allEvents.splice(idx, 1);
        save();
        await firebase.syncAllEvents(store.allEvents);
        return true;
    },

    getResetConfigs() {
        return load().resetTimeConfigs || {};
    },

    async saveResetConfigs(configs) {
        const store = load();
        store.resetTimeConfigs = { ...store.resetTimeConfigs, ...configs };
        save();
        await firebase.syncResetConfigs(store.resetTimeConfigs);
        return store.resetTimeConfigs;
    },

    getSettings() {
        return load().settings || {};
    },

    getLiveEvent() {
        return load().liveEvent || null;
    },

    getRecentLiveEvents() {
        return load().recentLiveEvents || [];
    },

    async publishLiveEvent(eventData) {
        const store = load();
        const liveEvent = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            ...eventData
        };
        store.liveEvent = liveEvent;
        store.recentLiveEvents = [...(store.recentLiveEvents || []), liveEvent].slice(-20);
        save();
        await firebase.syncLiveEvent(liveEvent, store.recentLiveEvents);
        return liveEvent;
    },

    async updateSettings(updates) {
        const store = load();
        store.settings = {
            ...store.settings,
            ...updates
        };
        save();
        await firebase.syncSettings(store.settings);
        return store.settings;
    },

    getSavedMaintenanceEndTime() {
        return load().savedMaintenanceEndTime;
    },

    async setSavedMaintenanceEndTime(time) {
        const store = load();
        store.savedMaintenanceEndTime = time;
        save();
        await firebase.syncSavedMaintenanceEndTime(time);
        return time;
    },

    getKillHistory(limit = 100) {
        const store = load();
        const list = store.killHistory || [];
        return list.slice(-limit).reverse();
    },

    addKillHistory(record) {
        const store = load();
        if (!store.killHistory) store.killHistory = [];
        const entry = {
            ...record,
            timestamp: record.timestamp || new Date().toISOString()
        };
        store.killHistory.push(entry);
        if (store.killHistory.length > 500) {
            store.killHistory = store.killHistory.slice(-500);
        }
        save();
        if (typeof firebase.syncKillHistory === 'function') {
            firebase.syncKillHistory(store.killHistory);
        }
        return entry;
    },

    _test: { calculateBossAutoAdvance }
};
