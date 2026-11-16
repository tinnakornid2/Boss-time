/**
 * =========================================================================
 * Lineage 2 Boss Tracker - Google Apps Script Parallel Database (v1.0)
 * =========================================================================
 * สคริปต์สำหรับติดตั้งบน Google Sheets เพื่อทำหน้าที่เป็นฐานข้อมูลกลางคู่ขนาน
 * รองรับการ Mirror ข้อมูลจาก Node.js Server และดึงข้อมูลกรณี Failover
 * 
 * วิธีติดตั้ง:
 * 1. สร้าง Google Spreadsheet ใหม่ใน Google Drive ของคุณ
 * 2. ไปที่เมนู "Extensions" (ส่วนขยาย) -> "Apps Script"
 * 3. ลบโค้ดเดิมออกทั้งหมด แล้ววางโค้ดไฟล์นี้ลงไป
 * 4. แก้ไขค่า SECRET_TOKEN ด้านล่างให้ตรงกับที่จะใช้ในระบบ Boss Tracker
 * 5. กดบันทึก (Ctrl + S)
 * 6. กดปุ่ม "Deploy" (ทำให้ใช้งานได้) -> "New deployment" (การทำให้ใช้งานได้ใหม่)
 * 7. เลือกประเภทเป็น "Web app" (เว็บแอปพลิเคชัน)
 *    - Description: Boss Tracker Parallel DB
 *    - Execute as: Me (ฉัน)
 *    - Who has access: Anyone (ทุกคน) ** สำคัญมาก **
 * 8. กด Deploy และคัดลอก "Web app URL" (ลงท้ายด้วย /exec) ไปใส่ในระบบ Boss Tracker
 * =========================================================================
 */

// กำหนด Secret Token สำหรับความปลอดภัย (ต้องตรงกับใน Node.js Server)
var SECRET_TOKEN = 'boss-parallel-secret-777999';

// ชื่อแท็บต่างๆ ใน Spreadsheet
var SHEET_BOSSES = 'Bosses';
var SHEET_EVENTS = 'Events';
var SHEET_SETTINGS = 'Settings';
var SHEET_METADATA = 'Metadata';
var SHEET_LOG = 'AuditLog';

/**
 * Handle GET Requests (เช่น การตรวจสอบ Health Ping หรือดึงข้อมูลทั้งหมดเมื่อ Failover)
 */
function doGet(e) {
  try {
    var params = e ? e.parameter : {};
    var action = params.action || 'ping';
    var token = params.token || '';

    // ตรวจสอบ Token
    if (token !== SECRET_TOKEN && action !== 'ping') {
      return jsonResponse({ success: false, message: 'Unauthorized: Invalid token' }, 401);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'ping') {
      return jsonResponse({
        success: true,
        status: 'online',
        message: 'Google Apps Script Parallel DB is active and ready',
        timestamp: new Date().toISOString(),
        spreadsheetName: ss.getName(),
        tokenVerified: (token === SECRET_TOKEN)
      });
    }

    if (action === 'get_store') {
      return jsonResponse(readFullStore(ss));
    }

    if (action === 'get_log') {
      return jsonResponse(readInvasionLog(ss));
    }

    return jsonResponse({ success: false, message: 'Unknown action: ' + action }, 400);

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() }, 500);
  }
}

