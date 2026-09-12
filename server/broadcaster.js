const { WebSocketServer } = require('ws');

let wss = null;

function init(server) {
    wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws, req) => {
        // Send initial heartbeat
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('message', (msg) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                }
            } catch (e) {}
        });
    });

    // Heartbeat ping interval
    const interval = setInterval(() => {
        if (!wss) return;
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => clearInterval(interval));
    console.log('WebSocket server initialized on /ws');
}

function broadcast(event, payload) {
    if (!wss) return;
    const message = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // OPEN
            client.send(message);
        }
    });
}

module.exports = {
    init,
    broadcast
};
