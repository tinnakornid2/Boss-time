require('./helpers/isolated-data');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installAlertAudioQueue } = require('../public/js/alert-audio-queue');

class FakeAudio {
    constructor(src) {
        this.tagName = 'AUDIO';
        this.src = src;
        this.paused = true;
        this.listeners = new Map();
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    removeEventListener(type) { this.listeners.delete(type); }
    emit(type) { this.listeners.get(type)?.(); }
    play() {
        if (FakeAudio.failNext) {
            FakeAudio.failNext = false;
            return Promise.reject(new Error('playback blocked'));
        }
        if (FakeAudio.suppressNext) {
            FakeAudio.suppressNext = false;
            return Promise.resolve();
        }
        this.paused = false;
        FakeAudio.started.push(this.src);
        return Promise.resolve();
    }
    pause() { this.paused = true; this.emit('pause'); }
    end() { this.paused = true; this.emit('ended'); }
}
FakeAudio.started = [];
FakeAudio.failNext = false;
FakeAudio.suppressNext = false;

test('simultaneous boss sounds play sequentially after the previous clip ends', async () => {
    FakeAudio.started = [];
    installAlertAudioQueue({
        mediaPrototype: FakeAudio.prototype,
        baseUrl: 'https://boss-time-eloni.vercel.app/',
        paths: ['/alert.mp3', '/just-spawned.mp3']
    });
    const first = new FakeAudio('https://boss-time-eloni.vercel.app/alert.mp3');
    const second = new FakeAudio('https://boss-time-eloni.vercel.app/just-spawned.mp3');
    const firstStarted = first.play();
    const secondStarted = second.play();
    await firstStarted;
    assert.deepEqual(FakeAudio.started, [first.src]);
    first.end();
    await secondStarted;
    assert.deepEqual(FakeAudio.started, [first.src, second.src]);
    second.end();
});

test('non-alert audio bypasses the alert queue', async () => {
    FakeAudio.started = [];
    const first = new FakeAudio('https://boss-time-eloni.vercel.app/alert.mp3');
    const unrelated = new FakeAudio('https://boss-time-eloni.vercel.app/notification.mp3');
    const firstStarted = first.play();
    const unrelatedStarted = unrelated.play();
    await Promise.all([firstStarted, unrelatedStarted]);
    assert.deepEqual(FakeAudio.started, [first.src, unrelated.src]);
    first.end();
});

test('blocked and intentionally suppressed playback never stalls later alerts', async () => {
    FakeAudio.started = [];
    FakeAudio.failNext = true;
    const blocked = new FakeAudio('https://boss-time-eloni.vercel.app/alert.mp3');
    const next = new FakeAudio('https://boss-time-eloni.vercel.app/just-spawned.mp3');
    const rejected = blocked.play();
    const nextStarted = next.play();
    await assert.rejects(rejected, /playback blocked/);
    await nextStarted;
    assert.deepEqual(FakeAudio.started, [next.src]);
    next.end();

    FakeAudio.started = [];
    FakeAudio.suppressNext = true;
    const suppressed = new FakeAudio('https://boss-time-eloni.vercel.app/alert.mp3');
    const following = new FakeAudio('https://boss-time-eloni.vercel.app/just-spawned.mp3');
    await suppressed.play();
    await following.play();
    assert.deepEqual(FakeAudio.started, [following.src]);
    following.end();
});

test('the visible React dashboard owns boss audio and the bridge keeps hidden-page audio', () => {
    const alerts = fs.readFileSync(path.join(__dirname, '../public/js/realtime-alerts.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
    assert.match(server, /alert-audio-queue\.js[\s\S]*realtime-alerts\.js/);
    assert.match(alerts, /BossTrackerAudioQueue\?\.installAlertAudioQueue\(/);
    assert.match(alerts, /const handledByDashboard = kind === 'boss' && !isCoveredOrBlurred && document\.visibilityState === 'visible'/);
    assert.match(alerts, /if \(document\.visibilityState !== 'visible' \|\| !document\.hasFocus\(\) \|\| window\.electronAPI\) \{/);
});
