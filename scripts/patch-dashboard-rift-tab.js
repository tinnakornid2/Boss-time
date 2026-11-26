'use strict';

// Adds an Admin-only "Rift" tab to the Settings menu (Display / Audio / Invasion / Events / Rift / Admin).
// The React source is not in this repository, so this is a narrow, repeatable string patch of the
// checked-in bundle. The tab body is an empty <div id="rift-settings-mount">; public/js/rift-panel.js
// fills it. React renders no children there, so it never fights the panel's DOM.
const fs = require('node:fs');
const path = require('node:path');

const assetsDir = path.join(__dirname, '../public/build/assets');
const bundleName = fs.readdirSync(assetsDir).find(name => /^dashboard-.*\.js$/.test(name));
if (!bundleName) throw new Error('dashboard bundle not found');
const bundlePath = path.join(assetsDir, bundleName);
let source = fs.readFileSync(bundlePath, 'utf8');

if (source.includes('rift-settings-mount')) {
    console.log('Rift settings tab patch already applied');
    process.exit(0);
}

function replaceOnce(before, after) {
    const first = source.indexOf(before);
    if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
        throw new Error(`Expected exactly one match: ${before.slice(0, 90)}`);
    }
    source = source.slice(0, first) + after + source.slice(first + before.length);
}

// Tab list: Admin only, placed before "admin".
replaceOnce('ze=["display","audio","invasion","events",...T?["admin"]:[]]', 'ze=["display","audio","invasion","events",...T?["rift","admin"]:[]]');
// Icon and label.
replaceOnce(
    'events:c.jsx(wd,{className:"size-3.5"}),admin:c.jsx(rs,{className:"size-3.5"})}[De],Et={display:"Display",audio:"Audio",invasion:"Invasion",events:"Events",admin:"Admin"}[De]',
    'events:c.jsx(wd,{className:"size-3.5"}),rift:c.jsx("span",{"aria-hidden":"true",className:"text-[11px] leading-none",children:"\u{1F300}"}),admin:c.jsx(rs,{className:"size-3.5"})}[De],Et={display:"Display",audio:"Audio",invasion:"Invasion",events:"Events",rift:"Rift",admin:"Admin"}[De]'
);
// Tab body: shares the Events slot (same memo deps: events, isAdmin, active tab).
replaceOnce(
    'Oe=rt==="events"&&c.jsx(_S,{events:xe,isAdmin:T})',
    'Oe=rt==="events"?c.jsx(_S,{events:xe,isAdmin:T}):rt==="rift"&&T&&c.jsx("div",{id:"rift-settings-mount",className:"rift-settings-mount"})'
);

fs.writeFileSync(bundlePath, source);
console.log(`Rift settings tab added to ${bundleName}`);
