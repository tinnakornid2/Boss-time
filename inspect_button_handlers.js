const fs = require('fs');

const code = fs.readFileSync('c:\\Users\\tinna\\Downloads\\Boss time\\public\\build\\assets\\dashboard-B9CVP--8.js', 'utf8');

// Search for handlers passed to row components: onKill, onKillNow, onMenuOpen, onToggleMute, onAdminAction, onDoubleClickName
const terms = ['mr=', 'gr=', 'vr=', 'xr=', '$a='];
terms.forEach(t => {
    let idx = code.indexOf(t);
    if (idx !== -1) {
        console.log(`=== ${t} ===`);
        console.log(code.substring(Math.max(0, idx - 20), Math.min(code.length, idx + 400)));
    } else {
        console.log(`Not found: ${t}`);
    }
});
