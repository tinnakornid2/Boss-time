const fs = require('fs');
const path = require('path');

const srcSounds = 'C:\\Users\\tinna\\.gemini\\antigravity-ide\\brain\\a8a31133-b583-42e0-92c4-f27d83db807e\\scratch\\sounds';
const destSounds = 'c:\\Users\\tinna\\Downloads\\Boss time\\public\\sounds';

if (!fs.existsSync(destSounds)) {
    fs.mkdirSync(destSounds, { recursive: true });
}

const files = fs.readdirSync(srcSounds);
for (const f of files) {
    fs.copyFileSync(path.join(srcSounds, f), path.join(destSounds, f));
    console.log(`Copied sound: ${f}`);
}

// Copy favicon if exists
const srcFavicon = 'C:\\Users\\tinna\\.gemini\\antigravity-ide\\brain\\a8a31133-b583-42e0-92c4-f27d83db807e\\scratch\\favicon.png';
const destFavicon = 'c:\\Users\\tinna\\Downloads\\Boss time\\public\\favicon.png';
if (fs.existsSync(srcFavicon)) {
    fs.copyFileSync(srcFavicon, destFavicon);
    console.log('Copied favicon.png');
}

console.log('Asset transfer complete!');
