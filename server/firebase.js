const fs = require('fs');
const path = require('path');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getDatabase, ServerValue } = require('firebase-admin/database');

let dbRef = null;
let isInitialized = false;
let isConnected = false;
let serviceAccountPathUsed = null;
let lastErrorCode = null;
let lastErrorAt = null;
let lastSuccessfulOperationAt = null;

function classifyFirebaseError(error) {
    const detail = `${error?.code || ''} ${error?.message || error || ''}`.toLowerCase();
    if (/quota|resource[_ -]?exhausted|limit[_ -]?exceeded|too many requests|429/.test(detail)) return 'quota_exceeded';
    if (/permission[_ -]?denied|unauthorized|forbidden|401|403/.test(detail)) return 'permission_denied';
    if (/credential|private key|service account|invalid_grant|app\/invalid-credential/.test(detail)) return 'configuration_error';
    if (/timeout|timed out|deadline|network|socket|econn|unavailable|dns/.test(detail)) return 'unavailable';
    return 'firebase_error';
}

function recordFirebaseError(operation, error) {
    isConnected = false;
    lastErrorCode = classifyFirebaseError(error);
    lastErrorAt = Date.now();
    console.error(`[Firebase RTDB] ${operation} error:`, error?.message || String(error));
}

function recordFirebaseSuccess() {
    lastSuccessfulOperationAt = Date.now();
    if (lastErrorCode === 'quota_exceeded' && Date.now() - lastErrorAt < 60000) return;
    lastErrorCode = null;
    lastErrorAt = null;
}

