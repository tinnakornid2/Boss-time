const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const desktopDir = path.join(rootDir, 'desktop-app');
const stagingDir = path.join(desktopDir, 'build-staging');
const resourcesDir = path.join(desktopDir, 'dist', 'win-unpacked', 'resources');
const unpackedAppDir = path.join(resourcesDir, 'app');
const asarFile = path.join(resourcesDir, 'app.asar');

console.log('--- Packaging Desktop App ---');

// Clean staging dir
if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

// Copy source files
const filesToCopy = ['package.json', 'main.js', 'preload.js'];
const dirsToCopy = ['assets', 'overlay'];

for (const f of filesToCopy) {
    const src = path.join(desktopDir, f);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(stagingDir, f));
        fs.mkdirSync(unpackedAppDir, { recursive: true });
        fs.copyFileSync(src, path.join(unpackedAppDir, f));
    }
}

for (const d of dirsToCopy) {
    const src = path.join(desktopDir, d);
    if (fs.existsSync(src)) {
        fs.cpSync(src, path.join(stagingDir, d), { recursive: true });
        fs.cpSync(src, path.join(unpackedAppDir, d), { recursive: true });
    }
}

console.log('Building app.asar via @electron/asar...');
execSync(`npx --yes @electron/asar pack "${stagingDir}" "${asarFile}"`, { stdio: 'inherit', cwd: rootDir });

console.log('app.asar created successfully at:', asarFile);

// Clean staging dir
fs.rmSync(stagingDir, { recursive: true, force: true });

// Ensure BossTracker.exe has requireAdministrator execution level in its PE manifest
const unpackedDir = path.join(desktopDir, 'dist', 'win-unpacked');
const exePath = path.join(unpackedDir, 'BossTracker.exe');
if (fs.existsSync(exePath)) {
    try {
        const cacheDir = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
        if (fs.existsSync(cacheDir)) {
            const subDirs = fs.readdirSync(cacheDir);
            for (const sub of subDirs) {
                const candidate = path.join(cacheDir, sub, 'rcedit-x64.exe');
                if (fs.existsSync(candidate)) {
                    execSync(`"${candidate}" "${exePath}" --set-requested-execution-level requireAdministrator`, { stdio: 'inherit' });
                    console.log('Verified requireAdministrator execution level on BossTracker.exe');
                    break;
                }
            }
        }
    } catch (e) {
        console.warn('Warning: rcedit skipped:', e.message);
    }
}

// Create portable zip
const zipPath = path.join(desktopDir, 'dist', 'BossTracker-Windows-Portable.zip');
console.log('Creating portable zip at:', zipPath);
try {
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    execSync(`tar.exe -a -c -f "${zipPath}" *`, { cwd: unpackedDir, stdio: 'inherit' });
    console.log('Portable zip created successfully!');
} catch (e) {
    try {
        execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${unpackedDir}\\*' -DestinationPath '${zipPath}' -Force"`, { stdio: 'inherit' });
        console.log('Portable zip created successfully via PowerShell!');
    } catch (err) {
        console.warn('Warning: Could not create portable zip:', err.message);
    }
}

console.log('Packaging complete!');
