// Runs the test suite against a temporary copy of server/data/store.json so tests can
// never modify the user-owned local store (AGENTS.md: preserve it byte-for-byte).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-tracker-test-'));
const tmpStore = path.join(tmpDir, 'store.json');
fs.copyFileSync(path.join(rootDir, 'server', 'data', 'store.json'), tmpStore);

const testFiles = fs.readdirSync(path.join(rootDir, 'test'))
    .filter(name => name.endsWith('.test.js'))
    .sort()
    .map(name => path.join('test', name));

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, BOSS_TRACKER_DATA_FILE: tmpStore, BOSS_TRACKER_OFFLINE: '1' }
});

fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(result.status === null ? 1 : result.status);
