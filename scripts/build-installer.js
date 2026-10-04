const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const desktopDir = path.join(rootDir, 'desktop-app');
const distDir = path.join(desktopDir, 'dist');
const unpackedDir = path.join(distDir, 'win-unpacked');
const iconPath = path.join(desktopDir, 'assets', 'icon.ico');
const setupExePath = path.join(distDir, 'BossTracker-Setup.exe');

console.log('--- Generating Native Windows Installer (NSIS) ---');

// 1. Locate makensis.exe
function findMakensis() {
    const candidatePaths = [
        path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis', 'nsis-3.0.4.1', 'makensis.exe'),
        'C:\\Program Files (x86)\\NSIS\\makensis.exe',
        'C:\\Program Files\\NSIS\\makensis.exe'
    ];
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) return p;
    }
    // Search in electron-builder cache recursively
    const nsisCache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis');
    if (fs.existsSync(nsisCache)) {
        for (const sub of fs.readdirSync(nsisCache)) {
            const candidate = path.join(nsisCache, sub, 'makensis.exe');
            if (fs.existsSync(candidate)) return candidate;
        }
    }
    return null;
}

const makensisPath = findMakensis();
if (!makensisPath) {
    throw new Error('makensis.exe not found in electron-builder cache or Program Files.');
}
console.log('Using NSIS compiler:', makensisPath);

if (!fs.existsSync(unpackedDir)) {
    throw new Error(`win-unpacked directory not found at: ${unpackedDir}`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
const version = pkg.version || '1.3.47';

// 2. Generate NSIS script
const nsiScript = `
Unicode True
!include "MUI2.nsh"

Name "Boss Tracker"
OutFile "${setupExePath.replace(/\\/g, '\\\\')}"
InstallDir "$LOCALAPPDATA\\\\Programs\\\\BossTracker"
InstallDirRegKey HKCU "Software\\\\BossTracker" ""
RequestExecutionLevel user

!define MUI_ABORTWARNING
!define MUI_ICON "${iconPath.replace(/\\/g, '\\\\')}"
!define MUI_UNICON "${iconPath.replace(/\\/g, '\\\\')}"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\\\\BossTracker.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Boss Tracker (เปิดใช้งานทันที)"
!insertmacro MUI_PAGE_FINISH

; Uninstaller Pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Thai"
!insertmacro MUI_LANGUAGE "English"

Section "Boss Tracker" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Stop existing instance if running
  nsExec::Exec 'taskkill /F /IM BossTracker.exe'
  Sleep 500

  File /r "${unpackedDir.replace(/\\/g, '\\\\')}\\\\*.*"

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\\\\Uninstall.exe"

  ; Desktop Shortcut (Always created on user Desktop)
  CreateShortcut "$DESKTOP\\\\Boss Tracker.lnk" "$INSTDIR\\\\BossTracker.exe" "" "$INSTDIR\\\\BossTracker.exe" 0

  ; Start Menu Shortcuts
  CreateDirectory "$SMPROGRAMS\\\\Boss Tracker"
  CreateShortcut "$SMPROGRAMS\\\\Boss Tracker\\\\Boss Tracker.lnk" "$INSTDIR\\\\BossTracker.exe" "" "$INSTDIR\\\\BossTracker.exe" 0
  CreateShortcut "$SMPROGRAMS\\\\Boss Tracker\\\\Uninstall.lnk" "$INSTDIR\\\\Uninstall.exe" "" "$INSTDIR\\\\Uninstall.exe" 0

  ; Windows Registry Uninstall Entry
  WriteRegStr HKCU "Software\\\\BossTracker" "" "$INSTDIR"
  WriteRegStr HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\BossTracker" "DisplayName" "Boss Tracker"
  WriteRegStr HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\BossTracker" "DisplayIcon" "$INSTDIR\\\\BossTracker.exe"
  WriteRegStr HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\BossTracker" "DisplayVersion" "${version}"
  WriteRegStr HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\BossTracker" "Publisher" "Boss Tracker Team"
  WriteRegStr HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\BossTracker" "UninstallString" '"$INSTDIR\\\\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\BossTracker" "NoModify" 1
  WriteRegDWORD HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\BossTracker" "NoRepair" 1

  ; If running silent (e.g. from background auto-update), launch the app automatically
  IfSilent 0 +2
    Exec '"$INSTDIR\\\\BossTracker.exe"'
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM BossTracker.exe'
  Sleep 500

  Delete "$DESKTOP\\\\Boss Tracker.lnk"
  RMDir /r "$SMPROGRAMS\\\\Boss Tracker"

  DeleteRegKey HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\BossTracker"
  DeleteRegKey HKCU "Software\\\\BossTracker"

  RMDir /r "$INSTDIR"
SectionEnd
`;

const nsiPath = path.join(distDir, 'installer.nsi');
fs.writeFileSync(nsiPath, '\uFEFF' + nsiScript.trim(), 'utf8');
console.log('NSIS script written to:', nsiPath);

// 3. Compile installer
console.log('Compiling installer via makensis...');
const output = execFileSync(makensisPath, ['/INPUTCHARSET', 'UTF8', '-V3', nsiPath], { encoding: 'utf8' });
console.log(output);

// Clean temporary .nsi
try { fs.unlinkSync(nsiPath); } catch (_) {}

if (fs.existsSync(setupExePath)) {
    const stat = fs.statSync(setupExePath);
    console.log(`\nInstaller successfully created at: ${setupExePath}`);
    console.log(`Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
} else {
    throw new Error('Installer file was not generated.');
}
