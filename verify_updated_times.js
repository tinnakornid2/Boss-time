const http = require('http');

http.get('http://localhost:3000/api/v1/time-bosses', res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        const j = JSON.parse(data);
        const list = [
            { name: 'Katan', th: 'คาทาน' },
            { name: 'Cont. Cruma', th: 'ครูม่าที่ถูกปนเปื้อน' },
            { name: 'Glaki', th: 'กลากิ' },
            { name: 'Timiniel', th: 'ทิมิเนล' },
            { name: 'Medusa', th: 'เมดูซ่า' },
            { name: 'Talakin', th: 'ทาลาคิน' },
            { name: 'Felis', th: 'เฟลิส' },
            { name: 'Repiro', th: 'เรปิโร' },
            { name: 'Selu', th: 'เซลลู' },
            { name: 'Landor', th: 'แลนเดอร์' },
            { name: 'Stonegeist', th: 'สตัน' },
            { name: 'Enkura', th: 'เอนคูรา' },
            { name: 'Balbo', th: 'บัลโบ' },
            { name: 'Mutated Cruma', th: 'ครูม่ามนุษย์กลายพันธุ์' },
            { name: 'Coroon', th: 'โครูน' },
            { name: 'Thanatos', th: 'ทานาทอส' }
        ];

        console.log('=== สถานะเวลาเกิดบอสปัจจุบัน (คำนวณ ณ เวลา 09:05 น.) ===\n');
        console.log('ชื่อบอส (ไทย/อังกฤษ)       | เวลาตายล่าสุด | เวลาเกิดถัดไป | สถานะปัจจุบัน');
        console.log('-------------------------------------------------------------------------');

        for (const item of list) {
            const b = j.bosses.find(x => x.name === item.name && !x.is_invasion);
            if (!b) continue;

            const killDate = new Date(b.last_kill_time);
            const killTimeStr = killDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

            const spawnDate = new Date(b.next_spawn);
            const spawnTimeStr = spawnDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

            let statusStr = '';
            const diffMin = Math.round((spawnDate.getTime() - Date.now()) / 60000);

            if (diffMin > 0) {
                const hours = Math.floor(diffMin / 60);
                const mins = diffMin % 60;
                statusStr = `⏳ อีก ${hours > 0 ? hours + ' ชม. ' : ''}${mins} นาที (${spawnTimeStr})`;
            } else {
                const passed = Math.abs(diffMin);
                if (passed < 60) {
                    statusStr = `⚔️ เกิดแล้ว! (${passed} นาทีที่แล้ว - ${spawnTimeStr})`;
                } else {
                    statusStr = `⚔️ เกิดแล้ว (เลยเวลา ${Math.floor(passed / 60)} ชม. ${passed % 60} น.)`;
                }
            }

            const title = `${item.th} (${item.name})`.padEnd(26);
            console.log(`${title} |    ${killTimeStr}    |    ${spawnTimeStr}   | ${statusStr}`);
        }
    });
}).on('error', console.error);
