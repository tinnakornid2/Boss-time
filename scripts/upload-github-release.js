const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

async function main() {
    console.log('--- Creating GitHub Release & Uploading Portable Zip ---');

    // 1. Get GitHub token from git credential manager
    const credOut = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n' }).toString();
    const token = (credOut.match(/password=(.+)/) || [])[1]?.trim();
    if (!token) {
        throw new Error('Could not retrieve GitHub token from git credential manager.');
    }
    console.log('GitHub token retrieved successfully.');

    const zipPath = path.resolve(__dirname, '../desktop-app/dist/BossTracker-Windows-Portable.zip');
    if (!fs.existsSync(zipPath)) {
        throw new Error(`File not found: ${zipPath}`);
    }
    const stat = fs.statSync(zipPath);
    console.log(`Target zip file: ${zipPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);

    // 2. Check if release v1.3.45 already exists
    let release = await getReleaseByTag('v1.3.45', token);
    if (!release) {
        console.log('Release v1.3.45 not found. Creating new release...');
        release = await createRelease({
            tag_name: 'v1.3.45',
            name: 'Boss Tracker Windows Portable v1.3.45',
            body: `## Boss Tracker Windows Portable v1.3.45

### ฟีเจอร์และการปรับปรุงในเวอร์ชันนี้:
- 🛡️ **Auto-Run as Administrator**: ดับเบิลคลิกเปิดโปรแกรม \`BossTracker.exe\` แล้วรันด้วยสิทธิ์แอดมินอัตโนมัติทันที ไม่ต้องคลิกขวา Run as administrator เอง
- 🔊 **Unthrottled Background Audio & Top-Most Toast Popup**: เสียงแจ้งเตือนดังชัดเจนแม้ถูกเกมหรือโปรแกรมอื่นบัง พร้อมหน้าต่างป๊อปอัพแจ้งเตือนมุมซ้ายล่างแบบแสดงบนสุด (Always-On-Top) โดยไม่ดึงโฟกัสและคลิกเมาส์ทะลุเข้าเกมได้ 100%
- 📅 **บังคับรูปแบบวันที่ ว/ด/ป (DD/MM/YYYY) และเวลา 24 ชม.**: หน้าต่างใส่เวลาเองในทั้งโปรแกรมหลักและเว็บไซต์แสดงช่องกรอก วัน/เดือน/ปี และเวลา 24 ชม. (00:00–23:59) พร้อมปุ่มดึงเวลาเซิร์ฟเวอร์อัตโนมัติ
- 🎯 **Mini HUD Events & Exact Countdown Format**: แสดงรายการกิจกรรม (Events) ใน Mini HUD แสดงเวลานับถอยหลังและสัญลักษณ์ \`⚠️\` เหมือนหน้าหลักโดยไม่มีป๊อปอัพคำอธิบายเมื่อชี้เมาส์
- 📱 **Mobile/Tablet Login & Screen Wake Lock**: แก้ไขปัญหาล็อกอินซ้ำหลังกดออกจากระบบบนมือถือ/แท็บเล็ต และป้องกันการพักหน้าจออัตโนมัติเมื่อเปิดหน้าเว็บค้างไว้`,
            draft: false,
            prerelease: false,
            make_latest: 'true'
        }, token);
        console.log(`Release created! ID: ${release.id}, URL: ${release.html_url}`);
    } else {
        console.log(`Release v1.3.45 already exists (ID: ${release.id}).`);
    }

    // 3. Check if asset already exists in release
    const existingAsset = release.assets?.find(a => a.name === 'BossTracker-Windows-Portable.zip');
    if (existingAsset) {
        console.log(`Asset BossTracker-Windows-Portable.zip already exists (ID: ${existingAsset.id}). Deleting old asset...`);
        await deleteAsset(existingAsset.id, token);
        console.log('Old asset deleted.');
    }

    // 4. Upload asset to release
    console.log('Uploading BossTracker-Windows-Portable.zip to GitHub Release...');
    const uploadResult = await uploadAsset(release.id, zipPath, stat.size, token);
    console.log('Upload complete! Asset URL:', uploadResult.browser_download_url);
    console.log('Direct download link ready:');
    console.log('https://github.com/tinnakornid2/Boss-time/releases/latest/download/BossTracker-Windows-Portable.zip');
}

function getReleaseByTag(tag, token) {
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.github.com',
            path: `/repos/tinnakornid2/Boss-time/releases/tags/${encodeURIComponent(tag)}`,
            method: 'GET',
            headers: {
                'User-Agent': 'NodeJS',
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
                } else {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.end();
    });
}

function createRelease(payload, token) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(payload);
        const req = https.request({
            hostname: 'api.github.com',
            path: '/repos/tinnakornid2/Boss-time/releases',
            method: 'POST',
            headers: {
                'User-Agent': 'NodeJS',
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 201) {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                } else {
                    reject(new Error(`Failed to create release: HTTP ${res.statusCode} - ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

function deleteAsset(assetId, token) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.github.com',
            path: `/repos/tinnakornid2/Boss-time/releases/assets/${assetId}`,
            method: 'DELETE',
            headers: {
                'User-Agent': 'NodeJS',
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        }, (res) => {
            if (res.statusCode === 204 || res.statusCode === 200) resolve();
            else reject(new Error(`Failed to delete asset: HTTP ${res.statusCode}`));
        });
        req.on('error', reject);
        req.end();
    });
}

function uploadAsset(releaseId, filePath, fileSize, token) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'uploads.github.com',
            path: `/repos/tinnakornid2/Boss-time/releases/${releaseId}/assets?name=BossTracker-Windows-Portable.zip`,
            method: 'POST',
            headers: {
                'User-Agent': 'NodeJS',
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/zip',
                'Content-Length': fileSize
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 201) {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                } else {
                    reject(new Error(`Failed to upload asset: HTTP ${res.statusCode} - ${data}`));
                }
            });
        });

        req.on('error', reject);

        const readStream = fs.createReadStream(filePath);
        let uploaded = 0;
        let lastLoggedMb = 0;

        readStream.on('data', (chunk) => {
            uploaded += chunk.length;
            const currentMb = Math.floor(uploaded / 1024 / 1024);
            if (currentMb >= lastLoggedMb + 10) {
                lastLoggedMb = currentMb;
                const pct = ((uploaded / fileSize) * 100).toFixed(1);
                console.log(`Uploaded ${currentMb} MB / ${(fileSize / 1024 / 1024).toFixed(1)} MB (${pct}%)`);
            }
        });

        readStream.pipe(req);
    });
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
