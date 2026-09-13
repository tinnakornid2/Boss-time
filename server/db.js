const fs = require('fs');
const path = require('path');
const firebase = require('./firebase');

const dataFile = path.join(__dirname, 'data', 'store.json');
let cache = null;
let isInitializedFirebase = false;

function load() {
    if (!cache) {
        if (!fs.existsSync(dataFile)) {
            throw new Error(`Data store not found at ${dataFile}`);
        }
        cache = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
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

// Convert RTDB object-or-array to standard JS array
function toArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val.filter(Boolean);
    return Object.values(val).filter(Boolean);
}

// Initialize Firebase integration
async function initFirebase(onRemoteChange) {
    if (isInitializedFirebase) return;
    load(); // ensure local cache is loaded

    const connected = firebase.init((remoteData) => {
        if (remoteData) {
            console.log('🔄 [Firebase RTDB] Remote data update received from Firebase');
            if (remoteData.bosses) cache.bosses = toArray(remoteData.bosses);
            if (remoteData.allEvents) cache.allEvents = toArray(remoteData.allEvents);
            if (remoteData.resetTimeConfigs) cache.resetTimeConfigs = remoteData.resetTimeConfigs;
            if (remoteData.settings) cache.settings = remoteData.settings;
            if (remoteData.savedMaintenanceEndTime !== undefined) {
                cache.savedMaintenanceEndTime = remoteData.savedMaintenanceEndTime;
            }
            if (remoteData.killHistory) cache.killHistory = toArray(remoteData.killHistory);
            save();

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
                await firebase.syncFullStore(cache);
                console.log(`✅ [Firebase RTDB] Seeded ${cache.bosses?.length || 0} bosses, ${cache.allEvents?.length || 0} events, and configs to Firebase!`);
            } else {
                console.log('📥 [Firebase RTDB] Cloud database found! Syncing cloud master data to local cache...');
                if (remoteStore.bosses) cache.bosses = toArray(remoteStore.bosses);
                if (remoteStore.allEvents) cache.allEvents = toArray(remoteStore.allEvents);
                if (remoteStore.resetTimeConfigs) cache.resetTimeConfigs = remoteStore.resetTimeConfigs;
                if (remoteStore.settings) cache.settings = remoteStore.settings;
                if (remoteStore.savedMaintenanceEndTime !== undefined) {
                    cache.savedMaintenanceEndTime = remoteStore.savedMaintenanceEndTime;
                }
                if (remoteStore.killHistory) cache.killHistory = toArray(remoteStore.killHistory);
                save();
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

module.exports = {
    initFirebase,

    getFirebaseStatus() {
        const store = load();
        const config = firebase.getConfig();
        const keyPath = firebase.findServiceAccountKey();
        return {
            connected: firebase.isReady(),
            strictCloudMode: Boolean(config.strictCloudMode),
            projectId: config.projectId,
            databaseURL: config.databaseURL,
            serviceAccountKeyFound: Boolean(keyPath),
            keyPath: keyPath ? path.basename(keyPath) : null,
            totalBosses: (store && store.bosses) ? store.bosses.length : 0
        };
    },

    getStore() {
        return load();
    },

    getBosses() {
        return load().bosses || [];
    },

    getBoss(id) {
        const numId = Number(id);
        return (load().bosses || []).find(b => b.id === numId);
    },

    createBoss(bossData) {
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
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        store.bosses.push(newBoss);
        save();
        firebase.syncAllBosses(store.bosses);
        return newBoss;
    },

    updateBoss(id, updates) {
        const store = load();
        const numId = Number(id);
        const idx = store.bosses.findIndex(b => b.id === numId);
        if (idx === -1) return null;

        store.bosses[idx] = {
            ...store.bosses[idx],
            ...updates,
            updated_at: new Date().toISOString()
        };
        save();
        firebase.syncBoss(idx, store.bosses[idx]);
        return store.bosses[idx];
    },

    deleteBoss(id) {
        const store = load();
        const numId = Number(id);
        const idx = store.bosses.findIndex(b => b.id === numId);
        if (idx === -1) return false;
        store.bosses.splice(idx, 1);
        save();
        firebase.syncAllBosses(store.bosses);
        return true;
    },

    getAllEvents() {
        const store = load();
        return store.allEvents || [];
    },

    getEvents() {
        const store = load();
        const all = store.allEvents || [];
        const todayDay = DAYS[new Date().getDay()];
        return all.filter(e => {
            if (!e.occurs_on) return true;
            return e.occurs_on.map(d => d.toLowerCase()).includes(todayDay);
        });
    },

    getEvent(id) {
        const numId = Number(id);
        const all = load().allEvents || [];
        return all.find(e => e.id === numId);
    },

    createEvent(eventData) {
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
        store.allEvents.push(newEvent);
        save();
        firebase.syncAllEvents(store.allEvents);
        return newEvent;
    },

    updateEvent(id, updates) {
        const store = load();
        const numId = Number(id);
        if (!store.allEvents) store.allEvents = [];
        const idx = store.allEvents.findIndex(e => e.id === numId);
        if (idx === -1) return null;

        store.allEvents[idx] = {
            ...store.allEvents[idx],
            ...updates,
            updated_at: new Date().toISOString()
        };
        save();
        firebase.syncAllEvents(store.allEvents);
        return store.allEvents[idx];
    },

    deleteEvent(id) {
        const store = load();
        const numId = Number(id);
        if (!store.allEvents) return false;
        const idx = store.allEvents.findIndex(e => e.id === numId);
        if (idx === -1) return false;
        store.allEvents.splice(idx, 1);
        save();
        firebase.syncAllEvents(store.allEvents);
        return true;
    },

    getResetConfigs() {
        return load().resetTimeConfigs || {};
    },

    saveResetConfigs(configs) {
        const store = load();
        store.resetTimeConfigs = { ...store.resetTimeConfigs, ...configs };
        save();
        firebase.syncResetConfigs(store.resetTimeConfigs);
        return store.resetTimeConfigs;
    },

    getSettings() {
        return load().settings || {};
    },

    updateSettings(updates) {
        const store = load();
        store.settings = {
            ...store.settings,
            ...updates
        };
        save();
        firebase.syncSettings(store.settings);
        return store.settings;
    },

    getSavedMaintenanceEndTime() {
        return load().savedMaintenanceEndTime;
    },

    setSavedMaintenanceEndTime(time) {
        const store = load();
        store.savedMaintenanceEndTime = time;
        save();
        firebase.syncSavedMaintenanceEndTime(time);
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
    }
};
