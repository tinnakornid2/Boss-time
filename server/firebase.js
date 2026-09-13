const fs = require('fs');
const path = require('path');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

let dbRef = null;
let isInitialized = false;
let isConnected = false;
let serviceAccountPathUsed = null;

// Helper: Escape invalid Firebase characters in keys (., #, $, /, [, ])
function encodeFirebaseKeys(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
        const safeKey = k
            .replace(/%/g, '%25')
            .replace(/\./g, '%2E')
            .replace(/#/g, '%23')
            .replace(/\$/g, '%24')
            .replace(/\//g, '%2F')
            .replace(/\[/g, '%5B')
            .replace(/\]/g, '%5D');
        result[safeKey] = v;
    }
    return result;
}

function decodeFirebaseKeys(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
        let cleanKey = k;
        try {
            cleanKey = decodeURIComponent(k);
        } catch (e) {}
        result[cleanKey] = v;
    }
    return result;
}

// Load config
function getConfig() {
    try {
        return require('./firebase-config.json');
    } catch (e) {}
    const configPath = path.join(__dirname, 'firebase-config.json');
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {
            console.error('[Firebase] Failed to parse firebase-config.json:', e.message);
        }
    }
    return {
        projectId: 'boss-timel2m',
        databaseURL: 'https://boss-timel2m-default-rtdb.asia-southeast1.firebasedatabase.app',
        rootPath: 'tracker'
    };
}

// Find serviceAccountKey.json in several likely locations
function findServiceAccountKey() {
    const config = getConfig();
    if (config.offlineMode || config.enabled === false) return null;

    const candidateDirs = [
        __dirname,
        path.join(__dirname, '..'),
        path.join(process.env.USERPROFILE || 'C:\\Users\\tinna', 'Downloads')
    ];

    // 1. Direct specified name in server/ or root
    const explicitFiles = [
        config.serviceAccountPath ? path.resolve(__dirname, config.serviceAccountPath) : null,
        path.join(__dirname, 'serviceAccountKey.json'),
        path.join(__dirname, '..', 'serviceAccountKey.json'),
        process.env.GOOGLE_APPLICATION_CREDENTIALS
    ].filter(Boolean);

    for (const f of explicitFiles) {
        if (fs.existsSync(f)) return f;
    }

    // 2. Scan directories for any *firebase-adminsdk*.json
    for (const dir of candidateDirs) {
        if (!fs.existsSync(dir)) continue;
        try {
            const files = fs.readdirSync(dir);
            // First check for boss-timel2m specifically
            const matchSpecific = files.find(f => f.toLowerCase().includes('boss-timel2m') && f.endsWith('.json'));
            if (matchSpecific) return path.join(dir, matchSpecific);

            // Next check for any firebase-adminsdk json
            const matchAdminSdk = files.find(f => f.toLowerCase().includes('firebase-adminsdk') && f.endsWith('.json'));
            if (matchAdminSdk) return path.join(dir, matchAdminSdk);
        } catch (e) {}
    }

    return null;
}

