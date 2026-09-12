const fs = require('fs');

const code = fs.readFileSync('c:\\Users\\tinna\\Downloads\\Boss time\\public\\build\\assets\\dashboard-B9CVP--8.js', 'utf8');

// Find all onClick handlers in the whole file
const onClicks = code.match(/onClick:\s*([a-zA-Z0-9_$]+|\(\)\s*=>\s*\{[^}]*\}|\(\)\s*=>\s*[a-zA-Z0-9_$.()]+)/g) || [];
console.log('Total onClick handlers in dashboard:', onClicks.length);
console.log('Sample onClick handlers:', [...new Set(onClicks)].slice(0, 30));
