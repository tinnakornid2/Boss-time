// Boss time report: the 📋 header button opens a read-only list of every boss with its
// name, last kill time and next spawn time, split into normal and invasion bosses, and
// copies it as plain text for sharing. It reads /poll once when opened (and on Refresh);
// it never writes anything and never polls on a timer. Boss names are never translated.
(function (root) {
    'use strict';

    const NOW_WINDOW_MS = 5 * 60 * 1000;

    const STR = {
        en: {
            title: 'Boss time report',
            button: 'Report',
            normal: 'Normal bosses',
            invasion: 'Invasion bosses',
            all: 'All',
            name: 'Boss',
            died: 'Died',
            spawn: 'Spawns',
            location: 'Location',
            status: 'Status',
            unset: 'Unset',
            now: 'NOW',
            alive: 'Still alive',
            waiting: 'Waiting',
            show_unset: 'Show bosses with no time',
            show_location: 'Show location',
            copy: 'Copy as text',
            copied: 'Copied',
            sheets: 'Export to Google Sheets',
            sheets_done: 'Table copied. In the new Google Sheet, click cell A1 and press Ctrl+V (⌘V on Mac).',
            sheets_failed: "Couldn't copy the table. Try again.",
            sheets_working: 'Writing to Google Sheets…',
            sheets_written: 'Done. The Boss Report sheet is open in a new tab.',
            sheets_open: 'Open sheet',
            sheets_not_configured: "Google Sheets isn't connected yet. Use Copy table instead.",
            sheets_outdated: 'Google Sheets needs the updated Apps Script first. Use Copy table for now.',
            sheets_write_failed: "Couldn't write to Google Sheets. Use Copy table instead.",
            copy_table: 'Copy table + open new sheet',
            refresh: 'Refresh',
            close: 'Close',
            loading: 'Loading…',
            empty: 'No bosses with a recorded time.',
            invasion_hidden: 'Invasion is hidden on the dashboard.',
            error: "Couldn't load boss times. Try again.",
            generated: 'As of',
            log: 'Log',
            log_hint: 'Saved at midnight (Thai time) after every Monday, Wednesday and Friday. Kept for 30 days in Google Sheets.',
            log_empty: 'No log yet. The first one is saved at midnight after the next Monday, Wednesday or Friday.',
            log_logged: 'saved',
            log_open: 'Open in Google Sheets',
            log_not_configured: "Google Sheets isn't connected yet, so the log can't be shown.",
            log_outdated: 'Google Sheets needs the updated Apps Script first.',
            log_failed: "Couldn't load the log. Try again.",
            server: 'Server',
            main_server: 'Main',
            import_btn: 'Import these times',
            importing: 'Importing…',
            import_confirm: 'Replace the current times of the invasion bosses with the {server} times saved on {date}? Every screen will update.',
            import_done: 'Imported {n} invasion bosses. Bosses whose spawn has passed moved on to their next cycle.',
            import_skipped: 'Not found on the dashboard: {names}',
            import_failed: "Couldn't import. Try again."
        },
        th: {
            title: 'รีพอทเวลาบอส',
            button: 'รีพอท',
            normal: 'บอสปกติ',
            invasion: 'บอสอินเวชั่น',
            all: 'ทั้งหมด',
            name: 'บอส',
            died: 'เวลาตาย',
            spawn: 'เวลาเกิด',
            location: 'สถานที่',
            status: 'สถานะ',
            unset: 'ยังไม่ตั้งเวลา',
            now: 'NOW',
            alive: 'ยังไม่ตาย',
            waiting: 'รอเกิด',
            show_unset: 'แสดงบอสที่ยังไม่มีเวลา',
            show_location: 'แสดงสถานที่',
            copy: 'คัดลอกเป็นข้อความ',
            copied: 'คัดลอกแล้ว',
            sheets: 'ส่งออกไป Google Sheets',
            sheets_done: 'คัดลอกตารางแล้ว ใน Google Sheets ที่เปิดขึ้นมา คลิกช่อง A1 แล้วกด Ctrl+V (⌘V บน Mac)',
            sheets_failed: 'คัดลอกตารางไม่สำเร็จ ลองใหม่อีกครั้ง',
            sheets_working: 'กำลังเขียนลง Google Sheets…',
            sheets_written: 'เรียบร้อย เปิดชีต Boss Report ในแท็บใหม่แล้ว',
            sheets_open: 'เปิดชีต',
            sheets_not_configured: 'ยังไม่ได้เชื่อม Google Sheets ใช้ปุ่มคัดลอกตารางแทน',
            sheets_outdated: 'ต้องอัปเดต Apps Script ของ Google Sheets ก่อน ระหว่างนี้ใช้ปุ่มคัดลอกตารางแทน',
            sheets_write_failed: 'เขียนลง Google Sheets ไม่สำเร็จ ใช้ปุ่มคัดลอกตารางแทน',
            copy_table: 'คัดลอกตาราง + เปิดชีตใหม่',
            refresh: 'รีเฟรช',
            close: 'ปิด',
            loading: 'กำลังโหลด…',
            empty: 'ยังไม่มีบอสที่บันทึกเวลา',
            invasion_hidden: 'ตอนนี้ซ่อนอินเวชั่นบนหน้าเว็บอยู่',
            error: 'โหลดเวลาบอสไม่สำเร็จ ลองใหม่อีกครั้ง',
            generated: 'ณ เวลา',
            log: 'Log',
            log_hint: 'บันทึกตอนเที่ยงคืน (เวลาไทย) หลังวันจันทร์ พุธ ศุกร์ เก็บไว้ 30 วันใน Google Sheets',
            log_empty: 'ยังไม่มี log จะบันทึกครั้งแรกตอนเที่ยงคืนหลังวันจันทร์ พุธ หรือศุกร์ที่จะถึง',
            log_logged: 'บันทึกเมื่อ',
            log_open: 'เปิดใน Google Sheets',
            log_not_configured: 'ยังไม่ได้เชื่อม Google Sheets จึงยังดู log ไม่ได้',
            log_outdated: 'ต้องอัปเดต Apps Script ของ Google Sheets ก่อน',
            log_failed: 'โหลด log ไม่สำเร็จ ลองใหม่อีกครั้ง',
            server: 'เซิร์ฟเวอร์',
            main_server: 'หลัก',
            import_btn: 'นำเข้าเวลาชุดนี้',
            importing: 'กำลังนำเข้า…',
            import_confirm: 'แทนที่เวลาบอสอินเวชั่นตอนนี้ ด้วยเวลาของ {server} ที่บันทึกไว้วันที่ {date} ใช่ไหม? ทุกหน้าจอจะเปลี่ยนตาม',
            import_done: 'นำเข้าเวลาบอสอินเวชั่น {n} ตัวแล้ว บอสที่เลยเวลาเกิดไปแล้วจะขยับไปรอบถัดไปให้เอง',
            import_skipped: 'ไม่พบบนหน้าเว็บ: {names}',
            import_failed: 'นำเข้าไม่สำเร็จ ลองใหม่อีกครั้ง'
        }
    };

    // ---------- Pure report logic (also used by tests) ----------

    function toMs(value) {
        if (!value) return null;
        const ms = new Date(value).getTime();
        return Number.isFinite(ms) ? ms : null;
    }

    function bossStatus(boss, nowMs) {
        const spawnMs = toMs(boss.next_spawn);
        if (spawnMs === null) return 'unset';
        if (boss.pinned_alive) return 'alive';
        if (nowMs >= spawnMs && nowMs < spawnMs + NOW_WINDOW_MS) return 'now';
        return 'upcoming';
    }

    const STATUS_ORDER = { alive: 0, now: 1, upcoming: 2, unset: 3 };

    // Same catch-up as server/db.js calculateBossAutoAdvance, computed locally for display
    // only: once the five-minute NOW window has passed, the scheduled spawn becomes the
    // latest kill time and the next cycle follows. Nothing is written.
    function withAutoAdvance(boss, nowMs) {
        const spawnMs = toMs(boss.next_spawn);
        const intervalMs = Number(boss.interval) * 60 * 1000;
        if (spawnMs === null || boss.pinned_alive || !Number.isFinite(intervalMs) || intervalMs <= 0) return boss;
        if (nowMs < spawnMs + NOW_WINDOW_MS) return boss;
        const completedCycles = Math.floor((nowMs - spawnMs - NOW_WINDOW_MS) / intervalMs) + 1;
        const latestSpawnMs = spawnMs + (completedCycles - 1) * intervalMs;
        return { ...boss, last_kill_time: new Date(latestSpawnMs).toISOString(), next_spawn: new Date(latestSpawnMs + intervalMs).toISOString() };
    }

    function toRow(rawBoss, nowMs) {
        const boss = withAutoAdvance(rawBoss, nowMs);
        const status = bossStatus(boss, nowMs);
        return {
            id: boss.id,
            name: String(boss.name || ''),
            location: String(boss.location || ''),
            status,
            killMs: status === 'unset' ? null : toMs(boss.last_kill_time),
            spawnMs: toMs(boss.next_spawn)
        };
    }

    function sortRows(a, b) {
        const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (byStatus) return byStatus;
        if (a.spawnMs !== null && b.spawnMs !== null && a.spawnMs !== b.spawnMs) return a.spawnMs - b.spawnMs;
        return a.name.localeCompare(b.name);
    }

    // Splits /poll bosses into normal and invasion lists. Invasion follows the shared
    // dashboard visibility (hideInvasionBosses), like the dashboard and phone alerts.
    function buildReport(data, nowMs, options) {
        const showUnset = Boolean(options && options.showUnset);
        // Location is hidden unless asked for (owner's choice).
        const showLocation = Boolean(options && options.showLocation);
        const bosses = Array.isArray(data && data.bosses) ? data.bosses.filter(Boolean) : [];
        const invasionHidden = Boolean(data && data.hideInvasionBosses);
        const rowsOf = list => list.map(boss => toRow(boss, nowMs))
            .map(row => (showLocation ? row : { ...row, location: '' }))
            .filter(row => showUnset || row.status !== 'unset').sort(sortRows);
        return {
            normal: rowsOf(bosses.filter(boss => !boss.is_invasion)),
            invasion: invasionHidden ? [] : rowsOf(bosses.filter(boss => boss.is_invasion)),
            invasionHidden,
            showLocation,
            invasionLabel: String((data && data.invasionLabel) || '').trim()
        };
    }

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    // dd/MM HH:mm in the dashboard's selected timezone (UTC+7 or UTC+8).
    function formatTime(ms, tzOffsetHours) {
        if (ms === null || ms === undefined) return '-';
        const d = new Date(ms + tzOffsetHours * 3600 * 1000);
        return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }

    function spawnText(row, tzOffsetHours, s) {
        if (row.status === 'unset') return s.unset;
        if (row.status === 'alive') return s.alive;
        if (row.status === 'now') return `${s.now} (${formatTime(row.spawnMs, tzOffsetHours)})`;
        return formatTime(row.spawnMs, tzOffsetHours);
    }

    function sectionText(title, rows, tzOffsetHours, s) {
        const lines = [`— ${title} (${rows.length}) —`];
        if (!rows.length) lines.push(s.empty);
        for (const row of rows) {
            lines.push(`${row.name} | ${s.died} ${formatTime(row.killMs, tzOffsetHours)} | ${s.spawn} ${spawnText(row, tzOffsetHours, s)}`);
        }
        return lines.join('\n');
    }

    function invasionTitle(report, s) {
        return report.invasionLabel ? `${s.invasion} ${report.invasionLabel}` : s.invasion;
    }

    function reportText(report, view, nowMs, tzOffsetHours, lang) {
        const s = STR[lang] || STR.en;
        const sign = tzOffsetHours >= 0 ? '+' : '-';
        const parts = [`📋 ${s.title} · ${s.generated} ${formatTime(nowMs, tzOffsetHours)} (UTC${sign}${Math.abs(tzOffsetHours)})`];
        if (view !== 'invasion') parts.push(sectionText(s.normal, report.normal, tzOffsetHours, s));
        if (view !== 'normal' && !report.invasionHidden) parts.push(sectionText(invasionTitle(report, s), report.invasion, tzOffsetHours, s));
        return parts.join('\n\n');
    }

    // ---------- Google Sheets export ----------
    // A styled HTML table on the clipboard keeps its colours, bold text and borders when
    // pasted into Google Sheets. Times use "dd/MM · HH:mm" so Sheets keeps them as text
    // instead of converting them to dates in the sheet's own locale.

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function sheetTime(ms, tzOffsetHours) {
        return ms === null || ms === undefined ? '-' : formatTime(ms, tzOffsetHours).replace(' ', ' · ');
    }

    // Same soft palette as the Apps Script "Boss Report" tab (google_apps_script/Code.gs).
    const SHEET = {
        border: 'border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;',
        cell: 'padding:6px 10px;font-family:Roboto,Arial,sans-serif;font-size:11pt;vertical-align:middle;height:28px;',
        normal: { band: '#fde7c8', bandFg: '#7c2d12', head: '#fff7ed', headFg: '#9a3412' },
        invasion: { band: '#e9ddff', bandFg: '#4c1d95', head: '#f7f3ff', headFg: '#5b21b6' },
        status: {
            now: 'background-color:#fee4e2;color:#b42318;font-weight:bold;',
            alive: 'background-color:#fef0c7;color:#93370d;font-weight:bold;',
            upcoming: 'background-color:#ecfdf3;color:#027a48;',
            unset: 'color:#98a2b3;'
        }
    };
    function statusLabel(status, s) {
        return { now: s.now, alive: s.alive, upcoming: s.waiting, unset: s.unset }[status];
    }

    // Columns of the exported table; Location appears only when it is switched on.
    function sheetColumns(report, s) {
        return [
            { label: '#', width: 40 },
            { label: s.name, width: 190 },
            report.showLocation ? { label: s.location, width: 170, location: true } : null,
            { label: s.died, width: 125 },
            { label: s.spawn, width: 125 },
            { label: s.status, width: 110 }
        ].filter(Boolean);
    }

    // One table section as a list of row cell-strings (no <tr>), so two sections can be
    // laid side by side in the same table rows.
    function sheetSection(title, rows, palette, tz, s, note, columns) {
        const n = columns.length;
        const withLocation = columns.some(col => col.location);
        const td = (content, style) => `<td style="${SHEET.cell}${SHEET.border}${style || ''}">${content}</td>`;
        const out = [
            `<td colspan="${n}" style="${SHEET.cell}${SHEET.border}background-color:${palette.band};color:${palette.bandFg};font-weight:bold;font-size:12pt;">${escapeHtml(title)}</td>`
        ];
        if (note || !rows.length) {
            out.push(`<td colspan="${n}" style="${SHEET.cell}${SHEET.border}color:#667085;font-style:italic;">${escapeHtml(note || s.empty)}</td>`);
            return out;
        }
        const headStyle = `background-color:${palette.head};color:${palette.headFg};font-weight:bold;font-size:10pt;text-align:center;`;
        out.push(columns.map((col, i) => td(escapeHtml(col.label), headStyle + (i === 1 ? 'text-align:left;' : ''))).join(''));
        rows.forEach((row, i) => {
            const zebra = i % 2 ? 'background-color:#f9fafb;' : 'background-color:#ffffff;';
            const spawn = row.status === 'unset' ? '-' : sheetTime(row.spawnMs, tz);
            out.push([
                td(String(i + 1), zebra + 'color:#667085;font-size:10pt;text-align:center;'),
                td(escapeHtml(row.name), zebra + 'font-weight:bold;color:#101828;'), // boss names are never translated
                withLocation ? td(escapeHtml(row.location), zebra + 'color:#344054;') : '',
                td(sheetTime(row.killMs, tz), zebra + 'text-align:center;color:#344054;'),
                td(spawn, zebra + 'text-align:center;font-weight:bold;color:#101828;'),
                td(escapeHtml(statusLabel(row.status, s)), zebra + 'text-align:center;' + SHEET.status[row.status])
            ].join(''));
        });
        return out;
    }

    // Normal bosses on the left, invasion bosses on the right, with a narrow gap column.
    function reportSheetHtml(report, view, nowMs, tzOffsetHours, lang) {
        const s = STR[lang] || STR.en;
        const sign = tzOffsetHours >= 0 ? '+' : '-';
        const columns = sheetColumns(report, s);
        const n = columns.length;
        const sections = [];
        if (view !== 'invasion') sections.push(sheetSection(`${s.normal} (${report.normal.length})`, report.normal, SHEET.normal, tzOffsetHours, s, null, columns));
        if (view !== 'normal') {
            const title = invasionTitle(report, s);
            sections.push(report.invasionHidden
                ? sheetSection(title, [], SHEET.invasion, tzOffsetHours, s, s.invasion_hidden, columns)
                : sheetSection(`${title} (${report.invasion.length})`, report.invasion, SHEET.invasion, tzOffsetHours, s, null, columns));
        }
        const total = sections.length > 1 ? n * 2 + 1 : n;
        const gap = '<td style="width:18px;"></td>';
        const filler = `<td colspan="${n}"></td>`;
        const height = Math.max(...sections.map(list => list.length));
        const body = [];
        for (let i = 0; i < height; i++) {
            body.push('<tr>' + sections.map(list => list[i] || filler).join(gap) + '</tr>');
        }
        const parts = [
            `<tr><td colspan="${total}" style="${SHEET.cell}background-color:#1e293b;color:#ffffff;font-weight:bold;font-size:15pt;height:40px;">📋 ${escapeHtml(s.title)}</td></tr>`,
            `<tr><td colspan="${total}" style="${SHEET.cell}background-color:#1e293b;color:#cbd5e1;font-size:10pt;">${escapeHtml(s.generated)} ${sheetTime(nowMs, tzOffsetHours)} (UTC${sign}${Math.abs(tzOffsetHours)})</td></tr>`,
            `<tr><td colspan="${total}" style="height:10px;"></td></tr>`,
            ...body
        ];
        const one = columns.map(col => `<col width="${col.width}">`).join('');
        const widths = sections.length > 1 ? one + '<col width="18">' + one : one;
        return `<meta charset="utf-8"><table style="border-collapse:collapse;"><colgroup>${widths}</colgroup><tbody>${parts.join('')}</tbody></table>`;
    }

    // Tab-separated fallback for a plain-text paste: still lands in separate columns.
    function reportTsv(report, view, nowMs, tzOffsetHours, lang) {
        const s = STR[lang] || STR.en;
        const lines = [`${s.title}\t${s.generated} ${sheetTime(nowMs, tzOffsetHours)}`];
        const add = (title, rows) => {
            const loc = report.showLocation;
            lines.push('', title, ['#', s.name, ...(loc ? [s.location] : []), s.died, s.spawn, s.status].join('\t'));
            rows.forEach((row, i) => lines.push([i + 1, row.name, ...(loc ? [row.location] : []), sheetTime(row.killMs, tzOffsetHours),
                row.status === 'unset' ? '-' : sheetTime(row.spawnMs, tzOffsetHours), statusLabel(row.status, s)].join('\t')));
        };
        if (view !== 'invasion') add(s.normal, report.normal);
        if (view !== 'normal' && !report.invasionHidden) add(invasionTitle(report, s), report.invasion);
        return lines.join('\n');
    }

    // Plain data for the Apps Script "Boss Report" tab (server/routes → google_apps_script/Code.gs).
    // Only text and a status key per row; Apps Script owns the colours and layout.
    function reportSheetData(report, view, nowMs, tzOffsetHours, lang) {
        const s = STR[lang] || STR.en;
        const sign = tzOffsetHours >= 0 ? '+' : '-';
        const headers = sheetColumns(report, s).map(col => col.label);
        const toRows = rows => rows.map((row, i) => ({
            status: row.status,
            values: [String(i + 1), row.name, ...(report.showLocation ? [row.location] : []),
                sheetTime(row.killMs, tzOffsetHours),
                row.status === 'unset' ? '-' : sheetTime(row.spawnMs, tzOffsetHours),
                statusLabel(row.status, s)]
        }));
        const sections = [];
        if (view !== 'invasion') sections.push({ kind: 'normal', title: `${s.normal} (${report.normal.length})`, headers, rows: toRows(report.normal), note: report.normal.length ? '' : s.empty });
        if (view !== 'normal') {
            const title = invasionTitle(report, s);
            sections.push(report.invasionHidden
                ? { kind: 'invasion', title, headers, rows: [], note: s.invasion_hidden }
                : { kind: 'invasion', title: `${title} (${report.invasion.length})`, headers, rows: toRows(report.invasion), note: report.invasion.length ? '' : s.empty });
        }
        return {
            title: `📋 ${s.title}`,
            subtitle: `${s.generated} ${sheetTime(nowMs, tzOffsetHours)} (UTC${sign}${Math.abs(tzOffsetHours)})`,
            columns: headers.length,
            sections
        };
    }

    // Midnight log snapshot (Mon/Wed/Fri, see google_apps_script/Code.gs invasionLogTick):
    // kill and spawn time of every boss that has a time, per server. Normal bosses are the
    // main server, saved as MAIN_SERVER rather than its name so a server move changes
    // nothing; invasion bosses are saved under the badge label active that night. The log
    // always includes invasion bosses, even while they are hidden on the dashboard. id and
    // the full ISO times let Admin import an invasion night back (POST /api/report/log/import).
    const MAIN_SERVER = 'Main';

    function snapshotRows(data, nowMs, tzOffsetHours) {
        const invasion = String((data && data.invasionLabel) || 'Invasion').trim();
        const report = buildReport({ bosses: data && data.bosses }, nowMs, { showUnset: false });
        const iso = ms => (ms === null || ms === undefined ? '' : new Date(ms).toISOString());
        const toRows = (rows, server, kind) => rows.map(row => ({
            server, kind, id: row.id, name: row.name,
            died: sheetTime(row.killMs, tzOffsetHours),
            spawns: sheetTime(row.spawnMs, tzOffsetHours),
            status: row.status,
            killIso: iso(row.killMs),
            spawnIso: iso(row.spawnMs)
        }));
        return [...toRows(report.normal, MAIN_SERVER, 'normal'), ...toRows(report.invasion, invasion, 'invasion')];
    }

    const core = { buildReport, bossStatus, formatTime, reportText, reportSheetHtml, reportTsv, reportSheetData, snapshotRows, MAIN_SERVER, STR, NOW_WINDOW_MS };
    if (typeof module !== 'undefined' && module.exports) module.exports = core;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.__bossTrackerReportLoaded) return;
    window.__bossTrackerReportLoaded = true;

    // ---------- Browser UI ----------

    function lang() {
        try { return localStorage.getItem('tracker_lang') === 'th' ? 'th' : 'en'; } catch (_) { return 'en'; }
    }

    function tr(key) {
        return STR[reportLang][key] ?? STR.en[key] ?? key;
    }

    function tzOffset() {
        try { return localStorage.getItem('dashboard.timeZoneOffset') === '8' ? 8 : 7; } catch (_) { return 7; }
    }

    function serverNow() {
        try {
            if (typeof window.getTrackerServerNow === 'function') return window.getTrackerServerNow().getTime();
        } catch (_) {}
        return Date.now();
    }

    function readPref(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            return value === null ? fallback : value;
        } catch (_) { return fallback; }
    }

    function writePref(key, value) {
        try { localStorage.setItem(key, value); } catch (_) {}
    }

    let modal = null;
    let data = null;
    let loading = false;
    let failed = false;
    let copied = false;
    let view = readPref('dashboard.reportView', 'normal');
    if (!['normal', 'invasion', 'all', 'log'].includes(view)) view = 'normal';
    // Midnight log (Admin): read from the "Invasion Log" tab via /api/report/log, once per
    // opening of the window or on Refresh. Never on a timer.
    let log = { loading: false, loaded: false, result: null };
    let logDate = null;  // selected calendar day ("y-m-d")
    let logMonth = null; // month shown in the calendar
    let logServer = 'all';
    let importState = null; // { busy, ok, text } for the last import in this window // Log filter: 'all' or one server (home name or invasion badge label)
    let showUnset = readPref('dashboard.reportShowUnset', 'false') === 'true';
    let showLocation = readPref('dashboard.reportShowLocation', 'false') === 'true'; // hidden by default
    // The report has its own EN/TH switch (per device); English is the default.
    let reportLang = readPref('dashboard.reportLang', 'en') === 'th' ? 'th' : 'en';
    let sheetsNotice = null; // null | working | written | ok | err | not_configured | script_outdated | failed
    let sheetUrl = null;
    let exporting = false;

    function h(tag, attrs, ...children) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs || {})) {
            if (value === null || value === undefined || value === false) continue;
            if (key === 'style') el.style.cssText = value;
            else if (key === 'class') el.className = value;
            else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
            else if (value === true) el.setAttribute(key, '');
            else el.setAttribute(key, value);
        }
        for (const child of children.flat(Infinity)) {
            if (child === null || child === undefined || child === false) continue;
            el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        }
        return el;
    }

    function injectStyles() {
        if (document.getElementById('boss-report-style')) return;
        const style = document.createElement('style');
        style.id = 'boss-report-style';
        style.textContent = `
            #boss-report-overlay{position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
            #boss-report-panel{width:min(620px,100%);max-height:88vh;display:flex;flex-direction:column;background:#101012;color:#f4f4f5;border:1px solid #3f3f46;border-radius:16px;padding:16px;box-sizing:border-box;font:14px/1.5 system-ui,sans-serif}
            #boss-report-panel h2{margin:0;font-size:17px;font-weight:700}
            #boss-report-panel h3{margin:14px 0 6px;font-size:13px;font-weight:700;color:#a1a1aa}
            #boss-report-panel .br-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
            #boss-report-panel .br-link{background:none;border:none;color:#38bdf8;padding:6px 0;font:600 13px system-ui;cursor:pointer}
            #boss-report-panel .br-tabs{display:flex;gap:6px;margin-top:12px;flex-wrap:wrap}
            #boss-report-panel .br-tab{padding:6px 12px;border-radius:999px;border:1px solid #3f3f46;background:#18181b;color:#d4d4d8;font:600 13px system-ui;cursor:pointer}
            #boss-report-panel .br-tab[aria-pressed=true]{background:#d97706;border-color:#d97706;color:#fff}
            #boss-report-panel .br-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;flex-wrap:wrap;font-size:13px;color:#d4d4d8}
            #boss-report-panel .br-btn{padding:7px 12px;border-radius:10px;border:1px solid #3f3f46;background:#18181b;color:#f4f4f5;font:600 13px system-ui;cursor:pointer}
            #boss-report-panel .br-primary{background:#d97706;border-color:#d97706;color:#fff}
            #boss-report-panel .br-body{overflow:auto;margin-top:8px;min-height:0}
            #boss-report-panel table{width:100%;border-collapse:collapse;font-size:13px}
            #boss-report-panel th{position:sticky;top:0;background:#101012;text-align:left;color:#a1a1aa;font-weight:600;padding:6px 6px;border-bottom:1px solid #3f3f46}
            #boss-report-panel td{padding:6px 6px;border-bottom:1px solid #27272a;vertical-align:top;white-space:nowrap}
            #boss-report-panel td.br-name{white-space:normal;font-weight:600}
            #boss-report-panel .br-loc{display:block;font-size:11px;font-weight:400;color:#71717a}
            #boss-report-panel .br-now{color:#f87171;font-weight:700}
            #boss-report-panel .br-alive{color:#fbbf24;font-weight:700}
            #boss-report-panel .br-unset{color:#71717a}
            #boss-report-panel .br-note{font-size:12px;color:#a1a1aa;margin:6px 0}
            #boss-report-panel .br-lang{display:inline-flex;border:1px solid #3f3f46;border-radius:8px;overflow:hidden}
            #boss-report-panel .br-lang button{padding:4px 10px;background:#18181b;color:#a1a1aa;border:none;font:700 12px system-ui;cursor:pointer}
            #boss-report-panel .br-lang button[aria-pressed=true]{background:#38bdf8;color:#0c0a09}
            #boss-report-panel .br-sheets{background:#0f9d58;border-color:#0f9d58;color:#fff}
            #boss-report-panel .br-ok{background:rgba(52,211,153,.12);color:#6ee7b7;border-radius:8px;padding:8px 10px;font-size:13px;margin-top:10px}
            #boss-report-panel .br-cal{margin:12px 0 4px;padding:10px;border:1px solid #27272a;border-radius:12px;background:#0b0b0d;max-width:320px}
            #boss-report-panel .br-cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:14px}
            #boss-report-panel .br-cal-nav{background:#18181b;border:1px solid #3f3f46;color:#f4f4f5;border-radius:8px;width:28px;height:28px;cursor:pointer;font:700 15px system-ui}
            #boss-report-panel .br-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center}
            #boss-report-panel .br-cal-wd{font-size:11px;color:#71717a;padding:2px 0}
            #boss-report-panel .br-cal-day{height:32px;border-radius:8px;border:1px solid transparent;background:none;color:#52525b;font:600 13px system-ui;cursor:default;position:relative}
            #boss-report-panel .br-cal-day.has{color:#f4f4f5;background:#18181b;border-color:#3f3f46;cursor:pointer}
            #boss-report-panel .br-cal-day.has::after{content:'';position:absolute;left:50%;bottom:4px;width:5px;height:5px;margin-left:-2.5px;border-radius:50%;background:#f59e0b}
            #boss-report-panel .br-cal-day.sel{background:#d97706;border-color:#d97706;color:#fff}
            #boss-report-panel .br-cal-day.sel::after{background:#fff}
            #boss-report-panel .br-err{background:rgba(248,113,113,.12);color:#fca5a5;border-radius:8px;padding:8px 10px;font-size:13px;margin-top:10px}
        `;
        document.head.appendChild(style);
    }

    function ensureButton() {
        if (document.getElementById('header-report-control')) return;
        const button = h('button', {
            id: 'header-report-control',
            type: 'button',
            class: 'compact-system-control no-drag',
            // A text label next to the icon: the bare 📋 emoji was too faint on the dark bar.
            // Same compact size as the other top-bar badges so the bar stays narrow.
            style: 'width:auto!important;min-width:0!important;height:22px!important;padding:0 6px!important;gap:3px!important;color:#38bdf8!important;background:rgba(56,189,248,.16)!important;border:1px solid rgba(56,189,248,.55)!important;border-radius:6px!important;font:700 9px/1 system-ui!important;white-space:nowrap!important;flex:0 0 auto!important;cursor:pointer',
            onclick: openModal
        }, '📋 ', h('span', { class: 'br-button-label' }, STR[lang()].button));
        document.body.appendChild(button);
        updateButtonLabel();
    }

    function updateButtonLabel() {
        const button = document.getElementById('header-report-control');
        if (!button) return;
        // The header button follows the dashboard EN/TH switch; the panel has its own.
        const title = STR[lang()].title;
        const label = button.querySelector('.br-button-label');
        if (label && label.textContent !== STR[lang()].button) label.textContent = STR[lang()].button;
        button.setAttribute('aria-label', title);
        button.setAttribute('data-unified-tooltip', title);
        button.removeAttribute('title');
    }

    function closeModal() {
        if (modal) modal.remove();
        modal = null;
        document.removeEventListener('keydown', onKey);
    }

    function onKey(e) {
        if (e.key === 'Escape') closeModal();
    }

    async function load() {
        loading = true;
        failed = false;
        render();
        try {
            const res = await fetch('/poll', {
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
            });
            const json = await res.json();
            if (!res.ok || json.notReady) throw new Error('not ready');
            data = json;
        } catch (_) {
            failed = true;
        }
        loading = false;
        render();
    }

    function openModal() {
        if (!isAdminPage()) return;
        injectStyles();
        closeModal();
        copied = false;
        log = { loading: false, loaded: false, result: null };
        logDate = null;
        logMonth = null;
        importState = null;
        sheetsNotice = null;
        sheetUrl = null;
        modal = h('div', { id: 'boss-report-overlay', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === modal) closeModal(); } },
            h('div', { id: 'boss-report-panel' }));
        document.body.appendChild(modal);
        document.addEventListener('keydown', onKey);
        load();
        if (view === 'log') loadLog();
    }

    function currentReport() {
        return buildReport(data || {}, serverNow(), { showUnset, showLocation });
    }

    function statusCell(row, tz) {
        const s = STR[reportLang];
        if (row.status === 'unset') return h('td', { class: 'br-unset' }, s.unset);
        if (row.status === 'alive') return h('td', { class: 'br-alive' }, s.alive);
        if (row.status === 'now') return h('td', { class: 'br-now' }, `${s.now} · ${formatTime(row.spawnMs, tz)}`);
        return h('td', null, formatTime(row.spawnMs, tz));
    }

    function table(rows, tz) {
        if (!rows.length) return h('p', { class: 'br-note' }, tr('empty'));
        return h('table', null,
            h('thead', null, h('tr', null, h('th', null, tr('name')), h('th', null, tr('died')), h('th', null, tr('spawn')))),
            h('tbody', null, rows.map(row => h('tr', { 'data-report-boss-id': String(row.id) }, // not data-boss-id: alert code targets real dashboard rows by that
                h('td', { class: 'br-name' }, row.name, row.location ? h('span', { class: 'br-loc' }, row.location) : null),
                h('td', { class: row.killMs === null ? 'br-unset' : null }, formatTime(row.killMs, tz)),
                statusCell(row, tz)))));
    }

    function section(title, rows, tz) {
        return [h('h3', null, `${title} (${rows.length})`), table(rows, tz)];
    }

    async function copyText() {
        const text = reportText(currentReport(), view, serverNow(), tzOffset(), reportLang);
        let ok = false;
        try {
            await navigator.clipboard.writeText(text);
            ok = true;
        } catch (_) {
            const area = h('textarea', { style: 'position:fixed;left:-9999px;top:0' });
            area.value = text;
            document.body.appendChild(area);
            area.select();
            try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
            area.remove();
        }
        if (ok) {
            copied = true;
            render();
            setTimeout(() => { copied = false; render(); }, 1500);
        }
    }

    // Copies the styled table, then opens a new Google Sheet to paste it into. The copy
    // runs synchronously inside the click so the browser allows both the copy and the
    // new tab (the desktop app opens https links in the default browser).
    function copyRich(html, text) {
        let ok = false;
        const onCopy = (e) => {
            e.clipboardData.setData('text/html', html);
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();
            ok = true;
        };
        const area = h('textarea', { style: 'position:fixed;left:-9999px;top:0' });
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.addEventListener('copy', onCopy, true);
        try { document.execCommand('copy'); } catch (_) { ok = false; }
        document.removeEventListener('copy', onCopy, true);
        area.remove();
        return ok;
    }

    // Fallback: copy the styled table and open a blank Google Sheet to paste into.
    function copyForSheets() {
        const report = currentReport();
        const now = serverNow();
        const tz = tzOffset();
        const ok = copyRich(reportSheetHtml(report, view, now, tz, reportLang), reportTsv(report, view, now, tz, reportLang));
        if (ok) window.open('https://sheets.new', '_blank', 'noopener');
        sheetsNotice = ok ? 'ok' : 'err';
        render();
    }

    // Main flow: the server has Apps Script write the "Boss Report" tab, then we open it.
    // A blank tab is opened inside the click (browsers block pop-ups opened later) and
    // pointed at the sheet when it is ready. The desktop app opens the link in the
    // default browser instead.
    async function exportToSheets() {
        if (exporting) return;
        exporting = true;
        sheetsNotice = 'working';
        sheetUrl = null;
        render();
        let tab = null;
        if (!window.electronAPI) {
            try { tab = window.open('', '_blank'); } catch (_) { tab = null; }
        }
        let result = { success: false, reason: 'failed' };
        try {
            const res = await fetch('/api/report/sheets', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify({ view, lang: reportLang, tz: tzOffset(), showUnset, showLocation })
            });
            result = await res.json().catch(() => result);
        } catch (_) {}
        exporting = false;
        if (result && result.success && /^https:\/\/docs\.google\.com\//.test(String(result.url || ''))) {
            sheetUrl = result.url;
            sheetsNotice = 'written';
            if (tab && !tab.closed) {
                try { tab.opener = null; tab.location.href = sheetUrl; } catch (_) { window.open(sheetUrl, '_blank', 'noopener'); }
            } else {
                window.open(sheetUrl, '_blank', 'noopener');
            }
        } else {
            if (tab) try { tab.close(); } catch (_) {}
            sheetsNotice = ['not_configured', 'script_outdated'].includes(result && result.reason) ? result.reason : 'failed';
        }
        render();
    }

    function sheetsMessage(s) {
        if (!sheetsNotice) return null;
        if (sheetsNotice === 'working') return h('p', { class: 'br-ok' }, s.sheets_working);
        if (sheetsNotice === 'written') {
            return h('p', { class: 'br-ok' }, s.sheets_written + ' ',
                sheetUrl ? h('a', { href: sheetUrl, target: '_blank', rel: 'noopener', style: 'color:#6ee7b7;font-weight:700' }, s.sheets_open) : null);
        }
        if (sheetsNotice === 'ok') return h('p', { class: 'br-ok' }, s.sheets_done);
        if (sheetsNotice === 'err') return h('p', { class: 'br-err' }, s.sheets_failed);
        const text = sheetsNotice === 'not_configured' ? s.sheets_not_configured
            : sheetsNotice === 'script_outdated' ? s.sheets_outdated : s.sheets_write_failed;
        return h('div', { class: 'br-err' }, text, ' ',
            h('button', { type: 'button', class: 'br-btn', style: 'margin-top:6px', onclick: copyForSheets }, '📋 ' + s.copy_table));
    }

    function langButton(code) {
        return h('button', {
            type: 'button',
            'aria-pressed': reportLang === code ? 'true' : 'false',
            onclick: () => { reportLang = code; writePref('dashboard.reportLang', code); render(); }
        }, code.toUpperCase());
    }

    function tabButton(key, label) {
        return h('button', {
            type: 'button',
            class: 'br-tab',
            'aria-pressed': view === key ? 'true' : 'false',
            onclick: () => {
                view = key;
                writePref('dashboard.reportView', key);
                render();
                if (key === 'log' && !log.loaded && !log.loading) loadLog();
            }
        }, label);
    }

    // The main server is saved as MAIN_SERVER (no fixed name); invasion servers by badge label.
    function serverName(name, s) {
        return name === MAIN_SERVER ? s.main_server : name; // just the name, e.g. "K1"
    }

    // Admin: put one logged night's invasion-server times back on the invasion bosses.
    async function importNight(day, server, s) {
        const question = s.import_confirm.replace('{server}', server).replace('{date}', `${day.day || ''} ${day.date || ''}`.trim());
        if (!window.confirm(question)) return;
        importState = { busy: true };
        render();
        let result = { success: false };
        try {
            const res = await fetch('/api/report/log/import', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify({ date: day.date, loggedAt: day.loggedAt, server })
            });
            result = await res.json().catch(() => result);
        } catch (_) {}
        if (result && result.success) {
            let text = s.import_done.replace('{n}', String(result.imported || 0));
            if (Array.isArray(result.skipped) && result.skipped.length) text += ' ' + s.import_skipped.replace('{names}', result.skipped.join(', '));
            importState = { ok: true, text };
        } else {
            importState = { ok: false, text: s.import_failed };
        }
        render();
    }

    async function loadLog() {
        log.loading = true;
        render();
        let result = { success: false, reason: 'failed' };
        try {
            const res = await fetch('/api/report/log', {
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
            });
            result = await res.json().catch(() => result);
        } catch (_) {}
        log = { loading: false, loaded: true, result };
        render();
    }

    function logBody(s) {
        if (log.loading || !log.loaded) return h('p', { class: 'br-note' }, s.loading);
        const result = log.result || {};
        if (!result.success) {
            const text = result.reason === 'not_configured' ? s.log_not_configured
                : result.reason === 'script_outdated' ? s.log_outdated : s.log_failed;
            return h('p', { class: 'br-err' }, text);
        }
        const allDays = Array.isArray(result.days) ? result.days : [];
        if (!allDays.length) return h('p', { class: 'br-note' }, s.log_empty);
        // Invasion servers are told apart by the badge label saved with each night.
        const servers = [];
        for (const day of allDays) for (const row of day.rows || []) if (row.server && !servers.includes(row.server)) servers.push(row.server);
        if (logServer !== 'all' && !servers.includes(logServer)) logServer = 'all';
        const chip = (key, label) => h('button', {
            type: 'button', class: 'br-tab', 'aria-pressed': logServer === key ? 'true' : 'false',
            onclick: () => { logServer = key; render(); }
        }, label);
        const filters = h('div', { class: 'br-tabs', style: 'margin-top:4px' },
            chip('all', s.all), servers.map(name => chip(name, serverName(name, s))));
        const days = allDays
            .map(day => ({ ...day, rows: (day.rows || []).filter(row => logServer === 'all' || row.server === logServer) }))
            .filter(day => logServer === 'all' || day.rows.length);
        if (!days.length) return [filters, h('p', { class: 'br-note' }, s.log_empty)];

        // Calendar: days with a log for the chosen server are clickable; newest by default.
        const parse = text => {
            const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text || '').trim());
            return m ? { d: Number(m[1]), m: Number(m[2]) - 1, y: Number(m[3]) } : null;
        };
        const keyOf = p => `${p.y}-${p.m}-${p.d}`;
        const logged = new Map();
        for (const day of days) {
            const p = parse(day.date);
            if (!p) continue;
            if (!logged.has(keyOf(p))) logged.set(keyOf(p), []);
            logged.get(keyOf(p)).push(day);
        }
        const newest = parse(days[0].date);
        if (!logDate || !logged.has(logDate)) logDate = newest ? keyOf(newest) : null;
        if (!logMonth && newest) logMonth = { y: newest.y, m: newest.m };
        if (!logMonth) { const t = new Date(); logMonth = { y: t.getFullYear(), m: t.getMonth() }; }
        const months = s === STR.th
            ? ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
            : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const weekdays = s === STR.th ? ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
        const shiftMonth = delta => {
            const next = new Date(Date.UTC(logMonth.y, logMonth.m + delta, 1));
            logMonth = { y: next.getUTCFullYear(), m: next.getUTCMonth() };
            render();
        };
        const first = new Date(Date.UTC(logMonth.y, logMonth.m, 1));
        const lead = (first.getUTCDay() + 6) % 7; // Monday first
        const daysInMonth = new Date(Date.UTC(logMonth.y, logMonth.m + 1, 0)).getUTCDate();
        const cells = [];
        for (let i = 0; i < lead; i++) cells.push(h('span', null));
        for (let d = 1; d <= daysInMonth; d++) {
            const key = keyOf({ y: logMonth.y, m: logMonth.m, d });
            const has = logged.has(key);
            cells.push(h('button', {
                type: 'button',
                class: 'br-cal-day' + (has ? ' has' : '') + (key === logDate ? ' sel' : ''),
                disabled: !has,
                onclick: has ? () => { logDate = key; render(); } : null
            }, String(d)));
        }
        const calendar = h('div', { class: 'br-cal' },
            h('div', { class: 'br-cal-head' },
                h('button', { type: 'button', class: 'br-cal-nav', 'aria-label': 'Previous month', onclick: () => shiftMonth(-1) }, '‹'),
                h('strong', null, `${months[logMonth.m]} ${logMonth.y}`),
                h('button', { type: 'button', class: 'br-cal-nav', 'aria-label': 'Next month', onclick: () => shiftMonth(1) }, '›')),
            h('div', { class: 'br-cal-grid' }, weekdays.map(w => h('span', { class: 'br-cal-wd' }, w)), cells));

        const picked = logged.get(logDate) || [];
        const importMessage = importState && !importState.busy
            ? h('p', { class: importState.ok ? 'br-ok' : 'br-err' }, importState.text) : null;
        return [filters, calendar, importMessage, picked.map(day => {
            const groups = [];
            for (const row of day.rows || []) {
                let group = groups.find(g => g.name === row.server);
                if (!group) groups.push(group = { name: row.server, rows: [] });
                group.rows.push(row);
            }
            return [
                h('h3', { style: 'color:#f4f4f5;font-size:14px;margin-top:16px' }, `📅 ${day.day || ''} ${day.date || ''}`,
                    h('span', { style: 'color:#71717a;font-weight:500;font-size:12px' }, ` · ${s.log_logged} ${day.loggedAt || ''}`)),
                groups.length ? groups.map(group => [
                    h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap' },
                        h('h3', null, `${serverName(group.name, s)} (${group.rows.length})`),
                        group.rows.some(row => row.kind === 'invasion')
                            ? h('button', {
                                type: 'button', class: 'br-btn', style: 'border-color:rgba(167,139,250,.6);color:#c4b5fd',
                                disabled: Boolean(importState && importState.busy),
                                onclick: () => importNight(day, group.name, s)
                            }, importState && importState.busy ? s.importing : '⬇️ ' + s.import_btn)
                            : null),
                    h('table', null,
                        h('thead', null, h('tr', null, h('th', null, s.name), h('th', null, s.died), h('th', null, s.spawn))),
                        h('tbody', null, group.rows.map(row => h('tr', null,
                            h('td', { class: 'br-name' }, String(row.name || '')),
                            h('td', null, String(row.died || '-')),
                            h('td', null, String(row.spawns || '-'))))))
                ]) : h('p', { class: 'br-note' }, '-')
            ];
        })];
    }

    function render() {
        const panel = document.getElementById('boss-report-panel');
        if (!panel) return;
        const s = STR[reportLang];
        const tz = tzOffset();
        let body;
        let report = null;
        if (view === 'log') body = logBody(s);
        else if (loading && !data) body = h('p', { class: 'br-note' }, s.loading);
        else if (failed && !data) body = h('p', { class: 'br-err' }, s.error);
        else {
            report = currentReport();
            const invTitle = invasionTitle(report, s);
            const parts = [];
            if (failed) parts.push(h('p', { class: 'br-err' }, s.error));
            if (view !== 'invasion') parts.push(section(s.normal, report.normal, tz));
            if (view !== 'normal') {
                if (report.invasionHidden) parts.push(h('h3', null, invTitle), h('p', { class: 'br-note' }, s.invasion_hidden));
                else parts.push(section(invTitle, report.invasion, tz));
            }
            body = parts;
        }
        const invLabel = data && String(data.invasionLabel || '').trim();
        const nodes = [
            h('div', { class: 'br-head' },
                h('h2', null, '📋 ' + s.title),
                h('div', { style: 'display:flex;align-items:center;gap:10px' },
                    h('div', { class: 'br-lang', role: 'group', 'aria-label': 'Language' }, langButton('en'), langButton('th')),
                    h('button', { class: 'br-link', type: 'button', onclick: closeModal }, s.close))),
            h('div', { class: 'br-tabs' },
                tabButton('normal', s.normal),
                tabButton('invasion', invLabel ? `${s.invasion} ${invLabel}` : s.invasion),
                tabButton('all', s.all),
                tabButton('log', '📜 ' + s.log)),
            view === 'log' ? h('div', { class: 'br-tools' },
                h('span', { class: 'br-note', style: 'margin:0;flex:1 1 220px' }, s.log_hint),
                h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
                    h('button', { type: 'button', class: 'br-btn', disabled: log.loading, onclick: loadLog }, log.loading ? s.loading : s.refresh),
                    log.result && log.result.url
                        ? h('a', { class: 'br-btn br-sheets', href: log.result.url, target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, '📊 ' + s.log_open)
                        : null)) : null,
            view === 'log' ? null : h('div', { class: 'br-tools' },
                h('label', { style: 'display:flex;align-items:center;gap:6px;cursor:pointer' },
                    h('input', { type: 'checkbox', checked: showUnset, onchange: (e) => { showUnset = e.target.checked; writePref('dashboard.reportShowUnset', String(showUnset)); render(); } }),
                    s.show_unset),
                h('label', { style: 'display:flex;align-items:center;gap:6px;cursor:pointer' },
                    h('input', { type: 'checkbox', checked: showLocation, onchange: (e) => { showLocation = e.target.checked; writePref('dashboard.reportShowLocation', String(showLocation)); render(); } }),
                    s.show_location),
                h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
                    h('button', { type: 'button', class: 'br-btn', disabled: loading, onclick: load }, loading ? s.loading : s.refresh),
                    h('button', { type: 'button', class: 'br-btn', disabled: !report, onclick: copyText }, copied ? '✓ ' + s.copied : s.copy),
                    h('button', { type: 'button', class: 'br-btn br-sheets', disabled: !report || exporting, onclick: exportToSheets }, '📊 ' + s.sheets))),
            view === 'log' ? null : sheetsMessage(s),
            h('div', { class: 'br-body' }, body)
        ];
        panel.replaceChildren(...nodes.filter(Boolean)); // replaceChildren would print null as "null"
    }

    window.addEventListener('tracker:languagechange', () => {
        updateButtonLabel();
        if (modal) render();
    });

    // Owner's choice: the report and Google Sheets export are for Admin only. Member and
    // Guest never get the button. (The report only shows boss times every logged-in user
    // already sees on the dashboard, and it never writes anything.)
    function isAdminPage() {
        try {
            const page = JSON.parse(document.getElementById('app')?.getAttribute('data-page') || '{}');
            return page.props?.auth?.user?.role === 'admin';
        } catch (_) {
            return false;
        }
    }

    function start() {
        if (!document.getElementById('app')) return; // dashboard only, not the login page
        if (!isAdminPage()) return;
        ensureButton();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})(typeof window !== 'undefined' ? window : globalThis);
