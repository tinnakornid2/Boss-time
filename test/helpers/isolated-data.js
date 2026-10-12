// Require this before any ../server module. It points db.js and google-sheets.js
// at temporary copies so tests never rewrite server/data/store.json or the
// owner's local server/google-sheets-config.json.
// `npm test` (scripts/run-tests.js) already provides a temp store; this also
// covers single-file runs such as `node --test test/boss-color.test.js`.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.BOSS_TRACKER_SHEETS_CONFIG_FILE) {
    const serverDir = path.join(__dirname, '..', '..', 'server');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-tracker-test-'));

    if (!process.env.BOSS_TRACKER_DATA_FILE) {
        const dataFile = path.join(tempDir, 'store.json');
        fs.copyFileSync(path.join(serverDir, 'data', 'store.json'), dataFile);
        process.env.BOSS_TRACKER_DATA_FILE = dataFile;
    }
    process.env.BOSS_TRACKER_OFFLINE = '1';

    // Start without the owner's Sheets config so tests never reach the real Web App.
    process.env.BOSS_TRACKER_SHEETS_CONFIG_FILE = path.join(tempDir, 'google-sheets-config.json');

    process.on('exit', () => {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    });
}