// Initialize Firebase Admin SDK
function init(onRemoteDataChange) {
    if (isInitialized) return true;

    const config = getConfig();
    if (config.offlineMode || config.enabled === false) {
        console.log('----------------------------------------------------');
        console.log('💾 [Offline Mode] System is running in 100% Local Offline Mode.');
        console.log('📦 Data persistence: server/data/store.json');
        console.log('☁️  Cloud sync (Firebase) is disabled.');
        console.log('----------------------------------------------------');
        return false;
    }

    let serviceAccount = null;
    let keySource = null;

    // 1. Check environment variable (ideal for Vercel / Cloud deployments)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
            if (raw.startsWith('{')) {
                serviceAccount = JSON.parse(raw);
            } else {
                // Try base64
                const decoded = Buffer.from(raw, 'base64').toString('utf8');
                serviceAccount = JSON.parse(decoded);
            }
            keySource = 'FIREBASE_SERVICE_ACCOUNT (env variable)';
        } catch (e) {
            console.error('[Firebase RTDB] Failed to parse FIREBASE_SERVICE_ACCOUNT env var:', e.message);
        }
    }

    // 2. Check local file if not found in env
    if (!serviceAccount) {
        const keyPath = findServiceAccountKey();
        if (keyPath) {
            try {
                serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
                keySource = path.basename(keyPath);
            } catch (e) {
                console.error('[Firebase RTDB] Failed to read key file:', e.message);
            }
        }
    }

    // 3. Check cloud runtime credentials (for Vercel / Serverless deployments)
    if (!serviceAccount) {
        try {
            const cloudCred = require('./cloud-credentials');
            if (typeof cloudCred.getCredentials === 'function') {
                serviceAccount = cloudCred.getCredentials();
                if (serviceAccount) {
                    keySource = 'Cloud Runtime Credentials (Vercel Production)';
                }
            }
        } catch (e) {}
    }

    if (!serviceAccount) {
        console.log('----------------------------------------------------');
        console.log('⚠️  [Firebase RTDB] serviceAccountKey not found yet.');
        console.log(`📌  Target Project: ${config.projectId}`);
        console.log(`📌  Database URL: ${config.databaseURL}`);
        console.log('📌  To connect:');
        console.log('    1. Open: https://console.firebase.google.com/u/0/project/' + config.projectId + '/settings/serviceaccounts/adminsdk');
        console.log('    2. Click "Generate new private key"');
        console.log('    3. Save file as "serviceAccountKey.json" in "server/" folder');
        console.log('    (Or in Vercel: set Environment Variable FIREBASE_SERVICE_ACCOUNT)');
        console.log('🔄  Operating in Local Storage fallback mode.');
        console.log('----------------------------------------------------');
        return false;
    }

    try {
        serviceAccountPathUsed = keySource;

        let dbUrl = process.env.FIREBASE_DATABASE_URL || config.databaseURL;
        if (!dbUrl || dbUrl.includes('example')) {
            dbUrl = `https://${serviceAccount.project_id || config.projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`;
        }

        let app;
        if (getApps().length === 0) {
            app = initializeApp({
                credential: cert(serviceAccount),
                databaseURL: dbUrl
            });
        } else {
            app = getApps()[0];
        }

        const rootNode = config.rootPath || 'tracker';
        dbRef = getDatabase(app).ref(rootNode);
        isInitialized = true;

        getDatabase(app).ref('.info/connected').on('value', (snapshot) => {
            isConnected = snapshot.val() === true;
        }, () => {
            isConnected = false;
        });

        console.log('====================================================');
        console.log(`🔥 [Firebase RTDB] Connected successfully to "${serviceAccount.project_id || config.projectId}"!`);
        console.log(`🌐 Database URL: ${dbUrl}`);
        console.log(`🔑 Key used: ${keySource}`);
        console.log('====================================================');

        // Set up real-time listener
        if (typeof onRemoteDataChange === 'function') {
            dbRef.on('value', (snapshot) => {
                const val = snapshot.val();
                if (val) {
                    if (val.resetTimeConfigs) {
                        val.resetTimeConfigs = decodeFirebaseKeys(val.resetTimeConfigs);
                    }
                    onRemoteDataChange(val);
                }
            }, (err) => {
                console.error('[Firebase RTDB] Listener error:', err.message);
            });
        }

        return true;
    } catch (err) {
        console.error('❌ [Firebase RTDB] Initialization error:', err.message);
        isInitialized = false;
        return false;
    }
}

// Check if ready
function isReady() {
    return isInitialized && dbRef !== null;
}

function isActuallyConnected() {
    return isReady() && isConnected;
}

// Get the root database reference
function getRef() {
    return dbRef;
}

// Sync full store to Firebase (e.g. for initial seed or full backup)
async function syncFullStore(store) {
    if (!isReady()) return false;
    try {
        const payload = {
            ...store,
            resetTimeConfigs: encodeFirebaseKeys(store.resetTimeConfigs)
        };
        await dbRef.set(payload);
        return true;
    } catch (e) {
        console.error('[Firebase RTDB] syncFullStore error:', e.message);
        return false;
    }
}

// Sync specific boss update
async function syncBoss(bossIndex, bossData) {
    if (!isReady()) return false;
    try {
        await dbRef.child(`bosses/${bossIndex}`).set(bossData);
        return true;
    } catch (e) {
        console.error('[Firebase RTDB] syncBoss error:', e.message);
        return false;
    }
}

// Update only the changed array positions in one RTDB request.
async function syncBossUpdates(changes) {
    if (!isReady()) return false;
    try {
        const payload = {};
        for (const [index, boss] of Object.entries(changes || {})) {
            payload[`bosses/${index}`] = boss;
        }
        if (Object.keys(payload).length === 0) return true;
        await dbRef.update(payload);
        return true;
    } catch (e) {
        isConnected = false;
        console.error('[Firebase RTDB] syncBossUpdates error:', e.message);
        return false;
    }
}

