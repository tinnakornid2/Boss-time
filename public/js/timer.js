/* ==========================================================
   TIMER & DATA FORMATTING ENGINE
   Lineage 2 Boss Tracker
   ========================================================== */

const TimerEngine = {
    // Format milliseconds into HH:MM:SS
    formatCountdown(ms) {
        if (ms === null || ms === undefined || isNaN(ms)) return '--:--:--';
        const isNegative = ms < 0;
        const absMs = Math.abs(ms);

        const totalSec = Math.floor(absMs / 1000);
        const hours = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;

        const pad = (n) => String(n).padStart(2, '0');
        const str = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
        return isNegative ? `-${str}` : str;
    },

    // Format ISO string to local time HH:MM:SS
    formatLocalTime(isoStr) {
        if (!isoStr) return '--:--:--';
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '--:--:--';
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    },

    // Format ISO string to Date + Time
    formatDateTime(isoStr) {
        if (!isoStr) return '-';
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '-';
        const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        return `${date} ${time}`;
    },

    // Format interval minutes to Xh Ym
    formatInterval(minutes) {
        const mins = Number(minutes) || 0;
        if (mins === 0) return 'Scheduled';
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        if (m === 0) return `${h}h`;
        return `${h}h ${m}m`;
    },

    // Categorize bosses for the UI
    categorizeBosses(bosses, nowMs = Date.now(), spawnWindowMs = 300000) {
        const justSpawned = [];
        const preSpawned = [];
        const upcoming = [];
        const overdue = [];

        for (const boss of bosses) {
            // Pinned alive always goes to Just Spawned
            if (boss.pinned_alive) {
                justSpawned.push(boss);
                continue;
            }

            // Pre-spawned boss
            if (boss.pre_spawned) {
                preSpawned.push(boss);
                continue;
            }

            if (!boss.next_spawn) {
                overdue.push(boss);
                continue;
            }

            const spawnMs = new Date(boss.next_spawn).getTime();
            const diff = spawnMs - nowMs;

            if (diff <= 0) {
                const elapsed = -diff;
                // Within 5 min window (300,000 ms) -> Just Spawned
                if (elapsed <= spawnWindowMs) {
                    justSpawned.push(boss);
                } else {
                    overdue.push(boss);
                }
            } else {
                upcoming.push(boss);
            }
        }

        // Sort upcoming by remaining time ascending
        upcoming.sort((a, b) => {
            const timeA = new Date(a.next_spawn).getTime();
            const timeB = new Date(b.next_spawn).getTime();
            return timeA - timeB;
        });

        // Sort justSpawned by pinned first, then nearest
        justSpawned.sort((a, b) => {
            if (a.pinned_alive && !b.pinned_alive) return -1;
            if (!a.pinned_alive && b.pinned_alive) return 1;
            const timeA = a.next_spawn ? new Date(a.next_spawn).getTime() : 0;
            const timeB = b.next_spawn ? new Date(b.next_spawn).getTime() : 0;
            return timeB - timeA;
        });

        // Sort overdue by most recently passed
        overdue.sort((a, b) => {
            const timeA = a.next_spawn ? new Date(a.next_spawn).getTime() : 0;
            const timeB = b.next_spawn ? new Date(b.next_spawn).getTime() : 0;
            return timeB - timeA;
        });

        return {
            justSpawned,
            preSpawned,
            upcoming,
            overdue,
            mainList: [...upcoming, ...overdue]
        };
    }
};

window.TimerEngine = TimerEngine;
