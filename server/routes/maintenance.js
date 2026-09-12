const express = require('express');
const router = express.Router();
const db = require('../db');
const broadcaster = require('../broadcaster');
const { authMiddleware } = require('./auth');

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
}

function subMinutes(date, minutes) {
    return new Date(date.getTime() - minutes * 60000);
}

// POST apply maintenance reset times
router.post('/apply', authMiddleware, (req, res) => {
    const { maintenance_end_time } = req.body;
    if (!maintenance_end_time) {
        return res.status(422).json({ error: 'maintenance_end_time is required' });
    }

    const baseDate = new Date(maintenance_end_time);
    const configs = db.getResetConfigs();
    const bosses = db.getBosses();
    let appliedCount = 0;

    for (const boss of bosses) {
        // Find config matching boss name
        const conf = configs[boss.name];
        if (conf) {
            const offsetMinutes = (Number(conf.hours) || 0) * 60 + (Number(conf.minutes) || 0);
            const nextSpawn = addMinutes(baseDate, offsetMinutes);
            const lastKill = subMinutes(nextSpawn, boss.interval || 60);

            db.updateBoss(boss.id, {
                next_spawn: nextSpawn.toISOString(),
                last_kill_time: lastKill.toISOString(),
                post_maintenance: true,
                pinned_alive: false,
                auto_advanced: false,
                pre_spawned: false
            });
            appliedCount++;
        }
    }

    db.setSavedMaintenanceEndTime(baseDate.toISOString());
    broadcaster.broadcast('bosses:reload', { reason: 'maintenance_applied', count: appliedCount });
    res.json({ success: true, appliedCount, maintenance_end_time: baseDate.toISOString() });
});

// POST cancel maintenance mode
router.post('/cancel', authMiddleware, (req, res) => {
    const bosses = db.getBosses();
    for (const boss of bosses) {
        if (boss.post_maintenance) {
            db.updateBoss(boss.id, { post_maintenance: false });
        }
    }
    db.setSavedMaintenanceEndTime(null);
    broadcaster.broadcast('bosses:reload', { reason: 'maintenance_cancelled' });
    res.json({ success: true });
});

// POST reset maintenance kill times
router.post('/reset-kill-times', authMiddleware, (req, res) => {
    const bosses = db.getBosses();
    for (const boss of bosses) {
        if (boss.post_maintenance) {
            db.updateBoss(boss.id, {
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
    broadcaster.broadcast('bosses:reload', { reason: 'maintenance_kill_times_reset' });
    res.json({ success: true });
});

// POST save reset configs
router.post('/save-configs', authMiddleware, (req, res) => {
    const { configs } = req.body;
    if (!configs || typeof configs !== 'object') {
        return res.status(422).json({ error: 'Invalid configs object' });
    }

    const saved = db.saveResetConfigs(configs);
    broadcaster.broadcast('settings:updated', { resetTimeConfigs: saved });
    res.json({ success: true, configs: saved });
});

module.exports = router;
