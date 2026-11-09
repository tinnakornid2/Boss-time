// Generates the three secrets phone alerts need and prints them once, in your own terminal.
// Nothing is saved or sent anywhere. Copy each value into Vercel, then close the terminal.
//   node scripts/generate-push-keys.js
const crypto = require('crypto');
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
const tickSecret = crypto.randomBytes(32).toString('base64url');

const line = '-'.repeat(60);
console.log(`\n${line}\nคัดลอกทีละค่าไปใส่ใน Vercel (ห้ามส่งให้ใคร / do not share)\n${line}`);
console.log(`\n1) Name: VAPID_PUBLIC_KEY\n   Value: ${publicKey}`);
console.log(`\n2) Name: VAPID_PRIVATE_KEY\n   Value: ${privateKey}`);
console.log(`\n3) Name: PUSH_TICK_SECRET\n   Value: ${tickSecret}`);
console.log(`\n${line}\nค่าที่ 3 ใช้ใส่ใน Google Apps Script (PUSH_TICK_SECRET) ด้วย\nรันใหม่จะได้ค่าใหม่ทุกครั้ง ใช้ชุดเดียวกันให้ครบทั้ง 3 ค่า\n${line}\n`);
