const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

let dbRef = null;
let isInitialized = false;
let serviceAccountPathUsed = null;

// Load config
function getConfig() {
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
        databaseURL: 'https://boss-timel2m-default-rtdb.firebaseio.com',
        rootPath: 'tracker'
    };
}

// Find serviceAccountKey.json in several likely locations
function findServiceAccountKey() {
    const config = getConfig();
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
            dbUrl = `https://${serviceAccount.project_id || config.projectId}-default-rtdb.firebaseio.com`;
        }

        if (admin.apps.length === 0) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: dbUrl
            });
        }

        const rootNode = config.rootPath || 'tracker';
        dbRef = admin.database().ref(rootNode);
        isInitialized = true;

        console.log('====================================================');
        console.log(`🔥 [Firebase RTDB] Connected successfully to "${serviceAccount.project_id || config.projectId}"!`);
        console.log(`🌐 Database URL: ${dbUrl}`);
        console.log(`🔑 Key used: ${path.basename(keyPath)}`);
        console.log('====================================================');

        // Set up real-time listener
        if (typeof onRemoteDataChange === 'function') {
            dbRef.on('value', (snapshot) => {
                const val = snapshot.val();
                if (val) {
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

// Get the root database reference
function getRef() {
    return dbRef;
}

// Sync full store to Firebase (e.g. for initial seed or full backup)
async function syncFullStore(store) {
    if (!isReady()) return false;
    try {
        await dbRef.set(store);
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
        await dbRef.child('resetTimeConfigs').set(configs);
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

// Fetch initial data once from Firebase
async function fetchOnce() {
    if (!isReady()) return null;
    try {
        const snap = await dbRef.once('value');
        return snap.val();
    } catch (e) {
        console.error('[Firebase RTDB] fetchOnce error:', e.message);
        return null;
    }
}

module.exports = {
    init,
    isReady,
    getRef,
    getConfig,
    findServiceAccountKey,
    fetchOnce,
    syncFullStore,
    syncBoss,
    syncAllBosses,
    syncAllEvents,
    syncResetConfigs,
    syncSettings,
    syncSavedMaintenanceEndTime
};
