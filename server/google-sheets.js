const fs = require('fs');
const path = require('path');
const dns = require('dns');

try {
    dns.setDefaultResultOrder('ipv4first');
} catch (_) {}

let status = {
    configured: false,
    enabled: false,
    autoFailover: false,
    webAppUrl: '',
    state: 'idle', // idle, synced, syncing, error, disabled
    lastSyncAt: null,
    lastError: null,
    lastErrorCode: null,
    totalMutationsMirrored: 0,
    consecutiveFailures: 0
};

const configFile = path.join(__dirname, 'google-sheets-config.json');

function loadLocalConfig() {
    if (fs.existsSync(configFile)) {
        try {
            return JSON.parse(fs.readFileSync(configFile, 'utf8'));
        } catch (_) {}
    }
    return null;
}

function saveLocalConfig(cfg) {
    try {
        fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), 'utf8');
    } catch (_) {}
}

function getConfig(settings = {}) {
    const local = loadLocalConfig() || {};
    const fromSettings = settings.googleSheets || {};
    const envUrl = process.env.GOOGLE_SCRIPT_WEBAPP_URL || '';
    const envToken = process.env.GOOGLE_SCRIPT_SECRET_TOKEN || '';

    const webAppUrl = fromSettings.webAppUrl || local.webAppUrl || envUrl || '';
    const secretToken = fromSettings.secretToken || local.secretToken || envToken || 'boss-parallel-secret-777999';
    const enabled = fromSettings.enabled !== undefined ? Boolean(fromSettings.enabled) : (local.enabled !== undefined ? Boolean(local.enabled) : Boolean(webAppUrl));
    const autoFailover = fromSettings.autoFailover !== undefined ? Boolean(fromSettings.autoFailover) : Boolean(local.autoFailover);

    status.configured = Boolean(webAppUrl);
    status.enabled = enabled;
    status.autoFailover = autoFailover;
    status.webAppUrl = webAppUrl ? `${webAppUrl.substring(0, 35)}...` : '';

    return { webAppUrl, secretToken, enabled, autoFailover };
}

