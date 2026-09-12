const fs = require('fs');

const code = fs.readFileSync('c:\\Users\\tinna\\Downloads\\Boss time\\public\\build\\assets\\dashboard-B9CVP--8.js', 'utf8');

// Find where onClick is defined in the boss row component
const searchTerms = ['onKillNow', 'onKill', 'still_alive', 'spawn_5min', 'toggle_pre_spawned', 'onAdminAction'];
searchTerms.forEach(term => {
    let count = 0;
    let idx = 0;
    console.log(`\n=== USAGES OF ${term} ===`);
    while ((idx = code.indexOf(term, idx)) !== -1 && count < 3) {
        console.log(code.substring(Math.max(0, idx - 50), Math.min(code.length, idx + 200)));
        idx += term.length + 5;
        count++;
    }
});
