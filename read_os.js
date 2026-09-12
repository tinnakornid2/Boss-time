const fs = require('fs');

const code = fs.readFileSync('c:\\Users\\tinna\\Downloads\\Boss time\\public\\build\\assets\\dashboard-B9CVP--8.js', 'utf8');

const idx = code.indexOf('function oS(t)');
console.log(code.substring(idx, idx + 1500));
