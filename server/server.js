const http = require('http');
const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const INERTIA_VERSION = '55c7f37e0516ec0f9ab5340e89e90c20';

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logger
app.use((req, res, next) => {
    console.log(`[REQ] ${req.method} ${req.url} (Inertia: ${req.headers['x-inertia'] || 'no'}) Body: ${JSON.stringify(req.body)}`);
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

// Helper: Escape HTML for data-page attribute
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Helper: HTML page wrapper matching boss.kain7.com exactly
function renderHtml(pageData, title = '#Kain7') {
    const jsonStr = escapeHtml(JSON.stringify(pageData));
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
                const isMaxDesktop = window.maxDesktop?.runtime === 'max';
                if ('__TAURI_INTERNALS__' in window) {
                    document.documentElement.classList.add('tauri');
                    document.documentElement.classList.add('desktop');
                }
                if (isMaxDesktop) {
                    document.documentElement.classList.add('max');
                    document.documentElement.classList.add('desktop');
                }
            })();
        </script>
        <style>
            html, body, #app {
                margin: 0;
                padding: 0;
                height: 100%;
                overflow: hidden;
            }
            html.desktop,
            html.desktop body,
            html.desktop #app,
            html.desktop .browser-shell,
            html.desktop .browser-shell > * {
                background: transparent !important;
            }
        </style>
        <title inertia>${title}</title>
        <meta name="theme-color" content="#000000">
        <meta name="mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
        <meta name="apple-mobile-web-app-title" content="BossTracker">
        <link rel="apple-touch-icon" href="/favicon.png">
        <link rel="icon" href="/favicon.png" sizes="any" type="image/png">
        <link rel="preconnect" href="https://fonts.bunny.net">
        <link href="https://fonts.bunny.net/css?family=instrument-sans:400,500,600" rel="stylesheet" />
        <link rel="preload" as="style" href="/build/assets/app-DIKwFrKw.css" />
        <link rel="modulepreload" as="script" href="/build/assets/app-CTdHufbH.js" />
        <link rel="stylesheet" href="/build/assets/app-DIKwFrKw.css" />
        <script type="module" src="/build/assets/app-CTdHufbH.js"></script>
    </head>
    <body class="font-sans antialiased">
        <div class="browser-shell">
            <div id="app" data-page="${jsonStr}"></div>
        </div>
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
    const sess = req.cookies['boss_session'] || req.cookies['remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d'];
    return Boolean(sess);
}

function getSessionRole(req) {
    const sess = req.cookies['boss_session'] || req.cookies['remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d'] || '';
    if (sess.includes('member')) return 'member';
    return 'admin';
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
                id: 1,
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
        savedMaintenanceEndTime: db.getSavedMaintenanceEndTime() || null
    };
}

// ==========================================================
// INERTIA PAGE ROUTES
// ==========================================================

// GET / or /dashboard -> Dashboard
app.all(['/', '/dashboard'], (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(405).end();
    }
    if (!isAuthenticated(req)) {
        return res.redirect('/login');
    }
    sendInertia(req, res, 'dashboard', getDashboardProps(req), '/');
});

// GET /login -> Login Form
app.get('/login', (req, res) => {
    if (isAuthenticated(req)) {
        return res.redirect('/');
    }
    const props = {
        errors: {},
        name: db.getSettings().serverName || '#Kain7',
        auth: { user: null },
        sidebarOpen: true,
        status: null
    };
    sendInertia(req, res, 'auth/login', props, '/login');
});

