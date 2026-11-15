// Mechanical patch for the checked-in generated dashboard bundle. The original
// React sources are not part of this repository.
//
// Boss alert sounds were played by two code paths: React hooks in the bundle and
// public/js/realtime-alerts.js. Both fired on a visible but unfocused page and in
// the desktop app, and the React hooks replayed sounds whenever the tab became
// visible again or a poll briefly dropped a boss from a list. Every boss alert
// sound now belongs only to realtime-alerts.js:
//   - double-click (pre-spawn): deduplicated by live event id
//   - alert before spawn and spawned: deduplicated by boss id + next_spawn
// Each pattern must match exactly once (or already be patched), so a rebuilt
// bundle is never silently rewritten in the wrong place.
const fs = require('node:fs');
const path = require('node:path');

const bundlePath = path.join(__dirname, '../public/build/assets/dashboard-B9CVP--8.js');
let bundle = fs.readFileSync(bundlePath, 'utf8');

const patches = [
    {
        name: 'pre-spawn (double-click) sound',
        before: '(d=()=>{if(document.visibilityState==="hidden"||i==="off"||e)return;const f=i==="ultraman"?"/ultraman.mp3":"/pop2.mp3";',
        after: '(d=()=>{return;const f=i==="ultraman"?"/ultraman.mp3":"/pop2.mp3";'
    },
    {
        name: 'spawned sound',
        before: '(d=()=>{if(document.visibilityState==="hidden"||i==="off"||e)return;const f=i==="ultraman"?"/ultraman.mp3":"/just-spawned.mp3";',
        after: '(d=()=>{return;const f=i==="ultraman"?"/ultraman.mp3":"/just-spawned.mp3";'
    },
    {
        name: 'alert-before-spawn sound',
        before: '!e&&m-hd>=W1)){hd=m;',
        after: '!1&&m-hd>=W1)){hd=m;'
    }
];

const count = (text) => bundle.split(text).length - 1;
let changed = false;
for (const { name, before, after } of patches) {
    const pending = count(before);
    const applied = count(after);
    if (pending === 0 && applied === 1) continue;
    if (pending !== 1 || applied !== 0) {
        throw new Error(`Dashboard ${name} pattern mismatch: found ${pending} unpatched and ${applied} patched`);
    }
    bundle = bundle.replace(before, after);
    changed = true;
}
if (!changed) {
    console.log('Dashboard alert audio patch is already applied.');
    process.exit(0);
}
fs.writeFileSync(bundlePath, bundle, 'utf8');
console.log('Dashboard boss alert sounds now play only from realtime-alerts.js.');