/**
 * Handle POST Requests (รับการ Mirror ข้อมูลจาก Server)
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // รอ Lock ไม่เกิน 30 วินาที เพื่อป้องกัน Race Condition ในการเขียน Sheets
    lock.waitLock(30000);

    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, message: 'No payload received' }, 400);
    }

    var payload = JSON.parse(e.postData.contents);
    var token = payload.token || (e.parameter ? e.parameter.token : '');

    if (token !== SECRET_TOKEN) {
      return jsonResponse({ success: false, message: 'Unauthorized: Invalid token' }, 401);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = payload.action;
    var result = { success: true, action: action, timestamp: new Date().toISOString() };

    // Admin "Export to Google Sheets": writes only the Boss Report tab and returns its
    // link. It is not a data mutation, so it leaves Bosses/Events/Settings/Metadata alone.
    if (action === 'write_report') {
      result.url = writeBossReport(ss, payload.report);
      return jsonResponse(result);
    }

    switch (action) {
      case 'ping':
        result.message = 'Pong! Authorized successfully';
        break;

      case 'sync_full':
        result.details = syncFullStore(ss, payload.store);
        logAudit(ss, 'SYNC_FULL', 'Full database synchronized from primary server');
        break;

      case 'update_boss':
        result.details = updateSingleBoss(ss, payload.boss);
        logAudit(ss, 'UPDATE_BOSS', 'Updated boss ID: ' + (payload.boss ? payload.boss.id : 'unknown'));
        break;

      case 'batch_update_bosses':
        result.details = batchUpdateBosses(ss, payload.bosses);
        logAudit(ss, 'BATCH_UPDATE_BOSSES', 'Updated ' + (payload.bosses ? Object.keys(payload.bosses).length : 0) + ' bosses');
        break;

      case 'update_events':
        result.details = syncEvents(ss, payload.events);
        logAudit(ss, 'UPDATE_EVENTS', 'Events synchronized');
        break;

      case 'update_settings':
        result.details = syncSettings(ss, payload.settings);
        logAudit(ss, 'UPDATE_SETTINGS', 'Settings updated');
        break;

      default:
        return jsonResponse({ success: false, message: 'Unknown action: ' + action }, 400);
    }

    // อัปเดต Metadata Revision
    updateMetadata(ss, payload.dataRevision);

    return jsonResponse(result);

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() }, 500);
  } finally {
    lock.releaseLock();
  }
}

/**
 * ฟังก์ชันสร้างหรือดึงแท็บชีต
 */
function getOrCreateSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

/**
 * จัดรูปแบบหัวตาราง
 */
function formatHeader(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1e293b')
    .setFontColor('#f8fafc');
  sheet.setFrozenRows(1);
}

/**
 * ซิงค์ข้อมูลบอสทั้งหมดลงแท็บ Bosses
 */
function syncFullStore(ss, store) {
  if (!store) return { error: 'Empty store' };

  // 1. ซิงค์ Bosses
  var bosses = store.bosses || [];
  var bSheet = getOrCreateSheet(ss, SHEET_BOSSES);
  bSheet.clearContents();

  var bHeaders = [
    'ID', 'Name', 'Location', 'Interval (Min)', 'Chance %', 'Is Invasion',
    'Color', 'Last Kill Time', 'Next Spawn Time', 'Pinned Alive', 'Auto Advanced',
    'Post Maintenance', 'Pre Spawned', 'Updated At'
  ];
  formatHeader(bSheet, bHeaders);

  if (bosses.length > 0) {
    var rows = bosses.map(function(b) {
      return [
        b.id || '',
        b.name || '',
        b.location || '',
        b.interval || 60,
        b.chance_of_appearing || '100.00',
        b.is_invasion ? 'YES' : 'NO',
        b.color || '',
        b.last_kill_time || '',
        b.next_spawn || '',
        b.pinned_alive ? 'YES' : 'NO',
        b.auto_advanced ? 'YES' : 'NO',
        b.post_maintenance ? 'YES' : 'NO',
        b.pre_spawned ? 'YES' : 'NO',
        b.updated_at || new Date().toISOString()
      ];
    });
    bSheet.getRange(2, 1, rows.length, bHeaders.length).setValues(rows);
  }

  // 2. ซิงค์ Events
  syncEvents(ss, store.allEvents || store.events || []);

  // 3. ซิงค์ Settings & Reset Configs
  syncSettings(ss, store.settings || {}, store.resetTimeConfigs || {});

  return { bossesCount: bosses.length };
}

/**
 * อัปเดตข้อมูลบอสตัวเดียวตาม ID
 */
function updateSingleBoss(ss, boss) {
  if (!boss || !boss.id) return { error: 'Invalid boss object' };
  var bSheet = getOrCreateSheet(ss, SHEET_BOSSES);
  var data = bSheet.getDataRange().getValues();
  if (data.length <= 1) {
    // ถ้ายังไม่มีแถวข้อมูล ให้ซิงค์ใหม่
    return syncFullStore(ss, { bosses: [boss] });
  }

  var targetId = String(boss.id);
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === targetId) {
      rowIndex = i + 1;
      break;
    }
  }

  var rowData = [
    boss.id || '',
    boss.name || '',
    boss.location || '',
    boss.interval || 60,
    boss.chance_of_appearing || '100.00',
    boss.is_invasion ? 'YES' : 'NO',
    boss.color || '',
    boss.last_kill_time || '',
    boss.next_spawn || '',
    boss.pinned_alive ? 'YES' : 'NO',
    boss.auto_advanced ? 'YES' : 'NO',
    boss.post_maintenance ? 'YES' : 'NO',
    boss.pre_spawned ? 'YES' : 'NO',
    boss.updated_at || new Date().toISOString()
  ];

  if (rowIndex > 0) {
    bSheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    bSheet.appendRow(rowData);
  }

  return { updatedId: boss.id, row: rowIndex };
}

