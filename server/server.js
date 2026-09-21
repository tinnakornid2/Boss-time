const http = require('http');
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const dns = require('dns');

try {
    dns.setDefaultResultOrder('ipv4first');
} catch (_) {}
const db = require('./db');

const app = express();
const pkg = require('../package.json');
const APP_VERSION = `v${pkg.version || '1.2.0'}`;
const INERTIA_VERSION = '55c7f37e0516ec0f9ab5340e89e90c20';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const PRE_SPAWN_ALERT_WINDOW_MS = 5 * 60 * 1000;
const loginAttempts = new Map();

function limitLogin(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (loginAttempts.get(key) || []).filter(time => now - time < 10 * 60 * 1000);
    if (recent.length >= 10) {
        return res.status(429).json({ success: false, message: 'Too many attempts — กรุณารอแล้วลองใหม่' });
    }
    recent.push(now);
    loginAttempts.set(key, recent);
    next();
}

let cachedSessionSecret = null;
function sessionSecret() {
    if (cachedSessionSecret) return cachedSessionSecret;
    let source = process.env.SESSION_SECRET || '';
    if (!source && process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
            const credential = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
            source = `${credential.project_id}:${credential.client_email}:${credential.private_key}`;
        } catch (_) {}
    }
    if (!source) {
        try {
            const credential = require('./cloud-credentials').getCredentials();
            if (credential) source = `${credential.project_id}:${credential.client_email}:${credential.private_key}`;
        } catch (_) {}
    }
    // Stable local fallback; production normally uses one of the credentials above.
    if (!source) source = `boss-timel2m:${__dirname}:session`;
    cachedSessionSecret = crypto.createHash('sha256').update(source).digest();
    return cachedSessionSecret;
}

function createSession(role, maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
    const effectiveAge = Math.max(60, Number(maxAgeSeconds) || SESSION_MAX_AGE_SECONDS);
    const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + effectiveAge * 1000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function readSession(value) {
    if (!value || !value.includes('.')) return null;
    const [payload, signature] = value.split('.');
    const expected = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!['admin', 'member', 'guest'].includes(data.role) || Number(data.exp) <= Date.now()) return null;
        return data;
    } catch (_) {
        return null;
    }
}

function verifyPassword(password, plaintext, storedHash, fallback) {
    if (plaintext && password === plaintext) return true;
    if (!plaintext && !storedHash && fallback && password === fallback) return true;
    if (!storedHash) return false;
    if (storedHash.startsWith('scrypt$')) {
        const [, salt, expectedHex] = storedHash.split('$');
        if (!salt || !expectedHex) return false;
        const actual = crypto.scryptSync(password, salt, 64);
        const expected = Buffer.from(expectedHex, 'hex');
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    }
    const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
    return legacyHash === storedHash;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

// Safe JSON parse error handler
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Malformed JSON payload' });
    }
    next(err);
});

// Request Logger
app.use((req, res, next) => {
    console.log(`[REQ] ${req.method} ${req.url} (Inertia: ${req.headers['x-inertia'] || 'no'})`);
    next();
});

// Cookie Parser Middleware
app.use((req, res, next) => {
    const header = req.headers.cookie;
    req.cookies = {};
    if (header) {
        header.split(';').forEach(c => {
            const parts = c.trim().split('=');
            if (parts[0]) {
                req.cookies[parts[0]] = decodeURIComponent(parts.slice(1).join('=') || '');
            }
        });
    }
    // Set XSRF-TOKEN cookie if missing
    if (!req.cookies['XSRF-TOKEN']) {
        const token = 'eyJpdiI6InhzcmZfdG9rZW4iLCJ2YWx1ZSI6InhzcmZfdmFsdWUifQ==';
        res.setHeader('Set-Cookie', `XSRF-TOKEN=${token}; Path=/; SameSite=Lax`);
        req.cookies['XSRF-TOKEN'] = token;
    }
    next();
});

// Serve static assets from public (do not serve index.html on root)
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { index: false }));

// Firebase initialization guard middleware: Ensure cloud DB is ready
let firebaseInitPromise = null;
app.use(async (req, res, next) => {
    if (req.path.startsWith('/assets/') || req.path.startsWith('/sound/') || req.path.endsWith('.ico') || req.path.endsWith('.png') || req.path.endsWith('.jpg') || req.path.endsWith('.css') || req.path.endsWith('.js')) {
        return next();
    }
    if (!firebaseInitPromise) {
        firebaseInitPromise = db.initFirebase();
    }
    try {
        await firebaseInitPromise;
    } catch (e) {
        console.error('[Firebase Init Middleware Error]:', e.message);
    }
    next();
});

// Mount REST API
app.use('/api/v1', requireSession, requireSameOrigin, require('./routes/api'));
app.use('/api/auth', limitLogin, require('./routes/auth').router);
app.use('/api/settings', requireSession, requireSameOrigin, require('./routes/settings'));

