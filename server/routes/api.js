const express = require('express');
const router = express.Router();
const db = require('../db');

// /api/v1/time-bosses
router.get('/time-bosses', (req, res) => {
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

module.exports = router;
