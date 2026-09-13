const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const storePath = path.join(__dirname, 'server', 'data', 'store.json');

function hash(val) {
    return crypto.createHash('sha256').update(val).digest('hex');
}

function loadStore() {
    if (!fs.existsSync(storePath)) {
        console.error('❌ ไม่พบไฟล์ store.json ที่:', storePath);
        process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    data.settings = data.settings || {};
    return data;
}

function saveStore(data) {
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const store = loadStore();
const currentMember = store.settings.memberPassword || 'password777999';
const currentAdmin = store.settings.adminPassword || '@777999';

console.clear();
console.log('================================================================');
console.log('🔐 โปรแกรมเปลี่ยนรหัสผ่าน Lineage 2 Boss Tracker (#Kain7)');
console.log('================================================================');
console.log(`📌 รหัสผ่านที่ใช้งานอยู่ในปัจจุบัน:`);
console.log(`   👥 Member (สมาชิกแคลน): [ ${currentMember} ]`);
console.log(`   🛡️  Admin (ผู้ดูแลระบบ):  [ ${currentAdmin} ]`);
console.log('================================================================');
console.log('เลือกเมนูที่ต้องการเปลี่ยน:');
console.log('1. เปลี่ยนรหัสผ่าน Member (สมาชิกแคลน)');
console.log('2. เปลี่ยนรหัสผ่าน Admin (ผู้ดูแลระบบ)');
console.log('3. เปลี่ยนทั้ง Member และ Admin');
console.log('4. ยกเลิก (ออก)');
console.log('----------------------------------------------------------------');

rl.question('กรุณาพิมพ์ตัวเลขเมนู (1-4) แล้วกด Enter: ', (choice) => {
    const trimmed = choice.trim();

    if (trimmed === '1') {
        rl.question('\nกรุณากรอกรหัสผ่านใหม่สำหรับ Member: ', (newPass) => {
            const pass = newPass.trim();
            if (!pass) {
                console.log('⚠️ รหัสผ่านต้องไม่เป็นค่าว่าง ยกเลิกการเปลี่ยน');
                rl.close();
                return;
            }
            store.settings.memberPassword = pass;
            store.settings.memberPasswordHash = hash(pass);
            saveStore(store);
            console.log('\n================================================================');
            console.log(`✅ สำเร็จ! เปลี่ยนรหัสผ่าน Member เป็น: "${pass}" เรียบร้อยแล้ว`);
            console.log('================================================================');
            rl.close();
        });
    } else if (trimmed === '2') {
        rl.question('\nกรุณากรอกรหัสผ่านใหม่สำหรับ Admin: ', (newPass) => {
            const pass = newPass.trim();
            if (!pass) {
                console.log('⚠️ รหัสผ่านต้องไม่เป็นค่าว่าง ยกเลิกการเปลี่ยน');
                rl.close();
                return;
            }
            store.settings.adminPassword = pass;
            store.settings.adminPasswordHash = hash(pass);
            saveStore(store);
            console.log('\n================================================================');
            console.log(`✅ สำเร็จ! เปลี่ยนรหัสผ่าน Admin เป็น: "${pass}" เรียบร้อยแล้ว`);
            console.log('================================================================');
            rl.close();
        });
    } else if (trimmed === '3') {
        rl.question('\n[1/2] กรุณากรอกรหัสผ่านใหม่สำหรับ Member: ', (newMember) => {
            const passM = newMember.trim();
            if (!passM) {
                console.log('⚠️ รหัสผ่านต้องไม่เป็นค่าว่าง ยกเลิกการเปลี่ยน');
                rl.close();
                return;
            }
            rl.question('[2/2] กรุณากรอกรหัสผ่านใหม่สำหรับ Admin: ', (newAdmin) => {
                const passA = newAdmin.trim();
                if (!passA) {
                    console.log('⚠️ รหัสผ่านต้องไม่เป็นค่าว่าง ยกเลิกการเปลี่ยน');
                    rl.close();
                    return;
                }
                store.settings.memberPassword = passM;
                store.settings.memberPasswordHash = hash(passM);
                store.settings.adminPassword = passA;
                store.settings.adminPasswordHash = hash(passA);
                saveStore(store);
                console.log('\n================================================================');
                console.log(`✅ สำเร็จ! เปลี่ยนรหัสผ่านเรียบร้อยแล้ว:`);
                console.log(`   👥 Member: "${passM}"`);
                console.log(`   🛡️  Admin:  "${passA}"`);
                console.log('================================================================');
                rl.close();
            });
        });
    } else {
        console.log('\nยกเลิกการทำงาน');
        rl.close();
    }
});
