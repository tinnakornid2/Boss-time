const express = require('express');
const router = express.Router();
const db = require('../db');
const broadcaster = require('../broadcaster');
const { authMiddleware } = require('./auth');

// Format ISO string to local or standard ISO
function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
}

function subMinutes(date, minutes) {
    return new Date(date.getTime() - minutes * 60000);
}

// GET all bosses and related data
router.get('/', (req, res) => {
    res.json({
        bosses: db.getBosses(),
        events: db.getEvents(),
        resetTimeConfigs: db.getResetConfigs(),
        settings: db.getSettings(),
        savedMaintenanceEndTime: db.getSavedMaintenanceEndTime()
    });
});

// POST create new boss
router.post('/', authMiddleware, (req, res) => {
    const { name, location, interval, chance_of_appearing, is_invasion, next_spawn, last_kill_time } = req.body;
    if (!name) {
        return res.status(422).json({ error: 'Boss name is required' });
    }

    const intervalMinutes = Number(interval) || 60;
    let spawnTime = next_spawn || null;
    let killTime = last_kill_time || null;

    if (killTime && !spawnTime) {
        spawnTime = addMinutes(new Date(killTime), intervalMinutes).toISOString();
    } else if (spawnTime && !killTime) {
        killTime = subMinutes(new Date(spawnTime), intervalMinutes).toISOString();
    }

    const newBoss = db.createBoss({
        name,
        location,
        interval: intervalMinutes,
        chance_of_appearing: chance_of_appearing || '100.00',
        is_invasion: Boolean(is_invasion),
        last_kill_time: killTime,
        next_spawn: spawnTime
    });

    broadcaster.broadcast('boss:created', newBoss);
    res.json({ success: true, boss: newBoss });
});

// PUT edit boss details
router.put('/:id', authMiddleware, (req, res) => {
    const id = req.params.id;
    const boss = db.getBoss(id);
    if (!boss) return res.status(404).json({ error: 'Boss not found' });

    const { name, location, interval, chance_of_appearing, is_invasion } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (location !== undefined) updates.location = location;
    if (interval !== undefined) updates.interval = Number(interval) || 60;
    if (chance_of_appearing !== undefined) updates.chance_of_appearing = String(chance_of_appearing);
    if (is_invasion !== undefined) updates.is_invasion = Boolean(is_invasion);

    const updated = db.updateBoss(id, updates);
    broadcaster.broadcast('boss:updated', updated);
    res.json({ success: true, boss: updated });
});

// DELETE boss
router.delete('/:id', authMiddleware, (req, res) => {
    const id = req.params.id;
    const success = db.deleteBoss(id);
    if (!success) return res.status(404).json({ error: 'Boss not found' });

    broadcaster.broadcast('boss:deleted', { id: Number(id) });
    res.json({ success: true });
});

// POST record kill or spawn
router.post('/:id/kill', (req, res) => {
    const id = req.params.id;
    const boss = db.getBoss(id);
    if (!boss) return res.status(404).json({ error: 'Boss not found' });

    const { mode, time, reporter } = req.body;
    let killDate = new Date();
    let spawnDate = new Date();

    if (mode === 'spawn' && time) {
        // User entered spawn time directly
        spawnDate = new Date(time);
        killDate = subMinutes(spawnDate, boss.interval);
    } else if (mode === 'kill' && time) {
        // User entered custom kill time
        killDate = new Date(time);
        spawnDate = addMinutes(killDate, boss.interval);
    } else {
        // Mode 'now' or default instant kill
        killDate = new Date();
        spawnDate = addMinutes(killDate, boss.interval);
    }

    const updates = {
        last_kill_time: killDate.toISOString(),
        next_spawn: spawnDate.toISOString(),
        pinned_alive: false,
        auto_advanced: false,
        post_maintenance: false,
        pre_spawned: false
    };

    const updated = db.updateBoss(id, updates);

    // Record to history
    db.addKillHistory({
        boss_id: boss.id,
        boss_name: boss.name,
        is_invasion: boss.is_invasion,
        killed_at: killDate.toISOString(),
        next_spawn: spawnDate.toISOString(),
        reporter: reporter || 'Anonymous'
    });

    broadcaster.broadcast('boss:killed', updated);
    res.json({ success: true, boss: updated });
});

// POST advance spawn time (skip missed 50% spawn)
router.post('/:id/advance', (req, res) => {
    const id = req.params.id;
    const boss = db.getBoss(id);
    if (!boss) return res.status(404).json({ error: 'Boss not found' });

    let currentNext = boss.next_spawn ? new Date(boss.next_spawn) : new Date();
    // If currentNext is in the past, add interval until it's in the future or add 1 interval
    let advancedNext = addMinutes(currentNext, boss.interval);
    if (advancedNext.getTime() < Date.now()) {
        advancedNext = addMinutes(new Date(), boss.interval);
    }

    const updates = {
        next_spawn: advancedNext.toISOString(),
        auto_advanced: true,
        pinned_alive: false,
        pre_spawned: false
    };

    const updated = db.updateBoss(id, updates);
    broadcaster.broadcast('boss:updated', updated);
    res.json({ success: true, boss: updated });
});

// POST toggle pinned alive
router.post('/:id/pin', (req, res) => {
    const id = req.params.id;
    const boss = db.getBoss(id);
    if (!boss) return res.status(404).json({ error: 'Boss not found' });

    const newPinned = !boss.pinned_alive;
    const updates = { pinned_alive: newPinned };
    if (newPinned) updates.pre_spawned = false;

    const updated = db.updateBoss(id, updates);
    broadcaster.broadcast('boss:updated', updated);
    res.json({ success: true, boss: updated });
});

// POST toggle pre-spawned
router.post('/:id/pre-spawn', (req, res) => {
    const id = req.params.id;
    const boss = db.getBoss(id);
    if (!boss) return res.status(404).json({ error: 'Boss not found' });

    const newPre = !boss.pre_spawned;
    const updates = { pre_spawned: newPre };
    if (newPre) updates.pinned_alive = false;

    const updated = db.updateBoss(id, updates);
    broadcaster.broadcast('boss:updated', updated);
    res.json({ success: true, boss: updated });
});

// POST toggle post maintenance
router.post('/:id/post-maintenance', (req, res) => {
    const id = req.params.id;
    const boss = db.getBoss(id);
    if (!boss) return res.status(404).json({ error: 'Boss not found' });

    const updated = db.updateBoss(id, { post_maintenance: !boss.post_maintenance });
    broadcaster.broadcast('boss:updated', updated);
    res.json({ success: true, boss: updated });
});

// POST reset invasion boss kill times
router.post('/reset-invasion-kill-times', authMiddleware, (req, res) => {
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
    broadcaster.broadcast('bosses:reload', { reason: 'invasion_reset' });
    res.json({ success: true, message: 'All invasion bosses reset' });
});

module.exports = router;
