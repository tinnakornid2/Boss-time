const https = require('https');
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'server', 'data', 'store.json');
const SNAPSHOT_PATH = 'C:\\Users\\tinna\\.gemini\\antigravity-ide\\brain\\a8a31133-b583-42e0-92c4-f27d83db807e\\scratch\\dashboard_inertia.json';

class Session {
    constructor(cookieHeader = '') {
        this.cookies = {};
        if (cookieHeader) {
            cookieHeader.split(';').forEach(part => {
                const eq = part.indexOf('=');
                if (eq > 0) this.cookies[part.substring(0, eq).trim()] = part.substring(eq + 1).trim();
            });
        }
    }

    setCookiesFromHeaders(setCookieHeader) {
        if (!setCookieHeader) return;
        const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
        for (const h of headers) {
            const part = h.split(';')[0].trim();
            const eqIdx = part.indexOf('=');
            if (eqIdx > 0) {
                const k = part.substring(0, eqIdx).trim();
                const v = part.substring(eqIdx + 1).trim();
                this.cookies[k] = v;
            }
        }
    }

    getCookieHeader() {
        return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    getXsrfToken() {
        if (this.cookies['XSRF-TOKEN']) {
            return decodeURIComponent(this.cookies['XSRF-TOKEN']);
        }
        return '';
    }

    async request(url, options = {}) {
        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ...options.headers
            };

            const cookieStr = this.getCookieHeader();
            if (cookieStr) {
                headers['Cookie'] = cookieStr;
            }

            const req = https.request({
                hostname: u.hostname,
                port: 443,
                path: u.pathname + u.search,
                method: options.method || 'GET',
                headers
            }, (res) => {
                this.setCookiesFromHeaders(res.headers['set-cookie']);
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                }));
            });

            req.on('error', reject);
            if (options.body) req.write(options.body);
            req.end();
        });
    }
}

function updateStore(data) {
    if (!fs.existsSync(STORE_PATH)) {
        console.error('Store file does not exist at:', STORE_PATH);
        return false;
    }
    const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));

    if (data.bosses && Array.isArray(data.bosses)) {
        store.bosses = data.bosses;
    }
    if (data.events && Array.isArray(data.events)) {
        store.events = data.events;
    }
    if (data.allEvents && Array.isArray(data.allEvents)) {
        store.allEvents = data.allEvents;
    }
    if (data.resetTimeConfigs) {
        store.resetTimeConfigs = data.resetTimeConfigs;
    }
    if (data.savedMaintenanceEndTime !== undefined) {
        store.savedMaintenanceEndTime = data.savedMaintenanceEndTime;
    }
    if (data.announcement !== undefined) {
        store.settings.announcement = data.announcement;
    }

    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
    console.log('✅ Successfully updated local store.json with live data:');
    console.log(`   - ${store.bosses.length} Bosses`);
    console.log(`   - ${store.events.length} Today Events`);
    console.log(`   - ${store.allEvents?.length || 0} All Clan Events`);
    console.log(`   - ${Object.keys(store.resetTimeConfigs || {}).length} Reset Configs`);
    return true;
}

async function sync() {
    const args = process.argv.slice(2);
    let cookieArg = null;
    let username = 'admin';
    let password = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--cookie' && args[i + 1]) {
            cookieArg = args[i + 1];
            i++;
        } else if (!cookieArg && i === 0 && !args[i].startsWith('--')) {
            username = args[i];
        } else if (!cookieArg && i === 1 && !args[i].startsWith('--')) {
            password = args[i];
        }
    }

    console.log('🔄 Lineage 2 Boss Tracker - Live Data Sync Tool');
    console.log('================================================');

    // If explicit cookie provided
    if (cookieArg) {
        console.log('Using provided session cookie...');
        const session = new Session(cookieArg);
        const res = await session.request('https://boss.kain7.com/', {
            headers: { 'X-Inertia': 'true', 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (res.statusCode === 200) {
            try {
                const parsed = JSON.parse(res.body);
                if (parsed.props?.bosses) {
                    updateStore(parsed.props);
                    return;
                }
            } catch (e) {}
        }
        console.warn('⚠️  Cookie session was not authenticated on boss.kain7.com');
    }

    // Try live login if password provided
    if (password) {
        console.log(`Attempting login to https://boss.kain7.com as "${username}"...`);
        const session = new Session();
        const loginPage = await session.request('https://boss.kain7.com/login');
        const match = loginPage.body.match(/data-page="([^"]+)"/);
        const pageData = match ? JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : null;
        const xsrf = session.getXsrfToken();

        const loginRes = await session.request('https://boss.kain7.com/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-XSRF-TOKEN': xsrf,
                'X-Inertia': 'true',
                'X-Inertia-Version': pageData?.version || '',
                'Accept': 'text/html, application/xhtml+xml'
            },
            body: JSON.stringify({ name: username, username, password, remember: true })
        });

        if (loginRes.headers.location === 'https://boss.kain7.com' || loginRes.headers.location === 'https://boss.kain7.com/') {
            console.log('✅ Logged in successfully! Fetching live dashboard...');
            const dash = await session.request('https://boss.kain7.com/', {
                headers: {
                    'X-Inertia': 'true',
                    'X-Inertia-Version': pageData?.version || '',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            const data = JSON.parse(dash.body);
            if (data.props?.bosses) {
                updateStore(data.props);
                return;
            }
        } else {
            console.log('❌ Login failed with status:', loginRes.statusCode, 'Location:', loginRes.headers.location);
        }
    }

    // Fallback to latest captured snapshot
    console.log('📦 Using latest verified snapshot data from snapshot cache...');
    if (fs.existsSync(SNAPSHOT_PATH)) {
        const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
        if (snap.props) {
            updateStore(snap.props);
            console.log('\n💡 Tip: To sync live from boss.kain7.com with your clan account, run:');
            console.log('   node sync_live_kain7.js <username> <password>');
            console.log('   or: node sync_live_kain7.js --cookie "boss_session=..."');
            return;
        }
    }
    console.error('❌ Could not locate snapshot cache or connect live.');
}

sync().catch(console.error);
