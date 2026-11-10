// Service worker for phone alerts only. It deliberately has no fetch handler and caches
// nothing, so the dashboard always loads live from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (_) {
        data = { body: event.data ? event.data.text() : '' };
    }
    const options = {
        body: data.body || '',
        icon: '/favicon.png',
        // Android draws the status-bar badge from alpha only: a white stencil on transparent.
        badge: '/badge.png',
        data: { url: data.url || '/' },
        timestamp: data.timestamp || Date.now()
    };
    // The same tag replaces an earlier notification instead of stacking a duplicate.
    if (data.tag) {
        options.tag = data.tag;
        options.renotify = true;
    }
    event.waitUntil(self.registration.showNotification(data.title || 'Boss Tracker', options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            if (client.url.startsWith(self.location.origin) && 'focus' in client) return client.focus();
        }
        return self.clients.openWindow(target);
    })());
});
