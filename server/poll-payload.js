const crypto = require('crypto');

// Tag of everything in a poll payload except the clock. It is computed from content, not from
// instance memory, so any Vercel instance gives the same tag for the same state.
function pollTag(payload) {
    return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

function pollReply(payload, clientTag, serverTime) {
    const tag = pollTag(payload);
    if (clientTag && clientTag === tag) {
        return { unchanged: true, pollTag: tag, serverTime, dataRevision: payload.dataRevision, stale: false };
    }
    return { ...payload, pollTag: tag, serverTime };
}

module.exports = { pollTag, pollReply };