// One atomic RTDB write: update the changed boss and publish a tiny event.
async function syncBossAndLiveEvent(bossIndex, bossData, liveEvent, recentLiveEvents) {
    if (!isReady()) return false;
    try {
        await dbRef.update({
            [`bosses/${bossIndex}`]: bossData,
            liveEvent,
            recentLiveEvents
        });
        return true;
    } catch (e) {
        isConnected = false;
        console.error('[Firebase RTDB] syncBossAndLiveEvent error:', e.message);
        return false;
    }
}

async function syncLiveEvent(liveEvent, recentLiveEvents) {
    if (!isReady()) return false;
    try {
        await dbRef.update({ liveEvent, recentLiveEvents });
        return true;
    } catch (e) {
        isConnected = false;
        console.error('[Firebase RTDB] syncLiveEvent error:', e.message);
        return false;
    }
}

// Sync entire bosses list
async function syncAllBosses(bosses) {
    if (!isReady()) return false;
    try {
        await dbRef.child('bosses').set(bosses);
        return true;
    } catch (e) {
        console.error('[Firebase RTDB] syncAllBosses error:', e.message);
        return false;
    }
}

// Run a conditional bosses update atomically across all server instances.
// The transaction is aborted when transform returns no value.
async function transactionBosses(transform) {
    if (!isReady()) return { committed: false, value: null };
    try {
        const result = await dbRef.child('bosses').transaction(current => {
            if (!current) return;
            return transform(current) || undefined;
        });
        return {
            committed: result.committed,
            value: result.committed ? result.snapshot.val() : null
        };
    } catch (e) {
        isConnected = false;
        console.error('[Firebase RTDB] transactionBosses error:', e.message);
        return { committed: false, value: null };
    }
}

// Sync events
async function syncAllEvents(allEvents) {
    if (!isReady()) return false;
    try {
        await dbRef.child('allEvents').set(allEvents);
        return true;
    } catch (e) {
        console.error('[Firebase RTDB] syncAllEvents error:', e.message);
        return false;
    }
}

// Sync reset configs
async function syncResetConfigs(configs) {
    if (!isReady()) return false;
    try {
        await dbRef.child('resetTimeConfigs').set(encodeFirebaseKeys(configs));
        return true;
    } catch (e) {
        console.error('[Firebase RTDB] syncResetConfigs error:', e.message);
        return false;
    }
}

// Sync settings
async function syncSettings(settings) {
    if (!isReady()) return false;
    try {
        await dbRef.child('settings').set(settings);
        return true;
    } catch (e) {
        console.error('[Firebase RTDB] syncSettings error:', e.message);
        return false;
    }
}

// Sync saved maintenance end time
async function syncSavedMaintenanceEndTime(time) {
    if (!isReady()) return false;
    try {
        await dbRef.child('savedMaintenanceEndTime').set(time);
        return true;
    } catch (e) {
        console.error('[Firebase RTDB] syncSavedMaintenanceEndTime error:', e.message);
        return false;
    }
}

// Sync kill history
async function syncKillHistory(killHistory) {
    if (!isReady()) return false;
    try {
        await dbRef.child('killHistory').set(killHistory);
        return true;
    } catch (e) {
        console.error('[Firebase RTDB] syncKillHistory error:', e.message);
        return false;
    }
}

// Fetch initial data once from Firebase
async function fetchOnce() {
    if (!isReady()) return null;
    try {
        const snap = await dbRef.once('value');
        const val = snap.val();
        if (val && val.resetTimeConfigs) {
            val.resetTimeConfigs = decodeFirebaseKeys(val.resetTimeConfigs);
        }
        return val;
    } catch (e) {
        console.error('[Firebase RTDB] fetchOnce error:', e.message);
        return null;
    }
}

module.exports = {
    init,
    isReady,
    isActuallyConnected,
    getRef,
    getConfig,
    findServiceAccountKey,
    fetchOnce,
    syncFullStore,
    syncBoss,
    syncBossUpdates,
    syncBossAndLiveEvent,
    syncLiveEvent,
    syncAllBosses,
    transactionBosses,
    syncAllEvents,
    syncResetConfigs,
    syncSettings,
    syncSavedMaintenanceEndTime,
    syncKillHistory
};
