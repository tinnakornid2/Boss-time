const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'server', 'data', 'store.json');
const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));

// Exact boss updates from user's 5 screenshots:
// Current Time: 2026-09-13 09:05:00 UTC+7
const bossUpdates = [
    {
        thaiName: 'คาทาน',
        name: 'Katan',
        killTime: '2026-09-13T04:59:00+07:00',
        nextSpawn: '2026-09-13T12:59:00+07:00',
        autoAdvanced: false
    },
    {
        thaiName: 'ครูม่าที่ถูกปนเปื้อน',
        name: 'Cont. Cruma',
        killTime: '2026-09-13T04:52:00+07:00',
        nextSpawn: '2026-09-13T12:52:00+07:00',
        autoAdvanced: false
    },
    {
        thaiName: 'กลากิ',
        name: 'Glaki',
        killTime: '2026-09-13T04:49:00+07:00',
        nextSpawn: '2026-09-13T12:49:00+07:00',
        autoAdvanced: false
    },
    {
        thaiName: 'ทิมิเนล',
        name: 'Timiniel',
        killTime: '2026-09-13T04:49:00+07:00',
        nextSpawn: '2026-09-13T12:49:00+07:00',
        autoAdvanced: false
    },
    {
        thaiName: 'เมดูซ่า',
        name: 'Medusa',
        killTime: '2026-09-13T03:09:00+07:00',
        nextSpawn: '2026-09-13T10:09:00+07:00',
        autoAdvanced: false
    },
    {
        thaiName: 'ทาลาคิน',
        name: 'Talakin',
        killTime: '2026-09-13T03:07:00+07:00',
        nextSpawn: '2026-09-13T10:07:00+07:00',
        autoAdvanced: false
    },
    {
        thaiName: 'เฟลิส',
        name: 'Felis',
        killTime: '2026-09-13T02:21:00+07:00',
        nextSpawn: '2026-09-13T04:21:00+07:00',
        autoAdvanced: true
    },
    {
        thaiName: 'เรปิโร',
        name: 'Repiro',
        killTime: '2026-09-13T02:15:00+07:00',
        nextSpawn: '2026-09-13T07:15:00+07:00',
        autoAdvanced: true
    },
    {
        thaiName: 'เซลลู',
        name: 'Selu',
        killTime: '2026-09-13T00:58:00+07:00',
        nextSpawn: '2026-09-13T08:28:00+07:00',
        autoAdvanced: false // spawned 08:28, currently alive!
    },
    {
        thaiName: 'แลนเดอร์',
        name: 'Landor',
        killTime: '2026-09-13T00:40:00+07:00',
        nextSpawn: '2026-09-13T08:40:00+07:00',
        autoAdvanced: false // spawned 08:40, currently alive!
    },
    {
        thaiName: 'สตัน',
        name: 'Stonegeist',
        killTime: '2026-09-13T00:33:00+07:00',
        nextSpawn: '2026-09-13T04:33:00+07:00',
        autoAdvanced: true
    },
    {
        thaiName: 'เอนคูรา',
        name: 'Enkura',
        killTime: '2026-09-12T23:49:00+07:00',
        nextSpawn: '2026-09-13T03:19:00+07:00',
        autoAdvanced: true
    },
    {
        thaiName: 'บัลโบ',
        name: 'Balbo',
        killTime: '2026-09-12T20:42:00+07:00',
        nextSpawn: '2026-09-13T04:42:00+07:00',
        autoAdvanced: true
    },
    {
        thaiName: 'ครูม่ามนุษย์กลายพันธุ์',
        name: 'Mutated Cruma',
        killTime: '2026-09-12T20:42:00+07:00',
        nextSpawn: '2026-09-13T04:42:00+07:00',
        autoAdvanced: true
    },
    {
        thaiName: 'โครูน',
        name: 'Coroon',
        killTime: '2026-09-12T20:40:00+07:00',
        nextSpawn: '2026-09-13T06:40:00+07:00',
        autoAdvanced: true
    },
    {
        thaiName: 'ทานาทอส',
        name: 'Thanatos',
        killTime: '2026-09-12T20:30:00+07:00',
        nextSpawn: '2026-09-13T20:30:00+07:00',
        autoAdvanced: false
    }
];

console.log('Updating bosses in store.json:');
let updatedCount = 0;

for (const update of bossUpdates) {
    // Find all matching bosses (both normal and invasion)
    const matches = store.bosses.filter(b => b.name === update.name);
    if (matches.length === 0) {
        console.warn(`⚠️ Boss not found: ${update.name} (${update.thaiName})`);
        continue;
    }

    for (const b of matches) {
        // If invasion boss, we can update it if it matches, or focus on non-invasion
        // Let's update both so both views have correct times
        b.last_kill_time = new Date(update.killTime).toISOString();
        b.next_spawn = update.nextSpawn;
        b.auto_advanced = update.autoAdvanced;
        b.pinned_alive = false;
        b.post_maintenance = false;
        b.pre_spawned = false;
        b.updated_at = new Date().toISOString();
        updatedCount++;
    }
    console.log(`✅ Updated ${update.name} (${update.thaiName}): Kill ${update.killTime} -> Next Spawn ${update.nextSpawn}`);
}

fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
console.log(`\n🎉 Successfully updated ${updatedCount} boss entries in store.json!`);
