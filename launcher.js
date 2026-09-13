const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const createBackup = require('./server/backup');

console.clear();
console.log('================================================================');
console.log('🚀 Initializing Lineage 2 Dedicated Boss Server (#Kain7)...');
console.log('================================================================');

let serverProcess = null;
let tunnelProcess = null;
let publicUrl = null;
const rootDir = __dirname;
const cloudflaredPath = path.join(rootDir, 'cloudflared.exe');

// Helper: Copy text to Windows clipboard
function copyToClipboard(text) {
    if (process.platform === 'win32') {
        const proc = spawn('powershell', ['-NoProfile', '-Command', `Set-Clipboard -Value "${text}"`]);
        proc.on('error', () => {});
    }
}

const os = require('os');

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// Helper: Print the interactive server dashboard
function printDashboard() {
    const localIp = getLocalIp();
    let adminPass = '777999';
    let memberPass = 'password777999';
    try {
        const store = JSON.parse(fs.readFileSync(path.join(rootDir, 'server', 'data', 'store.json'), 'utf8'));
        if (store.settings) {
            if (store.settings.adminPassword) adminPass = store.settings.adminPassword;
            if (store.settings.memberPassword) memberPass = store.settings.memberPassword;
        }
    } catch (e) {}

    console.clear();
    console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║         ⚔️  LINEAGE 2 BOSS TRACKER (#Kain7) - 24/7 DEDICATED SERVER            ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('  🌐 1. ลิงก์ออนไลน์ทั่วโลก (สำหรับส่งให้เพื่อนในกิลด์ / มือถือนอกบ้าน):');
    console.log(`     👉 \x1b[32m\x1b[1m${publicUrl || 'กำลังเชื่อมต่อ Cloudflare Tunnel...'}\x1b[0m`);
    if (publicUrl) {
        console.log('     📋 \x1b[36m(คัดลอกลง Clipboard เรียบร้อยแล้ว! กด Ctrl + V วางใน LINE/Discord ได้เลย)\x1b[0m');
    }
    console.log('');
    console.log('  🏠 2. ลิงก์สำหรับมือถือ / คอมเครื่องอื่นในบ้านเดียวกัน (Wi-Fi เดียวกัน):');
    console.log(`     👉 \x1b[36mhttp://${localIp}:3000\x1b[0m`);
    console.log('');
    console.log('  🖥️  3. ลิงก์เปิดดูบนหน้าจอคอมเครื่องนี้เอง:');
    console.log('     👉 \x1b[33mhttp://localhost:3000\x1b[0m');
    console.log('');
    console.log('  🔐 รหัสผ่านเข้าใช้งาน (Login Credentials):');
    console.log(`     👥 \x1b[1mสมาชิกทั่วไป (Member):\x1b[0m  แท็บ Member | รหัส: \x1b[32m${memberPass}\x1b[0m`);
    console.log(`     🛡️  \x1b[1mแอดมิน (Admin):\x1b[0m         แท็บ Admin  | รหัส: \x1b[33m${adminPass}\x1b[0m`);
    console.log('');
    console.log('  💾 ระบบสำรองข้อมูล (Auto-Backup):');
    console.log('     ✅ สำรองข้อมูลฐานข้อมูลบอสลงโฟลเดอร์ backups/ อัตโนมัติทุก 3 ชั่วโมง');
    console.log('');
    console.log('  🟢 สถานะ: ออนไลน์ตลอด 24 ชั่วโมง (เปิดหน้าต่างนี้ทิ้งไว้)');
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('  💡 กด Ctrl + C เพื่อปิดระบบอย่างปลอดภัย');
    console.log('════════════════════════════════════════════════════════════════════════════════');
}

// 1. Start Server Process with Auto-Restart Watchdog
function startServer() {
    console.log('📦 [1/2] กำลังเริ่มทำงานเซิร์ฟเวอร์หลัก (Port 3000)...');
    serverProcess = spawn('node', ['server/server.js'], { cwd: rootDir, stdio: 'pipe' });

    serverProcess.stdout.on('data', (d) => {
        const str = d.toString();
        if (str.includes('Lineage 2 Exact Clone Server running')) {
            console.log('✅ เซิร์ฟเวอร์หลักทำงานเรียบร้อยแล้ว');
            startTunnel();
        }
    });

    serverProcess.stderr.on('data', (d) => {
        // Suppress non-critical logs or show if needed
    });

    serverProcess.on('exit', (code) => {
        console.warn(`⚠️ เซิร์ฟเวอร์หลักหยุดทำงาน (Code: ${code}), กำลังเริ่มใหม่อัตโนมัติใน 3 วินาที...`);
        setTimeout(startServer, 3000);
    });
}

// 2. Start Cloudflare Tunnel
function startTunnel() {
    if (!fs.existsSync(cloudflaredPath)) {
        console.log('📥 ไม่พบ cloudflared.exe กำลังดาวน์โหลดอัตโนมัติ...');
        exec(`curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -o cloudflared.exe`, { cwd: rootDir }, (err) => {
            if (err) {
                console.error('❌ ดาวน์โหลด cloudflared.exe ไม่สำเร็จ:', err.message);
                return;
            }
            launchTunnel();
        });
    } else {
        launchTunnel();
    }
}

function launchTunnel() {
    console.log('🌐 [2/2] กำลังเชื่อมต่อ Cloudflare Tunnel เพื่อสร้างลิงก์ออนไลน์...');
    tunnelProcess = spawn(cloudflaredPath, ['tunnel', '--url', 'http://localhost:3000'], { cwd: rootDir });

    const handleOutput = (data) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !publicUrl) {
            publicUrl = match[0];
            fs.writeFileSync(path.join(rootDir, 'PUBLIC_URL.txt'), publicUrl, 'utf8');
            copyToClipboard(publicUrl);
            printDashboard();
        }
    };

    tunnelProcess.stdout.on('data', handleOutput);
    tunnelProcess.stderr.on('data', handleOutput);

    tunnelProcess.on('exit', (code) => {
        if (!isShuttingDown) {
            console.warn('⚠️ Cloudflare Tunnel หลุดการเชื่อมต่อ กำลังต่อใหม่อัตโนมัติใน 5 วินาที...');
            publicUrl = null;
            setTimeout(launchTunnel, 5000);
        }
    });
}

// 3. Auto-Backup Every 3 Hours
setInterval(() => {
    try {
        createBackup();
    } catch (e) {}
}, 3 * 60 * 60 * 1000);

// 4. Graceful Shutdown
let isShuttingDown = false;
function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n🛑 กำลังปิดเซิร์ฟเวอร์และบันทึกข้อมูล...');
    try { createBackup(); } catch (e) {}
    if (serverProcess) serverProcess.kill();
    if (tunnelProcess) tunnelProcess.kill();
    setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Kick off
startServer();
