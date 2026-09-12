const https = require('https');
const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync('C:\\Users\\tinna\\.gemini\\antigravity-ide\\brain\\a8a31133-b583-42e0-92c4-f27d83db807e\\scratch\\manifest.json', 'utf8'));

const files = new Set();
for (const [key, item] of Object.entries(manifest)) {
    if (item.file) files.add(item.file);
    if (item.css) item.css.forEach(c => files.add(c));
    if (item.assets) item.assets.forEach(a => files.add(a));
}

const buildDir = 'c:\\Users\\tinna\\Downloads\\Boss time\\public\\build';
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
}

// Also save manifest.json itself
fs.writeFileSync(path.join(buildDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

async function downloadFile(relPath) {
    const dest = path.join(buildDir, relPath);
    const parentDir = path.dirname(dest);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    const url = `https://boss.kain7.com/build/${relPath}`;
    return new Promise((resolve) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                console.error(`Failed to download ${relPath}: ${res.statusCode}`);
                return resolve();
            }
            const f = fs.createWriteStream(dest);
            res.pipe(f);
            f.on('finish', () => {
                f.close(() => {
                    console.log(`[OK] ${relPath} (${fs.statSync(dest).size} bytes)`);
                    resolve();
                });
            });
        }).on('error', (err) => {
            console.error(`[Error] ${relPath}:`, err.message);
            resolve();
        });
    });
}

async function run() {
    console.log(`Starting download of ${files.size} build assets...`);
    for (const file of files) {
        await downloadFile(file);
    }
    console.log('All build assets downloaded successfully!');
}

run();
