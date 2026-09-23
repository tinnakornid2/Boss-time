'use strict';

function bossConfigKey(bossId) {
    const id = Number(bossId);
    return Number.isInteger(id) && id >= 0 ? `boss_${id}` : null;
}

function normalizeResetConfigs(configs) {
    if (!Array.isArray(configs)) {
        return configs && typeof configs === 'object' ? configs : {};
    }

    const result = {};
    for (const config of configs) {
        const key = bossConfigKey(config && config.boss_id)
            || (config && config.boss_name ? String(config.boss_name) : null);
        if (!key) continue;
        result[key] = {
            hours: Number(config.delay_hours) || 0,
            minutes: Number(config.delay_minutes) || 0
        };
    }
    return result;
}

function getResetConfig(configs, boss) {
    if (!configs || !boss) return null;
    const idKey = bossConfigKey(boss.id);
    return (idKey && configs[idKey]) || configs[boss.name] || null;
}

module.exports = { bossConfigKey, normalizeResetConfigs, getResetConfig };
