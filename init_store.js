const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const seedFile = 'C:\\Users\\tinna\\.gemini\\antigravity-ide\\brain\\a8a31133-b583-42e0-92c4-f27d83db807e\\scratch\\seed_data.json';
const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

const storeDir = 'c:\\Users\\tinna\\Downloads\\Boss time\\server\\data';
if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true });
}

const initialStore = {
    bosses: seed.bosses || [],
    events: seed.events || [],
    resetTimeConfigs: seed.resetTimeConfigs || {},
    settings: {
        serverName: "#Kain7",
        invasionLabel: seed.invasionLabel || "⚡Inv.",
        invasionEmoji: "⚡",
        invasionColor: "#c084fc",
        invasionPosition: "prefix",
        hideInvasionBosses: false,
        announcement: seed.announcement || null,
        pinCode: "123456",
        adminUsername: "admin",
        adminPasswordHash: hashPassword("lindvior999"),
        discordWebhook: "",
        alertBeforeMinutes: 5,
        defaultAlertSound: "alert",
        defaultSpawnSound: "just-spawned"
    },
    savedMaintenanceEndTime: seed.savedMaintenanceEndTime || null,
    killHistory: []
};

fs.writeFileSync(path.join(storeDir, 'store.json'), JSON.stringify(initialStore, null, 2), 'utf8');
console.log('Created server/data/store.json with:');
console.log(`- ${initialStore.bosses.length} Bosses`);
console.log(`- ${initialStore.events.length} Events`);
console.log(`- ${Object.keys(initialStore.resetTimeConfigs).length} Reset Configs`);
