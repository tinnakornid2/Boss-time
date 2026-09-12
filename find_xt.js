const fs = require('fs');

const code = fs.readFileSync('c:\\Users\\tinna\\Downloads\\Boss time\\public\\build\\assets\\dashboard-B9CVP--8.js', 'utf8');

const idx = code.indexOf('xt=');
if (idx !== -1) {
    console.log(code.substring(Math.max(0, idx - 50), Math.min(code.length, idx + 200)));
} else {
    // Search with regex
    const matches = code.match(/[a-zA-Z0-9_$]+\.definition=\{methods:\["put"\],url:"\/bosses\/\{boss\}"\}/g) || [];
    console.log('Matches for /bosses/{boss}:', matches);
}
