// Rift dungeon panel (Admin only). Adds and edits rift bosses (kind "rift") and takes the open or
// the real close time of a run. Everything goes through the Admin routes (POST /bosses,
// PUT /bosses/:id); this file never touches Firebase and has no timer. Rows on the dashboard only
// get a data-rift-phase attribute (no text, no reordering): React owns the rows.
(function (root) {
    'use strict';
    if (typeof document === 'undefined') return;
    const RS = root.RiftSchedule;
    if (!RS) return;

    const STR = {
        en: {
            button: 'Rift', title: 'Rift dungeons', close: 'Close', add: 'Add rift boss', name: 'Boss name',
            location: 'Rift name', chance: 'Chance %', lobby: 'Lobby (min)', run: 'Play (min)', closing: 'Closing (min)',
            cooldown: 'Wait after close (min)', create: 'Add', save: 'Save', open_time: 'Open (start of play)',
            close_time: 'Real close', time_hint: 'Enter one time; the other is worked out. If you enter both, the close time is used.',
            set_time: 'Save time', unset: 'Unset', none: 'No rift bosses yet.', loading: 'Loading…', failed: 'Could not load. Try again.',
            saved: 'Saved', error: 'Not saved', unset_confirm: 'Unset {name}? Its timer stops on every screen.',
            phase_LOBBY: 'Lobby', phase_OPEN: 'Open', phase_CLOSING: 'Closing', phase_CLOSED: 'Closed', phase_null: 'Unset',
            next: 'Start {start} · close {close}', durations: 'Timeline'
        },
        th: {
            button: 'ริฟท์', title: 'ดันเจี้ยนริฟท์', close: 'ปิด', add: 'เพิ่มบอสริฟท์', name: 'ชื่อบอส',
            location: 'ชื่อริฟท์', chance: 'โอกาส %', lobby: 'ล็อบบี้ (นาที)', run: 'เวลาเล่น (นาที)', closing: 'ปิดตัว (นาที)',
            cooldown: 'รอหลังปิด (นาที)', create: 'เพิ่ม', save: 'บันทึก', open_time: 'เวลาเปิด (เริ่มเล่น)',
            close_time: 'เวลาปิดจริง', time_hint: 'ใส่เวลาเดียวพอ อีกเวลาคำนวณให้ ถ้าใส่ทั้งสองจะใช้เวลาปิด',
            set_time: 'บันทึกเวลา', unset: 'Unset', none: 'ยังไม่มีบอสริฟท์', loading: 'กำลังโหลด…', failed: 'โหลดไม่สำเร็จ ลองใหม่',
            saved: 'บันทึกแล้ว', error: 'บันทึกไม่สำเร็จ', unset_confirm: 'Unset {name}? ตัวจับเวลาจะหยุดทุกหน้าจอ',
            phase_LOBBY: 'ล็อบบี้', phase_OPEN: 'เปิดอยู่', phase_CLOSING: 'กำลังปิด', phase_CLOSED: 'ปิดอยู่', phase_null: 'Unset',
            next: 'เริ่ม {start} · ปิด {close}', durations: 'ช่วงเวลา'
        }
    };
    const lang = () => { try { return localStorage.getItem('tracker_lang') === 'th' ? 'th' : 'en'; } catch (_) { return 'en'; } };
    const tr = (key, vars) => String(STR[lang()][key] ?? STR.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : ''));
    const serverNow = () => { try { if (typeof root.getTrackerServerNow === 'function') return root.getTrackerServerNow().getTime(); } catch (_) {} return Date.now(); };

    function h(tag, attrs, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === null || v === undefined || v === false) continue;
            if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else el.setAttribute(k, v === true ? '' : String(v));
        }
        for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
        return el;
    }

    function isAdminPage() {
        try {
            const page = JSON.parse(document.getElementById('app')?.getAttribute('data-page') || '{}');
            return page.props?.auth?.user?.role === 'admin';
        } catch (_) { return false; }
    }

    const pad = (n) => String(n).padStart(2, '0');
    const clock = (iso) => { if (!iso) return '—'; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const toInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const fromInput = (value) => (value ? new Date(value).toISOString() : undefined); // datetime-local is this device's local time

    let modal = null;
    let bosses = [];
    let status = '';

    async function api(method, url, body) {
        const res = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: body ? JSON.stringify(body) : undefined
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) throw new Error(json.message || tr('error'));
        return json;
    }

    async function load() {
        status = tr('loading');
        render();
        try {
            const res = await fetch('/poll', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            const json = await res.json();
            if (!res.ok || json.notReady) throw new Error('not ready');
            bosses = (json.bosses || []).filter(RS.isRift);
            status = '';
        } catch (_) {
            status = tr('failed');
        }
        render();
    }

    async function run(action) {
        try {
            await action();
            status = tr('saved');
            await load();
        } catch (e) {
            status = `${tr('error')}: ${e.message}`;
            render();
        }
    }

    const numberField = (label, name, value) => h('label', { class: 'rp-field' }, label,
        h('input', { type: 'number', name, min: '0', step: '1', value: value ?? '', inputmode: 'numeric' }));

    function durationFields(rift) {
        const r = { ...RS.DEFAULTS, ...(rift || {}) };
        return h('div', { class: 'rp-grid' },
            numberField(tr('lobby'), 'lobby_min', r.lobby_min),
            numberField(tr('run'), 'run_min', r.run_min),
            numberField(tr('closing'), 'closing_min', r.closing_min),
            numberField(tr('cooldown'), 'cooldown_min', r.cooldown_min));
    }

    function readDurations(form) {
        const out = {};
        for (const key of Object.keys(RS.DEFAULTS)) out[key] = Number(form.elements[key].value);
        return out;
    }

    function addForm() {
        const form = h('form', { class: 'rp-card', onsubmit: (e) => {
            e.preventDefault();
            run(() => api('POST', '/bosses', {
                kind: 'rift',
                name: form.elements.name.value,
                location: form.elements.location.value,
                chance_of_appearing: form.elements.chance.value || '100',
                rift: readDurations(form)
            }));
        } },
        h('h3', null, tr('add')),
        h('div', { class: 'rp-grid' },
            h('label', { class: 'rp-field' }, tr('name'), h('input', { name: 'name', required: true, maxlength: '100', placeholder: 'Maluk' })),
            h('label', { class: 'rp-field' }, tr('location'), h('input', { name: 'location', maxlength: '100', placeholder: "Maluk's Castle" })),
            h('label', { class: 'rp-field' }, tr('chance'), h('input', { name: 'chance', type: 'number', min: '0', max: '100', value: '50' }))),
        durationFields(null),
        h('button', { type: 'submit', class: 'rp-btn rp-primary' }, tr('create')));
        return form;
    }

    function bossCard(boss) {
        const rift = boss.rift || {};
        const timeForm = h('form', { class: 'rp-row', onsubmit: (e) => {
            e.preventDefault();
            const open = fromInput(timeForm.elements.open_at.value);
            const close = fromInput(timeForm.elements.close_at.value);
            if (!open && !close) return;
            const times = close ? { close_at: close } : { open_at: open }; // close wins
            run(() => api('PUT', `/bosses/${boss.id}`, { rift: times }));
        } },
        h('label', { class: 'rp-field' }, tr('open_time'), h('input', { type: 'datetime-local', name: 'open_at', value: toInput(boss.rift_start_at) })),
        h('label', { class: 'rp-field' }, tr('close_time'), h('input', { type: 'datetime-local', name: 'close_at', value: '' })),
        h('button', { type: 'submit', class: 'rp-btn rp-primary' }, tr('set_time')));

        const editForm = h('form', { class: 'rp-edit', onsubmit: (e) => {
            e.preventDefault();
            run(() => api('PUT', `/bosses/${boss.id}`, {
                name: editForm.elements.name.value,
                location: editForm.elements.location.value,
                chance_of_appearing: editForm.elements.chance.value,
                rift: readDurations(editForm)
            }));
        } },
        h('div', { class: 'rp-grid' },
            h('label', { class: 'rp-field' }, tr('name'), h('input', { name: 'name', required: true, maxlength: '100', value: boss.name || '' })),
            h('label', { class: 'rp-field' }, tr('location'), h('input', { name: 'location', maxlength: '100', value: boss.location || '' })),
            h('label', { class: 'rp-field' }, tr('chance'), h('input', { name: 'chance', type: 'number', min: '0', max: '100', value: boss.chance_of_appearing || '' }))),
        durationFields(rift),
        h('button', { type: 'submit', class: 'rp-btn' }, tr('save')));

        return h('div', { class: 'rp-card', 'data-rift-id': String(boss.id) },
            h('div', { class: 'rp-head' },
                h('strong', null, boss.name, boss.location ? h('span', { class: 'rp-loc' }, ` · ${boss.location}`) : null),
                h('span', { class: `rp-phase rp-phase-${boss.rift_phase || 'none'}` }, tr(`phase_${boss.rift_phase || null}`))),
            boss.rift_start_at ? h('p', { class: 'rp-note' }, tr('next', { start: clock(boss.rift_start_at), close: clock(boss.rift_close_at) })) : null,
            timeForm,
            h('p', { class: 'rp-note' }, tr('time_hint')),
            h('details', null, h('summary', null, tr('durations')), editForm),
            h('button', { type: 'button', class: 'rp-btn rp-danger', onclick: () => {
                if (!root.confirm(tr('unset_confirm', { name: boss.name }))) return;
                run(() => api('PUT', `/bosses/${boss.id}`, { unset_kill_time: true }));
            } }, tr('unset')));
    }

    function render() {
        if (!modal) return;
        const panel = modal.querySelector('#rift-panel');
        panel.replaceChildren(
            h('div', { class: 'rp-headbar' }, h('h2', null, `🌀 ${tr('title')}`), h('button', { type: 'button', class: 'rp-btn', onclick: closeModal }, tr('close'))),
            status ? h('p', { class: 'rp-status', role: 'status' }, status) : null,
            h('div', { class: 'rp-body' },
                bosses.length ? bosses.map(bossCard) : h('p', { class: 'rp-note' }, tr('none')),
                addForm()));
    }

    function onKey(e) { if (e.key === 'Escape') closeModal(); }

    function closeModal() {
        if (modal) modal.remove();
        modal = null;
        document.removeEventListener('keydown', onKey);
    }

    function openModal() {
        if (!isAdminPage()) return;
        closeModal();
        status = '';
        modal = h('div', { id: 'rift-panel-overlay', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === modal) closeModal(); } },
            h('div', { id: 'rift-panel' }));
        document.body.appendChild(modal);
        document.addEventListener('keydown', onKey);
        load();
    }

    function injectStyles() {
        if (document.getElementById('rift-panel-style')) return;
        const style = document.createElement('style');
        style.id = 'rift-panel-style';
        style.textContent = `
            #rift-panel-overlay{position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
            #rift-panel{width:min(620px,100%);max-height:88vh;display:flex;flex-direction:column;background:#101012;color:#f4f4f5;border:1px solid #3f3f46;border-radius:16px;padding:16px;box-sizing:border-box;font:14px/1.5 system-ui,sans-serif}
            #rift-panel h2{margin:0;font-size:17px}
            #rift-panel h3{margin:0 0 8px;font-size:14px;color:#a1a1aa}
            #rift-panel .rp-headbar,#rift-panel .rp-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
            #rift-panel .rp-body{overflow:auto;min-height:0;margin-top:10px;display:flex;flex-direction:column;gap:10px}
            #rift-panel .rp-card{border:1px solid #27272a;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px}
            #rift-panel .rp-grid,#rift-panel .rp-row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
            #rift-panel .rp-field{display:flex;flex-direction:column;gap:2px;font-size:12px;color:#a1a1aa;flex:1 1 130px;min-width:0}
            #rift-panel input{background:#18181b;color:#f4f4f5;border:1px solid #3f3f46;border-radius:8px;padding:6px 8px;font:14px system-ui;min-width:0;color-scheme:dark}
            #rift-panel .rp-btn{padding:7px 12px;border-radius:10px;border:1px solid #3f3f46;background:#18181b;color:#f4f4f5;font:600 13px system-ui;cursor:pointer;align-self:flex-start}
            #rift-panel .rp-primary{background:#7c3aed;border-color:#7c3aed;color:#fff}
            #rift-panel .rp-danger{color:#fca5a5;border-color:#7f1d1d}
            #rift-panel .rp-note{margin:0;font-size:12px;color:#a1a1aa}
            #rift-panel .rp-status{margin:8px 0 0;font-size:13px;color:#fbbf24}
            #rift-panel .rp-loc{font-weight:400;color:#71717a}
            #rift-panel .rp-phase{font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;background:#27272a;color:#a1a1aa}
            #rift-panel .rp-phase-LOBBY{background:#713f12;color:#fde68a}
            #rift-panel .rp-phase-OPEN{background:#14532d;color:#86efac}
            #rift-panel .rp-phase-CLOSING{background:#7f1d1d;color:#fecaca}
            #rift-panel summary{cursor:pointer;color:#c4b5fd;font-size:13px}
            #rift-panel .rp-edit{display:flex;flex-direction:column;gap:8px;margin-top:8px}
            tr[data-rift-phase]{box-shadow:inset 3px 0 0 #7c3aed}
            tr[data-rift-phase="OPEN"],tr[data-rift-phase="CLOSING"]{box-shadow:inset 3px 0 0 #22c55e}
        `;
        document.head.appendChild(style);
    }

    function ensureButton() {
        if (document.getElementById('header-rift-control')) return;
        const button = h('button', {
            id: 'header-rift-control',
            type: 'button',
            class: 'compact-system-control no-drag',
            style: 'width:auto!important;min-width:0!important;height:22px!important;padding:0 6px!important;gap:3px!important;color:#c4b5fd!important;background:rgba(124,58,237,.18)!important;border:1px solid rgba(124,58,237,.55)!important;border-radius:6px!important;font:700 9px/1 system-ui!important;white-space:nowrap!important;flex:0 0 auto!important;cursor:pointer',
            'aria-label': tr('title'),
            'data-unified-tooltip': tr('title'),
            onclick: openModal
        }, '🌀 ', h('span', { class: 'rp-button-label' }, tr('button')));
        document.body.appendChild(button);
    }

    function start() {
        if (!document.getElementById('app')) return; // dashboard only
        injectStyles();
        if (isAdminPage()) ensureButton();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})(typeof window !== 'undefined' ? window : globalThis);
