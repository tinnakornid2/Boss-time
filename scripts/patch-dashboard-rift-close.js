'use strict';

// A Spawned rift (pinned NOW) shows a countdown to its real close next to NOW: "NOW · 36m 50s".
// Owner's rule: only ✅ Spawned keeps a rift at NOW, and it counts down to the close.
// Row renders pass riftCloseMs (rift_close_at of a pinned rift); the two row components with a
// countdown use it as their target, so React re-renders when the pin starts or ends, and the
// shared one-second ticker (local only, no Firebase) labels it. Narrow, repeatable string patch
// of the checked-in bundle (no React source in this repo), applied after patch-dashboard-rift-row.js.
const fs = require('node:fs');
const path = require('node:path');

const assetsDir = path.join(__dirname, '../public/build/assets');
const bundleName = fs.readdirSync(assetsDir).find(name => /^dashboard-.*\.js$/.test(name));
if (!bundleName) throw new Error('dashboard bundle not found');
const bundlePath = path.join(assetsDir, bundleName);
let source = fs.readFileSync(bundlePath, 'utf8');

if (source.includes('riftCloseMs')) {
    console.log('Rift close countdown patch already applied');
    process.exit(0);
}
if (!source.includes('"data-rift-action"')) throw new Error('Run patch-dashboard-rift-row.js first');

function replaceOnce(from, to) {
    const count = source.split(from).length - 1;
    if (count !== 1) throw new Error(`Expected 1 match, found ${count}: ${from.slice(0, 80)}`);
    source = source.replace(from, to);
}
function replaceAll(pattern, to, expected) {
    let count = 0;
    source = source.replace(pattern, (...args) => { count++; return typeof to === 'function' ? to(...args) : to; });
    if (count !== expected) throw new Error(`Expected ${expected} matches, found ${count}: ${pattern}`);
}

// 1. Label: NOW plus the time left until the close when the row counts down to it.
replaceOnce(
    'function uc(t,e,n,i){if(e)return{label:"NOW",overdue:!0,warning:!1};',
    'function uc(t,e,n,i,z){if(e){if(z&&t!==null&&t>i){const q=t-i,qh=Math.floor(q/36e5),qm=Math.floor(q%36e5/6e4),qs=Math.floor(q%6e4/1e3);return{label:`NOW · ${qh>0?qh+"h ":""}${String(qm).padStart(2,"0")}m ${String(qs).padStart(2,"0")}s`,overdue:!0,warning:!1}}return{label:"NOW",overdue:!0,warning:!1}}'
);
// 2. The shared one-second ticker passes the flag through.
replaceOnce(
    'aa.forEach(({el:e,targetMs:n,isJustSpawned:i,isPreSpawned:s})=>{const{label:r,overdue:o,warning:a}=uc(n,i,s,t);',
    'aa.forEach(({el:e,targetMs:n,isJustSpawned:i,isPreSpawned:s,untilClose:z})=>{const{label:r,overdue:o,warning:a}=uc(n,i,s,t,z);'
);
// 3. The countdown component takes untilClose.
replaceOnce(
    '{targetMs:i,isJustSpawned:s,isPreSpawned:r,spawnTime:o,showSpawnTime:a,compact:l}=e,',
    '{targetMs:i,isJustSpawned:s,isPreSpawned:r,spawnTime:o,showSpawnTime:a,compact:l,untilClose:riftUntilClose}=e,'
);
replaceOnce('aa.set(E,{el:E,targetMs:i,isJustSpawned:s,isPreSpawned:u}),U1();const{label:O,overdue:k}=uc(i,s,u,F1());',
    'aa.set(E,{el:E,targetMs:i,isJustSpawned:s,isPreSpawned:u,untilClose:riftUntilClose}),U1();const{label:O,overdue:k}=uc(i,s,u,F1(),riftUntilClose);');
replaceOnce('(m=uc(i,s,u,F1()),', '(m=uc(i,s,u,F1(),riftUntilClose),');

// 4. The two row components with a countdown target the close of a pinned rift.
replaceAll(/targetMs:u,isJustSpawned:d,[^}]*\}=e,/g,
    (m) => m.replace('targetMs:u,', 'targetMs:riftBaseTargetMs,').replace(/\}=e,$/, '}=e,u=e.riftCloseMs||riftBaseTargetMs,'), 2);
replaceAll(/c\.jsx\(ms,\{targetMs:u,isJustSpawned:d,/g, 'c.jsx(ms,{targetMs:u,untilClose:!!e.riftCloseMs,isJustSpawned:d,', 4);

// 5. Every row render passes the close of a pinned rift.
replaceAll(/isRift:(\w+)\.kind==="rift",/g,
    (_, item) => `isRift:${item}.kind==="rift",riftCloseMs:${item}.kind==="rift"&&${item}.pinned_alive&&${item}.rift_close_at?Date.parse(${item}.rift_close_at):0,`, 5);

fs.writeFileSync(bundlePath, source);
console.log(`Rift close countdown added to ${bundleName}`);
