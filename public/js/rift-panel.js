// Rift dungeon panel (Admin only), shown in the Settings menu "Rift" tab
// (scripts/patch-dashboard-rift-tab.js renders an empty #rift-settings-mount there).
// Adds and edits rift bosses (kind "rift"), takes the open or real close time of a run and the
// font color. Everything goes through the Admin routes (POST /bosses, PUT /bosses/:id); this file
// never touches Firebase and has no timer. Dashboard rows only get a data-rift-phase attribute
// (no text, no reordering): React owns the rows.
(function (root) {
    'use strict';
    if (typeof document === 'undefined') return;
    const RS = root.RiftSchedule;
    if (!RS) return;

    const STR = {
        en: {
            title: 'Rift dungeons', add: 'Add rift boss', name: 'Boss name',
            location: 'Rift name', chance: 'Chance %', lobby: 'Lobby (min)', run: 'Play (min)', closing: 'Closing (min)',
            cooldown: 'Wait after close (min)', create: 'Add', save: 'Save', open_time: 'Open (start of play)',
            close_time: 'Real close', time_hint: 'Enter one time; the other is worked out. If you enter both, the close time is used.',
            set_time: 'Save time', unset: 'Unset', none: 'No rift bosses yet.', loading: 'Loading…', failed: 'Could not load. Try again.',
            saved: 'Saved', error: 'Not saved', unset_confirm: 'Unset {name}? Its timer stops on every screen.',
            phase_LOBBY: 'Lobby', phase_OPEN: 'Open', phase_CLOSING: 'Closing', phase_CLOSED: 'Closed', phase_null: 'Unset',
            next: 'Start {start} · close {close}', durations: 'Name, chance and timeline', color: 'Font color', custom: 'Custom',
            spawned: '✅ Spawned', not_spawned: '❌ Not spawned', adjust: '🕒 Adjust time', mark_hint: 'For the run showing NOW (or the one that just closed). Spawned: NOW stays with a countdown to the close, next start 6 h after the close. No press counts as Not spawned: next start 6 h after this start.',
            not_spawned_confirm: '{name} did not spawn? The next start moves to {time}.',
            row_not_spawned_confirm: 'Did this rift NOT spawn? The next start is 6 h after this run\'s start, without the hour of play.',
            row_saved: 'Saved · next start {time}', row_nothing: 'No run to mark right now', cancel: 'Cancel', adjust_title: '🕒 Adjust time'
        },
        th: {
            title: 'ดันเจี้ยนริฟท์', add: 'เพิ่มบอสริฟท์', name: 'ชื่อบอส',
            location: 'ชื่อริฟท์', chance: 'โอกาส %', lobby: 'ล็อบบี้ (นาที)', run: 'เวลาเล่น (นาที)', closing: 'ปิดตัว (นาที)',
            cooldown: 'รอหลังปิด (นาที)', create: 'เพิ่ม', save: 'บันทึก', open_time: 'เวลาเปิด (เริ่มเล่น)',
            close_time: 'เวลาปิดจริง', time_hint: 'ใส่เวลาเดียวพอ อีกเวลาคำนวณให้ ถ้าใส่ทั้งสองจะใช้เวลาปิด',
            set_time: 'บันทึกเวลา', unset: 'Unset', none: 'ยังไม่มีบอสริฟท์', loading: 'กำลังโหลด…', failed: 'โหลดไม่สำเร็จ ลองใหม่',
            saved: 'บันทึกแล้ว', error: 'บันทึกไม่สำเร็จ', unset_confirm: 'Unset {name}? ตัวจับเวลาจะหยุดทุกหน้าจอ',
            phase_LOBBY: 'ล็อบบี้', phase_OPEN: 'เปิดอยู่', phase_CLOSING: 'กำลังปิด', phase_CLOSED: 'ปิดอยู่', phase_null: 'Unset',
            next: 'เริ่ม {start} · ปิด {close}', durations: 'ชื่อ โอกาส และช่วงเวลา', color: '🎨 สีตัวอักษรบอส', custom: 'เลือกเอง',
            spawned: '✅ เกิด', not_spawned: '❌ ไม่เกิด', adjust: '🕒 ปรับเวลา', mark_hint: 'ใช้กับรอบที่ขึ้น NOW (หรือรอบที่เพิ่งปิด) เกิด: ค้าง NOW พร้อมนับถอยหลังถึงเวลาปิด รอบถัดไป 6 ชม. หลังปิด ถ้าไม่กดถือว่าไม่เกิด: รอบถัดไป 6 ชม. หลังเวลาเริ่มรอบนี้',
            not_spawned_confirm: '{name} ไม่เกิดใช่ไหม? รอบถัดไปจะเริ่ม {time}',
            row_not_spawned_confirm: 'รอบนี้ริฟท์ไม่เกิดใช่ไหม? รอบถัดไปจะเริ่ม 6 ชม. หลังเวลาเริ่มรอบนี้ ไม่บวกเวลาเล่น 1 ชม.',
            row_saved: 'บันทึกแล้ว · รอบถัดไปเริ่ม {time}', row_nothing: 'ตอนนี้ยังไม่มีรอบให้กด', cancel: 'ยกเลิก', adjust_title: '🕒 ปรับเวลา'
        }
    };
    const lang = () => { try { return localStorage.getItem('tracker_lang') === 'th' ? 'th' : 'en'; } catch (_) { return 'en'; } };
    const tr = (key, vars) => String(STR[lang()][key] ?? STR.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : ''));

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
    const HEX = /^#[0-9a-f]{6}$/i;
    const serverNow = () => { try { if (typeof root.getTrackerServerNow === 'function') return root.getTrackerServerNow().getTime(); } catch (_) {} return Date.now(); };

    let mount = null;
    let bosses = [];
    let status = '';
    let openEdit = new Set();
    const openTime = new Set();

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
            await load();
            if (!status) { status = tr('saved'); render(); }
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

    // Font color: same presets as the Edit Boss dialog (realtime-alerts.js) plus the native picker.
    // The chosen value lives in a hidden input named "color" ('' = default).
    function colorField(current) {
        const value = HEX.test(current || '') ? current.toLowerCase() : '';
        const hidden = h('input', { type: 'hidden', name: 'color', value });
        const presets = Array.isArray(root.BossTrackerColorPresets) ? root.BossTrackerColorPresets : [{ key: 'default', color: '', label_en: 'Default', label_th: 'ค่าเริ่มต้น', dot: '#ffffff' }];
        const preview = h('span', { class: 'rp-preview' }, 'Maluk');
        const swatches = [];
        const pick = (color) => {
            hidden.value = color;
            preview.style.color = color || '';
            for (const s of swatches) s.setAttribute('aria-pressed', String((s.dataset.color || '') === color));
            custom.value = color || '#ffffff';
        };
        const custom = h('input', { type: 'color', class: 'rp-custom', 'aria-label': tr('custom'), title: tr('custom'), value: value || '#ffffff', oninput: (e) => pick(e.target.value.toLowerCase()) });
        for (const p of presets) {
            const label = lang() === 'th' ? p.label_th : p.label_en;
            const swatch = h('button', {
                type: 'button', class: 'rp-swatch', 'data-color': p.color || '', 'aria-label': label, 'data-unified-tooltip': label,
                'aria-pressed': String((p.color || '') === value),
                style: `background:${p.color || '#27272a'};${p.color ? '' : 'border-style:dashed'}`,
                onclick: () => pick(p.color || '')
            });
            swatches.push(swatch);
        }
        preview.style.color = value || '';
        return h('div', { class: 'rp-color' },
            h('div', { class: 'rp-color-head' }, h('span', null, tr('color')), preview),
            h('div', { class: 'rp-swatches' }, swatches, custom),
            hidden);
    }

    function addForm() {
        const form = h('form', { class: 'rp-card', onsubmit: (e) => {
            e.preventDefault();
            run(() => api('POST', '/bosses', {
                kind: 'rift',
                name: form.elements.name.value,
                location: form.elements.location.value,
                chance_of_appearing: form.elements.chance.value || '100',
                color: form.elements.color.value || null,
                rift: readDurations(form)
            }));
        } },
        h('h3', null, tr('add')),
        h('div', { class: 'rp-grid' },
            h('label', { class: 'rp-field' }, tr('name'), h('input', { name: 'name', required: true, maxlength: '100', placeholder: 'Maluk' })),
            h('label', { class: 'rp-field' }, tr('location'), h('input', { name: 'location', maxlength: '100', placeholder: "Maluk's Castle" })),
            h('label', { class: 'rp-field' }, tr('chance'), h('input', { name: 'chance', type: 'number', min: '0', max: '100', value: '50' }))),
        durationFields(null),
        colorField(''),
        h('button', { type: 'submit', class: 'rp-btn rp-primary' }, tr('create')));
        return form;
    }

    function bossCard(boss) {
        const rift = boss.rift || {};
        const timeForm = h('form', { class: 'rp-grid', onsubmit: (e) => {
            e.preventDefault();
            const open = fromInput(timeForm.elements.open_at.value);
            const close = fromInput(timeForm.elements.close_at.value);
            if (!open && !close) return;
            const times = close ? { close_at: close } : { open_at: open }; // close wins
            openTime.delete(boss.id);
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
                color: editForm.elements.color.value || null,
                rift: readDurations(editForm)
            }));
        } },
        h('div', { class: 'rp-grid' },
            h('label', { class: 'rp-field' }, tr('name'), h('input', { name: 'name', required: true, maxlength: '100', value: boss.name || '' })),
            h('label', { class: 'rp-field' }, tr('location'), h('input', { name: 'location', maxlength: '100', value: boss.location || '' })),
            h('label', { class: 'rp-field' }, tr('chance'), h('input', { name: 'chance', type: 'number', min: '0', max: '100', value: boss.chance_of_appearing || '' }))),
        durationFields(rift),
        colorField(boss.color),
        h('button', { type: 'submit', class: 'rp-btn' }, tr('save')));

        const details = h('details', { open: openEdit.has(boss.id), ontoggle: () => { if (details.open) openEdit.add(boss.id); else openEdit.delete(boss.id); } },
            h('summary', null, tr('durations')), editForm);

        return h('div', { class: 'rp-card', 'data-rift-id': String(boss.id) },
            h('div', { class: 'rp-head' },
                h('strong', { style: HEX.test(boss.color || '') ? `color:${boss.color}` : null }, boss.name, boss.location ? h('span', { class: 'rp-loc' }, ` · ${boss.location}`) : null),
                h('span', { class: `rp-phase rp-phase-${boss.rift_phase || 'none'}` }, tr(`phase_${boss.rift_phase || null}`))),
            boss.rift_start_at ? h('p', { class: 'rp-note' }, tr('next', { start: clock(boss.rift_start_at), close: clock(boss.rift_close_at) })) : null,
            boss.rift_phase ? h('div', { class: 'rp-grid' },
                h('button', { type: 'button', class: 'rp-btn rp-yes', onclick: () => run(() => api('PUT', '/bosses/' + boss.id, { rift_spawned: true })) }, tr('spawned')),
                h('button', { type: 'button', class: 'rp-btn rp-no', onclick: () => {
                    const next = RS.skipRun(boss.rift || {}, serverNow());
                    if (!next) { status = tr('error'); render(); return; }
                    const nextStart = RS.riftState(next, serverNow());
                    if (!root.confirm(tr('not_spawned_confirm', { name: boss.name, time: clock(nextStart && new Date(nextStart.startAt).toISOString()) }))) return;
                    run(() => api('PUT', '/bosses/' + boss.id, { not_spawned: true }));
                } }, tr('not_spawned')),
                h('button', { type: 'button', class: 'rp-btn', 'aria-expanded': String(openTime.has(boss.id)), onclick: () => { if (openTime.has(boss.id)) openTime.delete(boss.id); else openTime.add(boss.id); render(); } }, tr('adjust'))) : null,
            boss.rift_phase ? h('p', { class: 'rp-note' }, tr('mark_hint')) : null,
            !boss.rift_phase || openTime.has(boss.id) ? h('div', { class: 'rp-time' }, timeForm, h('p', { class: 'rp-note' }, tr('time_hint'))) : null,
            details,
            h('button', { type: 'button', class: 'rp-btn rp-danger', onclick: () => {
                if (!root.confirm(tr('unset_confirm', { name: boss.name }))) return;
                run(() => api('PUT', `/bosses/${boss.id}`, { unset_kill_time: true }));
            } }, tr('unset')));
    }

    function render() {
        if (!mount || !mount.isConnected) return;
        mount.replaceChildren(h('div', { id: 'rift-panel' },
            h('h2', null, `🌀 ${tr('title')}`),
            status ? h('p', { class: 'rp-status', role: 'status' }, status) : null,
            bosses.length ? bosses.map(bossCard) : h('p', { class: 'rp-note' }, tr('none')),
            addForm()));
    }

    function injectStyles() {
        if (document.getElementById('rift-panel-style')) return;
        const style = document.createElement('style');
        style.id = 'rift-panel-style';
        style.textContent = `
            #rift-panel{display:flex;flex-direction:column;gap:10px;padding:12px 16px 16px;color:#f4f4f5;font:12px/1.45 system-ui,sans-serif}
            #rift-panel h2{margin:0;font-size:13px;font-weight:700}
            #rift-panel h3{margin:0;font-size:12px;color:#a1a1aa}
            #rift-panel .rp-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
            #rift-panel .rp-card{border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;background:rgba(255,255,255,.02)}
            #rift-panel .rp-grid{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end}
            #rift-panel .rp-field{display:flex;flex-direction:column;gap:2px;font-size:10px;color:#a1a1aa;flex:1 1 120px;min-width:0}
            #rift-panel input:not([type=color]):not([type=hidden]){background:#18181b;color:#f4f4f5;border:1px solid #3f3f46;border-radius:6px;padding:5px 7px;font:12px system-ui;min-width:0;color-scheme:dark}
            #rift-panel .rp-btn{padding:6px 10px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#f4f4f5;font:600 11px system-ui;cursor:pointer;align-self:flex-start}
            #rift-panel .rp-primary{background:#7c3aed;border-color:#7c3aed;color:#fff}
            #rift-panel .rp-danger{color:#fca5a5;border-color:#7f1d1d}
            #rift-panel .rp-time{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px dashed rgba(255,255,255,.12);border-radius:8px}
            #rift-panel .rp-yes{background:#14532d;border-color:#16a34a;color:#dcfce7}
            #rift-panel .rp-no{background:#450a0a;border-color:#dc2626;color:#fee2e2}
            #rift-panel .rp-note{margin:0;font-size:10px;color:#a1a1aa}
            #rift-panel .rp-status{margin:0;font-size:11px;color:#fbbf24}
            #rift-panel .rp-loc{font-weight:400;color:#71717a}
            #rift-panel .rp-phase{font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;background:#27272a;color:#a1a1aa;white-space:nowrap}
            #rift-panel .rp-phase-LOBBY{background:#713f12;color:#fde68a}
            #rift-panel .rp-phase-OPEN{background:#14532d;color:#86efac}
            #rift-panel .rp-phase-CLOSING{background:#7f1d1d;color:#fecaca}
            #rift-panel summary{cursor:pointer;color:#c4b5fd;font-size:11px}
            #rift-panel .rp-edit{display:flex;flex-direction:column;gap:8px;margin-top:8px}
            #rift-panel .rp-color{display:flex;flex-direction:column;gap:5px}
            #rift-panel .rp-color-head{display:flex;align-items:center;justify-content:space-between;font-size:10px;color:#a1a1aa}
            #rift-panel .rp-preview{font-weight:700;font-size:12px;color:#fff}
            #rift-panel .rp-swatches{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
            #rift-panel .rp-swatch{width:18px;height:18px;border-radius:50%;border:1px solid rgba(255,255,255,.35);padding:0;cursor:pointer}
            #rift-panel .rp-swatch[aria-pressed=true]{outline:2px solid #fff;outline-offset:1px}
            #rift-panel .rp-custom{width:26px;height:20px;padding:0;border:1px solid #3f3f46;border-radius:5px;background:none;cursor:pointer}
            #rift-panel.rp-dialog{background:#101012;border:1px solid #3f3f46;border-radius:14px;width:min(440px,100%);box-sizing:border-box}
            [data-rift-action]{padding:3px!important;font-size:12px!important;line-height:1!important}
            /* Rift rows have ✅ ❌ 🕒 ⋮ (4 buttons): widen the 76px action column, only in tables that hold a rift row. */
            table:has([data-rift-action]) col[style*="76px"]{width:104px!important}
            tr[data-rift-phase]{box-shadow:inset 3px 0 0 #7c3aed}
            tr[data-rift-phase="OPEN"],tr[data-rift-phase="CLOSING"]{box-shadow:inset 3px 0 0 #22c55e}
        `;
        document.head.appendChild(style);
    }

    // ---------- Dashboard row buttons (scripts/patch-dashboard-rift-row.js) ----------
    // ✅ / ❌ / 🕒 on a rift row call mark(id, action). One request per click, nothing on a timer.
    function toast(text, ok) {
        const old = document.getElementById('rift-toast');
        if (old) old.remove();
        const el = h('div', { id: 'rift-toast', role: 'status', style: `position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100003;padding:8px 14px;border-radius:10px;font:600 12px system-ui;color:#fff;background:${ok ? '#166534' : '#7f1d1d'};box-shadow:0 6px 20px rgba(0,0,0,.4);max-width:calc(100vw - 32px)` }, text);
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3500);
    }

    async function send(id, body) {
        try {
            const json = await api('PUT', `/bosses/${id}`, body);
            const start = json.boss && json.boss.rift_start_at;
            toast(start ? tr('row_saved', { time: clock(start) }) : tr('saved'), true);
            if (mount && mount.isConnected) load();
        } catch (e) {
            toast(/No rift run/.test(e.message) ? tr('row_nothing') : `${tr('error')}: ${e.message}`, false);
        }
    }

    function adjustDialog(id) {
        const old = document.getElementById('rift-time-dialog');
        if (old) old.remove();
        const close = () => overlay.remove();
        const form = h('form', { id: 'rift-panel', class: 'rp-dialog', onsubmit: (e) => {
            e.preventDefault();
            const open = fromInput(form.elements.open_at.value);
            const closeAt = fromInput(form.elements.close_at.value);
            if (!open && !closeAt) return;
            close();
            send(id, { rift: closeAt ? { close_at: closeAt } : { open_at: open } }); // close wins
        } },
        h('h2', null, tr('adjust_title')),
        h('div', { class: 'rp-grid' },
            h('label', { class: 'rp-field' }, tr('open_time'), h('input', { type: 'datetime-local', name: 'open_at' })),
            h('label', { class: 'rp-field' }, tr('close_time'), h('input', { type: 'datetime-local', name: 'close_at' }))),
        h('p', { class: 'rp-note' }, tr('time_hint')),
        h('div', { class: 'rp-grid' },
            h('button', { type: 'submit', class: 'rp-btn rp-primary' }, tr('set_time')),
            h('button', { type: 'button', class: 'rp-btn', onclick: close }, tr('cancel'))));
        const overlay = h('div', { id: 'rift-time-dialog', role: 'dialog', 'aria-modal': 'true', style: 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px', onclick: (e) => { if (e.target === overlay) close(); } }, form);
        document.body.appendChild(overlay);
    }

    function mark(id, action) {
        if (!isAdminPage()) return;
        if (action === 'spawned') return send(id, { rift_spawned: true });
        if (action === 'not_spawned') {
            if (!root.confirm(tr('row_not_spawned_confirm'))) return;
            return send(id, { not_spawned: true });
        }
        if (action === 'adjust') return adjustDialog(id);
    }

    root.BossTrackerRift = { mark };

    // The Rift tab mounts and unmounts its empty div as the Admin switches tabs.
    function checkMount() {
        const el = document.getElementById('rift-settings-mount');
        if (el === mount) return;
        mount = el;
        if (mount && isAdminPage()) load();
    }

    function start() {
        if (!document.getElementById('app')) return; // dashboard only
        injectStyles();
        if (!isAdminPage()) return;
        new MutationObserver(checkMount).observe(document.body, { childList: true, subtree: true });
        checkMount();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})(typeof window !== 'undefined' ? window : globalThis);