// Helper: Escape HTML for data-page attribute
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderLoginHtml(pageData, title) {
    const error = escapeHtml(String(pageData?.props?.errors?.password || ''));
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Log in - ${escapeHtml(title)}</title><link rel="icon" href="/favicon.png" type="image/png">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070708;color:#fff;font-family:system-ui,sans-serif}
.login{position:relative;width:min(360px,calc(100vw - 32px));padding:26px;border:1px solid #3f3f46;border-radius:18px;background:#101012;box-shadow:0 24px 70px #000}
.lang-toggle{position:absolute;top:18px;right:18px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);color:#38bdf8;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all .15s}
.lang-toggle:hover{background:rgba(56,189,248,0.15);border-color:rgba(56,189,248,0.35);color:#7dd3fc}
.brand{text-align:center;color:#d97706;font-weight:800;margin-bottom:22px}
.tabs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:18px}
.tabs label{padding:9px;text-align:center;border-radius:8px;background:#18181b;cursor:pointer;font-size:12px;font-weight:700}
.tabs input{position:absolute;opacity:0}
.tabs label:has(input:checked){background:#78350f;color:#fcd34d}
.field{display:block;margin-bottom:7px;color:#a1a1aa;font-size:11px;font-weight:700}
.password{width:100%;padding:12px;border:1px solid #52525b;border-radius:9px;background:#09090b;color:#fff;font-size:16px}
.submit{width:100%;margin-top:16px;padding:12px;border:0;border-radius:9px;background:#d97706;color:#fff;font-weight:800;cursor:pointer}
.submit:disabled{opacity:.55}
.error{margin:12px 0 0;color:#f87171;font-size:13px}
.note{margin-top:14px;color:#71717a;text-align:center;font-size:11px}
</style></head><body><main class="login">
<button type="button" class="lang-toggle" id="login-lang-btn" onclick="toggleLoginLang()">🌐 EN</button>
<div class="brand">#madebyelon</div>
<form method="post" action="/login" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent=window.loginLang==='th'?'กำลังเข้าสู่ระบบ...':'Signing in...'">
<div class="tabs"><label><input type="radio" name="name" value="kain7" checked>MEMBER</label><label><input type="radio" name="name" value="guest">GUEST</label><label><input type="radio" name="name" value="admin">ADMIN</label></div>
<label class="field" id="label-pwd" for="password">PASSWORD</label>
<input class="password" id="password" name="password" type="password" required autocomplete="current-password" placeholder="Enter password" autofocus onkeydown="if(event.key==='Enter'){event.preventDefault();this.form.requestSubmit()}">
${error ? `<p class="error">${error}</p>` : ''}
<button class="submit" id="btn-submit" type="submit">SIGN IN</button>
</form><div class="note" id="login-footer-note">Boss Tracker ${APP_VERSION}</div></main>
<script>
window.loginLang = localStorage.getItem('tracker_lang') === 'th' ? 'th' : 'en';
function updateLoginLangUi() {
    const isTh = window.loginLang === 'th';
    document.documentElement.lang = window.loginLang;
    const btn = document.getElementById('login-lang-btn');
    if (btn) {
        btn.textContent = isTh ? '🌐 TH' : '🌐 EN';
        btn.title = isTh ? 'ภาษา: ไทย (กดเพื่อเปลี่ยนเป็น English)' : 'Language: English (Click to switch to Thai)';
    }
    const lbl = document.getElementById('label-pwd');
    if (lbl) lbl.textContent = isTh ? 'รหัสผ่าน (PASSWORD)' : 'PASSWORD';
    const pwdInput = document.getElementById('password');
    if (pwdInput) pwdInput.placeholder = isTh ? 'กรอกรหัสผ่าน' : 'Enter password';
    const subBtn = document.getElementById('btn-submit');
    if (subBtn && !subBtn.disabled) subBtn.textContent = isTh ? 'เข้าสู่ระบบ' : 'SIGN IN';
    const note = document.getElementById('login-footer-note');
    if (note) note.textContent = isTh ? 'ระบบติดตามบอส ${APP_VERSION}' : 'Boss Tracker ${APP_VERSION}';
}
function toggleLoginLang() {
    window.loginLang = window.loginLang === 'th' ? 'en' : 'th';
    localStorage.setItem('tracker_lang', window.loginLang);
    updateLoginLangUi();
}
updateLoginLangUi();
</script>
</body></html>`;
}

// Helper: HTML page wrapper matching boss.kain7.com exactly
function renderHtml(pageData, title = '#Kain7') {
    if (pageData?.component === 'auth/login') return renderLoginHtml(pageData, title);
    const jsonStr = escapeHtml(JSON.stringify(pageData));
    const isDashboard = Boolean(pageData && pageData.component === 'dashboard');
    const userRole = (pageData && pageData.props && pageData.props.auth && pageData.props.auth.user && pageData.props.auth.user.role) || 'guest';
    const isAdmin = userRole === 'admin';

    const adminPasswordSnippet = isAdmin ? `
    <style>
        /* Ensure Settings Dialog has comfortable width and does not clip or overflow */
        div[role="dialog"] {
            max-width: 520px !important;
            width: min(520px, calc(100vw - 24px)) !important;
        }

        /* Dedicated System Settings Sub-Bar placed neatly below React top tabs */
        #custom-admin-tabs-subbar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
            padding: 8px 12px;
            background: rgba(0, 0, 0, 0.45);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            box-sizing: border-box;
            width: 100%;
        }

        .custom-admin-tab-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.75);
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.12);
            cursor: pointer;
            transition: all 0.15s ease;
            user-select: none;
            white-space: nowrap;
        }

        .custom-admin-tab-btn:hover {
            background: rgba(255, 255, 255, 0.12);
            color: #fff;
            border-color: rgba(255, 255, 255, 0.25);
        }

        .custom-admin-tab-btn.active {
            background: rgba(245, 158, 11, 0.22) !important;
            color: #fbbf24 !important;
            border-color: #f59e0b !important;
            font-weight: 700 !important;
            box-shadow: 0 0 10px rgba(245, 158, 11, 0.25) !important;
        }

        /* Embedded Admin Settings Panel inside main React Settings Modal */
        .admin-embedded-panel {
            width: 100%;
            max-height: 65vh;
            overflow-y: auto;
            padding: 14px 18px 24px 18px;
            box-sizing: border-box;
            color: #fff;
            animation: fadeInAdminPanel 0.15s ease;
        }
        @keyframes fadeInAdminPanel {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .admin-embedded-panel::-webkit-scrollbar {
            width: 6px;
        }
        .admin-embedded-panel::-webkit-scrollbar-track {
            background: transparent;
        }
        .admin-embedded-panel::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.15);
            border-radius: 9999px;
        }
        .admin-embedded-panel::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.25);
        }

        .settings-tab-pane {
            display: none;
            animation: fadeInAdminPane 0.15s ease;
        }
        .settings-tab-pane.active {
            display: block;
        }
        @keyframes fadeInAdminPane {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .pwd-group {
            margin-bottom: 14px;
        }
        .pwd-label-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        }
        .pwd-label {
            font-size: 12px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .pwd-badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .pwd-input-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        .pwd-input {
            width: 100%;
            background: #09090b;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 8px;
            padding: 9px 42px 9px 12px;
            font-size: 13px;
            color: #fff;
            box-sizing: border-box;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .pwd-input:focus {
            border-color: #f59e0b;
            box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.25);
        }
        .pwd-toggle-eye {
            position: absolute;
            right: 10px;
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.4);
            cursor: pointer;
            padding: 4px;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s;
        }
        .pwd-toggle-eye:hover { color: #fff; }
        .pwd-subhint {
            margin: 5px 0 0 0;
            font-size: 10.5px;
            color: rgba(255, 255, 255, 0.4);
            line-height: 1.4;
        }
        .pwd-alert {
            display: none;
            padding: 9px 12px;
            border-radius: 8px;
            font-size: 11px;
            margin-bottom: 12px;
            line-height: 1.4;
        }
        .pwd-alert.success {
            display: block;
            background: rgba(16, 185, 129, 0.15);
            border: 1px solid rgba(16, 185, 129, 0.4);
            color: #34d399;
        }
        .pwd-alert.error {
            display: block;
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.4);
            color: #f87171;
        }
        .pwd-cloud-notice {
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(56, 189, 248, 0.08);
            border: 1px solid rgba(56, 189, 248, 0.2);
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 11px;
            color: #7dd3fc;
            margin-top: 14px;
        }
        .pwd-footer {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 10px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 14px;
            margin-top: 16px;
            flex-shrink: 0;
        }
        .pwd-btn-cancel {
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.6);
            font-size: 12px;
            font-weight: 500;
            padding: 7px 14px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .pwd-btn-cancel:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.08);
        }
        .pwd-btn-save {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: linear-gradient(135deg, #f59e0b, #d97706);
            color: #09090b;
            font-size: 12px;
            font-weight: 700;
            padding: 7px 18px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(245, 158, 11, 0.35);
            transition: all 0.15s;
        }
        .pwd-btn-save:hover {
            filter: brightness(1.1);
            transform: translateY(-1px);
        }
        .pwd-btn-secondary {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #fff;
            font-size: 11px;
            font-weight: 600;
            padding: 7px 14px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .pwd-btn-secondary:hover {
            background: rgba(255, 255, 255, 0.15);
            border-color: rgba(255, 255, 255, 0.35);
        }

        /* Guest table styling */
        .guest-table-wrap {
            max-height: 220px;
            overflow-y: auto;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            margin-top: 12px;
        }
        .guest-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            text-align: left;
        }
        .guest-table th {
            background: #18181b;
            padding: 8px 10px;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.6);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            position: sticky;
            top: 0;
        }
        .guest-table td {
            padding: 8px 10px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            color: rgba(255, 255, 255, 0.85);
        }
        .guest-status-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 9.5px;
            font-weight: 600;
        }
        .guest-status-badge.active {
            background: rgba(34, 197, 94, 0.15);
            color: #4ade80;
            border: 1px solid rgba(34, 197, 94, 0.3);
        }
        .guest-status-badge.expired {
            background: rgba(239, 68, 68, 0.15);
            color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }

        /* PIN Lock Box */
        .pin-lock-card {
            background: rgba(245, 158, 11, 0.08);
            border: 1px solid rgba(245, 158, 11, 0.3);
            border-radius: 12px;
            padding: 16px;
            text-align: center;
            margin: 10px 0;
        }

    </style>

    <div id="admin-settings-embedded-panel" class="admin-embedded-panel" style="display:none;">
        <div id="pwd-alert-box" class="pwd-alert"></div>

            <!-- Member Unlock Form if not yet authenticated as Admin -->
            <div id="pwd-verify-admin-section" style="${isAdmin ? 'display:none;' : 'display:block;'}">
                <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 10px; padding: 14px; margin-bottom: 16px;">
                    <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 700; color: #fbbf24;" data-i18n="verify_admin_title">🛡️ Admin Verification</p>
                    <p style="margin: 0 0 12px 0; font-size: 11px; color: rgba(255,255,255,0.7); line-height: 1.5;" data-i18n="verify_admin_desc">
                        Currently in Member/Guest mode. Please enter Admin password to unlock:
                    </p>
                    <div style="display:flex; gap:8px;">
                        <input type="password" id="modal-input-verify-admin" placeholder="Current Admin password" data-i18n-ph="verify_admin_ph" class="pwd-input" style="flex:1;">
                        <button type="button" class="pwd-btn-save" style="padding: 8px 16px; white-space: nowrap;" onclick="verifyAdminAndUnlock()" title="Verify Admin" data-i18n-title="verify_btn_title" data-i18n="verify_btn">🔓 Verify</button>
                    </div>
                    <div id="pwd-verify-error" style="color: #f87171; font-size: 11px; margin-top: 8px; display: none;"></div>
                </div>
            </div>

            <!-- TAB 1: SYSTEM PASSWORDS -->
            <div id="tab-pane-passwords" class="settings-tab-pane active" style="${isAdmin ? '' : 'display:none;'}">
                <div class="pwd-group">
                    <div class="pwd-label-row">
                        <span class="pwd-label" style="color: #fbbf24;" data-i18n="admin_pwd_label">🛡️ Admin Password</span>
                        <span class="pwd-badge" data-i18n="admin_badge">System Control</span>
                    </div>
                    <div class="pwd-input-wrap">
                        <input type="password" id="modal-input-admin-pwd" class="pwd-input" placeholder="New password (min 8 chars)" data-i18n-ph="admin_pwd_ph" autocomplete="off">
                        <button type="button" class="pwd-toggle-eye" onclick="togglePwdVisibility('modal-input-admin-pwd', this)" title="Show/Hide">👁️</button>
                    </div>
                    <p class="pwd-subhint" data-i18n="admin_pwd_hint">For Admin mode: record boss kill times, add/delete bosses, manage events</p>
                </div>

                <div class="pwd-group" style="margin-top: 14px;">
                    <div class="pwd-label-row">
                        <span class="pwd-label" style="color: #38bdf8;" data-i18n="member_pwd_label">👥 Member Password</span>
                        <span class="pwd-badge" data-i18n="member_badge">View Access</span>
                    </div>
                    <div class="pwd-input-wrap">
                        <input type="password" id="modal-input-member-pwd" class="pwd-input" placeholder="New password (min 8 chars)" data-i18n-ph="member_pwd_ph" autocomplete="off">
                        <button type="button" class="pwd-toggle-eye" onclick="togglePwdVisibility('modal-input-member-pwd', this)" title="Show/Hide">👁️</button>
                    </div>
                    <p class="pwd-subhint" data-i18n="member_pwd_hint">For clan members: view boss timetable, countdown timers, and audio alerts</p>
                </div>

                <div class="pwd-cloud-notice">
                    <span>☁️</span>
                    <span data-i18n="pwd_cloud_notice">Changes will sync to Firebase Cloud automatically</span>
                </div>

                <div class="pwd-footer">
                    <button type="button" class="pwd-btn-cancel" onclick="closeAdminPwdModal()" data-i18n="cancel_btn">Cancel</button>
                    <button type="button" id="btn-modal-save-pwd" class="pwd-btn-save" onclick="submitAdminPasswords()">
                        <span data-i18n="save_pwd_btn">💾 Save Passwords</span>
                    </button>
                </div>
            </div>

            <!-- TAB 2: GUEST ACCESS -->
            <div id="tab-pane-guest" class="settings-tab-pane">
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px; margin-bottom: 14px;">
                    <div style="font-size: 12px; font-weight: 700; color: #a855f7; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <span>🎟️</span><span data-i18n="guest_section_title">Generate Temporary Passwords (Guest Access)</span>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                        <div>
                            <label style="display:block; font-size:10.5px; color:#a1a1aa; margin-bottom:4px;" data-i18n="guest_label_field">Name / Note</label>
                            <input type="text" id="guest-input-label" class="pwd-input" placeholder="e.g. Guest #1 / Friend" data-i18n-ph="guest_label_ph" style="padding-right:12px;">
                        </div>
                        <div>
                            <label style="display:block; font-size:10.5px; color:#a1a1aa; margin-bottom:4px;" data-i18n="guest_duration_field">Expiration Duration</label>
                            <select id="guest-input-duration" class="pwd-input" style="padding-right:12px; cursor:pointer;">
                                <option value="1" data-i18n="guest_dur_1">1 Hour (1 hr)</option>
                                <option value="6" data-i18n="guest_dur_6">6 Hours (6 hrs)</option>
                                <option value="12" data-i18n="guest_dur_12">12 Hours (12 hrs)</option>
                                <option value="24" data-i18n="guest_dur_24" selected>1 Day (24 hrs)</option>
                                <option value="72" data-i18n="guest_dur_72">3 Days (72 hrs)</option>
                                <option value="168" data-i18n="guest_dur_168">7 Days (1 week)</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label style="display:block; font-size:10.5px; color:#a1a1aa; margin-bottom:4px;" data-i18n="guest_pwd_field">Guest Password (or generate random)</label>
                        <div style="display:flex; gap:8px;">
                            <input type="text" id="guest-input-pwd" class="pwd-input" placeholder="Type password or generate random" data-i18n-ph="guest_pwd_ph" style="flex:1;">
                            <button type="button" class="pwd-btn-secondary" onclick="generateRandomGuestPassword()" data-i18n="guest_random_btn" title="Generate Random">🎲 Random</button>
                            <button type="button" class="pwd-btn-save" onclick="createGuestPassword()" style="white-space:nowrap;" data-i18n="guest_create_btn">➕ Create</button>
                        </div>
                    </div>
                </div>

                <div style="font-size: 11.5px; font-weight: 700; color: rgba(255,255,255,0.7); margin-top: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <span data-i18n="guest_table_title">📋 All Temporary Passwords</span>
                    <button type="button" class="pwd-btn-secondary" style="padding: 3px 8px; font-size: 10px;" onclick="fetchGuestPasswords()" data-i18n="guest_refresh_btn">🔄 Refresh</button>
                </div>
                <div class="guest-table-wrap">
                    <table class="guest-table">
                        <thead>
                            <tr>
                                <th data-i18n="guest_col_name">Name / Note</th>
                                <th data-i18n="guest_col_pwd">Password</th>
                                <th data-i18n="guest_col_expires">Expires</th>
                                <th data-i18n="guest_col_status">Status</th>
                                <th style="text-align:right;" data-i18n="guest_col_action">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="guest-table-body">
                            <tr><td colspan="5" style="text-align:center; padding:16px; color:#71717a;" data-i18n="guest_loading">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- TAB 3: GOOGLE SHEETS (PROTECTED ACCESS) -->
            <div id="tab-pane-sheets" class="settings-tab-pane">
                <!-- Lock screen -->
                <div id="sheets-locked-view" class="pin-lock-card">
                    <div style="font-size: 32px; margin-bottom: 8px;">🔒</div>
                    <div style="font-size: 14px; font-weight: 700; color: #fbbf24; margin-bottom: 6px;" data-i18n="sheets_lock_title">Protected Configuration Area</div>
                    <p style="font-size: 11px; color: rgba(255,255,255,0.7); margin: 0 0 14px 0; line-height: 1.5;" data-i18n="sheets_lock_desc">
                        Parallel Google Sheets database settings are protected. Enter password to access:
                    </p>
                    <div style="display:flex; gap:8px; max-width: 320px; margin: 0 auto;">
                        <input type="password" id="input-sheets-pin" class="pwd-input" placeholder="Enter password..." data-i18n-ph="sheets_lock_ph" style="text-align:center;" onkeydown="if(event.key==='Enter')verifySheetsPin()">
                        <button type="button" id="btn-verify-sheets-pin" class="pwd-btn-save" onclick="verifySheetsPin()" style="white-space:nowrap;" data-i18n="sheets_unlock_btn">🔓 Unlock</button>
                    </div>
                    <div id="sheets-pin-error" style="color: #f87171; font-size: 11px; margin-top: 8px; display: none;"></div>
                </div>

                <!-- Unlocked Configuration Form -->
                <div id="sheets-unlocked-view" style="display: none;">
                    <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; font-size: 11px; display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <span style="color: #34d399; font-weight: 700;" data-i18n="sheets_unlocked_badge">🔓 Unlocked</span>
                            <span id="sheets-live-status" style="margin-left: 8px; color: rgba(255,255,255,0.7);">Checking status...</span>
                        </div>
                        <button type="button" class="pwd-btn-secondary" style="padding: 2px 8px; font-size: 9.5px;" onclick="lockSheetsView()" data-i18n="sheets_lock_btn">🔒 Lock</button>
                    </div>

                    <div class="pwd-group">
                        <label class="pwd-label" style="color:#34d399;" data-i18n="sheets_url_label">🌐 Google Apps Script Web App URL</label>
                        <input type="text" id="sheets-input-url" class="pwd-input" placeholder="https://script.google.com/macros/s/.../exec" style="font-size:11px; font-family:monospace;">
                        <p class="pwd-subhint" data-i18n="sheets_url_hint">Web app URL from Google Sheets Deployment (must end with /exec)</p>
                    </div>

                    <div class="pwd-group">
                        <label class="pwd-label" style="color:#fbbf24;" data-i18n="sheets_token_label">🔑 Secret Token</label>
                        <input type="text" id="sheets-input-token" class="pwd-input" placeholder="boss-parallel-secret-777999" value="boss-parallel-secret-777999" style="font-size:12px;">
                        <p class="pwd-subhint" data-i18n="sheets_token_hint">Must match SECRET_TOKEN in Code.gs</p>
                    </div>

                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px;">
                        <label style="display:flex; align-items:center; gap:8px; font-size:11.5px; cursor:pointer; margin-bottom:6px;">
                            <input type="checkbox" id="sheets-toggle-enabled" checked style="accent-color:#f59e0b; width:15px; height:15px;">
                            <span><b data-i18n="sheets_mirror_label">Enable Parallel Mirror</b></span>
                        </label>
                        <p class="pwd-subhint" style="margin-left:23px;" data-i18n="sheets_mirror_hint">Sync bosses and events to Google Sheets in background on every update</p>

                        <label style="display:flex; align-items:center; gap:8px; font-size:11.5px; cursor:pointer; margin-top:10px; margin-bottom:6px;">
                            <input type="checkbox" id="sheets-toggle-failover" style="accent-color:#10b981; width:15px; height:15px;">
                            <span><b data-i18n="sheets_failover_label">Enable Auto Failover</b></span>
                        </label>
                        <p class="pwd-subhint" style="margin-left:23px;" data-i18n="sheets_failover_hint">Serve data from Google Sheets if Firebase is offline or quota exceeded</p>
                    </div>

                    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top: 14px; justify-content:flex-end;">
                        <button type="button" class="pwd-btn-secondary" onclick="testSheetsConnection()" id="btn-test-sheets" data-i18n="sheets_test_btn">⚡ Test Connection</button>
                        <button type="button" class="pwd-btn-secondary" onclick="syncSheetsNow()" id="btn-sync-sheets" data-i18n="sheets_sync_btn">🔄 Sync All Now</button>
                        <button type="button" class="pwd-btn-save" onclick="saveSheetsConfig()" id="btn-save-sheets" data-i18n="sheets_save_btn">💾 Save Settings</button>
                    </div>

                    <div style="margin-top: 14px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 6px; font-size: 10.5px; color: #a1a1aa; line-height: 1.5;" data-i18n="sheets_script_guide">
                        📖 <b>Script file:</b> located at <code>google_apps_script/Code.gs</code> with guide in <code>google_apps_script/README.md</code>
                    </div>
                </div>
            </div>

    </div>

    <script>
        let currentSheetsPin = '';
        let isSheetsUnlocked = false;
        let activeCustomTab = null;
        let persistentPanel = null;
        let persistentSubbar = null;
        let panelTemplateHtml = '';

        function ensurePersistentPanel() {
            if (!persistentPanel) {
                persistentPanel = document.getElementById('admin-settings-embedded-panel');
                if (persistentPanel && !panelTemplateHtml) {
                    panelTemplateHtml = persistentPanel.outerHTML;
                }
            }
            if (!persistentPanel && panelTemplateHtml) {
                const holder = document.createElement('div');
                holder.innerHTML = panelTemplateHtml;
                persistentPanel = holder.firstElementChild;
                document.body.appendChild(persistentPanel);
            }
            return persistentPanel;
        }

        function ensurePersistentSubbar() {
            if (!persistentSubbar) {
                persistentSubbar = document.getElementById('custom-admin-tabs-subbar');
            }
            if (!persistentSubbar) {
                const subbar = document.createElement('div');
                subbar.id = 'custom-admin-tabs-subbar';
                const isTh = (window.getLanguage && window.getLanguage()) === 'th' || localStorage.getItem('tracker_lang') === 'th';
                subbar.innerHTML = '<span class="text-[10px] font-bold text-amber-400/90 tracking-wider flex items-center gap-1 shrink-0 select-none mr-1">' +
                        '<span>⚙️</span><span data-i18n="system_label">' + (isTh ? 'ระบบ:' : 'System:') + '</span>' +
                    '</span>' +
                    '<button type="button" class="custom-admin-tab-btn" data-tab-id="passwords" data-i18n-title="tab_passwords" data-unified-tooltip="' + (isTh ? 'รหัสผ่านระบบ' : 'System Passwords') + '">' +
                        '<span>🔑</span><span data-i18n="tab_passwords">' + (isTh ? 'รหัสผ่านระบบ' : 'System Passwords') + '</span>' +
                    '</button>' +
                    '<button type="button" class="custom-admin-tab-btn" data-tab-id="guest" data-i18n-title="tab_guest" data-unified-tooltip="' + (isTh ? 'ไอดีชั่วคราว (Guest)' : 'Guest Access') + '">' +
                        '<span>🎟️</span><span data-i18n="tab_guest">' + (isTh ? 'ไอดีชั่วคราว (Guest)' : 'Guest Access') + '</span>' +
                    '</button>' +
                    '<button type="button" class="custom-admin-tab-btn" data-tab-id="sheets" data-i18n-title="tab_sheets" data-unified-tooltip="Google Sheets">' +
                        '<span>☁️</span><span data-i18n="tab_sheets">Google Sheets</span>' +
                    '</button>';

                subbar.querySelectorAll('.custom-admin-tab-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        activateCustomTab(btn.dataset.tabId);
                    });
                });
                persistentSubbar = subbar;
            }
            return persistentSubbar;
        }

        function attachAdminSettingsToReactDialog() {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return;

            const tabBar = dialog.querySelector('.flex.gap-1.overflow-x-auto') || dialog.querySelector('.overflow-x-auto');
            if (!tabBar) return;

            const panel = ensurePersistentPanel();
            const subbar = ensurePersistentSubbar();
            if (!tabBar || !panel || !subbar) return;

            // Always keep subbar mounted right after tabBar
            if (tabBar.nextElementSibling !== subbar) {
                tabBar.insertAdjacentElement('afterend', subbar);
            }
            subbar.style.display = 'flex';

            // Ensure embedded panel is directly after subbar inside dialog
            if (subbar.nextElementSibling !== panel) {
                subbar.insertAdjacentElement('afterend', panel);
            }

            // Sync visibility based on activeCustomTab
            const contentArea = dialog.querySelector('.settings-scroll');
            if (activeCustomTab) {
                if (contentArea) contentArea.style.display = 'none';
                panel.style.display = 'block';
            } else {
                if (contentArea) contentArea.style.display = '';
                panel.style.display = 'none';
            }

            // Listen for native React tab clicks to revert to standard settings
            if (!tabBar.dataset.customListenerAttached) {
                tabBar.dataset.customListenerAttached = 'true';
                tabBar.addEventListener('click', (e) => {
                    if (e.target.closest('.custom-admin-tab-btn')) return;
                    deactivateCustomTabs();
                });
            }

            if (window.translateVisibleUi) {
                window.translateVisibleUi();
            }
        }

        function activateCustomTab(tabId) {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return;

            const contentArea = dialog.querySelector('.settings-scroll');
            const panel = document.getElementById('admin-settings-embedded-panel');
            if (!panel) return;

            activeCustomTab = tabId;

            if (contentArea) contentArea.style.display = 'none';
            panel.style.display = 'block';

            // Reset native React tab highlights
            const nativeBtns = dialog.querySelectorAll('.flex.gap-1.overflow-x-auto > button');
            nativeBtns.forEach(b => {
                b.classList.remove('bg-background', 'text-foreground', 'shadow-sm');
                b.classList.add('text-muted-foreground');
            });

            // Update subbar tab button highlights
            const customBtns = dialog.querySelectorAll('.custom-admin-tab-btn');
            customBtns.forEach(b => {
                if (b.dataset.tabId === tabId) {
                    b.classList.add('active');
                } else {
                    b.classList.remove('active');
                }
            });

            // Switch visible pane
            document.querySelectorAll('.settings-tab-pane').forEach(p => {
                p.classList.remove('active');
                p.style.display = 'none';
            });
            const targetPane = document.getElementById('tab-pane-' + tabId);
            if (targetPane) {
                targetPane.classList.add('active');
                targetPane.style.display = 'block';
            }

            const alertBox = document.getElementById('pwd-alert-box');
            if (alertBox) { alertBox.className = 'pwd-alert'; alertBox.textContent = ''; }

            if (tabId === 'passwords') {
                fetchPasswords();
            } else if (tabId === 'guest') {
                fetchGuestPasswords();
            } else if (tabId === 'sheets' && isSheetsUnlocked) {
                fetchSheetsConfig();
            }
        }

        function deactivateCustomTabs() {
            activeCustomTab = null;
            const dialog = document.querySelector('[role="dialog"]');
            const panel = document.getElementById('admin-settings-embedded-panel');
            if (panel) panel.style.display = 'none';
            if (dialog) {
                const contentArea = dialog.querySelector('.settings-scroll');
                if (contentArea) contentArea.style.display = '';

                const customBtns = dialog.querySelectorAll('.custom-admin-tab-btn');
                customBtns.forEach(b => {
                    b.classList.remove('active');
                });
            }
        }

        function detachAdminSettings() {
            activeCustomTab = null;
            if (persistentPanel && persistentPanel.parentElement !== document.body) {
                persistentPanel.style.display = 'none';
                document.body.appendChild(persistentPanel);
            }
            if (persistentSubbar && persistentSubbar.parentElement !== document.body) {
                persistentSubbar.style.display = 'none';
                document.body.appendChild(persistentSubbar);
            }
        }

        function switchSettingTab(tabName) {
            activateCustomTab(tabName);
        }

        function openAdminPwdModal(initialTab = 'passwords') {
            const dialog = document.querySelector('[role="dialog"]');
            if (dialog) {
                attachAdminSettingsToReactDialog();
                activateCustomTab(initialTab);
            } else {
                const gearBtn = document.querySelector('button:has(svg.lucide-settings), button[title*="Settings"], button[aria-label*="Settings"]');
                if (gearBtn) {
                    gearBtn.click();
                    setTimeout(() => {
                        attachAdminSettingsToReactDialog();
                        activateCustomTab(initialTab);
                    }, 80);
                }
            }
        }

        function closeAdminPwdModal() {
            const dialog = document.querySelector('[role="dialog"]');
            if (dialog) {
                const closeBtn = dialog.querySelector('button:has(svg.lucide-x), button[aria-label*="Close"], button[title*="Close"]');
                if (closeBtn) closeBtn.click();
                else deactivateCustomTabs();
            }
        }

        function togglePwdVisibility(inputId, btn) {
            const el = document.getElementById(inputId);
            if (!el) return;
            if (el.type === 'password') {
                el.type = 'text';
                btn.textContent = '🔒';
            } else {
                el.type = 'password';
                btn.textContent = '👁️';
            }
        }

        function fetchPasswords() {
            fetch('/api/settings/passwords')
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        const adminInput = document.getElementById('modal-input-admin-pwd');
                        const memberInput = document.getElementById('modal-input-member-pwd');
                        if (adminInput && data.adminPassword) adminInput.value = data.adminPassword;
                        if (memberInput && data.memberPassword) memberInput.value = data.memberPassword;
                        const verifySec = document.getElementById('pwd-verify-admin-section');
                        if (verifySec) verifySec.style.display = 'none';
                        document.querySelectorAll('.settings-tab-pane').forEach(p => {
                            if (p.id === 'tab-pane-passwords' && p.classList.contains('active')) p.style.display = 'block';
                        });
                    }
                })
                .catch(e => console.log('Fetch passwords error:', e));
        }

        function isTh() {
            return (window.getLanguage ? window.getLanguage() === 'th' : localStorage.getItem('tracker_lang') === 'th');
        }

        function verifyAdminAndUnlock() {
            const input = document.getElementById('modal-input-verify-admin');
            const err = document.getElementById('pwd-verify-error');
            const val = input ? input.value.trim() : '';
            if (!val) {
                if (err) { err.textContent = isTh() ? '❌ กรุณากรอกรหัสผ่าน Admin' : '❌ Please enter Admin password'; err.style.display = 'block'; }
                return;
            }

            fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ name: 'admin', password: val })
            })
            .then(r => {
                if (r.ok || r.redirected || r.status === 200 || r.status === 302) {
                    if (err) err.style.display = 'none';
                    document.getElementById('pwd-verify-admin-section').style.display = 'none';
                    fetchPasswords();
                    setTimeout(() => { window.location.reload(); }, 1200);
                } else {
                    if (err) { err.textContent = isTh() ? '❌ รหัสผ่าน Admin ไม่ถูกต้อง' : '❌ Incorrect Admin password'; err.style.display = 'block'; }
                }
            })
            .catch(e => {
                if (err) { err.textContent = isTh() ? '❌ รหัสผ่าน Admin ไม่ถูกต้อง' : '❌ Incorrect Admin password'; err.style.display = 'block'; }
            });
        }

        function submitAdminPasswords() {
            const adminVal = document.getElementById('modal-input-admin-pwd').value.trim();
            const memberVal = document.getElementById('modal-input-member-pwd').value.trim();
            const alertBox = document.getElementById('pwd-alert-box');
            const saveBtn = document.getElementById('btn-modal-save-pwd');

            if (adminVal.length < 8 || memberVal.length < 8) {
                alertBox.className = 'pwd-alert error';
                alertBox.textContent = isTh() ? '❌ รหัสผ่านทั้งสองต้องมีความยาวอย่างน้อย 8 ตัวอักษร' : '❌ Both passwords must be at least 8 characters long';
                return;
            }

            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span>⏳ ' + (isTh() ? 'กำลังบันทึก...' : 'Saving...') + '</span>';

            fetch('/api/settings/passwords', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminPassword: adminVal, memberPassword: memberVal })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alertBox.className = 'pwd-alert success';
                    alertBox.textContent = '✅ ' + (isTh() ? (data.message || 'บันทึกรหัสผ่านใหม่เรียบร้อยแล้ว!') : 'New passwords saved successfully!');
                    setTimeout(() => { closeAdminPwdModal(); }, 1200);
                } else {
                    alertBox.className = 'pwd-alert error';
                    alertBox.textContent = '❌ ' + (isTh() ? (data.message || 'เกิดข้อผิดพลาดในการบันทึก') : (data.message || 'Error saving passwords'));
                }
            })
            .catch(err => {
                alertBox.className = 'pwd-alert error';
                alertBox.textContent = '❌ ' + (isTh() ? 'การเชื่อมต่อล้มเหลว: ' : 'Connection failed: ') + err.message;
            })
            .finally(() => {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<span>💾 ' + (isTh() ? 'บันทึกรหัสผ่าน' : 'Save Passwords') + '</span>';
            });
        }

        /* --- GUEST ACCESS FUNCTIONS --- */
        function generateRandomGuestPassword() {
            const chars = '23456789abcdefghjkmnpqrstuvwxyz';
            let pwd = 'g-';
            for (let i = 0; i < 6; i++) {
                pwd += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            const inp = document.getElementById('guest-input-pwd');
            if (inp) inp.value = pwd;
        }

        function fetchGuestPasswords() {
            const tbody = document.getElementById('guest-table-body');
            if (!tbody) return;
            fetch('/api/settings/guest-passwords')
                .then(r => r.json())
                .then(data => {
                    if (!data.success || !data.passwords || data.passwords.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:16px; color:#71717a;">' + (isTh() ? 'ยังไม่มีรหัสผ่านชั่วคราว กดสร้างด้านบนได้เลย' : 'No temporary passwords yet. Create one above.') + '</td></tr>';
                        return;
                    }
                    tbody.innerHTML = data.passwords.map(p => {
                        const isExp = p.isExpired;
                        const expDate = new Date(p.expiresAt);
                        const expStr = expDate.toLocaleDateString(isTh() ? 'th-TH' : 'en-US') + ' ' + expDate.toLocaleTimeString(isTh() ? 'th-TH' : 'en-US', { hour: '2-digit', minute: '2-digit' });
                        const badge = isExp
                            ? '<span class="guest-status-badge expired">🔴 ' + (isTh() ? 'หมดอายุ' : 'Expired') + '</span>'
                            : '<span class="guest-status-badge active">🟢 ' + (isTh() ? 'ใช้ได้ (' : 'Active (') + (p.remainingMinutes > 60 ? Math.floor(p.remainingMinutes/60) + (isTh() ? ' ชม.' : 'h') : p.remainingMinutes + (isTh() ? ' นาที' : 'm')) + ')</span>';
                        return '<tr>' +
                            '<td><b>' + (p.label || 'Guest') + '</b><br><span style="font-size:9.5px; color:#71717a;">' + (isTh() ? 'ใช้แล้ว ' + (p.usedCount || 0) + ' ครั้ง' : 'Used ' + (p.usedCount || 0) + ' times') + '</span></td>' +
                            '<td><code style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; color:#fbbf24;">' + p.password + '</code> ' +
                            '<button type="button" class="pwd-btn-secondary" style="padding:2px 5px; font-size:9px;" onclick="copyGuestPassword(\\'' + p.password + '\\', this)">📋</button></td>' +
                            '<td style="font-size:10px;">' + expStr + '</td>' +
                            '<td>' + badge + '</td>' +
                            '<td style="text-align:right;"><button type="button" class="pwd-btn-secondary" style="padding:2px 6px; color:#f87171; border-color:rgba(239,68,68,0.4);" onclick="deleteGuestPassword(\\'' + p.id + '\\')">🗑️</button></td>' +
                            '</tr>';
                    }).join('');
                })
                .catch(err => {
                    tbody.innerHTML = '<tr><td colspan="5" style="color:#f87171; text-align:center;">' + (isTh() ? 'โหลดข้อมูลไม่สำเร็จ: ' : 'Failed to load: ') + err.message + '</td></tr>';
                });
        }

        function createGuestPassword() {
            const label = document.getElementById('guest-input-label').value.trim();
            const password = document.getElementById('guest-input-pwd').value.trim();
            const duration = document.getElementById('guest-input-duration').value;
            const alertBox = document.getElementById('pwd-alert-box');

            fetch('/api/settings/guest-passwords', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, password, durationHours: Number(duration) })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alertBox.className = 'pwd-alert success';
                    alertBox.textContent = '✅ ' + (isTh() ? 'สร้างรหัสผ่านชั่วคราวสำเร็จ: ' : 'Temporary password created: ') + data.password.password;
                    document.getElementById('guest-input-label').value = '';
                    document.getElementById('guest-input-pwd').value = '';
                    fetchGuestPasswords();
                } else {
                    alertBox.className = 'pwd-alert error';
                    alertBox.textContent = '❌ ' + (isTh() ? (data.message || 'สร้างรหัสไม่สำเร็จ') : (data.message || 'Failed to create password'));
                }
            })
            .catch(err => {
                alertBox.className = 'pwd-alert error';
                alertBox.textContent = '❌ ' + (isTh() ? 'การเชื่อมต่อล้มเหลว: ' : 'Connection failed: ') + err.message;
            });
        }

        function deleteGuestPassword(id) {
            if (!confirm(isTh() ? 'ต้องการลบรหัสผ่านชั่วคราวนี้หรือไม่? สมาชิกที่ใช้รหัสนี้อยู่จะไม่สามารถเข้าใช้งานต่อได้' : 'Delete this temporary password? Members using this password will lose access.')) return;
            fetch('/api/settings/guest-passwords/' + encodeURIComponent(id), { method: 'DELETE' })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        fetchGuestPasswords();
                    } else {
                        alert(isTh() ? (data.message || 'ลบไม่สำเร็จ') : (data.message || 'Failed to delete'));
                    }
                });
        }

        function copyGuestPassword(text, btn) {
            navigator.clipboard.writeText(text).then(() => {
                const orig = btn.textContent;
                btn.textContent = '✅';
                setTimeout(() => { btn.textContent = orig; }, 1200);
            });
        }

        /* --- GOOGLE SHEETS FUNCTIONS (PROTECTED) --- */
        function verifySheetsPin() {
            const input = document.getElementById('input-sheets-pin');
            const err = document.getElementById('sheets-pin-error');
            const btn = document.getElementById('btn-verify-sheets-pin');
            const val = input ? input.value.trim() : '';

            if (!val) {
                if (err) { err.textContent = isTh() ? '❌ กรุณากรอกรหัสผ่าน' : '❌ Please enter password'; err.style.display = 'block'; }
                return;
            }

            if (btn) { btn.disabled = true; btn.textContent = isTh() ? '⏳ กำลังตรวจ...' : '⏳ Verifying...'; }

            fetch('/api/settings/google-sheets/verify-pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: val })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    if (err) err.style.display = 'none';
                    currentSheetsPin = val;
                    isSheetsUnlocked = true;
                    document.getElementById('sheets-locked-view').style.display = 'none';
                    document.getElementById('sheets-unlocked-view').style.display = 'block';
                    fetchSheetsConfig();
                } else {
                    if (err) { err.textContent = '❌ ' + (isTh() ? (data.message || 'รหัสผ่านไม่ถูกต้อง') : 'Incorrect password'); err.style.display = 'block'; }
                }
            })
            .catch(e => {
                if (err) { err.textContent = isTh() ? '❌ รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' : '❌ Incorrect password, please try again'; err.style.display = 'block'; }
            })
            .finally(() => {
                if (btn) { btn.disabled = false; btn.textContent = isTh() ? '🔓 ปลดล็อก' : '🔓 Unlock'; }
            });
        }

        function lockSheetsView() {
            isSheetsUnlocked = false;
            currentSheetsPin = '';
            document.getElementById('sheets-locked-view').style.display = 'block';
            document.getElementById('sheets-unlocked-view').style.display = 'none';
            const input = document.getElementById('input-sheets-pin');
            if (input) input.value = '';
        }

        function fetchSheetsConfig() {
            fetch('/api/settings/google-sheets')
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        const urlInp = document.getElementById('sheets-input-url');
                        const tokenInp = document.getElementById('sheets-input-token');
                        const enToggle = document.getElementById('sheets-toggle-enabled');
                        const foToggle = document.getElementById('sheets-toggle-failover');
                        const statusLabel = document.getElementById('sheets-live-status');

                        if (urlInp && data.fullUrl) urlInp.value = data.fullUrl;
                        if (enToggle) enToggle.checked = Boolean(data.enabled);
                        if (foToggle) foToggle.checked = Boolean(data.autoFailover);

                        const lastSyncStr = data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleTimeString(isTh() ? 'th-TH' : 'en-US') : (isTh() ? 'ยังไม่เคยซิงค์' : 'Never synced');
                        if (statusLabel) {
                            if (isTh()) {
                                statusLabel.textContent = 'สถานะ: ' + (data.state === 'synced' ? '🟢 เชื่อมต่อแล้ว (ซิงค์: ' + lastSyncStr + ')' : data.state === 'error' ? '🔴 ผิดพลาด' : '⚪ รอซิงค์');
                            } else {
                                statusLabel.textContent = 'Status: ' + (data.state === 'synced' ? '🟢 Connected (Synced: ' + lastSyncStr + ')' : data.state === 'error' ? '🔴 Error' : '⚪ Pending Sync');
                            }
                        }
                    }
                })
                .catch(e => console.log('Fetch sheets config error:', e));
        }

        function saveSheetsConfig() {
            const webAppUrl = document.getElementById('sheets-input-url').value.trim();
            const secretToken = document.getElementById('sheets-input-token').value.trim();
            const enabled = document.getElementById('sheets-toggle-enabled').checked;
            const autoFailover = document.getElementById('sheets-toggle-failover').checked;
            const alertBox = document.getElementById('pwd-alert-box');
            const saveBtn = document.getElementById('btn-save-sheets');

            saveBtn.disabled = true;
            saveBtn.textContent = isTh() ? '⏳ กำลังบันทึก...' : '⏳ Saving...';

            fetch('/api/settings/google-sheets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pin: currentSheetsPin,
                    webAppUrl,
                    secretToken,
                    enabled,
                    autoFailover
                })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alertBox.className = 'pwd-alert success';
                    alertBox.textContent = '✅ ' + (isTh() ? data.message : 'Settings saved successfully');
                    fetchSheetsConfig();
                } else {
                    alertBox.className = 'pwd-alert error';
                    alertBox.textContent = '❌ ' + (isTh() ? (data.message || 'บันทึกไม่สำเร็จ') : (data.message || 'Failed to save settings'));
                }
            })
            .catch(e => {
                alertBox.className = 'pwd-alert error';
                alertBox.textContent = '❌ ' + (isTh() ? 'ข้อผิดพลาด: ' : 'Error: ') + e.message;
            })
            .finally(() => {
                saveBtn.disabled = false;
                saveBtn.textContent = isTh() ? '💾 บันทึกการตั้งค่า' : '💾 Save Settings';
            });
        }

        function testSheetsConnection() {
            const webAppUrl = document.getElementById('sheets-input-url').value.trim();
            const secretToken = document.getElementById('sheets-input-token').value.trim();
            const alertBox = document.getElementById('pwd-alert-box');
            const btn = document.getElementById('btn-test-sheets');

            btn.disabled = true;
            btn.textContent = isTh() ? '⏳ กำลังทดสอบ...' : '⏳ Testing...';

            fetch('/api/settings/google-sheets/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: currentSheetsPin, webAppUrl, secretToken })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alertBox.className = 'pwd-alert success';
                    alertBox.textContent = '✅ ' + (isTh() ? data.message : 'Connection successful!');
                } else {
                    alertBox.className = 'pwd-alert error';
                    alertBox.textContent = '❌ ' + (isTh() ? (data.message || 'ทดสอบล้มเหลว') : (data.message || 'Test failed'));
                }
            })
            .catch(e => {
                alertBox.className = 'pwd-alert error';
                alertBox.textContent = '❌ ' + (isTh() ? 'เกิดข้อผิดพลาด: ' : 'Error: ') + e.message;
            })
            .finally(() => {
                btn.disabled = false;
                btn.textContent = isTh() ? '⚡ ทดสอบการเชื่อมต่อ' : '⚡ Test Connection';
            });
        }

        function syncSheetsNow() {
            const alertBox = document.getElementById('pwd-alert-box');
            const btn = document.getElementById('btn-sync-sheets');

            btn.disabled = true;
            btn.textContent = isTh() ? '⏳ กำลังซิงค์...' : '⏳ Syncing...';

            fetch('/api/settings/google-sheets/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: currentSheetsPin })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alertBox.className = 'pwd-alert success';
                    alertBox.textContent = '✅ ' + (isTh() ? data.message : 'Sync completed successfully!');
                    fetchSheetsConfig();
                } else {
                    alertBox.className = 'pwd-alert error';
                    alertBox.textContent = '❌ ' + (isTh() ? (data.message || 'ซิงค์ไม่สำเร็จ') : (data.message || 'Sync failed'));
                }
            })
            .catch(e => {
                alertBox.className = 'pwd-alert error';
                alertBox.textContent = '❌ ' + (isTh() ? 'เกิดข้อผิดพลาด: ' : 'Error: ') + e.message;
            })
            .finally(() => {
                btn.disabled = false;
                btn.textContent = isTh() ? '🔄 ซิงค์ข้อมูลทั้งหมดเดี๋ยวนี้' : '🔄 Sync All Now';
            });
        }

        // Global functions on window
        window.openAdminPwdModal = openAdminPwdModal;
        window.closeAdminPwdModal = closeAdminPwdModal;
        window.switchSettingTab = switchSettingTab;
        window.attachAdminSettingsToReactDialog = attachAdminSettingsToReactDialog;
        window.activateCustomTab = activateCustomTab;
        window.deactivateCustomTabs = deactivateCustomTabs;
        window.detachAdminSettings = detachAdminSettings;
        window.togglePwdVisibility = togglePwdVisibility;
        window.verifyAdminAndUnlock = verifyAdminAndUnlock;
        window.submitAdminPasswords = submitAdminPasswords;
        window.generateRandomGuestPassword = generateRandomGuestPassword;
        window.createGuestPassword = createGuestPassword;
        window.deleteGuestPassword = deleteGuestPassword;
        window.copyGuestPassword = copyGuestPassword;
        window.verifySheetsPin = verifySheetsPin;
        window.lockSheetsView = lockSheetsView;
        window.saveSheetsConfig = saveSheetsConfig;
        window.testSheetsConnection = testSheetsConnection;
        window.syncSheetsNow = syncSheetsNow;

        // Observer to detect when the React Settings Dialog mounts or unmounts
        const dialogObserver = new MutationObserver((mutations) => {
            const dialog = document.querySelector('[role="dialog"]');
            if (dialog) {
                attachAdminSettingsToReactDialog();
            } else {
                for (const m of mutations) {
                    for (const node of m.removedNodes) {
                        if (node && node.nodeType === 1) {
                            const foundPanel = node.querySelector?.('#admin-settings-embedded-panel') || (node.id === 'admin-settings-embedded-panel' ? node : null);
                            const foundSubbar = node.querySelector?.('#custom-admin-tabs-subbar') || (node.id === 'custom-admin-tabs-subbar' ? node : null);
                            if (foundPanel && foundPanel.parentElement !== document.body) {
                                foundPanel.style.display = 'none';
                                document.body.appendChild(foundPanel);
                                persistentPanel = foundPanel;
                            }
                            if (foundSubbar && foundSubbar.parentElement !== document.body) {
                                foundSubbar.style.display = 'none';
                                document.body.appendChild(foundSubbar);
                                persistentSubbar = foundSubbar;
                            }
                        }
                    }
                }
                detachAdminSettings();
            }
        });
        dialogObserver.observe(document.body, { childList: true, subtree: true });

        // Cache template and elements on load
        ensurePersistentPanel();
        ensurePersistentSubbar();

        // Auto-open if query param or path present
        function checkAutoOpen() {
            if (window.location.search.includes('pwd=') || window.location.search.includes('openPwdModal=1') || window.location.hash.includes('pwd') || window.location.pathname === '/admin') {
                setTimeout(openAdminPwdModal, 350);
            }
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', checkAutoOpen);
        } else {
            checkAutoOpen();
        }
    </script>
    ` : '';
    return `<!DOCTYPE html>
