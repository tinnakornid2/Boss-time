const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Desktop main window title shows the desktop version instead of the page title', () => {
    const main = fs.readFileSync(path.join(__dirname, '../desktop-app/main.js'), 'utf8');
    assert.ok(main.includes("`Boss Tracker v${require('./package.json').version}`"));
    assert.ok(main.includes('mainWindow.setTitle(getMainWindowTitle())'));
    assert.ok(main.includes("mainWindow.on('page-title-updated', event => event.preventDefault())"));
});