/**
 * อัปเดตบอสหลายตัวพร้อมกัน
 */
function batchUpdateBosses(ss, bossesList) {
  if (!bossesList) return { count: 0 };
  var items = Array.isArray(bossesList) ? bossesList : Object.values(bossesList);
  for (var i = 0; i < items.length; i++) {
    updateSingleBoss(ss, items[i]);
  }
  return { updatedCount: items.length };
}

/**
 * ซิงค์ข้อมูลแท็บ Events
 */
function syncEvents(ss, events) {
  var sheet = getOrCreateSheet(ss, SHEET_EVENTS);
  sheet.clearContents();

  var headers = ['ID', 'Name', 'Location', 'Event Time', 'Occurs On', 'Auto Done (Min)', 'Done On', 'Pinned Alive', 'Next Spawn', 'Color'];
  formatHeader(sheet, headers);

  if (events && events.length > 0) {
    var rows = events.map(function(ev) {
      var days = Array.isArray(ev.occurs_on) ? ev.occurs_on.join(', ') : (ev.occurs_on || '');
      return [
        ev.id || '',
        ev.name || '',
        ev.location || '',
        ev.event_time || '',
        days,
        ev.auto_done_minutes || 10,
        ev.done_on || '',
        ev.pinned_alive ? 'YES' : 'NO',
        ev.next_spawn || '',
        ev.color || ''
      ];
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  return { eventsCount: events ? events.length : 0 };
}

/**
 * ซิงค์ข้อมูล Settings
 */
function syncSettings(ss, settings, resetConfigs) {
  var sheet = getOrCreateSheet(ss, SHEET_SETTINGS);
  sheet.clearContents();

  var headers = ['Key', 'Value', 'Updated At'];
  formatHeader(sheet, headers);

  var nowStr = new Date().toISOString();
  var rows = [];

  for (var k in settings) {
    if (k.toLowerCase().includes('password') || k.toLowerCase().includes('token') || k.toLowerCase().includes('secret')) continue;
    var val = typeof settings[k] === 'object' ? JSON.stringify(settings[k]) : String(settings[k]);
    rows.push([k, val, nowStr]);
  }

  if (resetConfigs) {
    rows.push(['resetTimeConfigs', JSON.stringify(resetConfigs), nowStr]);
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  return { settingsCount: rows.length };
}

/**
 * อัปเดตข้อมูล Metadata ในแท็บ Metadata
 */
function updateMetadata(ss, dataRevision) {
  var sheet = getOrCreateSheet(ss, SHEET_METADATA);
  sheet.clearContents();
  formatHeader(sheet, ['Property', 'Value']);

  var rows = [
    ['LastSyncAt', new Date().toISOString()],
    ['DataRevision', dataRevision || 1],
    ['Version', '1.3.25-gas'],
    ['Status', 'HEALTHY']
  ];
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
}

/**
 * บันทึกประวัติการซิงค์ลงแท็บ AuditLog (จำกัดไม่เกิน 500 แถว)
 */
function logAudit(ss, action, details) {
  var sheet = getOrCreateSheet(ss, SHEET_LOG);
  if (sheet.getLastRow() === 0) {
    formatHeader(sheet, ['Timestamp', 'Action', 'Details']);
  }
  sheet.appendRow([new Date().toISOString(), action, details]);
  if (sheet.getLastRow() > 500) {
    sheet.deleteRow(2); // ลบแถวเก่าสุด
  }
}

/**
 * อ่านข้อมูลทั้งหมดจาก Google Sheets เพื่อส่งกลับไปให้ Node.js กรณี Failover
 */
function readFullStore(ss) {
  var store = {
    bosses: [],
    allEvents: [],
    events: [],
    settings: {},
    resetTimeConfigs: {},
    meta: { source: 'google_sheets_failover', dataRevision: 1 }
  };

  // อ่าน Bosses
  var bSheet = ss.getSheetByName(SHEET_BOSSES);
  if (bSheet && bSheet.getLastRow() > 1) {
    var bValues = bSheet.getDataRange().getValues();
    for (var i = 1; i < bValues.length; i++) {
      var row = bValues[i];
      if (!row[0]) continue;
      store.bosses.push({
        id: Number(row[0]),
        name: String(row[1]),
        location: String(row[2]),
        interval: Number(row[3]) || 60,
        chance_of_appearing: String(row[4]),
        is_invasion: String(row[5]) === 'YES',
        color: row[6] ? String(row[6]).trim() : null,
        last_kill_time: row[7] ? String(row[7]) : null,
        next_spawn: row[8] ? String(row[8]) : null,
        pinned_alive: String(row[9]) === 'YES',
        auto_advanced: String(row[10]) === 'YES',
        post_maintenance: String(row[11]) === 'YES',
        pre_spawned: String(row[12]) === 'YES',
        updated_at: row[13] ? String(row[13]) : new Date().toISOString()
      });
    }
  }

  // อ่าน Events
  var eSheet = ss.getSheetByName(SHEET_EVENTS);
  if (eSheet && eSheet.getLastRow() > 1) {
    var eValues = eSheet.getDataRange().getValues();
    for (var j = 1; j < eValues.length; j++) {
      var erow = eValues[j];
      if (!erow[0]) continue;
      store.allEvents.push({
        id: Number(erow[0]),
        name: String(erow[1]),
        location: String(erow[2]),
        event_time: String(erow[3]),
        occurs_on: String(erow[4]).split(',').map(function(s) { return s.trim(); }),
        auto_done_minutes: Number(erow[5]) || 10,
        done_on: erow[6] ? String(erow[6]) : null,
        pinned_alive: String(erow[7]) === 'YES',
        next_spawn: erow[8] ? String(erow[8]) : null,
        color: erow[9] ? String(erow[9]).trim() : null
      });
    }
    store.events = store.allEvents;
  }

  // อ่าน Settings
  var sSheet = ss.getSheetByName(SHEET_SETTINGS);
  if (sSheet && sSheet.getLastRow() > 1) {
    var sValues = sSheet.getDataRange().getValues();
    for (var k = 1; k < sValues.length; k++) {
      var sKey = String(sValues[k][0]);
      var sVal = sValues[k][1];
      if (sKey === 'resetTimeConfigs') {
        try { store.resetTimeConfigs = JSON.parse(sVal); } catch (e) {}
      } else {
        store.settings[sKey] = sVal;
      }
    }
  }

  // อ่าน Metadata
  var mSheet = ss.getSheetByName(SHEET_METADATA);
  if (mSheet && mSheet.getLastRow() > 1) {
    var mValues = mSheet.getDataRange().getValues();
    for (var m = 1; m < mValues.length; m++) {
      var mKey = String(mValues[m][0]);
      if (mKey === 'DataRevision') store.meta.dataRevision = Number(mValues[m][1]) || 1;
      if (mKey === 'LastSyncAt') store.meta.lastSyncAt = String(mValues[m][1]);
    }
  }

  return { success: true, store: store };
}

/**
 * =========================================================================
 * Boss time report (Admin "Export to Google Sheets")
 * =========================================================================
 * Rewrites the "Boss Report" tab on every export: title band, one coloured table per
 * boss type (normal = orange, invasion = purple), borders, zebra rows and a coloured
 * status cell. Times arrive as text ("16/11 · 14:00") and stay text.
 */
var SHEET_REPORT = 'Boss Report';

// Soft, low-glare palette: pastel section bands with dark text, light header rows,
// faint zebra stripes, thin horizontal rules only, and status shown as soft "chips".
var REPORT_STYLE = {
  font: 'Roboto',
  titleBg: '#1e293b', titleFg: '#ffffff', subtitleFg: '#cbd5e1',
  normal: { band: '#fde7c8', bandFg: '#7c2d12', head: '#fff7ed', headFg: '#9a3412' },
  invasion: { band: '#e9ddff', bandFg: '#4c1d95', head: '#f7f3ff', headFg: '#5b21b6' },
  rule: '#e5e7eb', zebra: '#f9fafb', text: '#344054', strong: '#101828', muted: '#667085',
  status: {
    now: { bg: '#fee4e2', fg: '#b42318', bold: true },
    alive: { bg: '#fef0c7', fg: '#93370d', bold: true },
    upcoming: { bg: '#ecfdf3', fg: '#027a48', bold: false },
    unset: { bg: null, fg: '#98a2b3', bold: false }
  }
};

// Sections sit side by side (normal on the left, invasion on the right) with a narrow
// gap column between them, so both lists are visible without scrolling down.
function writeBossReport(ss, report) {
  if (!report || !report.sections) throw new Error('Empty report');
  var st = REPORT_STYLE;
  var cols = Math.max(1, Math.min(10, Number(report.columns) || 5));
  var sections = report.sections.slice(0, 2);
  var totalCols = sections.length > 1 ? cols * 2 + 1 : cols;
  var sheet = getOrCreateSheet(ss, SHEET_REPORT);
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(0);

  function band(row, col, width, text, bg, fg, size, bold) {
    sheet.getRange(row, col, 1, width).merge()
      .setValue(String(text || ''))
      .setBackground(bg).setFontColor(fg).setFontSize(size)
      .setFontWeight(bold ? 'bold' : 'normal')
      .setHorizontalAlignment('left').setVerticalAlignment('middle');
  }

  band(1, 1, totalCols, report.title, st.titleBg, st.titleFg, 15, true);
  sheet.setRowHeight(1, 40);
  band(2, 1, totalCols, report.subtitle, st.titleBg, st.subtitleFg, 10, false);
  sheet.setRowHeight(2, 24);
  sheet.setRowHeight(3, 14); // spacer

  var top = 4;
  var lastRow = top;
  for (var s = 0; s < sections.length; s++) {
    var section = sections[s];
    var col = 1 + s * (cols + 1);
    var palette = section.kind === 'invasion' ? st.invasion : st.normal;
    var row = top;
    band(row++, col, cols, section.title, palette.band, palette.bandFg, 12, true);

    var rows = section.rows || [];
    if (!rows.length) {
      band(row++, col, cols, section.note || '-', '#ffffff', st.muted, 10, false);
    } else {
      sheet.getRange(row, col, 1, cols).setValues([pad(section.headers, cols)])
        .setBackground(palette.head).setFontColor(palette.headFg).setFontWeight('bold')
        .setFontSize(10).setHorizontalAlignment('center').setVerticalAlignment('middle');
      sheet.getRange(row, col + 1).setHorizontalAlignment('left');
      row++;

      var body = sheet.getRange(row, col, rows.length, cols);
      body.setNumberFormat('@').setValues(rows.map(function (r) { return pad(r.values, cols); }))
        .setFontSize(11).setFontColor(st.text).setHorizontalAlignment('center').setVerticalAlignment('middle');
      sheet.getRange(row, col, rows.length, 1).setFontColor(st.muted).setFontSize(10);
      sheet.getRange(row, col + 1, rows.length, 1).setFontWeight('bold').setFontColor(st.strong).setHorizontalAlignment('left');
      sheet.getRange(row, col + cols - 2, rows.length, 1).setFontWeight('bold').setFontColor(st.strong);

      var backgrounds = [];
      var fontColors = [];
      var weights = [];
      for (var i = 0; i < rows.length; i++) {
        var zebra = i % 2 === 1 ? st.zebra : '#ffffff';
        var chip = st.status[rows[i].status] || st.status.upcoming;
        var bgRow = [];
        for (var c = 0; c < cols; c++) bgRow.push(c === cols - 1 && chip.bg ? chip.bg : zebra);
        backgrounds.push(bgRow);
        fontColors.push([chip.fg]);
        weights.push([chip.bold ? 'bold' : 'normal']);
      }
      body.setBackgrounds(backgrounds);
      sheet.getRange(row, col + cols - 1, rows.length, 1).setFontColors(fontColors).setFontWeights(weights);
      row += rows.length;
    }

    // Thin outer frame and horizontal rules only (no vertical lines) for a calm look.
    sheet.getRange(top, col, row - top, cols)
      .setBorder(true, true, true, true, false, true, st.rule, SpreadsheetApp.BorderStyle.SOLID);
    lastRow = Math.max(lastRow, row);
  }

  sheet.setRowHeight(top, 32);
  if (lastRow - top > 1) sheet.setRowHeights(top + 1, lastRow - top - 1, 28);
  sheet.getRange(1, 1, lastRow, totalCols).setFontFamily(st.font);

  // Column widths per table: # | Boss | (Location) | Died | Spawns | Status
  for (var t = 0; t < sections.length; t++) {
    var c0 = 1 + t * (cols + 1);
    sheet.setColumnWidth(c0, 40);
    sheet.setColumnWidth(c0 + 1, 190);
    for (var k = 2; k < cols; k++) sheet.setColumnWidth(c0 + k, k === cols - 1 ? 110 : 125);
    if (cols >= 6) sheet.setColumnWidth(c0 + 2, 170); // Location column, when shown
    if (t === 0 && sections.length > 1) sheet.setColumnWidth(c0 + cols, 18); // gap column
  }
  sheet.setFrozenRows(2);
  ss.setActiveSheet(sheet);
  return ss.getUrl() + '#gid=' + sheet.getSheetId();
}

function pad(values, cols) {
  var out = [];
  for (var i = 0; i < cols; i++) out.push(values && values[i] !== undefined ? String(values[i]) : '');
  return out;
}

/**
 * Helper คืนค่าผลลัพธ์เป็น JSON Output
 */
function jsonResponse(obj, status) {
  var textOutput = ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return textOutput;
}

/**
 * =========================================================================
 * Phone alerts (Web Push) one-minute trigger
 * =========================================================================
 * Google sends nothing itself: once a minute it asks the Boss Tracker server
 * (POST /api/push/tick) to send any alerts that are due. The server reads its
 * in-memory data, so this adds no Firebase reads or writes.
 *
 * Setup (once):
 * 1. Project Settings (gear icon) -> Script Properties -> add:
 *      PUSH_TICK_URL    = https://boss-time-eloni.vercel.app/api/push/tick
 *      PUSH_TICK_SECRET = same value as PUSH_TICK_SECRET in Vercel
 * 2. In the editor choose installPushTickTrigger and press Run (allow access).
 * To stop: run removePushTickTrigger.
 * The secret lives only in Script Properties, never in this file.
 */
function pushTick() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('PUSH_TICK_URL');
  var secret = props.getProperty('PUSH_TICK_SECRET');
  if (!url || !secret) {
    console.warn('pushTick: set PUSH_TICK_URL and PUSH_TICK_SECRET in Script Properties');
    return;
  }
  // One tick at a time, so two runs never send the same minute twice.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  // Midnight boss log (Mon/Wed/Fri). Runs at most once per night; never stops the tick.
  try { invasionLogTick(props, url, secret, false); } catch (logErr) { console.warn('invasionLog: ' + logErr); }
  try {
    // PUSH_TICK_SINCE is the end of the last window the server finished. Sending it back
    // makes every window start where the previous one ended, whichever server instance
    // answers, so each alert is sent exactly once.
    var since = Number(props.getProperty('PUSH_TICK_SINCE')) || null;
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ since: since }),
      headers: { 'x-push-tick-secret': secret },
      muteHttpExceptions: true,
      followRedirects: false
    });
    var code = response.getResponseCode();
    if (code !== 200) {
      // 503 right after a deploy is normal (server still loading); the next minute retries
      // the same window.
      console.warn('pushTick: HTTP ' + code);
      return;
    }
    var until = Number(JSON.parse(response.getContentText()).until);
    if (until > 0) props.setProperty('PUSH_TICK_SINCE', String(until));
  } catch (e) {
    console.warn('pushTick: ' + e);
  } finally {
    lock.releaseLock();
  }
}