<html lang="en" class="">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script>
            (function() {
                const appearance = 'system';
                if (appearance === 'system') {
                    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                    if (prefersDark) {
                        document.documentElement.classList.add('dark');
                    }
                }
                // Immediate restoration of user-configured Panel width (webMaxWidthRem)
                function applyPanelWidth(val) {
                    if (val !== null && val !== undefined) {
                        const num = Number(val);
                        if (Number.isFinite(num)) {
                            document.documentElement.style.setProperty('--dashboard-web-max-width', num === 0 ? '100%' : num + 'rem');
                        }
                    }
                }
                try {
                    applyPanelWidth(localStorage.getItem('dashboard.webMaxWidthRem'));
                } catch (e) {}

                // Intercept localStorage.setItem to immediately update layout width in real-time
                try {
                    const origSetItem = localStorage.setItem.bind(localStorage);
                    localStorage.setItem = function(key, value) {
                        origSetItem(key, value);
                        if (key === 'dashboard.webMaxWidthRem') {
                            applyPanelWidth(value);
                        }
                    };
                    window.addEventListener('storage', function(e) {
                        if (e.key === 'dashboard.webMaxWidthRem') {
                            applyPanelWidth(e.newValue);
                        }
                    });
                } catch (e) {}
            })();
        </script>
        <style>
            :root {
                --dashboard-web-max-width: 36rem;
            }
            html, body, #app {
                margin: 0;
                padding: 0;
                height: 100%;
                overflow: hidden;
            }
            /* Ensure web dashboard centers and dynamically respects user-configured Panel width */
            html:not(.page-analytics):not(.page-login):not(.page-download) .browser-shell {
                display: flex !important;
                justify-content: center !important;
                width: 100% !important;
                height: 100% !important;
            }
            html:not(.page-analytics):not(.page-login):not(.page-download) .browser-shell > * {
                max-width: var(--dashboard-web-max-width, 36rem) !important;
                width: 100% !important;
                height: 100% !important;
                margin-left: auto !important;
                margin-right: auto !important;
                border-inline-style: var(--tw-border-style, solid) !important;
                border-inline-width: 1px !important;
            }
        </style>
        <title inertia>${title} (${APP_VERSION})</title>
        <meta name="theme-color" content="#000000">
        <meta name="mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
        <meta name="apple-mobile-web-app-title" content="BossTracker">
        <link rel="apple-touch-icon" href="/favicon.png">
        <link rel="icon" href="/favicon.png" sizes="any" type="image/png">
        <link rel="preconnect" href="https://fonts.bunny.net">
        <link href="https://fonts.bunny.net/css?family=instrument-sans:400,500,600" rel="stylesheet" />
        <link rel="preload" as="style" href="/build/assets/app-DIKwFrKw.css?v=${APP_VERSION}" />
        <link rel="modulepreload" as="script" href="/build/assets/app-CTdHufbH.js" />
        <link rel="stylesheet" href="/build/assets/app-DIKwFrKw.css?v=${APP_VERSION}" />
        <script src="/js/realtime-alerts.js?v=${APP_VERSION}"></script>
        <script type="module" src="/build/assets/app-CTdHufbH.js?v=${APP_VERSION}"></script>
    </head>
    <body class="font-sans antialiased">
        <div class="browser-shell">
            <div id="app" data-page="${jsonStr}"></div>
        </div>
        ${adminPasswordSnippet}
        <!-- App Top Status Bar: Firebase & Version -->
        <style>
            div[role="dialog"] {
                max-width: 520px !important;
                width: min(520px, calc(100vw - 24px)) !important;
            }
            #top-floating-status-bar {
                position: fixed;
                top: -9999px;
                left: -9999px;
                z-index: 999999;
                display: flex;
                align-items: center;
                gap: 6px;
                pointer-events: auto;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                transition: transform 0.2s ease;
            }
            .app-version-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2.5px 8px;
                background: rgba(0, 0, 0, 0.65);
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 6px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 10px;
                font-weight: 600;
                color: rgba(255, 255, 255, 0.75);
                letter-spacing: 0.04em;
                user-select: none;
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                transition: all 0.2s ease;
            }
            .app-version-badge:hover {
                color: #38bdf8;
                border-color: rgba(56, 189, 248, 0.5);
                background: rgba(56, 189, 248, 0.15);
            }
            .firebase-mini-badge {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 2.5px 9px;
                background: rgba(0, 0, 0, 0.65);
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 9999px;
                font-family: inherit;
                font-size: 10px;
                font-weight: 600;
                color: rgba(255, 255, 255, 0.85);
                cursor: pointer;
                user-select: none;
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                transition: all 0.2s ease;
            }
            .firebase-mini-badge:hover {
                color: #fff;
                border-color: rgba(16, 185, 129, 0.6);
                background: rgba(16, 185, 129, 0.2);
            }
            .firebase-mini-badge[data-status="google_sheets"] {
                color: #34d399 !important;
                border-color: rgba(52, 211, 153, 0.45) !important;
            }
            .firebase-mini-badge[data-status="local"] {
                color: #fbbf24 !important;
                border-color: rgba(251, 191, 36, 0.45) !important;
            }
        </style>
        <div id="top-floating-status-bar">
            <span id="header-firebase-status-badge" class="firebase-mini-badge" title="Connecting…" aria-label="Connecting…">
                <span aria-hidden="true">☁️</span><span class="system-badge-label">Connecting…</span>
            </span>
            <span id="header-version-control" class="app-version-badge" title="Version ${APP_VERSION}" aria-label="Version ${APP_VERSION}">
                <span aria-hidden="true">ⓥ</span><span class="system-badge-label">${APP_VERSION}</span>
            </span>
        </div>
        <script>
            (function setupFirebaseBadge() {
                let consecutiveFailures = 0;
                let lastKnownStatus = null;
                function isLangTh() {
                    return (window.getLanguage ? window.getLanguage() === 'th' : localStorage.getItem('tracker_lang') === 'th');
                }
                function getStatusCopy(st) {
                    const isTh = isLangTh();
                    const active = st?.activeSource || (st?.connected ? 'firebase' : 'local');

                    if (active === 'google-sheets') {
                        return {
                            label: 'Google Sheets',
                            tooltip: isTh ? 'ดึงข้อมูลจาก Google Sheets (สายสำรองทำงาน)' : 'Data Source: Google Sheets (Failover Active)',
                            icon: '📊',
                            statusKey: 'google_sheets'
                        };
                    }

                    if (active === 'local') {
                        return {
                            label: 'Local Mode',
                            tooltip: isTh ? 'ทำงานแบบออฟไลน์ (Local Fallback)' : 'Local Mode (Offline Fallback)',
                            icon: '💾',
                            statusKey: 'local'
                        };
                    }

                    const reported = st?.status || (st?.connected ? 'connected' : 'offline');
                    let displaySt = reported;
                    if (reported === 'connected') {
                        consecutiveFailures = 0;
                        displaySt = 'connected';
                    } else if (['connecting', 'stale', 'quota_exceeded', 'configuration_error'].includes(reported)) {
                        if (reported !== 'stale') consecutiveFailures = 0;
                        displaySt = reported;
                    } else {
                        consecutiveFailures += 1;
                        displaySt = consecutiveFailures >= 3 ? 'offline' : 'connecting';
                    }

                    const statusCopy = {
                        connected: ['Firebase Live', isTh ? 'เชื่อมต่อ Firebase แล้ว (Cloud หลัก)' : 'Firebase Connected (Primary Cloud)', '☁️'],
                        connecting: ['Firebase Connecting', isTh ? 'กำลังเชื่อมต่อ Firebase…' : 'Firebase Connecting…', '☁️'],
                        stale: ['Firebase Stale', isTh ? 'ใช้ข้อมูลล่าสุดที่ซิงค์ไว้' : 'Firebase Stale — Using cached data', '☁️'],
                        quota_exceeded: ['Firebase Limit', isTh ? 'Firebase เกินโควตา' : 'Firebase Quota Exceeded', '⚠️'],
                        configuration_error: ['Firebase Config', isTh ? 'การตั้งค่า Firebase ผิดพลาด' : 'Firebase Configuration Error', '⚠️'],
                        offline: ['Firebase Offline', isTh ? 'Firebase ออฟไลน์' : 'Firebase Offline', '☁️']
                    };
                    const entry = statusCopy[displaySt] || statusCopy.connecting;
                    return {
                        label: entry[0],
                        tooltip: entry[1],
                        icon: entry[2],
                        statusKey: displaySt
                    };
                }
                function renderFbBadge(fbBadge, st) {
                    const copy = getStatusCopy(st);
                    fbBadge.innerHTML = '<span aria-hidden="true">' + copy.icon + '</span><span class="system-badge-label">' + copy.label + '</span>';
                    fbBadge.setAttribute('data-unified-tooltip', copy.tooltip);
                    fbBadge.setAttribute('aria-label', copy.tooltip);
                    fbBadge.title = copy.tooltip;
                    fbBadge.dataset.status = copy.statusKey;
                }
                function updateFbBadge() {
                    const fbBadge = document.getElementById('header-firebase-status-badge');
                    if (!fbBadge) return;
                    if (lastKnownStatus) renderFbBadge(fbBadge, lastKnownStatus);
                    fetch('/api/firebase-status')
                        .then(r => r.ok ? r.json() : Promise.reject(new Error('Status request failed')))
                        .then(st => {
                            lastKnownStatus = st;
                            renderFbBadge(fbBadge, st);
                        })
                        .catch(() => renderFbBadge(fbBadge, { status: 'offline', activeSource: 'local' }));
                }
                window.updateFbBadge = updateFbBadge;
                const fbBadge = document.getElementById('header-firebase-status-badge');
                if (fbBadge) {
                    fbBadge.onclick = function() {
                        const isTh = isLangTh();
                        fetch('/api/firebase-status')
                            .then(r => r.json())
                            .then(st => {
                                lastKnownStatus = st;
                                renderFbBadge(fbBadge, st);
                                const active = st.activeSource || (st.connected ? 'firebase' : 'local');
                                const fbLastSync = st.lastCloudSyncAt ? new Date(st.lastCloudSyncAt).toLocaleString(isTh ? 'th-TH' : 'en-US') : (isTh ? 'ยังไม่มีข้อมูล' : 'None');
                                const gs = st.googleSheets || {};
                                const gsLastSync = gs.lastSyncAt ? new Date(gs.lastSyncAt).toLocaleString(isTh ? 'th-TH' : 'en-US') : (isTh ? 'ยังไม่มีข้อมูล' : 'None');

                                let lines = [];
                                if (isTh) {
                                    lines.push('📡 แหล่งข้อมูลปัจจุบัน (Active Data Source):');
                                    if (active === 'google-sheets') {
                                        lines.push('  ▶ 📊 Google Sheets (สายสำรองทำงาน - Failover Active)');
                                        lines.push('  (ตรวจพบปัญหาที่ Firebase จึงสลับมารับข้อมูลจาก Google Sheets อัตโนมัติ)');
                                    } else if (active === 'firebase') {
                                        lines.push('  ▶ ☁️ Firebase Realtime Database (Cloud หลัก)');
                                    } else {
                                        lines.push('  ▶ 💾 Local Mode (โหมดออฟไลน์)');
                                    }
                                    lines.push('');
                                    lines.push('☁️ สถานะ Firebase:');
                                    lines.push('  • การเชื่อมต่อ: ' + (st.connected ? 'เชื่อมต่อแล้ว (Connected)' : st.status === 'quota_exceeded' ? 'เกินโควตา (Quota Exceeded)' : 'ออฟไลน์ / ไม่ได้เชื่อมต่อ'));
                                    lines.push('  • Project ID: ' + (st.projectId || '-'));
                                    lines.push('  • ข้อมูล Cloud พร้อม: ' + (st.cloudDataReady ? 'ใช่' : 'ไม่ใช่'));
                                    lines.push('  • ซิงค์ล่าสุด: ' + fbLastSync);
                                    lines.push('  • จำนวนบอสใน Cloud: ' + (st.totalBosses || 0));
                                    lines.push('');
                                    lines.push('📊 สถานะ Google Sheets (สายสำรองคู่ขนาน):');
                                    lines.push('  • การตั้งค่า: ' + (gs.configured ? 'กำหนดค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'));
                                    lines.push('  • การทำงานคู่ขนาน: ' + (gs.enabled ? 'เปิดใช้งาน (Mirror Active)' : 'ปิด'));
                                    lines.push('  • สลับอัตโนมัติ (Auto-Failover): ' + (gs.autoFailover ? 'เปิด (สลับทันทีเมื่อ Firebase ล่ม)' : 'ปิด'));
                                    lines.push('  • สถานะล่าสุด: ' + (gs.state === 'synced' ? 'ซิงค์สำเร็จ' : gs.state === 'error' ? 'พบข้อผิดพลาด' : (gs.state || '-')));
                                    lines.push('  • ซิงค์ล่าสุด: ' + gsLastSync);
                                    lines.push('  • บันทึกสะสม: ' + (gs.totalMutationsMirrored || 0) + ' ครั้ง');
                                } else {
                                    lines.push('📡 Active Data Source:');
                                    if (active === 'google-sheets') {
                                        lines.push('  ▶ 📊 Google Sheets (Failover Active)');
                                        lines.push('  (Firebase is unavailable; automatically switched to Google Sheets backup)');
                                    } else if (active === 'firebase') {
                                        lines.push('  ▶ ☁️ Firebase Realtime Database (Primary Cloud)');
                                    } else {
                                        lines.push('  ▶ 💾 Local Mode (Offline Fallback)');
                                    }
                                    lines.push('');
                                    lines.push('☁️ Firebase Status:');
                                    lines.push('  • Connection: ' + (st.connected ? 'Connected' : st.status === 'quota_exceeded' ? 'Quota Exceeded' : 'Offline / Disconnected'));
                                    lines.push('  • Project ID: ' + (st.projectId || '-'));
                                    lines.push('  • Cloud Data Ready: ' + (st.cloudDataReady ? 'Yes' : 'No'));
                                    lines.push('  • Last Cloud Sync: ' + fbLastSync);
                                    lines.push('  • Total Bosses in Cloud: ' + (st.totalBosses || 0));
                                    lines.push('');
                                    lines.push('📊 Google Sheets Status (Parallel Backup):');
                                    lines.push('  • Configured: ' + (gs.configured ? 'Configured' : 'Not configured'));
                                    lines.push('  • Parallel Mirror: ' + (gs.enabled ? 'Active' : 'Disabled'));
                                    lines.push('  • Auto-Failover: ' + (gs.autoFailover ? 'Enabled (Auto-fallback on Firebase failure)' : 'Disabled'));
                                    lines.push('  • Last State: ' + (gs.state || '-'));
                                    lines.push('  • Last Sync: ' + gsLastSync);
                                    lines.push('  • Mirrored Mutations: ' + (gs.totalMutationsMirrored || 0));
                                }
                                alert(lines.join('\\n'));
                            }).catch(err => alert(isTh ? ('เกิดข้อผิดพลาดในการตรวจสอบสถานะ Firebase\\n' + err.message) : ('Firebase Status Error\\n' + err.message)));
                    };
                }
                updateFbBadge();
                setInterval(updateFbBadge, 10000);
            })();
        </script>
    </body>
