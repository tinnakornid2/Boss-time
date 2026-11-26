'use strict';

// Rift bosses (kind "rift") have no kill: on dashboard rows they get ✅ Spawned / ❌ Not spawned /
// 🕒 Adjust time instead of Kill now, Kill time, Still alive, Spawn in 5/1 min and Not spawned.
// The ⋮ menu (edit, delete, mute) stays. Narrow, repeatable string patch of the checked-in bundle
// (no React source in this repo). Clicks call window.BossTrackerRift.mark (public/js/rift-panel.js).
const fs = require('node:fs');
const path = require('node:path');

const assetsDir = path.join(__dirname, '../public/build/assets');
const bundleName = fs.readdirSync(assetsDir).find(name => /^dashboard-.*\.js$/.test(name));
if (!bundleName) throw new Error('dashboard bundle not found');
const bundlePath = path.join(assetsDir, bundleName);
let source = fs.readFileSync(bundlePath, 'utf8');

if (source.includes('"data-rift-action"')) {
    console.log('Rift row buttons patch already applied');
    process.exit(0);
}

const riftButton = (action, tooltip, icon) =>
    `c.jsx("button",{type:"button",className:\`\${or} text-[12px] leading-none\`,"data-rift-action":"${action}","aria-label":"${tooltip}","data-unified-tooltip":"${tooltip}",onClick:()=>window.BossTrackerRift?.mark(i,"${action}"),children:"${icon}"})`;
const riftButtons = `e.isRift&&c.jsxs(c.Fragment,{children:[${[
    riftButton('spawned', 'Rift spawned', '✅'),
    riftButton('not_spawned', 'Rift not spawned', '❌'),
    riftButton('adjust', 'Rift adjust time', '🕒')
].join(',')}]})`;

// The three row components (NOW rows, still-alive rows, main rows) share this block; only the
// minified names of onKillNow, onKill and showSpawnStatusButtons differ.
const block = /c\.jsx\(Oc,\{bossId:i,onKillNow:(\w)\}\),c\.jsx\("button",\{className:`\$\{or\} text-sm`,onClick:\(\)=>(\w)\(i\),children:c\.jsx\(Ra,\{className:"size-3\.5"\}\)\}\),(\w)&&c\.jsxs\(c\.Fragment,\{children:\[c\.jsx\("span",\{className:"mx-0\.5 h-3 w-px bg-white\/10"\}\),c\.jsx\(gn,\{bossId:i,action:"still_alive"/g;
let blocks = 0;
source = source.replace(block, (_, killNow, kill, showButtons) => {
    blocks++;
    return `${riftButtons},!e.isRift&&c.jsx(Oc,{bossId:i,onKillNow:${killNow}}),!e.isRift&&c.jsx("button",{className:\`\${or} text-sm\`,onClick:()=>${kill}(i),children:c.jsx(Ra,{className:"size-3.5"})}),!e.isRift&&${showButtons}&&c.jsxs(c.Fragment,{children:[c.jsx("span",{className:"mx-0.5 h-3 w-px bg-white/10"}),c.jsx(gn,{bossId:i,action:"still_alive"`;
});
if (blocks !== 3) throw new Error(`Expected 3 row action blocks, found ${blocks}`);

// Every place that renders a row passes whether the boss is a rift.
let rows = 0;
source = source.replace(/c\.jsx\((sS|rS|Fc),\{bossId:(\w+)\.id,/g, (_, component, item) => {
    rows++;
    return `c.jsx(${component},{bossId:${item}.id,isRift:${item}.kind==="rift",`;
});
if (rows !== 5) throw new Error(`Expected 5 row renders, found ${rows}`);

fs.writeFileSync(bundlePath, source);
console.log(`Rift row buttons added to ${bundleName} (${blocks} row components, ${rows} row renders)`);
