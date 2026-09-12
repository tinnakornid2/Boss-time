/* ==========================================================
   AUDIO SOUND ALERT ENGINE
   Lineage 2 Boss Tracker
   ========================================================== */

const SOUND_FILES = {
    alert: 'sounds/alert.mp3',
    bell: 'sounds/bell.mp3',
    flute: 'sounds/flute.mp3',
    guitar: 'sounds/guitar.mp3',
    warHorn: 'sounds/warHorn.mp3',
    levelUp: 'sounds/game.wav',
    justSpawned: 'sounds/just-spawned.mp3',
    notification: 'sounds/notification.mp3',
    pop2: 'sounds/pop2.mp3',
    call: 'sounds/call.mp3',
    ratedRSuperstar: 'sounds/rated-r.mp3',
    jokowi: 'sounds/jokowi.mp3',
    virus: 'sounds/virus.mp3',
    walls: 'sounds/walls.mp3',
    shaq: 'sounds/shaq.mp3',
    hey: 'sounds/hey.mp3',
    kaget: 'sounds/kaget.mp3',
    kontlo: 'sounds/kontlo.mp3',
    kukuku: 'sounds/kukuku.mp3',
    lawan: 'sounds/lawan.mp3',
    ultraman: 'sounds/ultraman.mp3',
    kuntilanak: 'sounds/kuntilanak.mp3'
};

class SoundManager {
    constructor() {
        this.volume = parseFloat(localStorage.getItem('dashboard.alertVolume') ?? '0.8');
        this.selectedAlertSound = localStorage.getItem('dashboard.alertSound') || 'alert';
        this.selectedSpawnSound = localStorage.getItem('dashboard.justSpawnedSound') || 'justSpawned';
        this.alertBeforeMinutes = parseInt(localStorage.getItem('dashboard.alertBeforeMinutes') ?? '5', 10);
        
        // Muted bosses set
        const savedMuted = localStorage.getItem('dashboard.mutedBossIds');
        this.mutedBosses = new Set(savedMuted ? JSON.parse(savedMuted) : []);

        this.lastPlayTime = 0;
        this.debounceMs = 4000;
        this.currentAudio = null;

        // Tracks which spawn times have already triggered an alert to avoid repeating
        this.alertedSpawns = new Map(); // bossId -> next_spawn string
        this.justSpawnedAlerted = new Map();
    }

    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, parseFloat(vol)));
        localStorage.setItem('dashboard.alertVolume', this.volume.toString());
        if (this.currentAudio) {
            this.currentAudio.volume = this.volume;
        }
    }

    setAlertSound(soundKey) {
        if (SOUND_FILES[soundKey]) {
            this.selectedAlertSound = soundKey;
            localStorage.setItem('dashboard.alertSound', soundKey);
        }
    }

    setSpawnSound(soundKey) {
        if (SOUND_FILES[soundKey]) {
            this.selectedSpawnSound = soundKey;
            localStorage.setItem('dashboard.justSpawnedSound', soundKey);
        }
    }

    setAlertBeforeMinutes(mins) {
        this.alertBeforeMinutes = parseInt(mins, 10);
        localStorage.setItem('dashboard.alertBeforeMinutes', this.alertBeforeMinutes.toString());
    }

    toggleMuteBoss(bossId) {
        const id = Number(bossId);
        if (this.mutedBosses.has(id)) {
            this.mutedBosses.delete(id);
        } else {
            this.mutedBosses.add(id);
        }
        localStorage.setItem('dashboard.mutedBossIds', JSON.stringify([...this.mutedBosses]));
        return this.mutedBosses.has(id);
    }

    isBossMuted(bossId) {
        return this.mutedBosses.has(Number(bossId));
    }

    play(soundKey) {
        const src = SOUND_FILES[soundKey] || SOUND_FILES.alert;
        if (!src) return;

        const now = Date.now();
        if (now - this.lastPlayTime < this.debounceMs) {
            return; // Debounce
        }
        this.lastPlayTime = now;

        if (this.currentAudio) {
            this.currentAudio.pause();
        }

        const audio = new Audio(src);
        audio.volume = this.volume;
        this.currentAudio = audio;
        audio.play().catch(e => {
            console.warn('Audio playback prevented by browser autoplay policy:', e);
        });
    }

    preview(soundKey) {
        const src = SOUND_FILES[soundKey] || SOUND_FILES.alert;
        if (!src) return;

        if (this.currentAudio) {
            this.currentAudio.pause();
        }
        const audio = new Audio(src);
        audio.volume = this.volume;
        this.currentAudio = audio;
        audio.play().catch(console.warn);
    }

    // Called every second by the timer loop to check if alert sound should play
    checkAlerts(bosses) {
        if (this.volume <= 0) return;
        const now = Date.now();
        const alertThresholdMs = this.alertBeforeMinutes * 60 * 1000;

        for (const boss of bosses) {
            if (this.isBossMuted(boss.id) || !boss.next_spawn) continue;

            const spawnMs = new Date(boss.next_spawn).getTime();
            const diff = spawnMs - now;

            // 1. Approaching spawn alert (e.g. 5m before)
            if (diff > 0 && diff <= alertThresholdMs) {
                const recordedSpawn = this.alertedSpawns.get(boss.id);
                if (recordedSpawn !== boss.next_spawn) {
                    this.alertedSpawns.set(boss.id, boss.next_spawn);
                    this.play(this.selectedAlertSound);
                    this.triggerDesktopNotification(boss, `⚔️ ${boss.name} spawning in ${Math.ceil(diff / 60000)}m!`);
                    break;
                }
            }

            // 2. Just Spawned alert (when boss hits 0 to -60s)
            if (diff <= 0 && diff >= -60000) {
                const recordedSpawn = this.justSpawnedAlerted.get(boss.id);
                if (recordedSpawn !== boss.next_spawn) {
                    this.justSpawnedAlerted.set(boss.id, boss.next_spawn);
                    this.play(this.selectedSpawnSound);
                    this.triggerDesktopNotification(boss, `🔥 ${boss.name} HAS SPAWNED! (${boss.location || 'Unknown Location'})`);
                    break;
                }
            }
        }
    }

    triggerDesktopNotification(boss, body) {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            try {
                new Notification('Boss Tracker', {
                    body,
                    icon: '/favicon.png'
                });
            } catch (e) {}
        }
    }

    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
}

window.soundManager = new SoundManager();
