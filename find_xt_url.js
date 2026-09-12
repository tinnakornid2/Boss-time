const fs = require('fs');

const code = fs.readFileSync('c:\\Users\\tinna\\Downloads\\Boss time\\public\\build\\assets\\dashboard-B9CVP--8.js', 'utf8');

// Find the definition of xt.url
const idx = code.indexOf('xt.url=');
if (idx !== -1) {
    console.log(code.substring(idx, idx + 400));
}