/**
 * =========================================================================
 * Midnight boss log ("Invasion Log" tab), kept for 30 days
 * =========================================================================
 * At midnight Thailand time that ends each Monday, Wednesday and Friday, pushTick (which
 * already runs every minute) asks the server for a snapshot of every boss's kill and spawn
 * time, per server (home server and invasion server), and appends it here with the date.
 * Rows older than 30 days are deleted. Uses the same PUSH_TICK_URL / PUSH_TICK_SECRET
 * Script Properties as the phone alerts; the server reads its memory, no Firebase traffic.
 * To write a log right now for testing, run runInvasionLogNow from the editor.
 */
var SHEET_INVASION_LOG = 'Invasion Log';
var LOG_DAYS = [1, 3, 5];          // Monday, Wednesday, Friday (ISO day numbers)
var LOG_KEEP_DAYS = 30;
var LOG_TZ = 'Asia/Bangkok';
// Columns 1-8 are what people read; 9-14 are hidden helpers: ts for the 30-day clean-up,
// and kind/id/full times/status key so Admin can import an invasion night back.
var LOG_HEADERS = ['Date', 'Day', 'Logged at', 'Server', 'Boss', 'Died', 'Spawns', 'Status', 'ts', 'kind', 'id', 'killIso', 'spawnIso', 'statusKey'];
var LOG_VISIBLE = 8;
var LOG_MAIN_SERVER = 'Main'; // the main server, whatever it is called (server moves change nothing)
var LOG_DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function invasionLogTick(props, tickUrl, secret, force) {
  var now = new Date();
  // The run just after midnight logs the day that has just ended.
  var ended = new Date(now.getTime() - 60 * 60 * 1000);
  var hour = Number(Utilities.formatDate(now, LOG_TZ, 'H'));
  var endedDay = Number(Utilities.formatDate(ended, LOG_TZ, 'u'));
  var dateKey = Utilities.formatDate(force ? now : ended, LOG_TZ, 'yyyy-MM-dd');
  if (!force) {
    if (hour !== 0 || LOG_DAYS.indexOf(endedDay) === -1) return;
    if (props.getProperty('INVASION_LOG_DONE') === dateKey) {
      // Log already saved tonight: make sure the invasion reset has run too.
      if (props.getProperty('INVASION_RESET_DONE') !== dateKey) resetInvasionAfterLog(props, tickUrl, secret, dateKey);
      return;
    }
  }
  var snapshotUrl = String(tickUrl).replace(/\/api\/push\/tick\/?$/, '/api/report/snapshot');
  var response = UrlFetchApp.fetch(snapshotUrl, {
    method: 'get',
    headers: { 'x-push-tick-secret': secret },
    muteHttpExceptions: true,
    followRedirects: false
  });
  if (response.getResponseCode() !== 200) {
    console.warn('invasionLog: HTTP ' + response.getResponseCode()); // retried next minute
    return;
  }
  var data = JSON.parse(response.getContentText());
  var day = force ? now : ended;
  writeInvasionLog(SpreadsheetApp.getActiveSpreadsheet(), data, day);
  props.setProperty('INVASION_LOG_DONE', dateKey);
  // Owner's rule: after the scheduled log is saved, hide invasion bosses and clear their
  // times until Admin shows them again. Never on the manual test run (runInvasionLogNow).
  if (!force) resetInvasionAfterLog(props, tickUrl, secret, dateKey);
}

