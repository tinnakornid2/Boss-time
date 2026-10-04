const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

async function main() {
    console.log('====================================================');
    console.log('       BOSS TRACKER DESKTOP APP RELEASE PIPELINE     ');
    console.log('   (Releases desktop app ONLY - Zero Vercel deploy)  ');
    console.log('====================================================\n');

    const rootDir = path.resolve(__dirname, '..');
    const desktopDir = path.join(rootDir, 'desktop-app');
    const pkgPath = path.join(desktopDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // Check if new version passed as argument
    const argVersion = process.argv[2]?.trim().replace(/^v/, '');
    if (argVersion && argVersion !== pkg.version) {
        console.log(`Bumping desktop-app version: ${pkg.version} -> ${argVersion}`);
        pkg.version = argVersion;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    }

    const version = pkg.version;
    const tagName = `v${version}`;
    console.log(`Target Release Version: ${version} (Tag: ${tagName})`);

    // 1. Pack Desktop App (app.asar + Portable Zip)
    console.log('\n[1/4] Packing Desktop App files...');
    execSync('node scripts/pack-desktop.js', { cwd: rootDir, stdio: 'inherit' });

    // 2. Build NSIS Windows Installer (BossTracker-Setup.exe)
    console.log('\n[2/4] Building Windows Installer (Setup.exe with Desktop Icon)...');
    execSync('node scripts/build-installer.js', { cwd: rootDir, stdio: 'inherit' });

    const setupPath = path.join(desktopDir, 'dist', 'BossTracker-Setup.exe');
    const zipPath = path.join(desktopDir, 'dist', 'BossTracker-Windows-Portable.zip');

    if (!fs.existsSync(setupPath)) throw new Error(`Setup file missing: ${setupPath}`);
    if (!fs.existsSync(zipPath)) throw new Error(`Portable zip missing: ${zipPath}`);

    const setupStat = fs.statSync(setupPath);
    const zipStat = fs.statSync(zipPath);
    console.log(`\nAssets verified:`);
    console.log(`- BossTracker-Setup.exe: ${(setupStat.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`- BossTracker-Windows-Portable.zip: ${(zipStat.size / 1024 / 1024).toFixed(2)} MB`);

    // 3. GitHub Authentication
    console.log('\n[3/4] Authenticating with GitHub...');
    const credOut = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n' }).toString();
    const token = (credOut.match(/password=(.+)/) || [])[1]?.trim();
    if (!token) {
        throw new Error('Could not retrieve GitHub token from git credential manager.');
    }
    console.log('GitHub authentication successful.');

    // 4. Create or get release
    console.log(`\n[4/4] Publishing Release ${tagName} on GitHub...`);
    let release = await getReleaseByTag(tagName, token);
    const releaseBody = `## Boss Tracker Windows Desktop ${tagName}

### ไฮไลท์การอัปเดตเวอร์ชันนี้:
- 💻 **Windows Installer (Setup)**: ติดตั้งลงเครื่องวินโดวส์พร้อมสร้างไอคอนบนหน้าจอเดสก์ท็อป (\`Boss Tracker.lnk\`) และเมนู Start อัตโนมัติ
- 🔄 **In-App Auto-Update**: แจ้งเตือนอัปเดตทั้งในหน้าต่างหลักและ Mini HUD พร้อมปุ่มกดดาวน์โหลดและอัปเดตอัตโนมัติทันที
- 🛡️ **Auto-Run as Administrator**: เปิดโปรแกรมแล้วรันด้วยสิทธิ์แอดมินอัตโนมัติ
- 🔊 **Unthrottled Audio & Top-Most Toast**: เสียงแจ้งเตือนบอสเกิดดังชัดเจนแม้โดนเกมทับ และป๊อปอัพมุมซ้ายล่างแบบคลิกทะลุ 100%
- 🎯 **Mini HUD Events & Time Synchronization**: แสดงทั้งบอสและกิจกรรมนับถอยหลังแม่นยำตรงตามเซิร์ฟเวอร์`;

    if (!release) {
        console.log(`Release ${tagName} not found. Creating new release...`);
        release = await createRelease({
            tag_name: tagName,
            name: `Boss Tracker Windows Desktop ${tagName}`,
            body: releaseBody,
            draft: false,
            prerelease: false,
            make_latest: 'true'
        }, token);
        console.log(`Release created! ID: ${release.id}, URL: ${release.html_url}`);
    } else {
        console.log(`Release ${tagName} already exists (ID: ${release.id}). Updating body...`);
    }

    // Upload Setup.exe
    console.log('\nUploading BossTracker-Setup.exe...');
    await deleteAssetByName(release, 'BossTracker-Setup.exe', token);
    const setupResult = await uploadAsset(release.id, setupPath, 'BossTracker-Setup.exe', setupStat.size, token);
    console.log('BossTracker-Setup.exe uploaded! URL:', setupResult.browser_download_url);

    // Upload Portable.zip
    console.log('\nUploading BossTracker-Windows-Portable.zip...');
    await deleteAssetByName(release, 'BossTracker-Windows-Portable.zip', token);
    const zipResult = await uploadAsset(release.id, zipPath, 'BossTracker-Windows-Portable.zip', zipStat.size, token);
    console.log('BossTracker-Windows-Portable.zip uploaded! URL:', zipResult.browser_download_url);

    console.log('\n====================================================');
    console.log('       DESKTOP APP RELEASE COMPLETED SUCCESSFULLY!   ');
    console.log('====================================================');
    console.log('\nDirect Download Links:');
    console.log('1. Windows Installer (Setup with Desktop Icon):');
    console.log('   https://github.com/tinnakornid2/Boss-time/releases/latest/download/BossTracker-Setup.exe');
    console.log('2. Portable Zip:');
    console.log('   https://github.com/tinnakornid2/Boss-time/releases/latest/download/BossTracker-Windows-Portable.zip');
    console.log('\nNote: Vercel website deployment was NOT touched. All live web users unaffected.');
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

async function deleteAssetByName(release, assetName, token) {
    const existing = release.assets?.find(a => a.name === assetName);
    if (!existing) return;
    console.log(`Deleting existing asset ${assetName} (ID: ${existing.id})...`);
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.github.com',
            path: `/repos/tinnakornid2/Boss-time/releases/assets/${existing.id}`,
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

function uploadAsset(releaseId, filePath, assetName, fileSize, token) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'uploads.github.com',
            path: `/repos/tinnakornid2/Boss-time/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`,
            method: 'POST',
            headers: {
                'User-Agent': 'NodeJS',
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/octet-stream',
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
                    reject(new Error(`Failed to upload ${assetName}: HTTP ${res.statusCode} - ${data}`));
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

if (require.main === module) {
    main().catch(err => {
        console.error('\nFatal error releasing desktop app:', err.message);
        process.exit(1);
    });
}

module.exports = { main };
