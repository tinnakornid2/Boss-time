'use strict';

// The original React source is not included in this repository. Keep this
// narrowly scoped, repeatable patch for the checked-in production bundle.
const fs = require('node:fs');
const path = require('node:path');

const bundlePath = path.join(__dirname, '../public/build/assets/dashboard-B9CVP--8.js');
const source = fs.readFileSync(bundlePath, 'utf8');
const start = source.indexOf('function BS(t){');
const end = source.indexOf('function US(t){', start);
if (start < 0 || end < 0) throw new Error('Reset Boss Time component not found');
if (source.slice(start, end).includes('Copied delay from')) {
    console.log('Reset Boss Time UI patch already applied');
    process.exit(0);
}

let component = source.slice(start, end);
function replaceOnce(before, after) {
    const first = component.indexOf(before);
    if (first < 0 || component.indexOf(before, first + before.length) >= 0) {
        throw new Error(`Expected exactly one match: ${before.slice(0, 90)}`);
    }
    component = component.slice(0, first) + after + component.slice(first + before.length);
}

replaceOnce('const e=je.c(96)', 'const e=je.c(97)');
replaceOnce(
    'r=[...new Set(n.map(tM))].sort()',
    'r=[...new Set(n.map(tM))].sort((W,ce)=>{const me=n.find(Ne=>tM(Ne)===W)?.name??"",Ne=n.find(We=>tM(We)===ce)?.name??"";return me.localeCompare(Ne,"en",{sensitivity:"base"})||W.localeCompare(ce)})'
);
replaceOnce(
    '[y,x]=M.useState(null),[g,S]=M.useState(!1)',
    '[y,x]=M.useState(null),[pasteTarget,setPasteTarget]=M.useState(null),[g,S]=M.useState(!1)'
);
replaceOnce('e[70]!==o.length?', 'e[70]!==o.length||e[96]!==pasteTarget?');
replaceOnce('e[70]=o.length,e[71]=ue', 'e[70]=o.length,e[96]=pasteTarget,e[71]=ue');
replaceOnce(
    'children:[c.jsxs("div",{className:"flex items-center gap-1.5 border-b border-white/8 px-2.5 py-1.5"',
    'children:[y&&c.jsxs("div",{className:"flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5 text-[10px] text-amber-200",children:[c.jsx("span",{children:"Copied delay from"}),c.jsx("strong",{children:y.sourceName}),c.jsx("span",{children:`(${y.hours}h ${y.minutes}m)`}),c.jsx("span",{children:"Select a boss name below; Paste appears only on that row."}),pasteTarget&&c.jsx("strong",{className:"text-sky-300",children:`→ ${resetBossByKey[pasteTarget]?.name??""}`})]}),c.jsxs("div",{className:"flex items-center gap-1.5 border-b border-white/8 px-2.5 py-1.5"'
);
replaceOnce(
    'c.jsxs("span",{className:"truncate text-[11px] text-white/70",title:resetBossByKey[me]?.location??"",children:',
    'c.jsxs("button",{type:"button",onPointerDown:qS,onClick:()=>{if(y&&!_.has(me))setPasteTarget(me)},className:`no-drag truncate text-left text-[11px] text-white/70 ${y&&!_.has(me)?"cursor-pointer hover:text-amber-300":""} ${pasteTarget===me?"rounded bg-amber-400/15 ring-1 ring-amber-400/50":""}`,title:y?"Select as paste destination":resetBossByKey[me]?.location??"",children:'
);
replaceOnce(
    'onClick:()=>x({...G[me]??{hours:0,minutes:0}})',
    'onClick:()=>{x({...G[me]??{hours:0,minutes:0},sourceName:resetBossByKey[me]?.name??""});setPasteTarget(null)}'
);
replaceOnce(
    'y&&c.jsx("button",{type:"button",title:`Paste delay (${y.hours}h ${y.minutes}m)`',
    'y&&pasteTarget===me&&!_.has(me)&&c.jsx("button",{type:"button",title:"Paste copied delay here"'
);
replaceOnce(
    'onClick:()=>{h(Ne=>({...Ne,[me]:{...y}})),f==="confirming"&&p("idle")}',
    'onClick:()=>{h(Ne=>({...Ne,[me]:{hours:y.hours,minutes:y.minutes}})),f==="confirming"&&p("idle"),setPasteTarget(null),x(null)}'
);

fs.writeFileSync(bundlePath, source.slice(0, start) + component + source.slice(end));
console.log('Reset Boss Time UI patch applied');