function resetInvasionAfterLog(props, tickUrl, secret, dateKey) {
  var resetUrl = String(tickUrl).replace(/\/api\/push\/tick\/?$/, '/api/report/after-log');
  var response = UrlFetchApp.fetch(resetUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: '{}',
    headers: { 'x-push-tick-secret': secret },
    muteHttpExceptions: true,
    followRedirects: false
  });
  if (response.getResponseCode() !== 200) {
    console.warn('invasionReset: HTTP ' + response.getResponseCode()); // retried next minute
    return;
  }
  props.setProperty('INVASION_RESET_DONE', dateKey);
}

function runInvasionLogNow() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('PUSH_TICK_URL');
  var secret = props.getProperty('PUSH_TICK_SECRET');
  if (!url || !secret) throw new Error('Set PUSH_TICK_URL and PUSH_TICK_SECRET in Script Properties');
  invasionLogTick(props, url, secret, true);
}

function writeInvasionLog(ss, data, day) {
  var st = REPORT_STYLE;
  var sheet = getOrCreateSheet(ss, SHEET_INVASION_LOG);
  var isNew = sheet.getLastRow() === 0;
  if (sheet.getMaxColumns() < LOG_HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), LOG_HEADERS.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS])
    .setBackground(st.titleBg).setFontColor(st.titleFg).setFontWeight('bold').setVerticalAlignment('middle');
  sheet.hideColumns(LOG_VISIBLE + 1, LOG_HEADERS.length - LOG_VISIBLE);
  if (isNew) {
    sheet.setFrozenRows(1);
    sheet.setRowHeight(1, 30);
    var widths = [100, 60, 130, 90, 190, 125, 125, 100];
    for (var w = 0; w < widths.length; w++) sheet.setColumnWidth(w + 1, widths[w]);
    sheet.setHiddenGridlines(true);
  }

  var takenAt = Number(data.takenAt) || Date.now();
  var dateText = Utilities.formatDate(day, LOG_TZ, 'dd/MM/yyyy');
  var dayName = LOG_DAY_NAMES[Number(Utilities.formatDate(day, LOG_TZ, 'u'))];
  var loggedAt = Utilities.formatDate(new Date(takenAt), LOG_TZ, 'dd/MM HH:mm');
  var statusText = { now: 'NOW', alive: 'Still alive', upcoming: 'Waiting', unset: 'Unset' };
  var rows = (data.rows || []).map(function (r) {
    var server = r.kind === 'normal' ? LOG_MAIN_SERVER : String(r.server || '');
    return [dateText, dayName, loggedAt, server, String(r.name || ''), String(r.died || '-'), String(r.spawns || '-'), statusText[r.status] || '',
      String(takenAt), String(r.kind || ''), String(r.id === undefined ? '' : r.id), String(r.killIso || ''), String(r.spawnIso || ''), String(r.status || '')];
  });
  if (!rows.length) rows.push([dateText, dayName, loggedAt, '-', '(no boss times)', '-', '-', '', String(takenAt), '', '', '', '', '']);

  var start = sheet.getLastRow() + 1;
  var range = sheet.getRange(start, 1, rows.length, LOG_HEADERS.length);
  range.setNumberFormat('@').setValues(rows)
    .setFontFamily(st.font).setFontSize(10).setFontColor(st.text).setVerticalAlignment('middle');
  sheet.setRowHeights(start, rows.length, 24);
  sheet.getRange(start, 5, rows.length, 1).setFontWeight('bold').setFontColor(st.strong);
  sheet.getRange(start, 7, rows.length, 1).setFontWeight('bold').setFontColor(st.strong);
  var backgrounds = (data.rows || []).map(function (r) {
    var palette = r.kind === 'invasion' ? st.invasion : st.normal;
    return [palette.head, palette.head, palette.head, palette.band, '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'];
  });
  if (backgrounds.length === rows.length) range.setBackgrounds(backgrounds);
  // A clear line above each night's block.
  sheet.getRange(start, 1, 1, LOG_HEADERS.length)
    .setBorder(true, null, null, null, null, null, '#94a3b8', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  pruneInvasionLog(sheet);
}