</html>`;
}

// Helper: Response dispatcher (Inertia JSON vs Full HTML)
function sendInertia(req, res, component, props, url) {
    const targetUrl = url || req.originalUrl || req.url;
    const pageData = {
        component,
        props,
        url: targetUrl,
        version: INERTIA_VERSION,
        clearHistory: false,
        encryptHistory: false
    };

    const isInertia = Boolean(
        req.headers['x-inertia'] ||
        req.headers['x-requested-with'] === 'XMLHttpRequest' ||
        (req.headers.accept && req.headers.accept.includes('application/json'))
    );

    if (isInertia) {
        res.setHeader('X-Inertia', 'true');
        res.setHeader('Vary', 'Accept-Encoding, X-Inertia');
        return res.json(pageData);
    }

    const html = renderHtml(pageData, props.name || '#Kain7');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
}

// Helper: For non-GET mutations, return updated Inertia JSON directly to update client state immediately
function respondInertiaOrRedirect(req, res, targetUrl = '/') {
    const isInertia = Boolean(
        req.headers['x-inertia'] ||
        req.headers['x-requested-with'] === 'XMLHttpRequest' ||
        (req.headers.accept && req.headers.accept.includes('application/json'))
    );

    if (isInertia) {
        return sendInertia(req, res, 'dashboard', getDashboardProps(req), targetUrl);
    }
    res.setHeader('X-Inertia', 'true');
    res.redirect(303, targetUrl);
}

function isAuthenticated(req) {
    return Boolean(getSessionRole(req));
}

function getSessionRole(req) {
    const sess = req.cookies['boss_session'] || req.cookies['remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d'] || '';
    return readSession(sess)?.role || null;
}

function requireSession(req, res, next) {
    const role = getSessionRole(req);
    if (role) {
        req.user = { role };
        return next();
    }
    const requestPath = req.originalUrl || req.url || req.path || '';
    const json = requestPath.startsWith('/api/') || ['/poll', '/live-event'].includes(req.path) ||
        req.headers['x-requested-with'] === 'XMLHttpRequest' || String(req.headers.accept || '').includes('application/json');
    if (json) return res.status(401).json({ success: false, message: 'Authentication required', loginUrl: '/login' });
    return res.redirect(303, '/login');
}

function requireAdmin(req, res, next) {
    if (getSessionRole(req) === 'admin') return next();
    return res.status(403).json({ success: false, message: 'Admin access required' });
}

function requireSameOrigin(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    try {
        if (new URL(origin).host === req.headers.host) return next();
    } catch (_) {}
    return res.status(403).json({ success: false, message: 'Invalid request origin' });
}

// Helper: Build Dashboard Props
function getDashboardProps(req) {
    const settings = db.getSettings();
    const role = getSessionRole(req);
    const isAdmin = role === 'admin';
    const isGuest = role === 'guest';

    return {
        errors: {},
        name: settings.serverName || '#Kain7',
        auth: {
            user: {
                id: isAdmin ? 1 : isGuest ? 3 : 2,
                name: isAdmin ? 'admin' : isGuest ? 'guest' : 'kain7',
                email: isAdmin ? 'admin@boss.local' : isGuest ? 'guest@boss.local' : 'member@boss.local',
                email_verified_at: '2026-03-11T22:46:43.000000Z',
                role: role,
                two_factor_secret: null,
                two_factor_recovery_codes: null,
                two_factor_confirmed_at: null,
                created_at: '2026-03-11T22:46:43.000000Z',
                updated_at: '2026-03-11T22:46:43.000000Z'
            }
        },
        sidebarOpen: true,
        bosses: db.getBosses(),
        events: db.getEvents(),
        allEvents: db.getAllEvents(),
        hideInvasionBosses: Boolean(settings.hideInvasionBosses),
        invasionLabel: settings.invasionLabel || 'L3',
        invasionColor: settings.invasionColor || '#facc15',
        announcement: settings.announcement || null,
        resetTimeConfigs: db.getResetConfigs(),
        savedMaintenanceEndTime: db.getSavedMaintenanceEndTime() || null,
        dataRevision: db.getDataRevision()
    };
}

// ==========================================================
// INERTIA PAGE ROUTES
// ==========================================================

// GET / or /dashboard -> Dashboard (login required)
app.all(['/', '/dashboard'], async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(405).end();
    }
    if (!isAuthenticated(req)) {
        return res.redirect(303, '/login');
    }
    const cloudReady = !process.env.VERCEL || await db.ensureCloudDataReady();
    if (!cloudReady) {
        res.set('Retry-After', '2');
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(503).send(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="2"><title>Loading Boss Tracker</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#fff;font-family:system-ui}.box{text-align:center}.spin{margin:0 auto 16px;width:32px;height:32px;border:3px solid #3f3f46;border-top-color:#f59e0b;border-radius:50%;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}p{color:#a1a1aa}</style></head><body><main class="box"><div class="spin"></div><strong>Loading latest boss data</strong><p>กำลังโหลดข้อมูลบอสล่าสุด ระบบจะลองใหม่อัตโนมัติ</p></main></body></html>`);
    }
    await db.expireBossAlerts();
    await db.autoAdvanceOverdueBosses();
    sendInertia(req, res, 'dashboard', getDashboardProps(req), '/');
});

