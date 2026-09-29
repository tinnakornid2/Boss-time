const fs = require('fs');
const path = require('path');

// 1. public/js/realtime-alerts.js
const alertsFile = path.join(__dirname, '..', 'public', 'js', 'realtime-alerts.js');
let alertsContent = fs.readFileSync(alertsFile, 'utf8');
const target = "if ('Notification' in window && Notification.permission === 'granted') {";
const replacement = "// Native Windows Notification disabled per user request: keep only custom in-app/HUD toast popups\n        if (false && 'Notification' in window && Notification.permission === 'granted') {";

if (alertsContent.includes(target)) {
    alertsContent = alertsContent.replace(target, replacement);
    fs.writeFileSync(alertsFile, alertsContent, 'utf8');
    console.log('Disabled native notification in realtime-alerts.js');
} else {
    console.log('Target already replaced or not found in realtime-alerts.js');
}

// 2. public/js/audio.js
const audioFile = path.join(__dirname, '..', 'public', 'js', 'audio.js');
if (fs.existsSync(audioFile)) {
    let audioContent = fs.readFileSync(audioFile, 'utf8');
    const audioTarget = "if (!('Notification' in window)) return;";
    const audioReplacement = "// Native Windows Notification disabled per user request\n        return;\n        if (!('Notification' in window)) return;";
    if (audioContent.includes(audioTarget) && !audioContent.includes('// Native Windows Notification disabled')) {
        audioContent = audioContent.replace(audioTarget, audioReplacement);
        fs.writeFileSync(audioFile, audioContent, 'utf8');
        console.log('Disabled native notification in audio.js');
    }
}
