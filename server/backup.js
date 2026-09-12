const fs = require('fs');
const path = require('path');

function createBackup() {
    const storePath = path.join(__dirname, 'data', 'store.json');
    const backupsDir = path.join(__dirname, '..', 'backups');

    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }

    if (!fs.existsSync(storePath)) {
        console.error('❌ Store file not found at:', storePath);
        process.exit(1);
    }

    const data = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(data);

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

    const filename = `store_backup_${timestamp}.json`;
    const destPath = path.join(backupsDir, filename);
    const latestPath = path.join(backupsDir, 'latest_backup.json');

    fs.writeFileSync(destPath, data, 'utf8');
    fs.writeFileSync(latestPath, data, 'utf8');

    const stats = fs.statSync(destPath);

    console.log('========================================================');
    console.log('📦 Backup Created Successfully!');
    console.log('========================================================');
    console.log(`📁 File: backups/${filename}`);
    console.log(`📊 Size: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`⚔️  Bosses: ${parsed.bosses ? parsed.bosses.length : 0}`);
    console.log(`📅 Events: ${parsed.allEvents ? parsed.allEvents.length : 0}`);
    console.log(`⏰ Timestamp: ${now.toISOString()}`);
    console.log('========================================================');

    return destPath;
}

if (require.main === module) {
    createBackup();
}

module.exports = createBackup;
