const fs = require('fs');
const path = require('path');

const srcDir = 'c:\\Users\\tinna\\Downloads\\Boss time\\public\\sounds';
const destDir = 'c:\\Users\\tinna\\Downloads\\Boss time\\public';

const files = fs.readdirSync(srcDir);
for (const f of files) {
    fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
    console.log(`Copied ${f} to public root`);
}
