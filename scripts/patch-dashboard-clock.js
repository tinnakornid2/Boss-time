// Mechanical patch for the checked-in generated dashboard bundle. The original
// React sources are not part of this repository. Fail if the expected patterns
// change so a future bundle is never silently rewritten with the wrong clock.
const fs = require('node:fs');
const path = require('node:path');

const bundlePath = path.join(__dirname, '../public/build/assets/dashboard-B9CVP--8.js');
let bundle = fs.readFileSync(bundlePath, 'utf8');
const serverClock = 'F1=()=>typeof window.getTrackerServerNow==="function"?window.getTrackerServerNow().getTime():Date.now()';
if (bundle.includes(serverClock)) {
    console.log('Dashboard server clock patch is already applied.');
    process.exit(0);
}
const replacements = [
    ['F1=()=>Date.now()', serverClock, 1],
    ['if(dt&&pp)return;const t=Date.now();aa.forEach', 'if(dt&&pp)return;const t=F1();aa.forEach', 1],
    ['i(Math.floor(Date.now()/1e3))', 'i(Math.floor(F1()/1e3))', 2],
    ['function G1(){return Math.floor(Date.now()/1e3)}', 'function G1(){return Math.floor(F1()/1e3)}', 1],
    ['const o=Date.now(),a=[],l=[];for(const u of t)', 'const o=F1(),a=[],l=[];for(const u of t)', 1],
    ['if(document.visibilityState==="hidden")return;const m=Date.now();t.forEach', 'if(document.visibilityState==="hidden")return;const m=F1();t.forEach', 1],
    ['uc(i,s,u,Date.now())', 'uc(i,s,u,F1())', 1],
    ['Date.now()-new Date(', 'F1()-new Date(', 3],
    ['const P=Date.now()+en*36e5', 'const P=F1()+en*36e5', 1],
    ['aS(Yi,Date.now(),Tn)', 'aS(Yi,F1(),Tn)', 1],
    // Both one-second tickers start on a server-clock second boundary, so the dashboard
    // changes its seconds at the same moment as the Mini HUD and every other screen.
    ['1e3-Date.now()%1e3', '1e3-F1()%1e3', 2]
];
for (const [before, after, expected] of replacements) {
    const occurrences = bundle.split(before).length - 1;
    if (occurrences !== expected) throw new Error(`Dashboard clock pattern mismatch: expected ${expected}, found ${occurrences}`);
    bundle = bundle.split(before).join(after);
}
fs.writeFileSync(bundlePath, bundle, 'utf8');
console.log('Dashboard display, grouping and alerts now use the existing server clock offset.');
