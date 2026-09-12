const fs = require('fs');

const d = JSON.parse(fs.readFileSync('C:\\Users\\tinna\\.gemini\\antigravity-ide\\brain\\a8a31133-b583-42e0-92c4-f27d83db807e\\scratch\\dashboard_inertia.json', 'utf8'));
const storePath = 'c:\\Users\\tinna\\Downloads\\Boss time\\server\\data\\store.json';

const currentStore = JSON.parse(fs.readFileSync(storePath, 'utf8'));

currentStore.allEvents = d.props.allEvents || [];
currentStore.events = d.props.events || [];
currentStore.bosses = d.props.bosses || [];
currentStore.resetTimeConfigs = d.props.resetTimeConfigs || {};
currentStore.settings.invasionLabel = d.props.invasionLabel || "L3";
currentStore.settings.hideInvasionBosses = d.props.hideInvasionBosses || false;
currentStore.settings.announcement = d.props.announcement || null;

fs.writeFileSync(storePath, JSON.stringify(currentStore, null, 2), 'utf8');
console.log('Updated store.json with allEvents (9), bosses (89), and resetTimeConfigs (73)');