async function requestGas(url, method = 'GET', body = null, timeoutMs = 25000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const options = {
            method,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            redirect: 'follow',
            signal: controller.signal
        };
        if (body && method === 'POST') {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);
        clearTimeout(timeout);

        if (!response.ok && response.status !== 302) {
            throw new Error(`Google Apps Script responded with HTTP ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

async function testConnection(urlParam, tokenParam) {
    const url = urlParam || getConfig().webAppUrl;
    const token = tokenParam || getConfig().secretToken;

    if (!url) {
        return { success: false, message: 'กรุณากรอก Web App URL ก่อนทดสอบ' };
    }

    try {
        const pingUrl = `${url}${url.includes('?') ? '&' : '?'}action=ping&token=${encodeURIComponent(token)}`;
        const res = await requestGas(pingUrl, 'GET', null, 15000);
        if (res && res.success) {
            status.lastError = null;
            status.consecutiveFailures = 0;
            return {
                success: true,
                message: 'เชื่อมต่อ Google Apps Script สำเร็จ!',
                details: res
            };
        }
        return { success: false, message: res.message || 'การตอบกลับไม่ถูกต้อง', details: res };
    } catch (err) {
        return { success: false, message: `เชื่อมต่อล้มเหลว: ${err.message}` };
    }
}

let syncQueue = [];
let isProcessingQueue = false;

async function processQueue() {
    if (isProcessingQueue || syncQueue.length === 0) return;
    isProcessingQueue = true;

    while (syncQueue.length > 0) {
        const item = syncQueue.shift();
        const cfg = getConfig(item.settings);
        if (!cfg.enabled || !cfg.webAppUrl) continue;

        try {
            status.state = 'syncing';
            const payload = {
                action: item.action,
                token: cfg.secretToken,
                dataRevision: item.dataRevision,
                ...item.payload
            };
            const res = await requestGas(cfg.webAppUrl, 'POST', payload, 20000);
            if (res && res.success) {
                status.state = 'synced';
                status.lastSyncAt = Date.now();
                status.lastError = null;
                status.consecutiveFailures = 0;
                status.totalMutationsMirrored++;
            } else {
                throw new Error(res.message || 'Mutation mirror rejected');
            }
        } catch (err) {
            status.consecutiveFailures++;
            status.lastError = err.message;
            status.state = status.consecutiveFailures >= 3 ? 'error' : 'synced';
            console.error('[Google Apps Script Mirror Error]:', err.message);
        }
    }

    isProcessingQueue = false;
}

function mirrorMutation(action, payload = {}, dataRevision = 0, settings = {}) {
    if (process.env.NODE_ENV === 'test') return;
    const cfg = getConfig(settings);
    if (!cfg.enabled || !cfg.webAppUrl) return;

    // Zero Countdown Traffic Contract: ignore any non-mutation timers
    if (action === 'tick' || action === 'countdown') return;

    syncQueue.push({ action, payload, dataRevision, settings });
    if (syncQueue.length > 50) {
        syncQueue = syncQueue.slice(-50);
    }
    setImmediate(processQueue);
}

async function syncFullStore(store, settings = {}) {
    const cfg = getConfig(settings);
    if (!cfg.webAppUrl) {
        return { success: false, message: 'ยังไม่ได้ระบุ Web App URL' };
    }

    try {
        status.state = 'syncing';
        const payload = {
            action: 'sync_full',
            token: cfg.secretToken,
            dataRevision: Number(store.meta?.dataRevision) || 1,
            store: {
                bosses: store.bosses || [],
                allEvents: store.allEvents || store.events || [],
                settings: store.settings || {},
                resetTimeConfigs: store.resetTimeConfigs || {}
            }
        };

        const res = await requestGas(cfg.webAppUrl, 'POST', payload, 30000);
        if (res && res.success) {
            status.state = 'synced';
            status.lastSyncAt = Date.now();
            status.lastError = null;
            status.consecutiveFailures = 0;
            status.totalMutationsMirrored++;
            return {
                success: true,
                message: `ซิงค์ข้อมูลบอส ${store.bosses?.length || 0} ตัว และอีเวนต์ลง Google Sheets เรียบร้อยแล้ว!`,
                details: res
            };
        }
        throw new Error(res.message || 'Sync failed');
    } catch (err) {
        status.state = 'error';
        status.lastError = err.message;
        status.consecutiveFailures++;
        return { success: false, message: `ซิงค์ล้มเหลว: ${err.message}` };
    }
}

async function fetchStore(settings = {}) {
    const cfg = getConfig(settings);
    if (!cfg.webAppUrl) return null;

    try {
        const url = `${cfg.webAppUrl}${cfg.webAppUrl.includes('?') ? '&' : '?'}action=get_store&token=${encodeURIComponent(cfg.secretToken)}`;
        const res = await requestGas(url, 'GET', null, 25000);
        if (res && res.success && res.store) {
            return res.store;
        }
        return null;
    } catch (err) {
        console.error('[Google Apps Script Failover Fetch Error]:', err.message);
        return null;
    }
}

function getStatus(settings = {}) {
    const cfg = getConfig(settings);
    return {
        configured: Boolean(cfg.webAppUrl),
        enabled: cfg.enabled,
        autoFailover: cfg.autoFailover,
        webAppUrl: cfg.webAppUrl ? `${cfg.webAppUrl.substring(0, 35)}...` : '',
        fullUrl: cfg.webAppUrl,
        secretToken: cfg.secretToken ? '••••••••' : '',
        state: !cfg.enabled ? 'disabled' : status.state,
        lastSyncAt: status.lastSyncAt,
        lastError: status.lastError,
        consecutiveFailures: status.consecutiveFailures,
        totalMutationsMirrored: status.totalMutationsMirrored
    };
}

module.exports = {
    getConfig,
    saveLocalConfig,
    testConnection,
    mirrorMutation,
    syncFullStore,
    fetchStore,
    getStatus
};
