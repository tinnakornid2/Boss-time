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

  var headers = ['ID', 'Name', 'Location', 'Event Time', 'Occurs On', 'Auto Done (Min)', 'Done On', 'Pinned Alive', 'Next Spawn'];
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
        ev.next_spawn || ''
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
        last_kill_time: row[6] ? String(row[6]) : null,
        next_spawn: row[7] ? String(row[7]) : null,
        pinned_alive: String(row[8]) === 'YES',
        auto_advanced: String(row[9]) === 'YES',
        post_maintenance: String(row[10]) === 'YES',
        pre_spawned: String(row[11]) === 'YES',
        updated_at: row[12] ? String(row[12]) : new Date().toISOString()
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
        next_spawn: erow[8] ? String(erow[8]) : null
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
 * Helper คืนค่าผลลัพธ์เป็น JSON Output
 */
function jsonResponse(obj, status) {
  var textOutput = ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return textOutput;
}
