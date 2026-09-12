const fs = require('fs');

const code = fs.readFileSync('c:\\Users\\tinna\\Downloads\\Boss time\\public\\build\\assets\\dashboard-B9CVP--8.js', 'utf8');

const idx = code.indexOf('onClick:()=>w(5)');
if (idx !== -1) {
    console.log(code.substring(idx - 600, idx));
}
