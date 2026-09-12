const fs = require('fs');

const code = fs.readFileSync('c:\\Users\\tinna\\Downloads\\Boss time\\public\\build\\assets\\dashboard-B9CVP--8.js', 'utf8');

const idx = code.indexOf('Still Alive');
if (idx !== -1) {
    // Find the function definition
    const funcStart = code.lastIndexOf('function ', idx);
    console.log(code.substring(funcStart, funcStart + 300));
}