function pruneInvasionLog(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var cutoff = Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000;
  var ts = sheet.getRange(2, 9, last - 1, 1).getValues(); // ts column
  var old = 0;
  while (old < ts.length && Number(ts[old][0]) > 0 && Number(ts[old][0]) < cutoff) old++;
  if (old > 0) sheet.deleteRows(2, old); // rows are appended in time order
}

function readInvasionLog(ss) {
  var sheet = ss.getSheetByName(SHEET_INVASION_LOG);
  var url = ss.getUrl() + (sheet ? '#gid=' + sheet.getSheetId() : '');
  if (!sheet || sheet.getLastRow() < 2) return { success: true, url: url, days: [] };
  var cutoff = Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, LOG_HEADERS.length).getDisplayValues();
  var byKey = {};
  var order = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (Number(v[8]) && Number(v[8]) < cutoff) continue; // ts
    var key = v[0] + '|' + v[2];
    if (!byKey[key]) {
      byKey[key] = { date: v[0], day: v[1], loggedAt: v[2], rows: [] };
      order.push(key);
    }
    if (v[4] !== '(no boss times)') {
      byKey[key].rows.push({
        server: v[3], name: v[4], died: v[5], spawns: v[6], statusText: v[7],
        kind: v[9] || (v[3] === LOG_MAIN_SERVER ? 'normal' : 'invasion'),
        id: v[10], killIso: v[11], spawnIso: v[12], status: v[13]
      });
    }
  }
  var days = order.reverse().map(function (k) { return byKey[k]; }); // newest first
  return { success: true, url: url, days: days };
}

function installPushTickTrigger() {
  removePushTickTrigger();
  ScriptApp.newTrigger('pushTick').timeBased().everyMinutes(1).create();
  console.log('pushTick trigger installed (every minute)');
}

function removePushTickTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'pushTick') ScriptApp.deleteTrigger(triggers[i]);
  }
}
