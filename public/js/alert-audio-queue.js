(function (root) {
    'use strict';

    function installAlertAudioQueue({ paths, mediaPrototype, baseUrl } = {}) {
        const prototype = mediaPrototype || root.HTMLMediaElement?.prototype;
        if (!prototype || typeof prototype.play !== 'function') return false;
        if (prototype.__bossTrackerAlertQueueInstalled) return true;

        const pageUrl = new URL(baseUrl || root.location?.href || 'http://localhost/');
        const alertPaths = new Set((paths || []).map(path => new URL(path, pageUrl).pathname));
        const nativePlay = prototype.play;
        const pending = [];
        let active = false;

        function pump() {
            if (active || pending.length === 0) return;
            active = true;
            const { media, args, resolve, reject } = pending.shift();
            let finished = false;
            const watchdog = setTimeout(() => {
                try { media.pause(); } catch (_) {}
                finish();
            }, 45000);

            function finish() {
                if (finished) return;
                finished = true;
                clearTimeout(watchdog);
                for (const type of ['ended', 'error', 'abort', 'pause']) {
                    media.removeEventListener(type, finish);
                }
                active = false;
                pump();
            }

            for (const type of ['ended', 'error', 'abort', 'pause']) {
                media.addEventListener(type, finish, { once: true });
            }
            try {
                Promise.resolve(nativePlay.apply(media, args)).then(() => {
                    resolve();
                    // Some reload guards intentionally suppress playback by resolving
                    // play() without starting the media element.
                    if (media.paused) finish();
                }, error => {
                    reject(error);
                    finish();
                });
            } catch (error) {
                reject(error);
                finish();
            }
        }

        prototype.play = function (...args) {
            if (this.tagName !== 'AUDIO') return nativePlay.apply(this, args);
            try {
                const mediaUrl = new URL(this.currentSrc || this.src, pageUrl);
                if (mediaUrl.origin !== pageUrl.origin || !alertPaths.has(mediaUrl.pathname)) {
                    return nativePlay.apply(this, args);
                }
            } catch (_) {
                return nativePlay.apply(this, args);
            }
            return new Promise((resolve, reject) => {
                pending.push({ media: this, args, resolve, reject });
                pump();
            });
        };
        Object.defineProperty(prototype, '__bossTrackerAlertQueueInstalled', { value: true });
        return true;
    }

    root.BossTrackerAudioQueue = { installAlertAudioQueue };
    if (typeof module !== 'undefined' && module.exports) module.exports = { installAlertAudioQueue };
})(typeof window !== 'undefined' ? window : globalThis);
