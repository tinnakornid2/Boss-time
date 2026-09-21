const express = require('express');
const router = express.Router();
const db = require('../db');
const broadcaster = require('../broadcaster');
const { authMiddleware } = require('./auth');

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function calculateNextEventSpawn(occursOn, eventTime) {
    if (!occursOn || occursOn.length === 0 || !eventTime) return null;
    const [hours, minutes] = eventTime.split(':').map(Number);
    const now = new Date();

    const targetDays = occursOn.map(d => DAYS.indexOf(d.toLowerCase())).filter(d => d !== -1);
    if (targetDays.length === 0) return null;

    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
        const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hours, minutes, 0);
        const dayOfWeek = candidate.getDay();
        if (targetDays.includes(dayOfWeek) && candidate.getTime() > now.getTime()) {
            return candidate.toISOString();
        }
    }
    return null;
}

router.get('/', (req, res) => {
    res.json(db.getEvents());
});

router.post('/:id/done', (req, res) => {
    const id = req.params.id;
    const event = db.getEvent(id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const todayStr = new Date().toISOString().split('T')[0];
    const nextOccurrence = calculateNextEventSpawn(event.occurs_on, event.event_time);

    const updated = db.updateEvent(id, {
        done_on: todayStr,
        pinned_alive: false,
        next_spawn: nextOccurrence || event.next_spawn
    });

    broadcaster.broadcast('event:updated', updated);
    res.json({ success: true, event: updated });
});

router.post('/:id/skip', (req, res) => {
    const id = req.params.id;
    const event = db.getEvent(id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const nextOccurrence = calculateNextEventSpawn(event.occurs_on, event.event_time);
    const updated = db.updateEvent(id, {
        pinned_alive: false,
        next_spawn: nextOccurrence || event.next_spawn
    });

    broadcaster.broadcast('event:updated', updated);
    res.json({ success: true, event: updated });
});

router.post('/:id/pin', (req, res) => {
    const id = req.params.id;
    const event = db.getEvent(id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const updated = db.updateEvent(id, { pinned_alive: !event.pinned_alive });
    broadcaster.broadcast('event:updated', updated);
    res.json({ success: true, event: updated });
});

function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') return next();
    return res.status(403).json({ success: false, message: 'Admin access required' });
}

router.put('/:id/color', authMiddleware, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const event = db.getEvent(id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const color = req.body.color ? String(req.body.color).trim() : null;
    const updated = await db.updateEvent(id, { color });
    broadcaster.broadcast('event:updated', updated);
    res.json({ success: true, color, event: updated });
});

module.exports = router;