// Direct URL shortcuts to password management
app.all(['/admin', '/passwords', '/password'], (req, res) => {
    if (!isAuthenticated(req)) {
        return res.redirect('/login?pwd=1');
    }
    return res.redirect('/?pwd=1');
});

// GET /login -> Login Form (Redirects to dashboard if already authenticated)
app.get('/login', (req, res) => {
    if (isAuthenticated(req)) {
        return res.redirect('/');
    }
    const settings = db.getSettings();
    sendInertia(req, res, 'auth/login', {
        errors: {},
        name: settings.serverName || '#Kain7',
        auth: { user: null },
        sidebarOpen: true,
        status: null
    }, '/login');
});

// POST /login -> Authenticate
app.post('/login', limitLogin, async (req, res) => {
    const { name, username, password } = req.body;
    const user = (name || username || '').trim().toLowerCase();
    const pass = (password || '').trim();
    const settings = db.getSettings();

    const isAdminPass = verifyPassword(pass, settings.adminPassword, settings.adminPasswordHash, '@777999');
    const isMemberPass = verifyPassword(pass, settings.memberPassword, settings.memberPasswordHash, 'password777999');

    let sessionRole = null;
    let errorMessage = null;
    let guestEntry = null;

    const tempPasswords = settings.temporaryPasswords || [];
    for (const t of tempPasswords) {
        if (verifyPassword(pass, t.password, t.passwordHash)) {
            guestEntry = t;
            break;
        }
    }

    if (user === 'admin') {
        if (isAdminPass) {
            sessionRole = 'admin';
        } else {
            errorMessage = 'รหัสผ่าน Admin ไม่ถูกต้อง';
        }
    } else if (user === 'guest') {
        if (guestEntry) {
            if (new Date(guestEntry.expiresAt).getTime() <= Date.now()) {
                errorMessage = 'รหัสผ่านชั่วคราวหมดอายุแล้ว (Guest Access Expired)';
            } else {
                sessionRole = 'guest';
            }
        } else {
            errorMessage = 'รหัสผ่าน Guest ไม่ถูกต้อง';
        }
    } else if (user === 'kain7' || user === 'member') {
        if (isMemberPass) {
            sessionRole = 'member';
        } else if (isAdminPass) {
            // Admin password also lets into admin mode even if on member tab
            sessionRole = 'admin';
        } else if (guestEntry) {
            if (new Date(guestEntry.expiresAt).getTime() <= Date.now()) {
                errorMessage = 'รหัสผ่านชั่วคราวหมดอายุแล้ว (Guest Access Expired)';
            } else {
                sessionRole = 'guest';
            }
        } else {
            errorMessage = 'รหัสผ่าน Member ไม่ถูกต้อง';
        }
    } else {
        if (isAdminPass) {
            sessionRole = 'admin';
        } else if (isMemberPass) {
            sessionRole = 'member';
        } else if (guestEntry) {
            if (new Date(guestEntry.expiresAt).getTime() <= Date.now()) {
                errorMessage = 'รหัสผ่านชั่วคราวหมดอายุแล้ว (Guest Access Expired)';
            } else {
                sessionRole = 'guest';
            }
        } else {
            errorMessage = 'รหัสผ่านไม่ถูกต้อง';
        }
    }

    if (sessionRole === 'guest' && guestEntry) {
        guestEntry.usedCount = (guestEntry.usedCount || 0) + 1;
        guestEntry.lastUsedAt = new Date().toISOString();
        db.updateSettings({ temporaryPasswords: tempPasswords }).catch(e => console.error('Guest stats update error:', e));
    }

    if (!sessionRole) {
        if (req.headers['x-inertia']) {
            res.setHeader('X-Inertia', 'true');
            return res.status(422).json({
                component: 'auth/login',
                props: {
                    errors: { password: errorMessage },
                    name: settings.serverName || '#Kain7',
                    auth: { user: null },
                    sidebarOpen: true,
                    status: null
                },
                url: '/login',
                version: INERTIA_VERSION
            });
        }
        return res.status(401).send(renderLoginHtml({
            component: 'auth/login',
            props: { errors: { password: errorMessage } }
        }, settings.serverName || '#Kain7'));
    }

    const maxAgeSeconds = (sessionRole === 'guest' && guestEntry?.expiresAt)
        ? Math.max(60, Math.floor((new Date(guestEntry.expiresAt).getTime() - Date.now()) / 1000))
        : SESSION_MAX_AGE_SECONDS;

    const sessionVal = createSession(sessionRole, maxAgeSeconds);
    const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', [
        `boss_session=${sessionVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`,
        `remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=${sessionVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
    ]);
    return res.redirect(303, '/');
});

// POST /logout
app.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', [
        'boss_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    ]);
    if (req.headers['x-inertia']) {
        res.setHeader('X-Inertia-Location', '/login');
        return res.status(409).send('');
    }
    res.redirect(303, '/login');
});

app.use(requireSession);
app.use(requireSameOrigin);

let forceReloadAt = null;

// GET /poll -> Real-time polling
app.get('/poll', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (process.env.VERCEL && !db.isCloudDataReady()) {
        res.set('Retry-After', '2');
        return res.status(503).json({ notReady: true, stale: true, source: 'local-fallback', serverTime: Date.now() });
    }
    await db.expireBossAlerts();
    await db.autoAdvanceOverdueBosses();
    const settings = db.getSettings();
    res.json({
        bosses: db.getBosses(),
        events: db.getEvents(),
        allEvents: db.getAllEvents(),
        announcement: settings.announcement || null,
        hideInvasionBosses: Boolean(settings.hideInvasionBosses),
        invasionLabel: settings.invasionLabel || 'L3',
        invasionColor: settings.invasionColor || '#facc15',
        resetTimeConfigs: db.getResetConfigs(),
        savedMaintenanceEndTime: db.getSavedMaintenanceEndTime() || null,
        forceReloadAt: forceReloadAt,
        liveEvent: db.getLiveEvent(),
        recentLiveEvents: db.getRecentLiveEvents(),
        serverTime: Date.now(),
        dataRevision: db.getDataRevision(),
        source: db.getActiveSource(),
        stale: false
    });
});

// Tiny fallback for background tabs when Firebase rules disallow public streams.
app.get('/live-event', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
        liveEvent: db.getLiveEvent(),
        recentLiveEvents: db.getRecentLiveEvents(),
        serverTime: Date.now(),
        dataRevision: db.getDataRevision(),
        source: db.getActiveSource(),
        stale: !db.isCloudDataReady() && db.getActiveSource() === 'local'
    });
});

// ==========================================================
// BOSS ACTIONS
// ==========================================================

function getPreSpawnAlertUpdates(boss, role, now = Date.now()) {
    const expiry = new Date(boss.pre_spawn_expires_at || 0).getTime();
    const isActive = boss.pre_spawned && (!Number.isFinite(expiry) || expiry <= 0 || expiry > now);
    if (isActive) {
        return { pre_spawned: false, pre_spawn_expires_at: null, alerted_by: null };
    }
    return {
        pre_spawned: true,
        pre_spawn_expires_at: new Date(now + PRE_SPAWN_ALERT_WINDOW_MS).toISOString(),
        pinned_alive: false,
        alerted_by: role
    };
}

function clearPreSpawnAlert(updates) {
    updates.pre_spawned = false;
    updates.pre_spawn_expires_at = null;
    updates.alerted_by = null;
}

// Double-click alert: toggle on/off, with automatic expiry after five minutes.
app.post('/bosses/:id/notify', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const boss = db.getBoss(id);
    if (!boss) return res.status(404).json({ success: false, message: 'Boss not found' });
    const updated = await db.updateBoss(id, getPreSpawnAlertUpdates(boss, getSessionRole(req)));
    if (req.headers['x-inertia']) return respondInertiaOrRedirect(req, res, '/');
    return res.json({ success: true, active: updated.pre_spawned, boss: updated });
});

// POST /bosses -> Create boss
app.post('/bosses', requireAdmin, async (req, res) => {
    const { name, location, interval, chance_of_appearing, chanceOfAppearing, is_invasion, isInvasion, last_kill_time, color } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
        return res.status(400).json({ success: false, message: 'Invalid boss name' });
    }
    let intervalMinutes = 60;
    if (typeof interval === 'string' && interval.includes(':')) {
        const [h, m] = interval.split(':').map(Number);
        intervalMinutes = (h || 0) * 60 + (m || 0);
    } else {
        intervalMinutes = Number(interval) || 60;
    }
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0 || intervalMinutes > 10080) {
        return res.status(400).json({ success: false, message: 'Invalid boss interval' });
    }

    let spawnTime = null;
    let killTime = last_kill_time || null;
    if (killTime) {
        spawnTime = new Date(new Date(killTime).getTime() + intervalMinutes * 60000).toISOString();
    }

    const isInvasionVal = is_invasion !== undefined ? is_invasion : isInvasion;
    const chanceVal = chance_of_appearing !== undefined ? chance_of_appearing : (chanceOfAppearing || '100.00');

    await db.createBoss({
        name,
        location: location || '',
        interval: intervalMinutes,
        chance_of_appearing: String(chanceVal),
        is_invasion: Boolean(isInvasionVal),
        color: color ? String(color).trim() : null,
        last_kill_time: killTime,
        next_spawn: spawnTime
    });

    return respondInertiaOrRedirect(req, res, '/');
});

// PUT /bosses/:id -> Update boss / kill / advance / pin / settings
app.put('/bosses/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const boss = db.getBoss(id);
    if (!boss) return respondInertiaOrRedirect(req, res, '/');

    const body = req.body || {};
        const updates = {};

    if (body.last_kill_time !== undefined) {
        if (!body.last_kill_time) {
            updates.last_kill_time = null;
            updates.next_spawn = null;
            updates.pinned_alive = false;
            updates.auto_advanced = false;
            updates.post_maintenance = false;
            clearPreSpawnAlert(updates);
        } else {
            const killDate = new Date(body.last_kill_time);
            if (!isNaN(killDate.getTime())) {
                const intervalMinutes = boss.interval || 60;
                let spawnDate = new Date(killDate.getTime() + intervalMinutes * 60000);
                let autoAdvanced = false;

                // Auto-advance if spawn time has already passed!
                // If a player missed hunting rounds or inputs a past kill time (e.g. 04:59:00),
                // automatically calculate and roll forward by interval cycles to the next upcoming future spawn.
                const now = Date.now();
                if (spawnDate.getTime() < now) {
                    while (spawnDate.getTime() <= now) {
                        spawnDate = new Date(spawnDate.getTime() + intervalMinutes * 60000);
                    }
                    autoAdvanced = true;
                }

                updates.last_kill_time = killDate.toISOString();
                updates.next_spawn = spawnDate.toISOString();
                updates.pinned_alive = false;
                updates.auto_advanced = autoAdvanced;
                updates.post_maintenance = false;
                clearPreSpawnAlert(updates);
            }
        }
    } else if (body.not_spawned) {
        let currentNext = boss.next_spawn ? new Date(boss.next_spawn) : new Date();
        const intervalMinutes = boss.interval || 60;
        let advanced = new Date(currentNext.getTime() + intervalMinutes * 60000);
        while (advanced.getTime() <= Date.now()) {
            advanced = new Date(advanced.getTime() + intervalMinutes * 60000);
        }
        updates.next_spawn = advanced.toISOString();
        updates.last_kill_time = new Date(advanced.getTime() - intervalMinutes * 60000).toISOString();
        updates.auto_advanced = true;
        updates.pinned_alive = false;
        clearPreSpawnAlert(updates);
    } else if (body.still_alive) {
        updates.pinned_alive = !boss.pinned_alive;
        if (updates.pinned_alive) clearPreSpawnAlert(updates);
    } else if (body.toggle_pre_spawned) {
        Object.assign(updates, getPreSpawnAlertUpdates(boss, getSessionRole(req)));
    } else if (body.toggle_maintenance) {
        updates.post_maintenance = !boss.post_maintenance;
    } else if (body.adjust_spawn_minutes !== undefined) {
        const spawnMinutes = Number(body.adjust_spawn_minutes);
        const spawnDate = new Date(Date.now() + spawnMinutes * 60000);
        updates.next_spawn = spawnDate.toISOString();
        updates.last_kill_time = new Date(spawnDate.getTime() - (boss.interval || 60) * 60000).toISOString();
        updates.pinned_alive = false;
        updates.auto_advanced = false;
        clearPreSpawnAlert(updates);
    } else if (body.unset_kill_time) {
        updates.last_kill_time = null;
        updates.next_spawn = null;
        updates.pinned_alive = false;
        updates.auto_advanced = false;
        updates.post_maintenance = false;
        clearPreSpawnAlert(updates);
    } else if (body.name !== undefined) {
        updates.name = body.name;
        if (body.location !== undefined) updates.location = body.location;
        if (body.interval !== undefined) {
            if (typeof body.interval === 'string' && body.interval.includes(':')) {
                const [h, m] = body.interval.split(':').map(Number);
                updates.interval = (h || 0) * 60 + (m || 0);
            } else {
                updates.interval = Number(body.interval) || 60;
            }
            if (boss.last_kill_time) {
                const killDate = new Date(boss.last_kill_time);
                if (!isNaN(killDate.getTime())) {
                    updates.next_spawn = new Date(killDate.getTime() + updates.interval * 60000).toISOString();
                    clearPreSpawnAlert(updates);
                }
            }
        }
        const chanceVal = body.chance_of_appearing !== undefined ? body.chance_of_appearing : body.chanceOfAppearing;
        if (chanceVal !== undefined) updates.chance_of_appearing = String(chanceVal);
        const isInvVal = body.is_invasion !== undefined ? body.is_invasion : body.isInvasion;
        if (isInvVal !== undefined) updates.is_invasion = Boolean(isInvVal);
        if (body.color !== undefined) updates.color = body.color ? String(body.color).trim() : null;
    } else if (body.color !== undefined) {
        updates.color = body.color ? String(body.color).trim() : null;
    }

    await db.updateBoss(id, updates);
    return respondInertiaOrRedirect(req, res, '/');
});

// PUT /bosses/:id/color -> Update boss font color specifically
app.put('/bosses/:id/color', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const boss = db.getBoss(id);
    if (!boss) return res.status(404).json({ success: false, message: 'Boss not found' });
    const color = req.body.color !== undefined ? (req.body.color ? String(req.body.color).trim() : null) : null;
    const updated = await db.updateBoss(id, { color });
    if (req.headers['x-inertia']) return respondInertiaOrRedirect(req, res, '/');
    return res.json({ success: true, boss: updated });
});

// DELETE /bosses/:id -> Delete boss
app.delete('/bosses/:id', requireAdmin, async (req, res) => {
    await db.deleteBoss(Number(req.params.id));
    return respondInertiaOrRedirect(req, res, '/');
});

// PUT /settings/invasion-visibility
app.put('/settings/invasion-visibility', requireAdmin, async (req, res) => {
    const hide = req.body.hide_invasion_bosses !== undefined
        ? req.body.hide_invasion_bosses
        : req.body.hideInvasionBosses;
    await db.updateSettings({ hideInvasionBosses: Boolean(hide) });
    return respondInertiaOrRedirect(req, res, '/');
});

// PUT /settings/invasion-label
app.put('/settings/invasion-label', requireAdmin, async (req, res) => {
    const label = req.body.invasion_label !== undefined ? req.body.invasion_label : req.body.invasionLabel;
    await db.updateSettings({ invasionLabel: label || 'L3' });
    return respondInertiaOrRedirect(req, res, '/');
});

// PUT /settings/invasion-color
app.put('/settings/invasion-color', requireAdmin, async (req, res) => {
    const color = req.body.invasion_color !== undefined ? req.body.invasion_color : req.body.invasionColor;
    const finalColor = color ? String(color).trim() : '#facc15';
    await db.updateSettings({ invasionColor: finalColor });
    if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers['x-inertia']) {
        return res.json({ success: true, invasionColor: finalColor });
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/reset-invasion-kill-times
app.post('/bosses/reset-invasion-kill-times', requireAdmin, async (req, res) => {
    await db.batchUpdateBosses(b => {
        if (b.is_invasion) {
            return {
                last_kill_time: null,
                next_spawn: null,
                pinned_alive: false,
                auto_advanced: false,
                post_maintenance: false,
                pre_spawned: false,
                pre_spawn_expires_at: null,
                alerted_by: null
            };
        }
        return null;
    });
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/apply-reset-boss-time
app.post('/bosses/apply-reset-boss-time', requireAdmin, async (req, res) => {
    const { maintenance_end_time, configs } = req.body;
    if (maintenance_end_time) {
        let baseDate = new Date();
        let savedTimeStr = '14:00';
        if (typeof maintenance_end_time === 'string') {
            if (maintenance_end_time.includes('T')) {
                const parsed = new Date(maintenance_end_time);
                if (!isNaN(parsed.getTime())) baseDate = parsed;
                const timePart = maintenance_end_time.split('T')[1];
                savedTimeStr = timePart.substring(0, 5);
            } else if (maintenance_end_time.includes(':')) {
                const [h, m] = maintenance_end_time.split(':').map(Number);
                if (!isNaN(h) && !isNaN(m)) {
                    baseDate.setHours(h, m, 0, 0);
                    savedTimeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                }
            }
        }

        let configsMap = {};
        if (Array.isArray(configs)) {
            for (const c of configs) {
                configsMap[c.boss_name] = {
                    hours: Number(c.delay_hours) || 0,
                    minutes: Number(c.delay_minutes) || 0
                };
            }
        } else if (configs && typeof configs === 'object') {
            configsMap = configs;
        } else {
            configsMap = db.getResetConfigs();
        }

        await db.batchUpdateBosses(boss => {
            const conf = configsMap[boss.name] || db.getResetConfigs()[boss.name];
            if (conf) {
                const offsetMinutes = (Number(conf.hours) || 0) * 60 + (Number(conf.minutes) || 0);
                const nextSpawn = new Date(baseDate.getTime() + offsetMinutes * 60000);
                const lastKill = new Date(nextSpawn.getTime() - (boss.interval || 60) * 60000);

                return {
                    next_spawn: nextSpawn.toISOString(),
                    last_kill_time: lastKill.toISOString(),
                    post_maintenance: true,
                    pinned_alive: false,
                    auto_advanced: false,
                    pre_spawned: false,
                    pre_spawn_expires_at: null,
                    alerted_by: null
                };
            }
            return null;
        });
        await db.setSavedMaintenanceEndTime(savedTimeStr);
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/save-reset-boss-config
app.post('/bosses/save-reset-boss-config', requireAdmin, async (req, res) => {
    const { configs, resetTimeConfigs, maintenance_end_time } = req.body;
    let configsMap = {};
    if (Array.isArray(configs)) {
        for (const c of configs) {
            configsMap[c.boss_name] = {
                hours: Number(c.delay_hours) || 0,
                minutes: Number(c.delay_minutes) || 0
            };
        }
    } else if (configs && typeof configs === 'object') {
        configsMap = configs;
    } else if (resetTimeConfigs) {
        configsMap = resetTimeConfigs;
    }

    if (Object.keys(configsMap).length > 0) {
        await db.saveResetConfigs(configsMap);
    }
    if (maintenance_end_time) {
        let savedTime = maintenance_end_time;
        if (typeof savedTime === 'string' && savedTime.includes('T')) {
            savedTime = savedTime.split('T')[1].substring(0, 5);
        }
        await db.setSavedMaintenanceEndTime(savedTime);
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/post-maintenance-mode
app.post('/bosses/post-maintenance-mode', requireAdmin, async (req, res) => {
    await db.batchUpdateBosses(b => {
        if (b.next_spawn) {
            return { post_maintenance: true };
        }
        return null;
    });
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/cancel-maintenance-mode
app.post('/bosses/cancel-maintenance-mode', requireAdmin, async (req, res) => {
    await db.batchUpdateBosses(b => {
        if (b.post_maintenance) {
            return { post_maintenance: false };
        }
        return null;
    });
    await db.setSavedMaintenanceEndTime(null);
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/reset-maintenance-kill-times
app.post('/bosses/reset-maintenance-kill-times', requireAdmin, async (req, res) => {
    await db.batchUpdateBosses(b => {
        if (b.post_maintenance) {
            return {
                last_kill_time: null,
                next_spawn: null,
                post_maintenance: false,
                pinned_alive: false,
                auto_advanced: false,
                pre_spawned: false,
                pre_spawn_expires_at: null,
                alerted_by: null
            };
        }
        return null;
    });
    await db.setSavedMaintenanceEndTime(null);
    return respondInertiaOrRedirect(req, res, '/');
});

// ==========================================================
// EVENT ACTIONS
// ==========================================================

// PUT /events/:id/color
app.put('/events/:id/color', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const event = db.getEvent(id);
    if (!event) return respondInertiaOrRedirect(req, res, '/');

    const color = req.body.color ? String(req.body.color).trim() : null;
    await db.updateEvent(id, { color });

    if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers['x-inertia']) {
        return res.json({ success: true, color });
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// PUT /events/:id
app.put('/events/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body || {};
    const event = db.getEvent(id);
    if (event) {
        if (body.mark_done || body.mark_skipped) {
            const todayStr = db.getThaiDateInfo().dateStr;
            await db.updateEvent(id, { done_on: todayStr, pinned_alive: false });
        } else if (body.pin_alive) {
            await db.updateEvent(id, { pinned_alive: !event.pinned_alive });
        } else if (body.undo_exception) {
            await db.updateEvent(id, { done_on: null, pinned_alive: false });
        } else if (body.edit_occurrence) {
            const updates = {
                event_time: body.occurrence_time || event.event_time,
                name: body.occurrence_name || event.name
            };
            if (body.color !== undefined) updates.color = body.color ? String(body.color).trim() : null;
            await db.updateEvent(id, updates);
        } else if (body.name) {
            const updates = {
                name: body.name,
                location: body.location || '',
                event_time: body.event_time,
                occurs_on: body.occurs_on,
                auto_done_minutes: body.auto_done_minutes !== undefined ? Number(body.auto_done_minutes) : (event.auto_done_minutes || 10)
            };
            if (body.color !== undefined) updates.color = body.color ? String(body.color).trim() : null;
            await db.updateEvent(id, updates);
        } else if (body.color !== undefined) {
            await db.updateEvent(id, { color: body.color ? String(body.color).trim() : null });
        }
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /events
app.post('/events', requireAdmin, async (req, res) => {
    await db.createEvent({
        name: req.body.name,
        location: req.body.location || '',
        color: req.body.color ? String(req.body.color).trim() : null,
        event_time: req.body.event_time || '21:00',
        occurs_on: req.body.occurs_on || ['saturday', 'sunday'],
        auto_done_minutes: Number(req.body.auto_done_minutes) || 10
    });
    return respondInertiaOrRedirect(req, res, '/');
});

// DELETE /events/:id
app.delete('/events/:id', requireAdmin, async (req, res) => {
    await db.deleteEvent(Number(req.params.id));
    return respondInertiaOrRedirect(req, res, '/');
});

// ==========================================================
// ANNOUNCEMENTS
// ==========================================================
app.post('/announcement', requireAdmin, async (req, res) => {
    const { message, urgent, announcement } = req.body;
    const role = getSessionRole(req);
    const sent_by = role === 'admin' ? 'admin' : 'kain7';
    let announcementObj = null;
    if (message !== undefined) {
        announcementObj = {
            message: message || '',
            sent_by,
            urgent: Boolean(urgent),
            resent_at: new Date().toISOString()
        };
    } else if (announcement) {
        announcementObj = typeof announcement === 'object' ? announcement : {
            message: String(announcement),
            sent_by,
            urgent: false,
            resent_at: new Date().toISOString()
        };
    }
    await db.updateSettings({ announcement: announcementObj });
    if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers['x-inertia']) {
        return res.json({ ok: true, announcement: announcementObj });
    }
    return respondInertiaOrRedirect(req, res, '/');
});

app.post('/announcement/clear', requireAdmin, async (req, res) => {
    await db.updateSettings({ announcement: null });
    if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers['x-inertia']) {
        return res.json({ ok: true });
    }
    return respondInertiaOrRedirect(req, res, '/');
});

app.post('/announcement/resend', requireAdmin, async (req, res) => {
    const settings = db.getSettings();
    if (settings.announcement) {
        settings.announcement.resent_at = new Date().toISOString();
        await db.updateSettings({ announcement: settings.announcement });
    }
    if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers['x-inertia']) {
        return res.json({ ok: true });
    }
    return respondInertiaOrRedirect(req, res, '/');
});

app.post('/force-reload', requireAdmin, (req, res) => {
    forceReloadAt = new Date().toISOString();
    if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers['x-inertia']) {
        return res.json({ ok: true, forceReloadAt });
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// Client heartbeat analytics
app.post('/analytics/heartbeat', (req, res) => {
    res.json({ status: 'ok' });
});

// Public API
app.get('/api/v1/time-bosses', (req, res) => {
    const bosses = db.getBosses();
    const now = Date.now();
    const formatted = bosses.map(b => {
        let remainingSeconds = null;
        let isAlive = b.pinned_alive;
        if (b.next_spawn) {
            const spawnMs = new Date(b.next_spawn).getTime();
            remainingSeconds = Math.round((spawnMs - now) / 1000);
            if (remainingSeconds <= 0 && remainingSeconds > -300) {
                isAlive = true;
            }
        }
        return {
            id: b.id,
            name: b.name,
            location: b.location,
            interval_minutes: b.interval,
            chance_of_appearing: b.chance_of_appearing,
            is_invasion: b.is_invasion,
            last_kill_time: b.last_kill_time,
            next_spawn: b.next_spawn,
            remaining_seconds: remainingSeconds,
            is_alive: isAlive,
            pinned_alive: b.pinned_alive,
            pre_spawned: b.pre_spawned,
            auto_advanced: b.auto_advanced,
            post_maintenance: b.post_maintenance
        };
    });
    res.json({
        server_name: db.getSettings().serverName || '#Kain7',
        timestamp: new Date().toISOString(),
        total_bosses: formatted.length,
        bosses: formatted
    });
});

// Gemini Status health check
app.get('/api/gemini-status', (req, res) => {
    res.json({ ok: true, status: 'online', version: APP_VERSION, time: new Date().toISOString() });
});

// Firebase Status health check
app.get('/api/firebase-status', (req, res) => {
    res.json({ ...db.getFirebaseStatus(), version: APP_VERSION });
});

// Backup Download Endpoint (JSON file download)
app.get('/api/v1/backup', requireAdmin, (req, res) => {
    const store = db.getStore();
    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Disposition', `attachment; filename="boss-tracker-backup-${APP_VERSION}-${dateStr}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(store, null, 2));
});