function getHealthStatus() {
    const recentlySucceeded = lastSuccessfulOperationAt && Date.now() - lastSuccessfulOperationAt < 60000;
    return {
        connected: isReady() && (isConnected || Boolean(recentlySucceeded)),
        transportConnected: isActuallyConnected(),
        initialized: isReady(),
        lastErrorCode,
        lastErrorAt,
        lastSuccessfulOperationAt
    };
}

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
            recordFirebaseError('service account parsing', e);
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
                recordFirebaseError('service account read', e);
            }
        }
    }

    // 3. Check cloud runtime credentials (for Vercel / Serverless deployments)
    if (!serviceAccount) {
        lastErrorCode = 'configuration_error';
        lastErrorAt = Date.now();
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
            if (isConnected) recordFirebaseSuccess();
        }, (error) => {
            recordFirebaseError('connection status', error);
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
                    recordFirebaseSuccess();
                    onRemoteDataChange(val);
                }
            }, (err) => {
                recordFirebaseError('listener', err);
            });
        }

        return true;
    } catch (err) {
        recordFirebaseError('initialization', err);
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

function revisionUpdate(payload) {
    return {
        ...payload,
        'meta/dataRevision': ServerValue.increment(1),
        'meta/updatedAt': ServerValue.TIMESTAMP
    };
}

// Sync full store to Firebase (e.g. for initial seed or full backup)
async function syncFullStore(store) {
    if (!isReady()) return false;
    try {
        const payload = {
            ...store,
            resetTimeConfigs: encodeFirebaseKeys(store.resetTimeConfigs),
            meta: {
                ...(store.meta || {}),
                dataRevision: Math.max(1, Number(store.meta?.dataRevision) || 0),
                updatedAt: ServerValue.TIMESTAMP
            }
        };
        await dbRef.set(payload);
        recordFirebaseSuccess();
        return true;
    } catch (e) {
        recordFirebaseError('syncFullStore', e);
        return false;
    }
}

// Sync specific boss update
async function syncBoss(bossIndex, bossData) {
    if (!isReady()) return false;
    try {
        await dbRef.update(revisionUpdate({ [`bosses/${bossIndex}`]: bossData }));
        recordFirebaseSuccess();
        return true;
    } catch (e) {
        recordFirebaseError('syncBoss', e);
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
        await dbRef.update(revisionUpdate(payload));
        recordFirebaseSuccess();
        return true;
    } catch (e) {
        recordFirebaseError('syncBossUpdates', e);
        return false;
    }
}

// One atomic RTDB write: update the changed boss and publish a tiny event.
async function syncBossAndLiveEvent(bossIndex, bossData, liveEvent, recentLiveEvents) {
    if (!isReady()) return false;
    try {
        await dbRef.update(revisionUpdate({
            [`bosses/${bossIndex}`]: bossData,
            liveEvent,
            recentLiveEvents
        }));
        recordFirebaseSuccess();
        return true;
    } catch (e) {
        recordFirebaseError('syncBossAndLiveEvent', e);
        return false;
    }
}

async function syncLiveEvent(liveEvent, recentLiveEvents) {
    if (!isReady()) return false;
    try {
        await dbRef.update(revisionUpdate({ liveEvent, recentLiveEvents }));
        recordFirebaseSuccess();
        return true;
    } catch (e) {
        recordFirebaseError('syncLiveEvent', e);
        return false;
    }
}

// Sync entire bosses list
async function syncAllBosses(bosses) {
    if (!isReady()) return false;
    try {
        await dbRef.update(revisionUpdate({ bosses }));
        recordFirebaseSuccess();
        return true;
    } catch (e) {
        recordFirebaseError('syncAllBosses', e);
        return false;
    }
}

// Run a conditional bosses update atomically across all server instances.
// The transaction is aborted when transform returns no value.
async function transactionBosses(transform) {
    if (!isReady()) return { committed: false, value: null };
    try {
        const result = await dbRef.transaction(currentRoot => {
            if (!currentRoot?.bosses) return;
            const bosses = transform(currentRoot.bosses);
            if (!bosses) return;
            return {
                ...currentRoot,
                bosses,
                meta: {
                    ...(currentRoot.meta || {}),
                    dataRevision: (Number(currentRoot.meta?.dataRevision) || 0) + 1,
                    updatedAt: Date.now()
                }
            };
        });
        recordFirebaseSuccess();
        return {
            committed: result.committed,
            value: result.committed ? result.snapshot.val()?.bosses : null,
            revision: result.committed ? Number(result.snapshot.val()?.meta?.dataRevision) || 0 : 0
        };
    } catch (e) {
        recordFirebaseError('transactionBosses', e);
        return { committed: false, value: null };
    }
}

// Sync events
async function syncAllEvents(allEvents) {
    if (!isReady()) return false;
    try {
        await dbRef.update(revisionUpdate({ allEvents }));
        recordFirebaseSuccess();
        return true;
    } catch (e) {
        recordFirebaseError('syncAllEvents', e);
        return false;
    }
}

// Sync reset configs
async function syncResetConfigs(configs) {
    if (!isReady()) return false;
    try {
        await dbRef.update(revisionUpdate({ resetTimeConfigs: encodeFirebaseKeys(configs) }));
        recordFirebaseSuccess();
        return true;
    } catch (e) {
        recordFirebaseError('syncResetConfigs', e);
        return false;
    }
}

// Sync settings
async function syncSettings(settings) {
    if (!isReady()) return false;
    try {
        await dbRef.update(revisionUpdate({ settings }));
        recordFirebaseSuccess();
        return true;
    } catch (e) {
        recordFirebaseError('syncSettings', e);
        return false;
    }
}

// Sync saved maintenance end time
async function syncSavedMaintenanceEndTime(time) {
    if (!isReady()) return false;
    try {
        await dbRef.update(revisionUpdate({ savedMaintenanceEndTime: time }));
        recordFirebaseSuccess();
        return true;
    } catch (e) {
        recordFirebaseError('syncSavedMaintenanceEndTime', e);
        return false;
    }
}

// Sync kill history
async function syncKillHistory(killHistory) {
    if (!isReady()) return false;
    try {
        await dbRef.update(revisionUpdate({ killHistory }));
        recordFirebaseSuccess();
        return true;
    } catch (e) {
        recordFirebaseError('syncKillHistory', e);
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
        recordFirebaseSuccess();
        return val;
    } catch (e) {
        recordFirebaseError('fetchOnce', e);
        return null;
    }
}

module.exports = {
    init,
    isReady,
    isActuallyConnected,
    getHealthStatus,
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
    syncKillHistory,
    _test: { classifyFirebaseError }
};
