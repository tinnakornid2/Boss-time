const http = require('http');
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const pkg = require('../package.json');
const APP_VERSION = `v${pkg.version || '1.2.0'}`;
const INERTIA_VERSION = '55c7f37e0516ec0f9ab5340e89e90c20';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
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

function createSession(role) {
    const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 })).toString('base64url');
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
        if (!['admin', 'member'].includes(data.role) || Number(data.exp) <= Date.now()) return null;
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
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Log in - ${escapeHtml(title)}</title><link rel="icon" href="/favicon.png" type="image/png">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070708;color:#fff;font-family:system-ui,sans-serif}.login{width:min(360px,calc(100vw - 32px));padding:26px;border:1px solid #3f3f46;border-radius:18px;background:#101012;box-shadow:0 24px 70px #000}.brand{text-align:center;color:#d97706;font-weight:800;margin-bottom:22px}.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:18px}.tabs label{padding:9px;text-align:center;border-radius:8px;background:#18181b;cursor:pointer;font-size:12px;font-weight:700}.tabs input{position:absolute;opacity:0}.tabs label:has(input:checked){background:#78350f;color:#fcd34d}.field{display:block;margin-bottom:7px;color:#a1a1aa;font-size:11px;font-weight:700}.password{width:100%;padding:12px;border:1px solid #52525b;border-radius:9px;background:#09090b;color:#fff;font-size:16px}.submit{width:100%;margin-top:16px;padding:12px;border:0;border-radius:9px;background:#d97706;color:#fff;font-weight:800;cursor:pointer}.submit:disabled{opacity:.55}.error{margin:12px 0 0;color:#f87171;font-size:13px}.note{margin-top:14px;color:#71717a;text-align:center;font-size:11px}
</style></head><body><main class="login"><div class="brand">#madebyelon</div>
<form method="post" action="/login" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Signing in — กำลังเข้าสู่ระบบ'">
<div class="tabs"><label><input type="radio" name="name" value="kain7" checked>MEMBER — สมาชิก</label><label><input type="radio" name="name" value="admin">ADMIN — ผู้ดูแล</label></div>
<label class="field" for="password">PASSWORD — รหัสผ่าน</label><input class="password" id="password" name="password" type="password" required autocomplete="current-password" autofocus onkeydown="if(event.key==='Enter'){event.preventDefault();this.form.requestSubmit()}">
${error ? `<p class="error">${error}</p>` : ''}<button class="submit" type="submit">SIGN IN — เข้าสู่ระบบ</button>
</form><div class="note">Boss Tracker ${APP_VERSION}</div></main></body></html>`;
}

// Helper: HTML page wrapper matching boss.kain7.com exactly
function renderHtml(pageData, title = '#Kain7') {
    if (pageData?.component === 'auth/login') return renderLoginHtml(pageData, title);
    const jsonStr = escapeHtml(JSON.stringify(pageData));
    const isDashboard = Boolean(pageData && pageData.component === 'dashboard');
    const userRole = (pageData && pageData.props && pageData.props.auth && pageData.props.auth.user && pageData.props.auth.user.role) || 'guest';
    const isAdmin = userRole === 'admin';

    const adminPasswordSnippet = `
    <!-- Admin Password Management Modal & Permanent Button Script -->
    <style>
        #admin-pwd-modal {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 999999;
            background: rgba(0, 0, 0, 0.82);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            align-items: center;
            justify-content: center;
            padding: 16px;
            font-family: inherit;
        }
        #admin-pwd-modal.active {
            display: flex !important;
        }
        .pwd-card {
            position: relative;
            width: 100%;
            max-width: 450px;
            background: linear-gradient(145deg, #18181b, #09090b);
            border: 1px solid rgba(245, 158, 11, 0.4);
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 25px 60px rgba(0,0,0,0.9), 0 0 30px rgba(245,158,11,0.2);
            color: #fff;
            box-sizing: border-box;
            animation: pwdModalPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes pwdModalPop {
            0% { opacity: 0; transform: scale(0.95) translateY(10px); }
            100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .pwd-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            padding-bottom: 14px;
            margin-bottom: 18px;
        }
        .pwd-title {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .pwd-title-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 38px;
            height: 38px;
            border-radius: 10px;
            background: rgba(245, 158, 11, 0.15);
            border: 1px solid rgba(245, 158, 11, 0.35);
            font-size: 18px;
        }
        .pwd-title-text h3 {
            margin: 0;
            font-size: 15px;
            font-weight: 700;
            color: #fff;
            letter-spacing: -0.01em;
        }
        .pwd-title-text p {
            margin: 2px 0 0 0;
            font-size: 11px;
            color: rgba(255, 255, 255, 0.5);
        }
        .pwd-close-btn {
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.4);
            font-size: 18px;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 6px;
            transition: all 0.15s;
        }
        .pwd-close-btn:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }
        .pwd-group {
            margin-bottom: 16px;
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
            padding: 10px 42px 10px 12px;
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
        .pwd-toggle-eye:hover {
            color: #fff;
        }
        .pwd-subhint {
            margin: 5px 0 0 0;
            font-size: 10px;
            color: rgba(255, 255, 255, 0.4);
            line-height: 1.4;
        }
        .pwd-alert {
            display: none;
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 11px;
            margin-bottom: 14px;
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
            margin-top: 16px;
        }
        .pwd-footer {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 10px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 16px;
            margin-top: 20px;
        }
        .pwd-btn-cancel {
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.6);
            font-size: 12px;
            font-weight: 500;
            padding: 8px 16px;
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
            padding: 8px 20px;
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

        /* Floating Key Button Trigger Bar */
        #admin-pwd-floating-bar {
            position: fixed;
            bottom: 12px;
            left: 14px;
            z-index: 999999;
            display: flex;
            align-items: center;
            gap: 6px;
            pointer-events: auto;
        }
        .pwd-trigger-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 14px;
            background: linear-gradient(135deg, rgba(245, 158, 11, 0.35), rgba(217, 119, 6, 0.25));
            border: 1.5px solid #f59e0b;
            border-radius: 9999px;
            color: #fbbf24;
            font-family: inherit;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            box-shadow: 0 4px 16px rgba(0,0,0,0.6), 0 0 12px rgba(245, 158, 11, 0.35);
            transition: all 0.2s ease;
            user-select: none;
            animation: pwdPulseGlow 3s ease-in-out infinite;
        }
        @keyframes pwdPulseGlow {
            0%, 100% { box-shadow: 0 4px 16px rgba(0,0,0,0.6), 0 0 10px rgba(245, 158, 11, 0.3); }
            50% { box-shadow: 0 4px 22px rgba(0,0,0,0.8), 0 0 20px rgba(245, 158, 11, 0.65); }
        }
        .pwd-trigger-pill:hover {
            background: linear-gradient(135deg, rgba(245, 158, 11, 0.55), rgba(217, 119, 6, 0.4));
            border-color: #fbbf24;
            color: #fff;
            transform: translateY(-1px) scale(1.03);
        }
        .header-pwd-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            background: rgba(245, 158, 11, 0.15);
            border: 1px solid rgba(245, 158, 11, 0.4);
            border-radius: 5px;
            color: #fbbf24;
            font-family: inherit;
            font-size: 10px;
            font-weight: 600;
            cursor: pointer;
            margin: 0 4px;
            transition: all 0.2s ease;
            backdrop-filter: blur(4px);
        }
        .header-pwd-btn:hover {
            background: rgba(245, 158, 11, 0.3);
            border-color: #f59e0b;
            color: #fff;
        }
    </style>

    <div id="admin-pwd-floating-bar" style="${isAdmin ? '' : 'display:none;'}">
        <button type="button" id="header-password-control" class="pwd-trigger-pill" onclick="openAdminPwdModal()" title="Manage Passwords — จัดการรหัสผ่าน" aria-label="Manage Passwords — จัดการรหัสผ่าน">
            <span aria-hidden="true">🔑</span>
            <span id="pwd-pill-label">Manage Passwords</span>
        </button>
    </div>

    <div id="admin-pwd-modal">
        <div class="pwd-card" onclick="event.stopPropagation()">
            <div class="pwd-header">
                <div class="pwd-title">
                    <div class="pwd-title-icon">🔑</div>
                    <div class="pwd-title-text">
                        <h3>จัดการรหัสผ่านระบบ</h3>
                        <p>ตั้งค่ารหัสผ่าน Admin & Member</p>
                    </div>
                </div>
                <button type="button" class="pwd-close-btn" onclick="closeAdminPwdModal()">✕</button>
            </div>

            <div id="pwd-alert-box" class="pwd-alert"></div>

            <!-- Member Unlock Form if not yet authenticated as Admin -->
            <div id="pwd-verify-admin-section" style="${isAdmin ? 'display:none;' : 'display:block;'}">
                <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 10px; padding: 14px; margin-bottom: 16px;">
                    <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 700; color: #fbbf24;">🛡️ ยืนยันสิทธิ์ Admin</p>
                    <p style="margin: 0 0 12px 0; font-size: 11px; color: rgba(255,255,255,0.7); line-height: 1.5;">
                        ปัจจุบันคุณกำลังเปิดในสถานะ <b>Member</b> กรุณากรอกรหัสผ่าน Admin ปัจจุบันเพื่อปลดล็อก:
                    </p>
                    <div style="display:flex; gap:8px;">
                        <input type="password" id="modal-input-verify-admin" placeholder="รหัสผ่าน Admin ปัจจุบัน" class="pwd-input" style="flex:1;">
                        <button type="button" class="pwd-btn-save" style="padding: 8px 16px; white-space: nowrap;" onclick="verifyAdminAndUnlock()">🔓 ยืนยัน</button>
                    </div>
                    <div id="pwd-verify-error" style="color: #f87171; font-size: 11px; margin-top: 8px; display: none;"></div>
                </div>
            </div>

            <!-- Password Editing Fields -->
            <div id="pwd-edit-fields-section" style="${isAdmin ? 'display:block;' : 'display:none;'}">
                <div class="pwd-group">
                    <div class="pwd-label-row">
                        <span class="pwd-label" style="color: #fbbf24;">🛡️ รหัสผ่าน Admin (ผู้ดูแล)</span>
                        <span class="pwd-badge">สิทธิ์จัดการระบบ</span>
                    </div>
                    <div class="pwd-input-wrap">
                        <input type="password" id="modal-input-admin-pwd" class="pwd-input" placeholder="รหัสผ่านใหม่" autocomplete="off">
                        <button type="button" class="pwd-toggle-eye" onclick="togglePwdVisibility('modal-input-admin-pwd', this)">👁️</button>
                    </div>
                    <p class="pwd-subhint">สำหรับเข้าสู่โหมด Admin: บันทึกเวลาเกิดบอส, เพิ่ม/ลบบอส, จัดการอีเวนต์</p>
                </div>

                <div class="pwd-group" style="margin-top: 14px;">
                    <div class="pwd-label-row">
                        <span class="pwd-label" style="color: #38bdf8;">👥 รหัสผ่าน Member (สมาชิกแคลน)</span>
                        <span class="pwd-badge">สิทธิ์ดูตาราง</span>
                    </div>
                    <div class="pwd-input-wrap">
                        <input type="password" id="modal-input-member-pwd" class="pwd-input" placeholder="รหัสผ่านใหม่" autocomplete="off">
                        <button type="button" class="pwd-toggle-eye" onclick="togglePwdVisibility('modal-input-member-pwd', this)">👁️</button>
                    </div>
                    <p class="pwd-subhint">สำหรับแจกคนในแคลน: เปิดดูตารางเวลาบอส, เวลานับถอยหลัง และเสียงเตือน</p>
                </div>

                <div class="pwd-cloud-notice">
                    <span>☁️</span>
                    <span>เมื่อบันทึกแล้ว ข้อมูลจะซิงค์ไปยัง Firebase Cloud อัตโนมัติ</span>
                </div>

                <div class="pwd-footer" id="pwd-footer-save">
                    <button type="button" class="pwd-btn-cancel" onclick="closeAdminPwdModal()">ยกเลิก</button>
                    <button type="button" id="btn-modal-save-pwd" class="pwd-btn-save" onclick="submitAdminPasswords()">
                        <span>💾 บันทึกรหัสผ่านใหม่</span>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <script>
        function openAdminPwdModal() {
            const modal = document.getElementById('admin-pwd-modal');
            if (!modal) return;
            modal.classList.add('active');
            const alertBox = document.getElementById('pwd-alert-box');
            if (alertBox) {
                alertBox.className = 'pwd-alert';
                alertBox.textContent = '';
            }

            // Fetch current passwords if already admin
            fetchPasswords();
        }

        function closeAdminPwdModal() {
            const modal = document.getElementById('admin-pwd-modal');
            if (modal) modal.classList.remove('active');
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
                        const editSec = document.getElementById('pwd-edit-fields-section');
                        if (verifySec) verifySec.style.display = 'none';
                        if (editSec) editSec.style.display = 'block';
                        const pillLabel = document.getElementById('pwd-pill-label');
                        if (pillLabel) pillLabel.textContent = '🛡️ Admin (รหัสผ่าน)';
                    }
                })
                .catch(e => console.log('Fetch passwords:', e));
        }

        function verifyAdminAndUnlock() {
            const input = document.getElementById('modal-input-verify-admin');
            const err = document.getElementById('pwd-verify-error');
            const val = input ? input.value.trim() : '';
            if (!val) {
                if (err) { err.textContent = '❌ กรุณากรอกรหัสผ่าน Admin'; err.style.display = 'block'; }
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
                    document.getElementById('pwd-edit-fields-section').style.display = 'block';
                    fetchPasswords();
                    setTimeout(() => { window.location.reload(); }, 1500);
                } else {
                    if (err) { err.textContent = '❌ รหัสผ่าน Admin ไม่ถูกต้อง'; err.style.display = 'block'; }
                }
            })
            .catch(e => {
                if (err) { err.textContent = '❌ รหัสผ่าน Admin ไม่ถูกต้อง'; err.style.display = 'block'; }
            });
        }

        function submitAdminPasswords() {
            const adminVal = document.getElementById('modal-input-admin-pwd').value.trim();
            const memberVal = document.getElementById('modal-input-member-pwd').value.trim();
            const alertBox = document.getElementById('pwd-alert-box');
            const saveBtn = document.getElementById('btn-modal-save-pwd');

            if (adminVal.length < 8 || memberVal.length < 8) {
                alertBox.className = 'pwd-alert error';
                alertBox.textContent = '❌ รหัสผ่านทั้งสองต้องมีความยาวอย่างน้อย 8 ตัวอักษร';
                return;
            }

            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span>⏳ กำลังบันทึก...</span>';

            fetch('/api/settings/passwords', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    adminPassword: adminVal,
                    memberPassword: memberVal
                })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alertBox.className = 'pwd-alert success';
                    alertBox.textContent = '✅ ' + (data.message || 'บันทึกรหัสผ่านใหม่เรียบร้อยแล้ว!');
                    setTimeout(() => {
                        closeAdminPwdModal();
                    }, 1200);
                } else {
                    alertBox.className = 'pwd-alert error';
                    alertBox.textContent = '❌ ' + (data.message || 'เกิดข้อผิดพลาดในการบันทึก');
                }
            })
            .catch(err => {
                alertBox.className = 'pwd-alert error';
                alertBox.textContent = '❌ การเชื่อมต่อล้มเหลว: ' + err.message;
            })
            .finally(() => {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<span>💾 บันทึกรหัสผ่านใหม่</span>';
            });
        }

        // Expose functions on window for React and global buttons
        window.openAdminPwdModal = openAdminPwdModal;
        window.closeAdminPwdModal = closeAdminPwdModal;
        window.togglePwdVisibility = togglePwdVisibility;
        window.verifyAdminAndUnlock = verifyAdminAndUnlock;
        window.submitAdminPasswords = submitAdminPasswords;

        // Close on clicking backdrop
        document.addEventListener('click', function(e) {
            const modal = document.getElementById('admin-pwd-modal');
            if (modal && e.target === modal) closeAdminPwdModal();
        });

        // Close on Escape
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeAdminPwdModal();
        });

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
    `;
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
        <script type="module" src="/build/assets/app-CTdHufbH.js"></script>
    </head>
    <body class="font-sans antialiased">
        <div class="browser-shell">
            <div id="app" data-page="${jsonStr}"></div>
        </div>
        ${adminPasswordSnippet}
        <!-- App Top Status Bar: Firebase & Version -->
        <style>
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
        </style>
        <div id="top-floating-status-bar">
            <span id="header-firebase-status-badge" class="firebase-mini-badge" title="Firebase Connecting — กำลังเชื่อมต่อ Firebase" aria-label="Firebase Connecting — กำลังเชื่อมต่อ Firebase">
                <span aria-hidden="true">☁️</span>
            </span>
            <span id="header-version-control" class="app-version-badge" title="Version ${APP_VERSION} — เวอร์ชัน ${APP_VERSION}" aria-label="Version ${APP_VERSION} — เวอร์ชัน ${APP_VERSION}">
                <span aria-hidden="true">ⓥ</span>
            </span>
        </div>
        <script>
            (function setupFirebaseBadge() {
                function updateFbBadge() {
                    const fbBadge = document.getElementById('header-firebase-status-badge');
                    if (!fbBadge) return;
                    fetch('/api/firebase-status')
                        .then(r => r.json())
                        .then(st => {
                            if (st.connected) {
                                fbBadge.innerHTML = '<span aria-hidden="true">☁️</span>';
                                fbBadge.title = 'Firebase Connected — เชื่อมต่อ Firebase แล้ว';
                                fbBadge.setAttribute('aria-label', fbBadge.title);
                                fbBadge.dataset.status = 'connected';
                            } else {
                                fbBadge.innerHTML = '<span aria-hidden="true">☁️</span>';
                                fbBadge.title = 'Firebase Offline — Firebase ออฟไลน์';
                                fbBadge.setAttribute('aria-label', fbBadge.title);
                                fbBadge.dataset.status = 'offline';
                            }
                        }).catch(() => {});
                }
                const fbBadge = document.getElementById('header-firebase-status-badge');
                if (fbBadge) {
                    fbBadge.onclick = function() {
                        fetch('/api/firebase-status')
                            .then(r => r.json())
                            .then(st => {
                                if (st.connected) {
                                    alert('✅ [Firebase Realtime Database]\\nStatus: Connected & Live Synced\\n\\nProject ID: ' + st.projectId + '\\nRegion: Singapore (asia-southeast1)\\nDatabase URL: ' + st.databaseURL + '\\nTotal Bosses in Cloud: ' + st.totalBosses);
                                } else {
                                    alert('⚠️ [Firebase Realtime Database]\\nStatus: Offline (Local Mode)\\nKey: serviceAccountKey.json not detected\\n\\nTo connect cloud database:\\n1. Download serviceAccountKey.json from Firebase Console\\n2. Place it into server/serviceAccountKey.json');
                                }
                            }).catch(err => alert('Error: ' + err.message));
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

    return {
        errors: {},
        name: settings.serverName || '#Kain7',
        auth: {
            user: {
                id: isAdmin ? 1 : 2,
                name: isAdmin ? 'admin' : 'kain7',
                email: isAdmin ? 'admin@boss.local' : 'member@boss.local',
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

    if (user === 'admin') {
        if (isAdminPass) {
            sessionRole = 'admin';
        } else {
            errorMessage = 'รหัสผ่าน Admin ไม่ถูกต้อง';
        }
    } else if (user === 'kain7' || user === 'member') {
        if (isMemberPass) {
            sessionRole = 'member';
        } else if (isAdminPass) {
            // Admin password also lets into admin mode even if on member tab
            sessionRole = 'admin';
        } else {
            errorMessage = 'รหัสผ่าน Member ไม่ถูกต้อง';
        }
    } else {
        if (isAdminPass) {
            sessionRole = 'admin';
        } else if (isMemberPass) {
            sessionRole = 'member';
        } else {
            errorMessage = 'รหัสผ่านไม่ถูกต้อง';
        }
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

    const sessionVal = createSession(sessionRole);
    const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', [
        `boss_session=${sessionVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`,
        `remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=${sessionVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`
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
        resetTimeConfigs: db.getResetConfigs(),
        savedMaintenanceEndTime: db.getSavedMaintenanceEndTime() || null,
        forceReloadAt: forceReloadAt,
        liveEvent: db.getLiveEvent(),
        recentLiveEvents: db.getRecentLiveEvents(),
        serverTime: Date.now(),
        dataRevision: db.getDataRevision(),
        source: 'firebase',
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
        source: db.isCloudDataReady() ? 'firebase' : 'local-fallback',
        stale: !db.isCloudDataReady()
    });
});

// ==========================================================
// BOSS ACTIONS
// ==========================================================

// Member/admin alert: explicit start with a short expiry (never toggle off by accident).
app.post('/bosses/:id/notify', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const boss = db.getBoss(id);
    if (!boss) return res.status(404).json({ success: false, message: 'Boss not found' });
    const now = Date.now();
    const previousExpiry = new Date(boss.pre_spawn_expires_at || 0).getTime();
    if (boss.pre_spawned && previousExpiry > now) {
        return res.status(429).json({ success: false, message: 'Alert already sent', retryAfterMs: previousExpiry - now });
    }

    // One-time migration: keep the same password while removing plaintext and
    // legacy SHA-256 storage from Firebase after a successful login.
    const passwordKey = sessionRole === 'admin' ? 'adminPassword' : 'memberPassword';
    const hashKey = sessionRole === 'admin' ? 'adminPasswordHash' : 'memberPasswordHash';
    if (settings[passwordKey] || !String(settings[hashKey] || '').startsWith('scrypt$')) {
        await db.updateSettings({ [passwordKey]: null, [hashKey]: hashPassword(pass) });
    }
    const updated = await db.updateBoss(id, {
        pre_spawned: true,
        pre_spawn_expires_at: new Date(now + 15000).toISOString(),
        pinned_alive: false,
        alerted_by: getSessionRole(req)
    });
    return res.json({ success: true, boss: updated });
});

// POST /bosses -> Create boss
app.post('/bosses', requireAdmin, async (req, res) => {
    const { name, location, interval, chance_of_appearing, chanceOfAppearing, is_invasion, isInvasion, last_kill_time } = req.body;
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
            updates.pre_spawned = false;
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
                updates.pre_spawned = false;
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
        updates.pre_spawned = false;
    } else if (body.still_alive) {
        updates.pinned_alive = !boss.pinned_alive;
        if (updates.pinned_alive) updates.pre_spawned = false;
    } else if (body.toggle_pre_spawned) {
        updates.pre_spawned = !boss.pre_spawned;
        if (updates.pre_spawned) updates.pinned_alive = false;
    } else if (body.toggle_maintenance) {
        updates.post_maintenance = !boss.post_maintenance;
    } else if (body.adjust_spawn_minutes !== undefined) {
        const spawnMinutes = Number(body.adjust_spawn_minutes);
        const spawnDate = new Date(Date.now() + spawnMinutes * 60000);
        updates.next_spawn = spawnDate.toISOString();
        updates.last_kill_time = new Date(spawnDate.getTime() - (boss.interval || 60) * 60000).toISOString();
        updates.pinned_alive = false;
        updates.auto_advanced = false;
        updates.pre_spawned = false;
    } else if (body.unset_kill_time) {
        updates.last_kill_time = null;
        updates.next_spawn = null;
        updates.pinned_alive = false;
        updates.auto_advanced = false;
        updates.post_maintenance = false;
        updates.pre_spawned = false;
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
                }
            }
        }
        const chanceVal = body.chance_of_appearing !== undefined ? body.chance_of_appearing : body.chanceOfAppearing;
        if (chanceVal !== undefined) updates.chance_of_appearing = String(chanceVal);
        const isInvVal = body.is_invasion !== undefined ? body.is_invasion : body.isInvasion;
        if (isInvVal !== undefined) updates.is_invasion = Boolean(isInvVal);
    }

    await db.updateBoss(id, updates);
    return respondInertiaOrRedirect(req, res, '/');
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
                pre_spawned: false
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
                    pre_spawned: false
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
                pre_spawned: false
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
            await db.updateEvent(id, {
                event_time: body.occurrence_time || event.event_time,
                name: body.occurrence_name || event.name
            });
        } else if (body.name) {
            await db.updateEvent(id, {
                name: body.name,
                location: body.location || '',
                event_time: body.event_time,
                occurs_on: body.occurs_on,
                auto_done_minutes: body.auto_done_minutes !== undefined ? Number(body.auto_done_minutes) : (event.auto_done_minutes || 10)
            });
        }
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /events
app.post('/events', requireAdmin, async (req, res) => {
    await db.createEvent({
        name: req.body.name,
        location: req.body.location || '',
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