// Settings page redirects (for standard Inertia links)
app.get(['/admin', '/admin/passwords', '/admin/password', '/passwords'], (req, res) => {
    if (getSessionRole(req) !== 'admin') {
        return res.redirect('/');
    }
    return res.redirect('/?openPwdModal=1');
});
app.all(['/settings/appearance', '/settings/password', '/settings/profile'], (req, res) => {
    return respondInertiaOrRedirect(req, res, '/');
});

// Start Server with auto port retry
function startServer(port = 3000) {
    const srv = http.createServer(app);
    srv.listen(port, () => {
        console.log(`================================================`);
        console.log(`⚔️  Lineage 2 Exact Clone Server (${APP_VERSION}) running on port ${port}`);
        console.log(`🌐 Local URL: http://localhost:${port}`);
        console.log('🛡️  Admin and member login enabled');
        console.log(`☁️  Central DB:  Firebase Realtime Database (Single Source of Truth)`);
        console.log(`================================================`);
        
        // Initialize Firebase Realtime Database
        db.initFirebase();
    });

    srv.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`Port ${port} in use, trying port ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const targetPort = process.env.PORT ? Number(process.env.PORT) : 3000;
if (!process.env.VERCEL) {
    startServer(targetPort);
} else {
    // In Vercel serverless environment, initialize Firebase DB directly
    db.initFirebase();
}

module.exports = app;