// POST /login -> Authenticate (Accepts both admin and member tabs)
app.post('/login', (req, res) => {
    const { name, username, password } = req.body;
    const user = (name || username || '').trim().toLowerCase();
    const pass = (password || '').trim();

    // Check credentials:
    // If password is lindvior999 (default admin password) -> grant admin!
    // If user selected member or entered kain7 -> grant member access!
    const isAdmin = pass === 'lindvior999' || user === 'admin';
    const isMember = user === 'kain7' || user === 'member' || pass === 'kain7';

    if (pass === 'lindvior999' || isAdmin || isMember) {
        const sessionRole = (pass === 'lindvior999' || user === 'admin') ? 'admin' : 'member';
        const sessionVal = `authenticated_${sessionRole}_session`;
        res.setHeader('Set-Cookie', [
            `boss_session=${sessionVal}; Path=/; HttpOnly; SameSite=Lax`,
            `remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=${sessionVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
        ]);
        return res.redirect(303, '/');
    }

    // Invalid credentials
    const errors = { password: 'These credentials do not match our records.' };
    if (req.headers['x-inertia']) {
        res.setHeader('X-Inertia', 'true');
        return res.status(422).json({
            component: 'auth/login',
            props: {
                errors,
                name: db.getSettings().serverName || '#Kain7',
                auth: { user: null },
                sidebarOpen: true,
                status: null
            },
            url: '/login',
            version: INERTIA_VERSION
        });
    }

    res.redirect('/login');
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

let forceReloadAt = null;

// GET /poll -> Real-time polling
app.get('/poll', (req, res) => {
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
        forceReloadAt: forceReloadAt
    });
});

// ==========================================================
// BOSS ACTIONS
// ==========================================================

// POST /bosses -> Create boss
app.post('/bosses', (req, res) => {
    const { name, location, interval, chance_of_appearing, chanceOfAppearing, is_invasion, isInvasion, last_kill_time } = req.body;
    let intervalMinutes = 60;
    if (typeof interval === 'string' && interval.includes(':')) {
        const [h, m] = interval.split(':').map(Number);
        intervalMinutes = (h || 0) * 60 + (m || 0);
    } else {
        intervalMinutes = Number(interval) || 60;
    }

    let spawnTime = null;
    let killTime = last_kill_time || null;
    if (killTime) {
        spawnTime = new Date(new Date(killTime).getTime() + intervalMinutes * 60000).toISOString();
    }

    const isInvasionVal = is_invasion !== undefined ? is_invasion : isInvasion;
    const chanceVal = chance_of_appearing !== undefined ? chance_of_appearing : (chanceOfAppearing || '100.00');

    db.createBoss({
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
app.put('/bosses/:id', (req, res) => {
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
                const spawnDate = new Date(killDate.getTime() + intervalMinutes * 60000);
                updates.last_kill_time = killDate.toISOString();
                updates.next_spawn = spawnDate.toISOString();
                updates.pinned_alive = false;
                updates.auto_advanced = false;
                updates.post_maintenance = false;
                updates.pre_spawned = false;
            }
        }
    } else if (body.not_spawned) {
        let currentNext = boss.next_spawn ? new Date(boss.next_spawn) : new Date();
        let advanced = new Date(currentNext.getTime() + (boss.interval || 60) * 60000);
        if (advanced.getTime() < Date.now()) {
            advanced = new Date(Date.now() + (boss.interval || 60) * 60000);
        }
        updates.next_spawn = advanced.toISOString();
        updates.last_kill_time = new Date(advanced.getTime() - (boss.interval || 60) * 60000).toISOString();
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

    db.updateBoss(id, updates);
    return respondInertiaOrRedirect(req, res, '/');
});

// DELETE /bosses/:id -> Delete boss
app.delete('/bosses/:id', (req, res) => {
    db.deleteBoss(Number(req.params.id));
    return respondInertiaOrRedirect(req, res, '/');
});

// PUT /settings/invasion-visibility
app.put('/settings/invasion-visibility', (req, res) => {
    const hide = req.body.hide_invasion_bosses !== undefined
        ? req.body.hide_invasion_bosses
        : req.body.hideInvasionBosses;
    db.updateSettings({ hideInvasionBosses: Boolean(hide) });
    return respondInertiaOrRedirect(req, res, '/');
});

// PUT /settings/invasion-label
app.put('/settings/invasion-label', (req, res) => {
    const label = req.body.invasion_label !== undefined ? req.body.invasion_label : req.body.invasionLabel;
    db.updateSettings({ invasionLabel: label || 'L3' });
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/reset-invasion-kill-times
app.post('/bosses/reset-invasion-kill-times', (req, res) => {
    const bosses = db.getBosses();
    for (const b of bosses) {
        if (b.is_invasion) {
            db.updateBoss(b.id, {
                last_kill_time: null,
                next_spawn: null,
                pinned_alive: false,
                auto_advanced: false,
                post_maintenance: false,
                pre_spawned: false
            });
        }
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/apply-reset-boss-time
app.post('/bosses/apply-reset-boss-time', (req, res) => {
    const { maintenance_end_time, configs } = req.body;
    if (maintenance_end_time) {
        const baseDate = new Date(maintenance_end_time);
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

        const bosses = db.getBosses();
        for (const boss of bosses) {
            const conf = configsMap[boss.name] || db.getResetConfigs()[boss.name];
            if (conf) {
                const offsetMinutes = (Number(conf.hours) || 0) * 60 + (Number(conf.minutes) || 0);
                const nextSpawn = new Date(baseDate.getTime() + offsetMinutes * 60000);
                const lastKill = new Date(nextSpawn.getTime() - (boss.interval || 60) * 60000);

                db.updateBoss(boss.id, {
                    next_spawn: nextSpawn.toISOString(),
                    last_kill_time: lastKill.toISOString(),
                    post_maintenance: true,
                    pinned_alive: false,
                    auto_advanced: false,
                    pre_spawned: false
                });
            }
        }
        db.setSavedMaintenanceEndTime(baseDate.toISOString());
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/save-reset-boss-config
app.post('/bosses/save-reset-boss-config', (req, res) => {
    const { configs, resetTimeConfigs } = req.body;
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
        db.saveResetConfigs(configsMap);
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/post-maintenance-mode
app.post('/bosses/post-maintenance-mode', (req, res) => {
    const bosses = db.getBosses();
    for (const b of bosses) {
        if (b.next_spawn) {
            db.updateBoss(b.id, { post_maintenance: true });
        }
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/cancel-maintenance-mode
app.post('/bosses/cancel-maintenance-mode', (req, res) => {
    const bosses = db.getBosses();
    for (const b of bosses) {
        if (b.post_maintenance) {
            db.updateBoss(b.id, { post_maintenance: false });
        }
    }
    db.setSavedMaintenanceEndTime(null);
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /bosses/reset-maintenance-kill-times
app.post('/bosses/reset-maintenance-kill-times', (req, res) => {
    const bosses = db.getBosses();
    for (const b of bosses) {
        if (b.post_maintenance) {
            db.updateBoss(b.id, {
                last_kill_time: null,
                next_spawn: null,
                post_maintenance: false,
                pinned_alive: false,
                auto_advanced: false,
                pre_spawned: false
            });
        }
    }
    db.setSavedMaintenanceEndTime(null);
    return respondInertiaOrRedirect(req, res, '/');
});

// ==========================================================
// EVENT ACTIONS
// ==========================================================

// PUT /events/:id
app.put('/events/:id', (req, res) => {
    const id = Number(req.params.id);
    const body = req.body || {};
    const event = db.getEvent(id);
    if (event) {
        if (body.mark_done) {
            const todayStr = new Date().toISOString().split('T')[0];
            db.updateEvent(id, { done_on: todayStr, pinned_alive: false });
        } else if (body.mark_skipped) {
            db.updateEvent(id, { pinned_alive: false });
        } else if (body.pin_alive) {
            db.updateEvent(id, { pinned_alive: !event.pinned_alive });
        } else if (body.undo_exception) {
            db.updateEvent(id, { done_on: null, pinned_alive: false });
        } else if (body.edit_occurrence) {
            db.updateEvent(id, {
                event_time: body.occurrence_time || event.event_time,
                name: body.occurrence_name || event.name
            });
        } else if (body.name) {
            db.updateEvent(id, {
                name: body.name,
                location: body.location,
                event_time: body.event_time,
                occurs_on: body.occurs_on
            });
        }
    }
    return respondInertiaOrRedirect(req, res, '/');
});

// POST /events
app.post('/events', (req, res) => {
    db.createEvent({
        name: req.body.name,
        location: req.body.location || '',
        event_time: req.body.event_time || '21:00',
        occurs_on: req.body.occurs_on || ['saturday', 'sunday'],
        auto_done_minutes: Number(req.body.auto_done_minutes) || 10
    });
    return respondInertiaOrRedirect(req, res, '/');
});

// DELETE /events/:id
app.delete('/events/:id', (req, res) => {
    db.deleteEvent(Number(req.params.id));
    return respondInertiaOrRedirect(req, res, '/');
});

// ==========================================================
// ANNOUNCEMENTS
// ==========================================================
app.post('/announcement', (req, res) => {
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
    db.updateSettings({ announcement: announcementObj });
    if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers['x-inertia']) {
        return res.json({ ok: true, announcement: announcementObj });
    }
    return respondInertiaOrRedirect(req, res, '/');
});

app.post('/announcement/clear', (req, res) => {
    db.updateSettings({ announcement: null });
    if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers['x-inertia']) {
        return res.json({ ok: true });
    }
    return respondInertiaOrRedirect(req, res, '/');
});

app.post('/announcement/resend', (req, res) => {
    const settings = db.getSettings();
    if (settings.announcement) {
        settings.announcement.resent_at = new Date().toISOString();
        db.updateSettings({ announcement: settings.announcement });
    }
    if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers['x-inertia']) {
        return res.json({ ok: true });
    }
    return respondInertiaOrRedirect(req, res, '/');
});

app.post('/force-reload', (req, res) => {
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
    res.json({ ok: true, status: 'online', time: new Date().toISOString() });
});

// Firebase Status health check
app.get('/api/firebase-status', (req, res) => {
    res.json(db.getFirebaseStatus());
});

// Settings page redirects (for standard Inertia links)
app.all(['/settings/appearance', '/settings/password', '/settings/profile'], (req, res) => {
    return respondInertiaOrRedirect(req, res, '/');
});

// Start Server with auto port retry
function startServer(port = 3000) {
    const srv = http.createServer(app);
    srv.listen(port, () => {
        console.log(`================================================`);
        console.log(`⚔️  Lineage 2 Exact Clone Server running on port ${port}`);
        console.log(`🌐 Local URL: http://localhost:${port}`);
        console.log(`🛡️  Admin user: admin / lindvior999`);
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
startServer(targetPort);

