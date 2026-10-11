/**
 * TreeALA_API — ระบบข้อมูลและติดตามงานตัดต้นไม้ กฟส.อ่าวลึก
 * หลังบ้าน Google Apps Script + Google Sheets
 *
 * ติดตั้ง 3 ขั้น
 *   1) วางไฟล์นี้ทั้งไฟล์ในโครงการ Apps Script ใหม่ ตั้งชื่อ TreeALA_API
 *   2) เลือกฟังก์ชัน setupDatabase แล้วกด "เรียกใช้" หนึ่งครั้ง
 *      (ระบบจะสร้างทุกแท็บพร้อมข้อมูลปี 2569 และ 2570 ให้เอง)
 *   3) ทำให้ใช้งานได้ > เว็บแอป > ดำเนินการในฐานะ: ฉัน · ผู้มีสิทธิ์เข้าถึง: ทุกคน
 *      แล้วนำ URL ที่ได้ไปใส่ในไฟล์ index.html ที่ตัวแปร API_URL
 */

// ====== ตั้งค่า ======
const DB_ID = '1DWfex5lBumS0rV4uWyLG-h8Q3V2AdFgk7gA01lnMeYY';   // ชีต TreeALA_DB ที่สร้างไว้ให้แล้ว
const APP_CODE = 'TREE';                          // รหัสแอปในคอลัมน์ Apps ของชีต Members
const TOKEN_SALT = 'tree-ala-2569';               // เปลี่ยนเป็นข้อความอะไรก็ได้ของท่านเอง
const SLD_DEFAULT_ID = '1m7dL33F1JwdK60G640xLjlWntkPrY5ulb4tpkpf04LU';  // ชีต SLD อ่าวลึก - ฐานข้อมูล

// ====== ตารางและคอลัมน์ ======
const TABLES = {
  jobs:      'TreeJobs',
  rounds:    'TreeRounds',
  segments:  'TreeSegments',
  estimates: 'TreeEstimates',
  findings:  'TreeFindings',
  payments:  'TreePayments',
  lines:     'TreeLines',
  linefix:   'TreeLineFix',
  photos:    'TreePhotos',
  members:   'Members',
  config:    'Config',
  logs:      'Logs'
};

// ====== จุดเข้าออก ======
function doGet(e) {
  return handle_(e, (e && e.parameter) ? e.parameter : {});
}

function doPost(e) {
  var body = {};
  try {
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch (err) { body = {}; }
  if (body && body.events && Object.prototype.toString.call(body.events) === '[object Array]') {
    return lineWebhook_(body);
  }
  return handle_(e, body);
}

function handle_(e, p) {
  var action = p.action || 'ping';
  var out;
  try {
    switch (action) {
      case 'ping':        out = { ok: true, app: 'TreeALA_API', time: new Date() }; break;
      case 'version':     out = { ok: true, stamp: dataStamp_() }; break;
      case 'login':       out = apiLogin_(p); break;
      case 'bootstrap':   out = apiBootstrap_(p); break;
      case 'saveRound':   out = apiSaveRound_(p); break;
      case 'saveJob':     out = apiSaveJob_(p); break;
      case 'savePayment': out = apiSavePayment_(p); break;
      case 'saveLine':    out = apiSaveLine_(p); break;
      case 'saveLineFix': out = apiSaveLineFix_(p); break;
      case 'addFinding':  out = apiAddFinding_(p); break;
      case 'addPhoto':    out = apiAddPhoto_(p); break;
      case 'delPhoto':    out = apiDelPhoto_(p); break;
      case 'fixFinding':  out = apiFixFinding_(p); break;
      case 'sldPoints':   out = apiSldPoints_(p); break;
      default:            out = { ok: false, error: 'ไม่รู้จักคำสั่ง: ' + action };
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return reply_(out, p.callback);
}

function reply_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   แคชข้อมูล — ทำให้โหลดเร็วขึ้น (ข้อ 1)
   ------------------------------------------------------------
   stamp = เลขรุ่นข้อมูล เปลี่ยนทุกครั้งที่มีการบันทึก
   ฝั่งเบราว์เซอร์จะถาม action=version ก่อน ถ้า stamp เท่าเดิม
   ก็ใช้ข้อมูลที่เก็บไว้ในเครื่องต่อ ไม่ต้องโหลดใหม่
   ============================================================ */
var STAMP_KEY = 'TREE_DATA_STAMP';

function dataStamp_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty(STAMP_KEY);
  if (!s) { s = String(Date.now()); props.setProperty(STAMP_KEY, s); }
  return s;
}

/* เรียกทุกครั้งที่เขียนข้อมูล — ทำให้แคชทั้งหมดหมดอายุทันที */
function bumpStamp_() {
  try {
    PropertiesService.getScriptProperties().setProperty(STAMP_KEY, String(Date.now()));
  } catch (e) { /* ไม่ให้ล้มงานหลัก */ }
}

/* ให้เรียกจาก Trigger แบบ On change ของชีต TreeALA_DB
   เผื่อมีคนแก้ในชีตตรง ๆ ไม่ได้แก้ผ่านแอป */
function onTreeSheetChange(e) { bumpStamp_(); }

/* ติดตั้ง Trigger ให้ครั้งเดียว — รันฟังก์ชันนี้มือเดียวจากเมนู Apps Script */
function installStampTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onTreeSheetChange') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('onTreeSheetChange')
    .forSpreadsheet(DB_ID)
    .onChange()
    .create();
  return 'ติดตั้ง Trigger เรียบร้อย — แก้ข้อมูลในชีตตรง ๆ แล้วแอปจะรู้เองว่าต้องโหลดใหม่';
}

/* CacheService เก็บค่าได้คีย์ละไม่เกิน 100KB จึงต้องหั่นเป็นท่อน
   ภาษาไทยหนึ่งตัวอักษรกิน 3 ไบต์ จึงหั่นที่ 30,000 ตัวอักษร
   (กรณีแย่สุด 90KB ยังไม่เกินขีด)  */
var CACHE_CHUNK = 30000;
var CACHE_TTL = 21600;        // 6 ชั่วโมง

function cacheGet_(key) {
  try {
    var c = CacheService.getScriptCache();
    var head = c.get(key + '_n');
    if (!head) return null;
    var n = Number(head);
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '_' + i);
    var got = c.getAll(keys);
    var buf = '';
    for (var j = 0; j < n; j++) {
      var part = got[key + '_' + j];
      if (part === null || part === undefined) return null;   // ท่อนหาย ถือว่าแคชเสีย
      buf += part;
    }
    return buf;
  } catch (e) { return null; }
}

function cachePut_(key, str) {
  try {
    var c = CacheService.getScriptCache();
    var n = Math.ceil(str.length / CACHE_CHUNK);
    if (n > 80) return;                                      // ใหญ่เกินไป ไม่ต้องแคช
    var obj = {};
    for (var i = 0; i < n; i++) {
      obj[key + '_' + i] = str.substr(i * CACHE_CHUNK, CACHE_CHUNK);
    }
    c.putAll(obj, CACHE_TTL);
    c.put(key + '_n', String(n), CACHE_TTL);
  } catch (e) { /* แคชไม่สำเร็จ ไม่กระทบการใช้งาน */ }
}

// ====== เครื่องมือพื้นฐาน ======
var DB_CACHE_ = null;
function db_() {
  if (!DB_CACHE_) DB_CACHE_ = SpreadsheetApp.openById(DB_ID);
  return DB_CACHE_;
}

function readTable_(name) {
  var sh = db_().getSheetByName(name);
  if (!sh) return { headers: [], rows: [] };
  var values = sh.getDataRange().getValues();
  if (values.length < 1) return { headers: [], rows: [] };
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i].join('') === '') continue;
    var o = {};
    for (var c = 0; c < headers.length; c++) o[headers[c]] = normalize_(values[i][c]);
    o._row = i + 1;
    rows.push(o);
  }
  return { headers: headers, rows: rows };
}

function normalize_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd');
  return v;
}

function updateRow_(sheetName, keyCol, keyVal, fields) {
  var sh = db_().getSheetByName(sheetName);
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var keyIdx = headers.indexOf(keyCol);
  if (keyIdx < 0) throw new Error('ไม่พบคอลัมน์ ' + keyCol + ' ในแท็บ ' + sheetName);
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][keyIdx]) === String(keyVal)) {
      Object.keys(fields).forEach(function (k) {
        var c = headers.indexOf(k);
        if (c >= 0) sh.getRange(i + 1, c + 1).setValue(fields[k]);
      });
      return true;
    }
  }
  throw new Error('ไม่พบข้อมูล ' + keyVal + ' ในแท็บ ' + sheetName);
}

function appendRow_(sheetName, obj) {
  var sh = db_().getSheetByName(sheetName);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var row = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sh.appendRow(row);
  return true;
}

function log_(user, action, target, detail) {
  try {
    appendRow_(TABLES.logs, {
      Timestamp: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'),
      User: user || '', Action: action || '', Target: target || '', Detail: detail || ''
    });
  } catch (err) { /* ไม่ให้ล้มงานหลัก */ }
}

function getConfig_() {
  var t = readTable_(TABLES.config);
  var cfg = {};
  t.rows.forEach(function (r) { cfg[String(r.Key).trim()] = r.Value; });
  if (!cfg.SLD_SHEET_ID) cfg.SLD_SHEET_ID = SLD_DEFAULT_ID;
  return cfg;
}

// ====== สิทธิ์ผู้ใช้ (ใช้ล็อกอินร่วมกับแพลตฟอร์มเดิม) ======
// ผู้ใช้อยู่ในชีตของระบบ SLD แท็บ Admins และ Members — ล็อกอินด้วยชื่อ + รหัสผ่าน
// ถ้าเปิดใช้ ENFORCE_APPS = TRUE ในแท็บ Config จะตรวจว่าคอลัมน์ Apps มีคำว่า tree ด้วย

function makeToken_(name) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,
    String(name).trim().toLowerCase() + '|' + TOKEN_SALT);
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}

function classifyUserSheet_(sh) {
  if (sh.getLastRow() < 2 || sh.getLastColumn() < 2) return null;
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim().toLowerCase(); });
  if (headers[0] !== 'name') return null;
  if (headers.indexOf('requestedrole') >= 0) return null;   // แท็บรออนุมัติ ไม่ใช่ผู้ใช้จริง
  var iPw = headers.indexOf('password');
  if (iPw < 0) iPw = headers.indexOf('pin');
  if (iPw < 0) iPw = 1;                                      // คอลัมน์ถัดจากชื่อ
  var iApps = headers.indexOf('apps');
  var iRole = headers.indexOf('role');
  return { iPw: iPw, iApps: iApps, iRole: iRole, role: (iApps >= 0 ? 'member' : 'admin') };
}

function lookupPlatformUser_(ss, name, password) {
  var target = String(name).trim().toLowerCase();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var meta = classifyUserSheet_(sheets[i]);
    if (!meta) continue;
    var v = sheets[i].getDataRange().getValues();
    for (var r = 1; r < v.length; r++) {
      var nm = String(v[r][0]).trim();
      if (!nm || nm.toLowerCase() !== target) continue;
      if (String(v[r][meta.iPw]).trim() !== String(password).trim()) continue;
      return {
        name: nm,
        role: meta.iRole >= 0 && v[r][meta.iRole] ? String(v[r][meta.iRole]).trim() : meta.role,
        apps: meta.iApps >= 0 ? String(v[r][meta.iApps]).trim() : '',
        source: sheets[i].getName()
      };
    }
  }
  return null;
}

function lookupLocalUser_(name, password) {
  var t = readTable_(TABLES.members);
  var target = String(name).trim().toLowerCase();
  for (var i = 0; i < t.rows.length; i++) {
    var m = t.rows[i];
    var nm = String(m.Name || '').trim();
    var em = String(m.Email || '').trim();
    if (nm.toLowerCase() !== target && em.toLowerCase() !== target) continue;
    var active = String(m.Active).toUpperCase();
    if (active === 'FALSE' || active === 'N' || active === '0') return null;
    if (m.Password && String(m.Password).trim() !== String(password).trim()) return null;
    return { name: nm || em, role: String(m.Role || 'member'), apps: String(m.Apps || ''),
             source: 'TreeALA_DB' };
  }
  return null;
}

function findUser_(name, password) {
  if (!name) return null;
  var cfg = getConfig_();
  if (cfg.SLD_SHEET_ID) {
    try {
      var u = lookupPlatformUser_(SpreadsheetApp.openById(cfg.SLD_SHEET_ID), name, password);
      if (u) return u;
    } catch (e) { /* เปิดชีตกลางไม่ได้ ใช้รายชื่อสำรองต่อ */ }
  }
  return lookupLocalUser_(name, password);
}

function allowedApp_(u) {
  var cfg = getConfig_();
  if (String(cfg.ENFORCE_APPS).toUpperCase() !== 'TRUE') return true;
  if (!u.apps) return true;
  return u.apps.toLowerCase().indexOf(APP_CODE.toLowerCase()) >= 0;
}

function requireUser_(p) {
  var name = p.user || p.email;
  if (!name) throw new Error('กรุณาเข้าสู่ระบบ');
  if (String(p.token || '') !== makeToken_(name)) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  return { name: String(name), role: p.role || 'member' };
}

function apiLogin_(p) {
  var name = p.user || p.email;
  var u = findUser_(name, p.password);
  if (!u) return { ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  if (!allowedApp_(u)) return { ok: false, error: 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานระบบงานตัดต้นไม้' };
  log_(u.name, 'login', u.source, '');
  return { ok: true, token: makeToken_(u.name),
           user: { name: u.name, role: u.role, apps: u.apps, source: u.source } };
}

// ====== อ่านข้อมูลทั้งชุด ======
function apiBootstrap_(p) {
  requireUser_(p);
  var year = p.year ? String(p.year) : '';
  var stamp = dataStamp_();
  var key = 'boot_' + year + '_' + stamp;

  /* ถ้าหน้าเว็บบอกมาว่ามีข้อมูลรุ่นนี้อยู่แล้ว ตอบสั้น ๆ ว่าใช้ของเดิมได้ */
  if (!p.fresh && p.have && String(p.have) === stamp) {
    return { ok: true, same: true, stamp: stamp };
  }

  if (!p.fresh) {
    var hit = cacheGet_(key);
    if (hit) {
      try {
        var o = JSON.parse(hit);
        o.cached = true;
        return o;
      } catch (e) { /* แคชเสีย อ่านใหม่จากชีต */ }
    }
  }

  var out = bootstrapRaw_(year);
  out.stamp = stamp;
  cachePut_(key, JSON.stringify(out));
  return out;
}

function bootstrapRaw_(year) {
  var all = readTable_(TABLES.jobs).rows;          // อ่านแท็บ Jobs ครั้งเดียว ใช้ทั้งสองที่
  var seen = {}, years = [];
  all.forEach(function (j) {
    var y = String(j.Year);
    if (y && !seen[y]) { seen[y] = true; years.push(y); }
  });
  years.sort();

  var jobs = year ? all.filter(function (j) { return String(j.Year) === year; }) : all;
  var ids = {};
  jobs.forEach(function (j) { ids[j.JobID] = true; });
  var keep = function (r) { return ids[r.JobID]; };

  return {
    ok: true,
    config: getConfig_(),
    jobs: jobs,
    rounds: readTable_(TABLES.rounds).rows.filter(keep),
    segments: readTable_(TABLES.segments).rows.filter(keep),
    estimates: readTable_(TABLES.estimates).rows.filter(keep),
    payments: readTable_(TABLES.payments).rows.filter(keep),
    lines: readTable_(TABLES.lines).rows.filter(keep),
    linefix: readTable_(TABLES.linefix).rows,
    photos: readTable_(TABLES.photos).rows.filter(keep),
    findings: readTable_(TABLES.findings).rows.filter(keep),
    years: years
  };
}

function uniqueYears_() {
  var seen = {}, out = [];
  readTable_(TABLES.jobs).rows.forEach(function (j) {
    var y = String(j.Year);
    if (y && !seen[y]) { seen[y] = true; out.push(y); }
  });
  return out.sort();
}

// ====== บันทึกข้อมูล ======
function apiSaveRound_(p) {
  var u = requireUser_(p);
  var fields = p.fields || {};

  /* ล็อกการตรวจรับ — ต้องตัดครบทุกเส้นและปรับปรุงจุดที่พบครบ
     ยกเว้นได้โดยผู้จัดการหรือหัวหน้าแผนก และต้องใส่เหตุผล */
  if (String(fields.Status || '').indexOf('ตรวจรับแล้ว') >= 0) {
    var rows = readTable_(TABLES.rounds).rows;
    var cur = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].RoundID === p.roundId) cur = rows[i];
    if (cur) {
      var blk = acceptBlockers_(cur.JobID, parseInt(cur.RoundNo, 10) || 1);
      if (blk.length) {
        var reason = String(p.overrideReason || '').trim();
        if (!reason) {
          throw new Error('ยังตรวจรับไม่ได้ — ' + blk.map(function (b) { return b.text; }).join(' · '));
        }
        if (!isSupervisor_(u.name)) {
          throw new Error('การยกเว้นต้องให้ผู้จัดการหรือหัวหน้าแผนกเป็นผู้กด');
        }
        fields.OverrideBy = u.name;
        fields.OverrideReason = reason;
        fields.OverrideAt = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
        ensureSheet_(TABLES.rounds, ['OverrideBy', 'OverrideReason', 'OverrideAt']);
        log_(u.name, 'acceptOverride', p.roundId, reason + ' | ' +
             blk.map(function (b) { return b.text; }).join(' · '));
      }
    }
  }

  var allow = ['PlanMonth', 'AssignDate', 'AcceptDate', 'SAPTimeDate', 'Inspector', 'Status', 'Note',
               'OverrideBy', 'OverrideReason', 'OverrideAt'];
  var clean = {};
  allow.forEach(function (k) { if (fields[k] !== undefined) clean[k] = fields[k]; });
  updateRow_(TABLES.rounds, 'RoundID', p.roundId, clean);
  log_(u.name, 'saveRound', p.roundId, JSON.stringify(clean));
  bumpStamp_();
  lineAccepted_(p.roundId, clean);
  return { ok: true };
}

function apiSaveJob_(p) {
  var u = requireUser_(p);
  var fields = p.fields || {};
  var allow = ['PlanKm', 'MonthGroup', 'PlanMonths', 'EstPrice', 'EstPriceVat',
               'ContractPrice', 'Contractor', 'ZPM4No', 'Status', 'Note'];
  var clean = {};
  allow.forEach(function (k) { if (fields[k] !== undefined) clean[k] = fields[k]; });
  updateRow_(TABLES.jobs, 'JobID', p.jobId, clean);
  log_(u.name, 'saveJob', p.jobId, JSON.stringify(clean));
  bumpStamp_();
  return { ok: true };
}

function apiSavePayment_(p) {
  var u = requireUser_(p);
  var fields = p.fields || {};
  var allow = ['Amount', 'ActualCost', 'DocNo', 'PaidDate', 'Status'];
  var clean = {};
  allow.forEach(function (k) { if (fields[k] !== undefined) clean[k] = fields[k]; });
  updateRow_(TABLES.payments, 'PayID', p.payId, clean);
  log_(u.name, 'savePayment', p.payId, JSON.stringify(clean));
  bumpStamp_();
  return { ok: true };
}

function apiSaveLine_(p) {
  var u = requireUser_(p);
  var fields = p.fields || {};
  var allow = ['R1Date','R1By','R2Date','R2By','R3Date','R3By','Status','Note'];
  var clean = {};
  allow.forEach(function (k) { if (fields[k] !== undefined) clean[k] = fields[k]; });
  updateRow_(TABLES.lines, 'LineID', p.lineId, clean);
  log_(u.name, 'saveLine', p.lineId, JSON.stringify(clean));
  bumpStamp_();
  return { ok: true };
}

/* กำหนดเจ้าของช่วงสายบนแผนที่ด้วยมือ — ทับผลที่ระบบคำนวณให้ */
function apiSaveLineFix_(p) {
  var u = requireUser_(p);
  var key = String(p.segKey || '').trim();
  if (!key) throw new Error('ไม่พบรหัสช่วงสาย');

  var ss = db_();
  var sh = ss.getSheetByName(TABLES.linefix);
  if (!sh) {
    sh = ss.insertSheet(TABLES.linefix);
    sh.getRange(1, 1, 1, 5).setValues([['SegKey', 'JobID', 'Note', 'UpdatedBy', 'UpdatedAt']])
      .setBackground('#4A1D62').setFontColor('#FFFFFF').setFontWeight('bold')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    [150, 150, 220, 160, 150].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  }

  var now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
  var v = sh.getDataRange().getValues();
  for (var r = 1; r < v.length; r++) {
    if (String(v[r][0]).trim() === key) {
      if (!p.jobId) {
        sh.deleteRow(r + 1);                      // ยกเลิกการกำหนดเอง กลับไปใช้ค่าที่ระบบคำนวณ
        log_(u.name, 'saveLineFix', key, 'ลบ');
        bumpStamp_();
        return { ok: true, removed: true };
      }
      sh.getRange(r + 1, 2, 1, 4).setValues([[p.jobId, p.note || '', u.name, now]]);
      log_(u.name, 'saveLineFix', key, String(p.jobId));
      bumpStamp_();
      return { ok: true };
    }
  }
  if (!p.jobId) return { ok: true, removed: true };
  sh.appendRow([key, p.jobId, p.note || '', u.name, now]);
  log_(u.name, 'saveLineFix', key, String(p.jobId));
  bumpStamp_();
  return { ok: true };
}

function apiAddFinding_(p) {
  var u = requireUser_(p);
  var f = p.finding || {};
  var id = 'F' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMMddHHmmss') +
           Math.floor(Math.random() * 90 + 10);
  var photoUrl = '';
  if (p.photoBase64) photoUrl = savePhoto_(p.photoBase64, id, p.photoName);

  appendRow_(TABLES.findings, {
    FindID: id,
    JobID: f.JobID || '',
    RoundID: f.RoundID || '',
    SegID: f.SegID || '',
    DeviceID: f.DeviceID || '',
    Lat: f.Lat || '',
    Lng: f.Lng || '',
    TreeType: f.TreeType || '',
    Severity: f.Severity || '',
    PhotoBefore: photoUrl,
    PhotoAfter: '',
    Reporter: u.name,
    ReportDate: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'),
    FixedDate: '',
    Status: 'รอปรับปรุง',
    Note: f.Note || ''
  });
  log_(u.name, 'addFinding', id, f.JobID || '');
  bumpStamp_();
  lineRisk_(Object.assign({Reporter: u.name}, f), photoUrl);
  return { ok: true, findId: id, photo: photoUrl };
}

function savePhoto_(base64, id, name) {
  var cfg = getConfig_();
  var folderId = cfg.PHOTO_FOLDER_ID;
  if (!folderId) return '';
  var parts = String(base64).split(',');
  var data = parts.length > 1 ? parts[1] : parts[0];
  var mime = 'image/jpeg';
  var m = /^data:([^;]+);/.exec(String(base64));
  if (m) mime = m[1];
  var blob = Utilities.newBlob(Utilities.base64Decode(data), mime, (name || id) + '.jpg');
  var file = DriveApp.getFolderById(folderId).createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/uc?id=' + file.getId();
}

// ====== พิกัดจากระบบ SLD ======
function apiSldPoints_(p) {
  requireUser_(p);
  var cfg = getConfig_();
  if (!cfg.SLD_SHEET_ID) return { ok: true, points: [], feeders: [], note: 'ยังไม่ได้ตั้งค่า SLD_SHEET_ID ในแท็บ Config' };

  var cache = CacheService.getScriptCache();
  if (!p.refresh) {
    var cached = cache.get('sldPoints');
    if (cached) {
      var o = JSON.parse(cached);
      o.ok = true; o.cached = true;
      return o;
    }
  }

  var ss = SpreadsheetApp.openById(cfg.SLD_SHEET_ID);
  var sh = pickDeviceSheet_(ss, cfg.SLD_DEVICE_SHEET);
  if (!sh) return { ok: false, error: 'ไม่พบแท็บที่มีคอลัมน์ DeviceID และ Lat ในชีต SLD' };

  var values = sh.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var iId = colIndex_(headers, ['DeviceID', 'ID', 'Code', 'Device', 'รหัสอุปกรณ์', cfg.SLD_COL_DEVICE_ID]);
  var iFd = colIndex_(headers, ['Feeder', 'FeederID', 'Circuit', 'ฟีดเดอร์', cfg.SLD_COL_FEEDER]);
  var iLa = colIndex_(headers, ['Lat', 'Latitude', 'Y', 'ละติจูด', cfg.SLD_COL_LAT]);
  var iLn = colIndex_(headers, ['Lon', 'Lng', 'Long', 'Longitude', 'X', 'ลองจิจูด', cfg.SLD_COL_LNG]);
  var iPa = colIndex_(headers, ['ParentID', 'Parent', 'ParentDeviceID']);
  var iTy = colIndex_(headers, ['Type', 'DeviceType', 'ชนิด']);
  var iDs = colIndex_(headers, ['Description', 'Name', 'ชื่อ', 'รายละเอียด']);
  var iIm = colIndex_(headers, ['CustomerImpact', 'Customers', 'Impact', 'ผู้ใช้ไฟ', 'จำนวนผู้ใช้ไฟ']);
  if (iId < 0 || iLa < 0 || iLn < 0) {
    return { ok: false, error: 'ไม่พบคอลัมน์รหัสอุปกรณ์หรือพิกัดในแท็บ ' + sh.getName() };
  }

  var points = [];
  for (var i = 1; i < values.length; i++) {
    var lat = parseFloat(values[i][iLa]), lng = parseFloat(values[i][iLn]);
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) continue;
    points.push({
      id: String(values[i][iId]).trim(),
      feeder: iFd >= 0 ? String(values[i][iFd]).trim().toUpperCase() : '',
      lat: lat, lng: lng,
      parent: iPa >= 0 ? String(values[i][iPa]).trim() : '',
      type: iTy >= 0 ? String(values[i][iTy]).trim() : '',
      desc: iDs >= 0 ? String(values[i][iDs]).trim() : '',
      impact: iIm >= 0 ? (parseFloat(values[i][iIm]) || 0) : 0
    });
  }

  var feeders = readFeederList_(ss);
  var out = { points: points, feeders: feeders, sheet: sh.getName() };
  try { cache.put('sldPoints', JSON.stringify(out), 21600); } catch (err) { /* เกินขนาด cache */ }
  out.ok = true;
  return out;
}

function pickDeviceSheet_(ss, preferred) {
  var sheets = ss.getSheets();
  if (preferred) {
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getName().toLowerCase() === String(preferred).toLowerCase()) return sheets[i];
    }
  }
  // หาแท็บที่มีคอลัมน์ DeviceID และ Lat ให้เอง
  for (var j = 0; j < sheets.length; j++) {
    if (sheets[j].getLastColumn() < 3 || sheets[j].getLastRow() < 2) continue;
    var h = sheets[j].getRange(1, 1, 1, sheets[j].getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim().toLowerCase(); });
    if (h.indexOf('deviceid') >= 0 && h.indexOf('lat') >= 0) return sheets[j];
  }
  return null;
}

function readFeederList_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getLastRow() < 2) continue;
    var h = sheets[i].getRange(1, 1, 1, sheets[i].getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim().toLowerCase(); });
    var iId = h.indexOf('feederid'), iNm = h.indexOf('name'), iCl = h.indexOf('color');
    if (iId < 0 || iNm < 0) continue;
    var v = sheets[i].getDataRange().getValues(), out = [];
    for (var r = 1; r < v.length; r++) {
      var id = String(v[r][iId]).trim();
      if (!id) continue;
      out.push({ id: id.toUpperCase(), name: String(v[r][iNm]).trim(),
                 color: iCl >= 0 ? String(v[r][iCl]).trim() : '' });
    }
    if (out.length) return out;
  }
  return [];
}

function colIndex_(headers, names) {
  var lower = headers.map(function (h) { return String(h).trim().toLowerCase(); });
  for (var i = 0; i < names.length; i++) {
    if (!names[i]) continue;
    var k = lower.indexOf(String(names[i]).trim().toLowerCase());
    if (k >= 0) return k;
  }
  return -1;
}

// ====== ทดสอบจากในตัวแก้ไข ======
function testPing() {
  Logger.log(readTable_(TABLES.jobs).rows.length + ' ใบงานในฐานข้อมูล');
}


// ============================================================
//  ติดตั้งฐานข้อมูลครั้งแรก — เลือกฟังก์ชันนี้แล้วกด "เรียกใช้"
// ============================================================
const SEED = {"Config": "Key\tValue\tหมายเหตุ\nORG_NAME\tกฟส.อ่าวลึก\tชื่อหน่วยงานที่แสดงบนหัวเว็บ\nCURRENT_YEAR\t2569\tปีที่เปิดให้แก้ไขเป็นค่าเริ่มต้น\nSLD_SHEET_ID\t1m7dL33F1JwdK60G640xLjlWntkPrY5ulb4tpkpf04LU\tวางรหัส Google Sheet ของระบบ SLD เพื่อดึงพิกัดอุปกรณ์\nSLD_DEVICE_SHEET\tDevices\tชื่อแท็บอุปกรณ์ในชีต SLD\nSLD_FEEDER_SHEET\tFeeders\tชื่อแท็บฟีดเดอร์ในชีต SLD\nSLD_COL_DEVICE_ID\tDeviceID\tชื่อคอลัมน์รหัสอุปกรณ์\nSLD_COL_FEEDER\tFeeder\tชื่อคอลัมน์ฟีดเดอร์\nSLD_COL_LAT\tLat\tชื่อคอลัมน์ละติจูด\nSLD_COL_LNG\tLon\tชื่อคอลัมน์ลองจิจูด\nENFORCE_APPS\tFALSE\tTRUE = ให้ตรวจคอลัมน์ Apps ในชีตกลางว่ามีคำว่า tree\nPHOTO_FOLDER_ID\t\tรหัสโฟลเดอร์ Google Drive สำหรับเก็บรูปหน้างาน\nLINE_TOKEN\t\tChannel access token ถ้าจะเปิดแจ้งเตือน LINE", "Members": "Email\tName\tPassword\tPosition\tDept\tRole\tApps\tActive\naloofpea@gmail.com\tAloofpea\t\tผู้จัดการ\tกฟส.อ่าวลึก\tadmin\ttree\tTRUE", "TreeJobs": "JobID\tYear\tMJMNo\tSAPDesc\tJobName\tSystem\tVoltLevel\tFeederID\tPlanKm\tJobType\tMonthGroup\tPlanMonths\tEstPrice\tEstPriceVat\tContractPrice\tContractor\tZPM4No\tStatus\tNote\nJ69-TT68000774\t2569\tTT68000774\tTREE69_HV_EMP_TT68000774_KBB-ALA\tTREE69_HV_EMP_ALA03YB-101 สฟฟ.อ่าวลึก ถึง จุดแบ่งแดน จ.กระบี่ (115KV)\tHV\t115 kV\tKBB-ALA\t18.98\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t78218.06\t83693.32\t83000\tหจก.กรุณา\t4007916861\t\t\nJ69-TT68000930\t2569\tTT68000930\tTREE69_HV_EMP_TT68000930_PN-ALA\tTREE69_HV_EMP_ALA05YB-101 สฟฟ.อ่าวลึก ถึง จุดแบ่งแดน จ.พังงา (115KV)\tHV\t115 kV\tPN-ALA\t14.72\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t68674.84\t73482.08\t73000\tหจก.กรุณา\t4007916865\t\t\nJ69-TT68000932\t2569\tTT68000932\tTREE69_MV_EMP_TT68000932_ALA01\tTREE69_MV_EMP_ALA01WS-101 ถึง ALA01WS-1018 จุดแบ่งแดน จ.กระบี่ ALA01WR-101 ไลน์เมนบ้านบากัน\tMV\t33 kV\tALA01\t26.53\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t85188.96\t91152.19\t91000\tหจก.กรุณา\t4007916871\t\t\nJ69-TT68000934\t2569\tTT68000934\tTREE69_MV_EMP_TT68000934_ALA02\tTREE69_MV_EMP_ALA02WR-101 ไลน์เมนบ้านเขาแก้ว\tMV\t33 kV\tALA02\t18.11\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t66513.04\t71168.95\t71000\tหจก.กรุณา\t4007916875\t\t\nJ69-TT68001122\t2569\tTT68001122\tTREE69_MV_EMP_TT68001122_ALA03\tTREE69_MV_EMP_ALA03WS-101 ถึง  จุดแบ่งแดน อ.พระแสง (F3) ALA03WR-103 ถึง ALA03WR-104 ไลน์เมนปลายพระยา-เขาต่อและไลน์เมนบ้านทะเลหอย-ควนเขียว\tMV\t33 kV\tALA03\t65.44\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t261691.32\t280009.71\t261000\tณัฏฐ์วัฒน์\t4007916882\t\t\nJ69-TT68001249\t2569\tTT68001249\tTREE69_MV_EMP_TT68001249_ALA06\tTREE69_MV_EMP_ALA06WS-101 ไลน์เมนบ้านแหลมสัก ALA06WR-102 ไลน์เมนบ้านทางสาย-ไลน์เมนเขาล่อม\tMV\t33 kV\tALA06\t36.22\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t132202.36\t141456.53\t140000\tหจก.กรุณา\t4007916887\t\t\nJ69-TT68001255\t2569\tTT68001255\tTREE69_MV_EMP_TT68001255_ALA07\tTREE69_MV_EMP_ALA07WS-101 ถึง  จุดแบ่งแดน อ.พระแสง , ALA07WR-101 ไลน์เมนบ้านน้ำจาน  (F7)\tMV\t33 kV\tALA07\t42.78\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t158713.29\t169823.22\t169000\tหจก.กรุณา\t4007916891\t\t\nJ69-TT68001258\t2569\tTT68001258\tTREE69_MV_EMP_TT68001258_ALA09\tTREE69_MV_EMP_ALA09WS-101 ถึง  จุดแบ่งแดน จ.พังงา สี่แยกนาเหนือ ถึง จุดแบ่งแดน อ.พนม (F9)\tMV\t33 kV\tALA09\t36.33\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t137289.96\t146900.26\t146000\tหจก.กรุณา\t4007916895\t\t\nJ69-TT68001260\t2569\tTT68001260\tTREE69_MV_EMP_TT68001260_ALA01\tTREE69_MV_EMP_ALA01WF-113 ปอเนาะนาแค ถึง ALA01WF-124 บ้านบากัน (ข้าง รร.)\tMV\t33 kV\tALA01\t16.05\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t104124.55\t111413.27\t111000\tหจก.กรุณา\t4007916905\t\t\nJ69-TT68001364\t2569\tTT68001364\tTREE69_MV_EMP_TT68001364_ALA02\tTREE69_MV_EMP_ALA02WF-130 บ้านนบใหม่ ถึง ALA02WF-144 บ้านปากช่อง\tMV\t33 kV\tALA02\t35.4\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t190321.48\t203643.98\t200000\tหจก.กรุณา\t4007916907\t\t\nJ69-TT68001369\t2569\tTT68001369\tTREE69_MV_EMP_TT68001369_ALA02\tTREE69_MV_EMP_ALA02WF-104 บ้านถ้ำเพชร ถึง ALA02WF-110 บ้านถ้ำช้าง\tMV\t33 kV\tALA02\t14.95\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t69354.12\t74208.91\t74000\tหจก.กรุณา\t4007916911\t\t\nJ69-TT68001375\t2569\tTT68001375\tTREE69_MV_EMP_TT68001375_ALA\tTREE69_MV_EMP_ALA01WF-107 บ้านถ้ำสระยวนทอง ถึง ALA02WF-146 ประปาศาลาพระม่วง\tMV\t33 kV\tALA\t40.02\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t192949.87\t206456.36\t206000\tหจก.กรุณา\t4007916914\t\t\nJ69-TT68001547\t2569\tTT68001547\tTREE69_MV_EMP_TT68001547_ALA03\tTREE69_MV_EMP_ALA03WF-140 บ้านนาเขาเขน ถึง ALA03WF-151 บ้านบางส้าน\tMV\t33 kV\tALA03\t40.19\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t176575.44\t188935.72\t176000\tณัฏฐ์วัฒน์\t4007916923\t\t\nJ69-TT68001589\t2569\tTT68001589\tTREE69_MV_EMP_TT68001589_ALA07\tTREE69_MV_EMP_ALA07WF-113 บ้านบางเหลียว ถึง ALA03WF-139 บ้านตก\tMV\t33 kV\tALA07\t23.93\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t122311.25\t130873.04\t130000\tหจก.กรุณา\t4007922105\t\t\nJ69-TT68001613\t2569\tTT68001613\tTREE69_MV_EMP_TT68001613_ALA07\tTREE69_MV_EMP_ALA07WF-127 บ้านก่อตง ถึง ALA03WF-156 บ้านนาโพรงเข้\tMV\t33 kV\tALA07\t38.47\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t198621.53\t212525.04\t198000\tณัฏฐ์วัฒน์\t4007922106\t\t\nJ69-TT68001618\t2569\tTT68001618\tTREE69_MV_EMP_TT68001618_ALA03\tTREE69_MV_EMP_ALA03WF-161 บ้านบางหรน ถึง ALA07WF-150 ซ.สหปาล์ม\tMV\t33 kV\tALA03\t18.45\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t87191.21\t93294.59\t87000\tณัฏฐ์วัฒน์\t4007924427\t\t\nJ69-TT68001647\t2569\tTT68001647\tTREE69_MV_EMP_TT68001647_ALA03\tTREE69_MV_EMP_ALA03WF-201 บ้านบางเหียน ถึง ALA07WF-15 บ้านทับเที่ยง\tMV\t33 kV\tALA03\t26.97\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t134888.51\t144330.71\t134000\tณัฏฐ์วัฒน์\t4007924429\t\t\nJ69-TT68001686\t2569\tTT68001686\tTREE69_MV_EMP_TT68001686_ALA06\tTREE69_MV_EMP_ALA06WF-102 บ้านควนวังทอง ถึง ALA06WF-118 บ้านท่าเรือ\tMV\t33 kV\tALA06\t13.34\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t64313.66\t68815.62\t68000\tหจก.กรุณา\t4007924430\t\t\nJ69-TT68001688\t2569\tTT68001688\tTREE69_MV_EMP_TT68001688_ALA06\tTREE69_MV_EMP_ALA06WF-119 บ้านคลองสุข ถึง ALA06WF-131 บ้านต้นบก\tMV\t33 kV\tALA06\t22.23\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t100766.57\t107820.23\t107000\tหจก.กรุณา\t4007924435\t\t\nJ69-TT68001692\t2569\tTT68001692\tTREE69_MV_EMP_TT68001692_ALA06\tTREE69_MV_EMP_ALA06WF-134 บ้านถ้ำเสือ ถึง ALA06WF-137 บ้านควนผักเหมียง\tMV\t33 kV\tALA06\t13.91\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t71583.76\t76594.62\t76000\tหจก.กรุณา\t4007924454\t\t\nJ69-TT68001759\t2569\tTT68001759\tTREE69_MV_EMP_TT68001759_ALA03\tTREE69_MV_EMP_ALA03WF-101 บ้านห้วยปริศนา ถึง ALA07WF-112 บ้านไร่ใหญ่\tMV\t33 kV\tALA03\t9.7\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t48087.39\t51453.51\t51000\tหจก.กรุณา\t4007924458\t\t\nJ69-TT68001769\t2569\tTT68001769\tTREE69_MV_EMP_TT68001769_ALA07\tTREE69_MV_EMP_ALA07WF-101 ประปาอ่าวลึกเหนือ ถึง ALA07WF-108 บ้านหน้าผึ้ง\tMV\t33 kV\tALA07\t7.71\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t38646.8\t41352.08\t41000\tหจก.กรุณา\t4007924463\t\t\nJ69-TT68001770\t2569\tTT68001770\tTREE69_MV_EMP_TT68001770_ALA03\tTREE69_MV_EMP_ALA03WF-169 บ้านควน ถึง ALA03WF-189 บ้านคลองพวน\tMV\t33 kV\tALA03\t49.32\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t174439.04\t186649.77\t174000\tณัฏฐ์วัฒน์\t4007924468\t\t\nJ69-TT68001795\t2569\tTT68001795\tTREE69_MV_EMP_TT68001795_ALA06\tTREE69_MV_EMP_ALA05WF-101 บ้านหนองเต่า ถึง ALA06WF-138 บ้านบางเตียว\tMV\t33 kV\tALA06\t13.92\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t84503.7\t90418.96\t90000\tหจก.กรุณา\t4007924497\t\t\nJ69-TT68001796\t2569\tTT68001796\tTREE69_MV_EMP_TT68001796_ALA05\tTREE69_MV_EMP_ALA05WF-102 ซ.นพวงศ์ ถึง ALA09WF-105 บ้านทุ่งสูง\tMV\t33 kV\tALA05\t14\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t58734.68\t62846.11\t62000\tหจก.กรุณา\t4007924504\t\t\nJ69-TT68001813\t2569\tTT68001813\tTREE69_MV_EMP_TT68001813_ALA05\tTREE69_MV_EMP_ALA05WF-106 บ้านบางมัด ถึง ALA09WF-106 บ้านบางไทร\tMV\t33 kV\tALA05\t18.21\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t92852.56\t99352.24\t99000\tหจก.กรุณา\t4007924509\t\t\nJ69-TT68001816\t2569\tTT68001816\tTREE69_MV_EMP_TT68001816_ALA09\tTREE69_MV_EMP_ALA09WF-107 บ้านควนสยามโมเดิร์น ถึง ALA09WF-121 บ้านบางทอง\tMV\t33 kV\tALA09\t30.81\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t156129.92\t167059.01\t167000\tหจก.กรุณา\t4007924517\t\t\nJ69-TT68001818\t2569\tTT68001818\tTREE69_MV_EMP_TT68001818_ALA09\tTREE69_MV_EMP_ALA09WF-124 บ้านบางหอยโข่ง ถึง ALA03WF-191 ซอยหลวงเท่ง\tMV\t33 kV\tALA09\t28.1\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t143811.36\t153878.16\t143000\tณัฏฐ์วัฒน์\t4007924525\t\t\nJ69-TT68001831\t2569\tTT68001831\tTREE69_MV_EMP_TT68001831_ALA09\tTREE69_MV_EMP_ALA09WF-136 บ้านบางกลวย ถึง ALA09WF-149 บ้านบางแห้ง\tMV\t33 kV\tALA09\t23.77\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t153724.98\t164485.73\t164000\tหจก.กรุณา\t4007924533\t\t\nJ69-TT68001834\t2569\tTT68001834\tTREE69_MV_EMP_TT68001834_ALA03\tTREE69_MV_EMP_ALA03WR-101 ไลน์เมนบ้านสหกรณ์ ถึง ALA03WF-136 บ้านสหกรณ์ ซ.18\tMV\t33 kV\tALA03\t88.1\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t392769.47\t420263.33\t392000\tณัฏฐ์วัฒน์\t4007924537\t\t\nJ69-TT68001771\t2569\tTT68001771\tTREE69_LV_EMP_TT68001771_ALA01 \tTREE69_LV_EMP_ALA01\tLV\t400/230 V\tALA01\t50.21\tเฉพาะคราว\t\tมกราคม\t\t\t\t\t\tตรวจรับแล้ว\tปิดจบใน MJM-MFO 25/8/2569\nJ69-TT68001798\t2569\tTT68001798\tTREE69_LV_EMP_TT68001798_ALA02\tTREE69_LV_EMP_ALA02\tLV\t400/230 V\tALA02\t63.28\tเฉพาะคราว\t\tกุมภาพันธ์\t\t\t\t\t\tตรวจรับแล้ว\tปิดจบใน MJM-MFO 25/8/2569\nJ69-TT68001849\t2569\tTT68001849\tTREE69_LV_EMP_TT68001849_ALA03\tTREE69_LV_EMP_ALA03\tLV\t400/230 V\tALA03\t155.39\tเฉพาะคราว\t\tมีนาคม\t\t\t\t\t\tตรวจรับแล้ว\tปิดจบใน MJM-MFO 25/8/2569\nJ69-TT68001811\t2569\tTT68001811\tTREE69_LV_EMP_TT68001811_ALA05\tTREE69_LV_EMP_ALA05\tLV\t400/230 V\tALA05\t16.16\tเฉพาะคราว\t\tเมษายน\t\t\t\t\t\tตรวจรับแล้ว\tปิดจบใน MJM-MFO 25/8/2569\nJ69-TT68001812\t2569\tTT68001812\tTREE69_LV_EMP_TT68001812_ALA06\tTREE69_LV_EMP_ALA06\tLV\t400/230 V\tALA06\t56.25\tเฉพาะคราว\t\tพฤษภาคม\t\t\t\t\t\tตรวจรับแล้ว\tปิดจบใน MJM-MFO 25/8/2569\nJ69-TT68002105\t2569\tTT68002105\tTREE69_LV_EMP_TT68002105_ALA07\tTREE69_LV_EMP_ALA07\tLV\t400/230 V\tALA07\t79.26\tเฉพาะคราว\t\tมิถุนายน\t\t\t\t\t\tตรวจรับแล้ว\tปิดจบใน MJM-MFO 25/8/2569\nJ69-TT68002104\t2569\tTT68002104\tTREE69_LV_EMP_TT68002104_ALA09\tTREE69_LV_EMP_ALA09\tLV\t400/230 V\tALA09\t74.89\tเฉพาะคราว\t\tกรกฎาคม\t\t\t\t\t\tตรวจรับแล้ว\tปิดจบใน MJM-MFO 25/8/2569\nJ70-TT69000364\t2570\tTT69000364\tTREE70_HV_EMP_TT69000364_ALA03YB-101\tALA03YB-101\tHV\t115 kV\tALA03\t\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t\t\t\t\t4008460763\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000365\t2570\tTT69000365\tTREE70_HV_EMP_TT69000365_ALA05YB-101\tALA05YB-101\tHV\t115 kV\tALA05\t\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t\t\t\t\t4008460764\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000366\t2570\tTT69000366\tTREE70_MV_EMP_TT69000366_ALA01WS-101\tALA01WS-101\tMV\t33 kV\tALA01\t\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t\t\t\t\t4008460765\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000367\t2570\tTT69000367\tTREE70_MV_EMP_TT69000367_ALA02WR-101\tALA02WR-101\tMV\t33 kV\tALA02\t\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t\t\t\t\t4008460766\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000368\t2570\tTT69000368\tTREE70_MV_EMP_TT69000368_ALA03WS-101\tALA03WS-101\tMV\t33 kV\tALA03\t\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t\t\t\t\t4008460767\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000369\t2570\tTT69000369\tTREE70_MV_EMP_TT69000369_ALA06WS-101\tALA06WS-101\tMV\t33 kV\tALA06\t\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t\t\t\t\t4008460768\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000370\t2570\tTT69000370\tTREE70_MV_EMP_TT69000370_ALA07WS-101\tALA07WS-101\tMV\t33 kV\tALA07\t\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t\t\t\t\t4008460769\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000371\t2570\tTT69000371\tTREE70_MV_EMP_TT69000371_ALA09WS-101\tALA09WS-101\tMV\t33 kV\tALA09\t\tรายปี\t1\tม.ค./พ.ค./ก.ย.\t\t\t\t\t4008460770\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000376\t2570\tTT69000376\tTREE70_MV_EMP_TT69000376_ALA01WF-113\tALA01WF-113\tMV\t33 kV\tALA01\t\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t\t\t\t\t4008460771\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000377\t2570\tTT69000377\tTREE70_MV_EMP_TT69000377_ALA02WF-130\tALA02WF-130\tMV\t33 kV\tALA02\t\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t\t\t\t\t4008460772\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000378\t2570\tTT69000378\tTREE70_MV_EMP_TT69000378_ALA02WF-104\tALA02WF-104\tMV\t33 kV\tALA02\t\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t\t\t\t\t4008460773\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000379\t2570\tTT69000379\tTREE70_MV_EMP_TT69000379_ALA03WF-140\tALA03WF-140\tMV\t33 kV\tALA03\t\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t\t\t\t\t4008460774\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000380\t2570\tTT69000380\tTREE70_MV_EMP_TT69000380_ALA07WF-113\tALA07WF-113\tMV\t33 kV\tALA07\t\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t\t\t\t\t4008460775\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000381\t2570\tTT69000381\tTREE70_MV_EMP_TT69000381_ALA07WF-127\tALA07WF-127\tMV\t33 kV\tALA07\t\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t\t\t\t\t4008460776\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000382\t2570\tTT69000382\tTREE70_MV_EMP_TT69000382_ALA01WF-107\tALA01WF-107\tMV\t33 kV\tALA01\t\tรายปี\t2\tก.พ./มิ.ย./ต.ค.\t\t\t\t\t4008460777\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000384\t2570\tTT69000384\tTREE70_MV_EMP_TT69000384_ALA03WF-161\tALA03WF-161\tMV\t33 kV\tALA03\t\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t\t\t\t\t4008460778\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000385\t2570\tTT69000385\tTREE70_MV_EMP_TT69000385_ALA03WF-201\tALA03WF-201\tMV\t33 kV\tALA03\t\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t\t\t\t\t4008460779\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000386\t2570\tTT69000386\tTREE70_MV_EMP_TT69000386_ALA06WF-102\tALA06WF-102\tMV\t33 kV\tALA06\t\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t\t\t\t\t4008460780\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000387\t2570\tTT69000387\tTREE70_MV_EMP_TT69000387_ALA06WF-119\tALA06WF-119\tMV\t33 kV\tALA06\t\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t\t\t\t\t4008460781\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000388\t2570\tTT69000388\tTREE70_MV_EMP_TT69000388_ALA06WF-134\tALA06WF-134\tMV\t33 kV\tALA06\t\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t\t\t\t\t4008460782\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000389\t2570\tTT69000389\tTREE70_MV_EMP_TT69000389_ALA03WF-101\tALA03WF-101\tMV\t33 kV\tALA03\t\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t\t\t\t\t4008460783\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000390\t2570\tTT69000390\tTREE70_MV_EMP_TT69000390_ALA07WF-101\tALA07WF-101\tMV\t33 kV\tALA07\t\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t\t\t\t\t4008460784\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000391\t2570\tTT69000391\tTREE70_MV_EMP_TT69000391_ALA03WF-169\tALA03WF-169\tMV\t33 kV\tALA03\t\tรายปี\t3\tมี.ค./ก.ค./พ.ย.\t\t\t\t\t4008460785\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000392\t2570\tTT69000392\tTREE70_MV_EMP_TT69000392_ALA05WF-101\tALA05WF-101\tMV\t33 kV\tALA05\t\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t\t\t\t\t4008460786\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000393\t2570\tTT69000393\tTREE70_MV_EMP_TT69000393_ALA05WF-102\tALA05WF-102\tMV\t33 kV\tALA05\t\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t\t\t\t\t4008460787\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000394\t2570\tTT69000394\tTREE70_MV_EMP_TT69000394_ALA05WF-106\tALA05WF-106\tMV\t33 kV\tALA05\t\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t\t\t\t\t4008460788\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000395\t2570\tTT69000395\tTREE70_MV_EMP_TT69000395_ALA09WF-107\tALA09WF-107\tMV\t33 kV\tALA09\t\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t\t\t\t\t4008460789\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000396\t2570\tTT69000396\tTREE70_MV_EMP_TT69000396_ALA09WF-124\tALA09WF-124\tMV\t33 kV\tALA09\t\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t\t\t\t\t4008460790\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69000397\t2570\tTT69000397\tTREE70_MV_EMP_TT69000397_ALA09WF-136\tALA09WF-136\tMV\t33 kV\tALA09\t\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t\t\t\t\t4008460791\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69001784\t2570\tTT69001784\tTREE70_MV_EMP_TT69001784_ALA03WR-101\tALA03WR-101\tMV\t33 kV\tALA03\t\tรายปี\t4\tเม.ย./ส.ค./ธ.ค.\t\t\t\t\t4008460792\tยังไม่เริ่ม\tจำนวนข้องานครบใน MJM-MFO\nJ70-TT69002075\t2570\tTT69002075\tTREE70_LV_EMP_ALA01 ฟีดเดอร์ 1\tTREE70_LV_EMP_ALA01 ฟีดเดอร์ 1\tLV\t400/230 V\tALA01\t\tเฉพาะคราว\t\tมกราคม\t\t\t\t\t\tยังไม่เริ่ม\tครบระยะทาง/ส่งต่อได้\nJ70-TT69002077\t2570\tTT69002077\tTREE70_LV_EMP_ALA02 ฟีดเดอร์ 2\tTREE70_LV_EMP_ALA02 ฟีดเดอร์ 2\tLV\t400/230 V\tALA02\t\tเฉพาะคราว\t\tกุมภาพันธ์\t\t\t\t\t\tยังไม่เริ่ม\tครบระยะทางไม่ครบ\nJ70-TT69002081\t2570\tTT69002081\tTREE70_LV_EMP_ALA03 ฟีดเดอร์ 3\tTREE70_LV_EMP_ALA03 ฟีดเดอร์ 3\tLV\t400/230 V\tALA03\t\tเฉพาะคราว\t\tมีนาคม\t\t\t\t\t\tยังไม่เริ่ม\tครบระยะทาง/ส่งต่อได้\nJ70-TT69002090\t2570\tTT69002090\tTREE70_LV_EMP_ALA05 ฟีดเดอร์ 5\tTREE70_LV_EMP_ALA05 ฟีดเดอร์ 5\tLV\t400/230 V\tALA05\t\tเฉพาะคราว\t\tเมษายน\t\t\t\t\t\tยังไม่เริ่ม\tครบระยะทาง/ส่งต่อได้\nJ70-TT69002091\t2570\tTT69002091\tTREE70_LV_EMP_ALA06 ฟีดเดอร์ 6\tTREE70_LV_EMP_ALA06 ฟีดเดอร์ 6\tLV\t400/230 V\tALA06\t\tเฉพาะคราว\t\tพฤษภาคม\t\t\t\t\t\tยังไม่เริ่ม\tครบระยะทาง/ส่งต่อได้\nJ70-TT69002093\t2570\tTT69002093\tTREE70_LV_EMP_ALA07 ฟีดเดอร์ 7\tTREE70_LV_EMP_ALA07 ฟีดเดอร์ 7\tLV\t400/230 V\tALA07\t\tเฉพาะคราว\t\tมิถุนายน\t\t\t\t\t\tยังไม่เริ่ม\tครบระยะทาง/ส่งต่อได้\nJ70-TT69002094\t2570\tTT69002094\tTREE70_LV_EMP_ALA09 ฟีดเดอร์ 9\tTREE70_LV_EMP_ALA09 ฟีดเดอร์ 9\tLV\t400/230 V\tALA09\t\tเฉพาะคราว\t\tกรกฎาคม\t\t\t\t\t\tยังไม่เริ่ม\tครบระยะทาง/ส่งต่อได้", "TreeRounds": "RoundID\tJobID\tRoundNo\tPlanMonth\tAssignDate\tAcceptDate\tSAPTimeDate\tInspector\tStatus\tNote\nR-TT68000774-1\tJ69-TT68000774\t1\t\t\t2569-01-23\t2569-01-31\t\tตรวจรับแล้ว\t\nR-TT68000774-2\tJ69-TT68000774\t2\t\t\t2569-05-08\t2569-05-29\t\tตรวจรับแล้ว\t\nR-TT68000774-3\tJ69-TT68000774\t3\t\t\t2569-09-10\t2569-09-19\t\tตรวจรับแล้ว\t\nR-TT68000930-1\tJ69-TT68000930\t1\t\t\t2569-01-23\t2569-01-31\t\tตรวจรับแล้ว\t\nR-TT68000930-2\tJ69-TT68000930\t2\t\t\t2569-05-08\t2569-05-29\t\tตรวจรับแล้ว\t\nR-TT68000930-3\tJ69-TT68000930\t3\t\t\t2569-09-10\t2569-09-19\t\tตรวจรับแล้ว\t\nR-TT68000932-1\tJ69-TT68000932\t1\t\t\t2569-01-23\t2569-01-31\t\tตรวจรับแล้ว\t\nR-TT68000932-2\tJ69-TT68000932\t2\t\t\t2569-05-08\t2569-05-29\t\tตรวจรับแล้ว\t\nR-TT68000932-3\tJ69-TT68000932\t3\t\t\t2569-09-10\t2569-09-19\t\tตรวจรับแล้ว\t\nR-TT68000934-1\tJ69-TT68000934\t1\t\t\t2569-01-23\t2569-01-31\t\tตรวจรับแล้ว\t\nR-TT68000934-2\tJ69-TT68000934\t2\t\t\t2569-05-08\t2569-05-29\t\tตรวจรับแล้ว\t\nR-TT68000934-3\tJ69-TT68000934\t3\t\t\t2569-09-10\t2569-09-19\t\tตรวจรับแล้ว\t\nR-TT68001122-1\tJ69-TT68001122\t1\t\t\t2569-01-23\t2569-01-31\t\tตรวจรับแล้ว\t\nR-TT68001122-2\tJ69-TT68001122\t2\t\t\t2569-05-08\t2569-05-29\t\tตรวจรับแล้ว\t\nR-TT68001122-3\tJ69-TT68001122\t3\t\t\t2569-09-18\t2569-09-19\t\tตรวจรับแล้ว\t\nR-TT68001249-1\tJ69-TT68001249\t1\t\t\t2569-01-23\t2569-01-31\t\tตรวจรับแล้ว\t\nR-TT68001249-2\tJ69-TT68001249\t2\t\t\t2569-05-08\t2569-05-29\t\tตรวจรับแล้ว\t\nR-TT68001249-3\tJ69-TT68001249\t3\t\t\t2569-09-18\t2569-09-19\t\tตรวจรับแล้ว\t\nR-TT68001255-1\tJ69-TT68001255\t1\t\t\t2569-01-23\t2569-01-31\t\tตรวจรับแล้ว\t\nR-TT68001255-2\tJ69-TT68001255\t2\t\t\t2569-05-08\t2569-05-29\t\tตรวจรับแล้ว\t\nR-TT68001255-3\tJ69-TT68001255\t3\t\t\t2569-09-18\t2569-09-19\t\tตรวจรับแล้ว\t\nR-TT68001258-1\tJ69-TT68001258\t1\t\t\t2569-01-23\t2569-01-31\t\tตรวจรับแล้ว\t\nR-TT68001258-2\tJ69-TT68001258\t2\t\t\t2569-05-08\t2569-05-29\t\tตรวจรับแล้ว\t\nR-TT68001258-3\tJ69-TT68001258\t3\t\t\t2569-09-18\t2569-09-19\t\tตรวจรับแล้ว\t\nR-TT68001260-1\tJ69-TT68001260\t1\t\t\t2569-02-02\t2569-02-29\t\tตรวจรับแล้ว\t\nR-TT68001260-2\tJ69-TT68001260\t2\t\t\t2569-07-06\t2569-07-02\t\tตรวจรับแล้ว\t\nR-TT68001260-3\tJ69-TT68001260\t3\t\t2569-08-20\t\t\t\tจ่ายงาน/รอตรวจรับ\t\nR-TT68001364-1\tJ69-TT68001364\t1\t\t\t2569-02-02\t2569-02-29\t\tตรวจรับแล้ว\t\nR-TT68001364-2\tJ69-TT68001364\t2\t\t\t2569-07-06\t2569-07-02\t\tตรวจรับแล้ว\t\nR-TT68001364-3\tJ69-TT68001364\t3\t\t2569-08-20\t\t\t\tจ่ายงาน/รอตรวจรับ\t\nR-TT68001369-1\tJ69-TT68001369\t1\t\t\t2569-02-02\t2569-02-29\t\tตรวจรับแล้ว\t\nR-TT68001369-2\tJ69-TT68001369\t2\t\t\t2569-07-06\t2569-07-02\t\tตรวจรับแล้ว\t\nR-TT68001369-3\tJ69-TT68001369\t3\t\t2569-08-25\t\t\t\tจ่ายงาน/รอตรวจรับ\t\nR-TT68001375-1\tJ69-TT68001375\t1\t\t\t2569-02-02\t2569-02-29\t\tตรวจรับแล้ว\t\nR-TT68001375-2\tJ69-TT68001375\t2\t\t\t2569-07-06\t2569-07-02\t\tตรวจรับแล้ว\t\nR-TT68001375-3\tJ69-TT68001375\t3\t\t2569-08-25\t\t\t\tจ่ายงาน/รอตรวจรับ\t\nR-TT68001547-1\tJ69-TT68001547\t1\t\t\t2569-02-02\t2569-02-29\t\tตรวจรับแล้ว\t\nR-TT68001547-2\tJ69-TT68001547\t2\t\t\t2569-07-06\t2569-07-02\t\tตรวจรับแล้ว\t\nR-TT68001547-3\tJ69-TT68001547\t3\t\t2569-08-25\t\t\t\tจ่ายงาน/รอตรวจรับ\t\nR-TT68001589-1\tJ69-TT68001589\t1\t\t\t2569-02-02\t2569-02-29\t\tตรวจรับแล้ว\t\nR-TT68001589-2\tJ69-TT68001589\t2\t\t\t2569-07-06\t2569-07-02\t\tตรวจรับแล้ว\t\nR-TT68001589-3\tJ69-TT68001589\t3\t\t2569-08-25\t\t\t\tจ่ายงาน/รอตรวจรับ\t\nR-TT68001613-1\tJ69-TT68001613\t1\t\t\t2569-02-02\t2569-02-29\t\tตรวจรับแล้ว\t\nR-TT68001613-2\tJ69-TT68001613\t2\t\t\t2569-07-06\t2569-07-02\t\tตรวจรับแล้ว\t\nR-TT68001613-3\tJ69-TT68001613\t3\t\t2569-08-25\t\t\t\tจ่ายงาน/รอตรวจรับ\t\nR-TT68001618-1\tJ69-TT68001618\t1\t\t\t2569-03-10\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001618-2\tJ69-TT68001618\t2\t\t\t2569-07-24\t\t\tตรวจรับแล้ว\t\nR-TT68001618-3\tJ69-TT68001618\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001647-1\tJ69-TT68001647\t1\t\t\t2569-03-10\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001647-2\tJ69-TT68001647\t2\t\t\t2569-07-24\t\t\tตรวจรับแล้ว\t\nR-TT68001647-3\tJ69-TT68001647\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001686-1\tJ69-TT68001686\t1\t\t\t2569-03-10\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001686-2\tJ69-TT68001686\t2\t\t\t2569-07-24\t\t\tตรวจรับแล้ว\t\nR-TT68001686-3\tJ69-TT68001686\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001688-1\tJ69-TT68001688\t1\t\t\t2569-03-10\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001688-2\tJ69-TT68001688\t2\t\t\t2569-07-24\t\t\tตรวจรับแล้ว\t\nR-TT68001688-3\tJ69-TT68001688\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001692-1\tJ69-TT68001692\t1\t\t\t2569-03-10\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001692-2\tJ69-TT68001692\t2\t\t\t2569-07-24\t\t\tตรวจรับแล้ว\t\nR-TT68001692-3\tJ69-TT68001692\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001759-1\tJ69-TT68001759\t1\t\t\t2569-03-10\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001759-2\tJ69-TT68001759\t2\t\t\t2569-07-24\t\t\tตรวจรับแล้ว\t\nR-TT68001759-3\tJ69-TT68001759\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001769-1\tJ69-TT68001769\t1\t\t\t2569-03-10\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001769-2\tJ69-TT68001769\t2\t\t\t2569-07-24\t\t\tตรวจรับแล้ว\t\nR-TT68001769-3\tJ69-TT68001769\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001770-1\tJ69-TT68001770\t1\t\t\t2569-03-10\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001770-2\tJ69-TT68001770\t2\t\t\t2569-07-24\t\t\tตรวจรับแล้ว\t\nR-TT68001770-3\tJ69-TT68001770\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001795-1\tJ69-TT68001795\t1\t\t\t2569-04-20\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001795-2\tJ69-TT68001795\t2\t\t\t2569-09-01\t\t\tตรวจรับแล้ว\t\nR-TT68001795-3\tJ69-TT68001795\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001796-1\tJ69-TT68001796\t1\t\t\t2569-04-20\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001796-2\tJ69-TT68001796\t2\t\t\t2569-09-01\t\t\tตรวจรับแล้ว\t\nR-TT68001796-3\tJ69-TT68001796\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001813-1\tJ69-TT68001813\t1\t\t\t2569-04-20\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001813-2\tJ69-TT68001813\t2\t\t\t2569-09-01\t\t\tตรวจรับแล้ว\t\nR-TT68001813-3\tJ69-TT68001813\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001816-1\tJ69-TT68001816\t1\t\t\t2569-04-20\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001816-2\tJ69-TT68001816\t2\t\t\t2569-09-01\t\t\tตรวจรับแล้ว\t\nR-TT68001816-3\tJ69-TT68001816\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001818-1\tJ69-TT68001818\t1\t\t\t2569-04-20\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001818-2\tJ69-TT68001818\t2\t\t\t2569-09-01\t\t\tตรวจรับแล้ว\t\nR-TT68001818-3\tJ69-TT68001818\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001831-1\tJ69-TT68001831\t1\t\t\t2569-04-20\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001831-2\tJ69-TT68001831\t2\t\t\t2569-09-01\t\t\tตรวจรับแล้ว\t\nR-TT68001831-3\tJ69-TT68001831\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001834-1\tJ69-TT68001834\t1\t\t\t2569-04-20\t2569-04-20\t\tตรวจรับแล้ว\t\nR-TT68001834-2\tJ69-TT68001834\t2\t\t\t2569-09-01\t\t\tตรวจรับแล้ว\t\nR-TT68001834-3\tJ69-TT68001834\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT68001771-1\tJ69-TT68001771\t1\tมกราคม\t\t\t\t\tตรวจรับแล้ว\tเสร็จสิ้น/ตรวจรับเรียบร้อย\nR-TT68001798-1\tJ69-TT68001798\t1\tกุมภาพันธ์\t\t\t\t\tตรวจรับแล้ว\tเสร็จสิ้น/ตรวจรับเรียบร้อย\nR-TT68001849-1\tJ69-TT68001849\t1\tมีนาคม\t\t\t\t\tตรวจรับแล้ว\tเสร็จสิ้น/ตรวจรับเรียบร้อย\nR-TT68001811-1\tJ69-TT68001811\t1\tเมษายน\t\t\t\t\tตรวจรับแล้ว\tเสร็จสิ้น/ตรวจรับเรียบร้อย\nR-TT68001812-1\tJ69-TT68001812\t1\tพฤษภาคม\t\t\t\t\tตรวจรับแล้ว\tเสร็จสิ้น/ตรวจรับเรียบร้อย\nR-TT68002105-1\tJ69-TT68002105\t1\tมิถุนายน\t\t\t\t\tตรวจรับแล้ว\tเสร็จสิ้น/ตรวจรับเรียบร้อย\nR-TT68002104-1\tJ69-TT68002104\t1\tกรกฎาคม\t\t\t\t\tตรวจรับแล้ว\tเสร็จสิ้น/ตรวจรับเรียบร้อย\nR-TT69000364-1\tJ70-TT69000364\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000364-2\tJ70-TT69000364\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000364-3\tJ70-TT69000364\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000365-1\tJ70-TT69000365\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000365-2\tJ70-TT69000365\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000365-3\tJ70-TT69000365\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000366-1\tJ70-TT69000366\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000366-2\tJ70-TT69000366\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000366-3\tJ70-TT69000366\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000367-1\tJ70-TT69000367\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000367-2\tJ70-TT69000367\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000367-3\tJ70-TT69000367\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000368-1\tJ70-TT69000368\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000368-2\tJ70-TT69000368\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000368-3\tJ70-TT69000368\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000369-1\tJ70-TT69000369\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000369-2\tJ70-TT69000369\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000369-3\tJ70-TT69000369\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000370-1\tJ70-TT69000370\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000370-2\tJ70-TT69000370\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000370-3\tJ70-TT69000370\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000371-1\tJ70-TT69000371\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000371-2\tJ70-TT69000371\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000371-3\tJ70-TT69000371\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000376-1\tJ70-TT69000376\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000376-2\tJ70-TT69000376\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000376-3\tJ70-TT69000376\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000377-1\tJ70-TT69000377\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000377-2\tJ70-TT69000377\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000377-3\tJ70-TT69000377\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000378-1\tJ70-TT69000378\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000378-2\tJ70-TT69000378\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000378-3\tJ70-TT69000378\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000379-1\tJ70-TT69000379\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000379-2\tJ70-TT69000379\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000379-3\tJ70-TT69000379\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000380-1\tJ70-TT69000380\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000380-2\tJ70-TT69000380\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000380-3\tJ70-TT69000380\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000381-1\tJ70-TT69000381\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000381-2\tJ70-TT69000381\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000381-3\tJ70-TT69000381\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000382-1\tJ70-TT69000382\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000382-2\tJ70-TT69000382\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000382-3\tJ70-TT69000382\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000384-1\tJ70-TT69000384\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000384-2\tJ70-TT69000384\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000384-3\tJ70-TT69000384\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000385-1\tJ70-TT69000385\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000385-2\tJ70-TT69000385\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000385-3\tJ70-TT69000385\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000386-1\tJ70-TT69000386\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000386-2\tJ70-TT69000386\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000386-3\tJ70-TT69000386\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000387-1\tJ70-TT69000387\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000387-2\tJ70-TT69000387\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000387-3\tJ70-TT69000387\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000388-1\tJ70-TT69000388\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000388-2\tJ70-TT69000388\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000388-3\tJ70-TT69000388\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000389-1\tJ70-TT69000389\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000389-2\tJ70-TT69000389\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000389-3\tJ70-TT69000389\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000390-1\tJ70-TT69000390\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000390-2\tJ70-TT69000390\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000390-3\tJ70-TT69000390\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000391-1\tJ70-TT69000391\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000391-2\tJ70-TT69000391\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000391-3\tJ70-TT69000391\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000392-1\tJ70-TT69000392\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000392-2\tJ70-TT69000392\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000392-3\tJ70-TT69000392\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000393-1\tJ70-TT69000393\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000393-2\tJ70-TT69000393\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000393-3\tJ70-TT69000393\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000394-1\tJ70-TT69000394\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000394-2\tJ70-TT69000394\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000394-3\tJ70-TT69000394\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000395-1\tJ70-TT69000395\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000395-2\tJ70-TT69000395\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000395-3\tJ70-TT69000395\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000396-1\tJ70-TT69000396\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000396-2\tJ70-TT69000396\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000396-3\tJ70-TT69000396\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000397-1\tJ70-TT69000397\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000397-2\tJ70-TT69000397\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69000397-3\tJ70-TT69000397\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69001784-1\tJ70-TT69001784\t1\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69001784-2\tJ70-TT69001784\t2\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69001784-3\tJ70-TT69001784\t3\t\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69002075-1\tJ70-TT69002075\t1\tมกราคม\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69002077-1\tJ70-TT69002077\t1\tกุมภาพันธ์\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69002081-1\tJ70-TT69002081\t1\tมีนาคม\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69002090-1\tJ70-TT69002090\t1\tเมษายน\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69002091-1\tJ70-TT69002091\t1\tพฤษภาคม\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69002093-1\tJ70-TT69002093\t1\tมิถุนายน\t\t\t\t\tยังไม่จ่ายงาน\t\nR-TT69002094-1\tJ70-TT69002094\t1\tกรกฎาคม\t\t\t\t\tยังไม่จ่ายงาน\t", "TreeSegments": "SegID\tJobID\tFeederID\tFromDeviceID\tToDeviceID\tKm\tPathJSON\tDensity\nS-TT68000774\tJ69-TT68000774\tKBB-ALA\tALA03YB-101\t\t18.98\t\t\nS-TT68000930\tJ69-TT68000930\tPN-ALA\tALA05YB-101\t\t14.72\t\t\nS-TT68000932\tJ69-TT68000932\tALA01\tALA01WS-101\tALA01WR-101\t26.53\t\t\nS-TT68000934\tJ69-TT68000934\tALA02\tALA02WR-101\t\t18.11\t\t\nS-TT68001122\tJ69-TT68001122\tALA03\tALA03WS-101\tALA03WR-104\t65.44\t\t\nS-TT68001249\tJ69-TT68001249\tALA06\tALA06WS-101\tALA06WR-102\t36.22\t\t\nS-TT68001255\tJ69-TT68001255\tALA07\tALA07WS-101\tALA07WR-101\t42.78\t\t\nS-TT68001258\tJ69-TT68001258\tALA09\tALA09WS-101\t\t36.33\t\t\nS-TT68001260\tJ69-TT68001260\tALA01\tALA01WF-113\tALA01WF-124\t16.05\t\t\nS-TT68001364\tJ69-TT68001364\tALA02\tALA02WF-130\tALA02WF-144\t35.4\t\t\nS-TT68001369\tJ69-TT68001369\tALA02\tALA02WF-104\tALA02WF-110\t14.95\t\t\nS-TT68001375\tJ69-TT68001375\tALA\tALA01WF-107\tALA02WF-146\t40.02\t\t\nS-TT68001547\tJ69-TT68001547\tALA03\tALA03WF-140\tALA03WF-151\t40.19\t\t\nS-TT68001589\tJ69-TT68001589\tALA07\tALA07WF-113\tALA03WF-139\t23.93\t\t\nS-TT68001613\tJ69-TT68001613\tALA07\tALA07WF-127\tALA03WF-156\t38.47\t\t\nS-TT68001618\tJ69-TT68001618\tALA03\tALA03WF-161\tALA07WF-150\t18.45\t\t\nS-TT68001647\tJ69-TT68001647\tALA03\tALA03WF-201\tALA07WF-15\t26.97\t\t\nS-TT68001686\tJ69-TT68001686\tALA06\tALA06WF-102\tALA06WF-118\t13.34\t\t\nS-TT68001688\tJ69-TT68001688\tALA06\tALA06WF-119\tALA06WF-131\t22.23\t\t\nS-TT68001692\tJ69-TT68001692\tALA06\tALA06WF-134\tALA06WF-137\t13.91\t\t\nS-TT68001759\tJ69-TT68001759\tALA03\tALA03WF-101\tALA07WF-112\t9.7\t\t\nS-TT68001769\tJ69-TT68001769\tALA07\tALA07WF-101\tALA07WF-108\t7.71\t\t\nS-TT68001770\tJ69-TT68001770\tALA03\tALA03WF-169\tALA03WF-189\t49.32\t\t\nS-TT68001795\tJ69-TT68001795\tALA06\tALA05WF-101\tALA06WF-138\t13.92\t\t\nS-TT68001796\tJ69-TT68001796\tALA05\tALA05WF-102\tALA09WF-105\t14\t\t\nS-TT68001813\tJ69-TT68001813\tALA05\tALA05WF-106\tALA09WF-106\t18.21\t\t\nS-TT68001816\tJ69-TT68001816\tALA09\tALA09WF-107\tALA09WF-121\t30.81\t\t\nS-TT68001818\tJ69-TT68001818\tALA09\tALA09WF-124\tALA03WF-191\t28.1\t\t\nS-TT68001831\tJ69-TT68001831\tALA09\tALA09WF-136\tALA09WF-149\t23.77\t\t\nS-TT68001834\tJ69-TT68001834\tALA03\tALA03WR-101\tALA03WF-136\t88.1\t\t\nS-TT68001771\tJ69-TT68001771\tALA01\t\t\t50.21\t\t\nS-TT68001798\tJ69-TT68001798\tALA02\t\t\t63.28\t\t\nS-TT68001849\tJ69-TT68001849\tALA03\t\t\t155.39\t\t\nS-TT68001811\tJ69-TT68001811\tALA05\t\t\t16.16\t\t\nS-TT68001812\tJ69-TT68001812\tALA06\t\t\t56.25\t\t\nS-TT68002105\tJ69-TT68002105\tALA07\t\t\t79.26\t\t\nS-TT68002104\tJ69-TT68002104\tALA09\t\t\t74.89\t\t\nS-TT69000364\tJ70-TT69000364\tALA03\tALA03YB-101\t\t\t\t\nS-TT69000365\tJ70-TT69000365\tALA05\tALA05YB-101\t\t\t\t\nS-TT69000366\tJ70-TT69000366\tALA01\tALA01WS-101\t\t\t\t\nS-TT69000367\tJ70-TT69000367\tALA02\tALA02WR-101\t\t\t\t\nS-TT69000368\tJ70-TT69000368\tALA03\tALA03WS-101\t\t\t\t\nS-TT69000369\tJ70-TT69000369\tALA06\tALA06WS-101\t\t\t\t\nS-TT69000370\tJ70-TT69000370\tALA07\tALA07WS-101\t\t\t\t\nS-TT69000371\tJ70-TT69000371\tALA09\tALA09WS-101\t\t\t\t\nS-TT69000376\tJ70-TT69000376\tALA01\tALA01WF-113\t\t\t\t\nS-TT69000377\tJ70-TT69000377\tALA02\tALA02WF-130\t\t\t\t\nS-TT69000378\tJ70-TT69000378\tALA02\tALA02WF-104\t\t\t\t\nS-TT69000379\tJ70-TT69000379\tALA03\tALA03WF-140\t\t\t\t\nS-TT69000380\tJ70-TT69000380\tALA07\tALA07WF-113\t\t\t\t\nS-TT69000381\tJ70-TT69000381\tALA07\tALA07WF-127\t\t\t\t\nS-TT69000382\tJ70-TT69000382\tALA01\tALA01WF-107\t\t\t\t\nS-TT69000384\tJ70-TT69000384\tALA03\tALA03WF-161\t\t\t\t\nS-TT69000385\tJ70-TT69000385\tALA03\tALA03WF-201\t\t\t\t\nS-TT69000386\tJ70-TT69000386\tALA06\tALA06WF-102\t\t\t\t\nS-TT69000387\tJ70-TT69000387\tALA06\tALA06WF-119\t\t\t\t\nS-TT69000388\tJ70-TT69000388\tALA06\tALA06WF-134\t\t\t\t\nS-TT69000389\tJ70-TT69000389\tALA03\tALA03WF-101\t\t\t\t\nS-TT69000390\tJ70-TT69000390\tALA07\tALA07WF-101\t\t\t\t\nS-TT69000391\tJ70-TT69000391\tALA03\tALA03WF-169\t\t\t\t\nS-TT69000392\tJ70-TT69000392\tALA05\tALA05WF-101\t\t\t\t\nS-TT69000393\tJ70-TT69000393\tALA05\tALA05WF-102\t\t\t\t\nS-TT69000394\tJ70-TT69000394\tALA05\tALA05WF-106\t\t\t\t\nS-TT69000395\tJ70-TT69000395\tALA09\tALA09WF-107\t\t\t\t\nS-TT69000396\tJ70-TT69000396\tALA09\tALA09WF-124\t\t\t\t\nS-TT69000397\tJ70-TT69000397\tALA09\tALA09WF-136\t\t\t\t\nS-TT69001784\tJ70-TT69001784\tALA03\tALA03WR-101\t\t\t\t\nS-TT69002075\tJ70-TT69002075\tALA01\t\t\t\t\t\nS-TT69002077\tJ70-TT69002077\tALA02\t\t\t\t\t\nS-TT69002081\tJ70-TT69002081\tALA03\t\t\t\t\t\nS-TT69002090\tJ70-TT69002090\tALA05\t\t\t\t\t\nS-TT69002091\tJ70-TT69002091\tALA06\t\t\t\t\t\nS-TT69002093\tJ70-TT69002093\tALA07\t\t\t\t\t\nS-TT69002094\tJ70-TT69002094\tALA09\t\t\t\t\t", "TreeEstimates": "EstID\tJobID\tVoltLevel\tDensityClass\tKm\tTreeCount\tPrice\nE-TT69000369-1\tJ70-TT69000369\tMV\tหนาแน่น\t0\t0\t0\nE-TT69000369-2\tJ70-TT69000369\tMV\tปานกลาง\t15\t810\t71790\nE-TT69000369-3\tJ70-TT69000369\tMV\tเบาบาง\t18.23\t503\t56713.53\nE-TT69000369-4\tJ70-TT69000369\tMV\tที่โล่ง\t3\t23\t7153", "TreeFindings": "FindID\tJobID\tRoundID\tSegID\tDeviceID\tLat\tLng\tTreeType\tSeverity\tPhotoBefore\tPhotoAfter\tReporter\tReportDate\tFixedDate\tStatus\tNote", "TreePayments": "PayID\tJobID\tInstallment\tPercent\tAmount\tActualCost\tDocNo\tPaidDate\tStatus\nP-TT68000774-1\tJ69-TT68000774\t1\t40\t33200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68000774-2\tJ69-TT68000774\t2\t40\t33200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68000774-3\tJ69-TT68000774\t3\t20\t16600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68000930-1\tJ69-TT68000930\t1\t40\t29200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68000930-2\tJ69-TT68000930\t2\t40\t29200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68000930-3\tJ69-TT68000930\t3\t20\t14600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68000932-1\tJ69-TT68000932\t1\t40\t36400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68000932-2\tJ69-TT68000932\t2\t40\t36400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68000932-3\tJ69-TT68000932\t3\t20\t18200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68000934-1\tJ69-TT68000934\t1\t40\t28400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68000934-2\tJ69-TT68000934\t2\t40\t28400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68000934-3\tJ69-TT68000934\t3\t20\t14200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001122-1\tJ69-TT68001122\t1\t40\t104400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001122-2\tJ69-TT68001122\t2\t40\t104400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001122-3\tJ69-TT68001122\t3\t20\t52200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001249-1\tJ69-TT68001249\t1\t40\t56000\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001249-2\tJ69-TT68001249\t2\t40\t56000\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001249-3\tJ69-TT68001249\t3\t20\t28000\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001255-1\tJ69-TT68001255\t1\t40\t67600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001255-2\tJ69-TT68001255\t2\t40\t67600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001255-3\tJ69-TT68001255\t3\t20\t33800\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001258-1\tJ69-TT68001258\t1\t40\t58400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001258-2\tJ69-TT68001258\t2\t40\t58400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001258-3\tJ69-TT68001258\t3\t20\t29200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001260-1\tJ69-TT68001260\t1\t40\t44400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001260-2\tJ69-TT68001260\t2\t40\t44400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001260-3\tJ69-TT68001260\t3\t20\t22200\t\t\t\tรอตั้งเบิก\nP-TT68001364-1\tJ69-TT68001364\t1\t40\t80000\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001364-2\tJ69-TT68001364\t2\t40\t80000\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001364-3\tJ69-TT68001364\t3\t20\t40000\t\t\t\tรอตั้งเบิก\nP-TT68001369-1\tJ69-TT68001369\t1\t40\t29600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001369-2\tJ69-TT68001369\t2\t40\t29600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001369-3\tJ69-TT68001369\t3\t20\t14800\t\t\t\tรอตั้งเบิก\nP-TT68001375-1\tJ69-TT68001375\t1\t40\t82400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001375-2\tJ69-TT68001375\t2\t40\t82400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001375-3\tJ69-TT68001375\t3\t20\t41200\t\t\t\tรอตั้งเบิก\nP-TT68001547-1\tJ69-TT68001547\t1\t40\t70400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001547-2\tJ69-TT68001547\t2\t40\t70400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001547-3\tJ69-TT68001547\t3\t20\t35200\t\t\t\tรอตั้งเบิก\nP-TT68001589-1\tJ69-TT68001589\t1\t40\t52000\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001589-2\tJ69-TT68001589\t2\t40\t52000\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001589-3\tJ69-TT68001589\t3\t20\t26000\t\t\t\tรอตั้งเบิก\nP-TT68001613-1\tJ69-TT68001613\t1\t40\t79200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001613-2\tJ69-TT68001613\t2\t40\t79200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001613-3\tJ69-TT68001613\t3\t20\t39600\t\t\t\tรอตั้งเบิก\nP-TT68001618-1\tJ69-TT68001618\t1\t40\t34800\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001618-2\tJ69-TT68001618\t2\t40\t34800\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001618-3\tJ69-TT68001618\t3\t20\t17400\t\t\t\tรอตั้งเบิก\nP-TT68001647-1\tJ69-TT68001647\t1\t40\t53600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001647-2\tJ69-TT68001647\t2\t40\t53600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001647-3\tJ69-TT68001647\t3\t20\t26800\t\t\t\tรอตั้งเบิก\nP-TT68001686-1\tJ69-TT68001686\t1\t40\t27200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001686-2\tJ69-TT68001686\t2\t40\t27200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001686-3\tJ69-TT68001686\t3\t20\t13600\t\t\t\tรอตั้งเบิก\nP-TT68001688-1\tJ69-TT68001688\t1\t40\t42800\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001688-2\tJ69-TT68001688\t2\t40\t42800\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001688-3\tJ69-TT68001688\t3\t20\t21400\t\t\t\tรอตั้งเบิก\nP-TT68001692-1\tJ69-TT68001692\t1\t40\t30400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001692-2\tJ69-TT68001692\t2\t40\t30400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001692-3\tJ69-TT68001692\t3\t20\t15200\t\t\t\tรอตั้งเบิก\nP-TT68001759-1\tJ69-TT68001759\t1\t40\t20400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001759-2\tJ69-TT68001759\t2\t40\t20400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001759-3\tJ69-TT68001759\t3\t20\t10200\t\t\t\tรอตั้งเบิก\nP-TT68001769-1\tJ69-TT68001769\t1\t40\t16400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001769-2\tJ69-TT68001769\t2\t40\t16400\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001769-3\tJ69-TT68001769\t3\t20\t8200\t\t\t\tรอตั้งเบิก\nP-TT68001770-1\tJ69-TT68001770\t1\t40\t69600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001770-2\tJ69-TT68001770\t2\t40\t69600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001770-3\tJ69-TT68001770\t3\t20\t34800\t\t\t\tรอตั้งเบิก\nP-TT68001795-1\tJ69-TT68001795\t1\t40\t36000\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001795-2\tJ69-TT68001795\t2\t40\t36000\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001795-3\tJ69-TT68001795\t3\t20\t18000\t\t\t\tรอตั้งเบิก\nP-TT68001796-1\tJ69-TT68001796\t1\t40\t24800\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001796-2\tJ69-TT68001796\t2\t40\t24800\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001796-3\tJ69-TT68001796\t3\t20\t12400\t\t\t\tรอตั้งเบิก\nP-TT68001813-1\tJ69-TT68001813\t1\t40\t39600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001813-2\tJ69-TT68001813\t2\t40\t39600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001813-3\tJ69-TT68001813\t3\t20\t19800\t\t\t\tรอตั้งเบิก\nP-TT68001816-1\tJ69-TT68001816\t1\t40\t66800\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001816-2\tJ69-TT68001816\t2\t40\t66800\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001816-3\tJ69-TT68001816\t3\t20\t33400\t\t\t\tรอตั้งเบิก\nP-TT68001818-1\tJ69-TT68001818\t1\t40\t57200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001818-2\tJ69-TT68001818\t2\t40\t57200\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001818-3\tJ69-TT68001818\t3\t20\t28600\t\t\t\tรอตั้งเบิก\nP-TT68001831-1\tJ69-TT68001831\t1\t40\t65600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001831-2\tJ69-TT68001831\t2\t40\t65600\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001831-3\tJ69-TT68001831\t3\t20\t32800\t\t\t\tรอตั้งเบิก\nP-TT68001834-1\tJ69-TT68001834\t1\t40\t156800\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001834-2\tJ69-TT68001834\t2\t40\t156800\t\t\t\tเบิกจ่ายแล้ว\nP-TT68001834-3\tJ69-TT68001834\t3\t20\t78400\t\t\t\tรอตั้งเบิก", "Logs": "Timestamp\tUser\tAction\tTarget\tDetail"};
const SEED_WIDTHS = {"Config": [22, 40, 52], "Members": [30, 24, 14, 22, 18, 12, 16, 10], "TreeJobs": [14, 8, 13, 34, 52, 8, 10, 10, 10, 12, 12, 16, 13, 13, 14, 14, 14, 16, 30], "TreeRounds": [20, 14, 9, 14, 14, 14, 14, 16, 20, 30], "TreeSegments": [16, 14, 10, 16, 16, 10, 40, 12], "TreeEstimates": [20, 16, 10, 14, 10, 12, 14], "TreeFindings": [18, 14, 18, 14, 14, 12, 12, 20, 12, 30, 30, 18, 14, 14, 14, 30], "TreePayments": [18, 14, 12, 10, 14, 14, 16, 14, 16], "Logs": [20, 26, 18, 20, 60]};

function setupDatabase() {
  var ss = SpreadsheetApp.openById(DB_ID);
  var order = ['Config','Members','TreeJobs','TreeRounds','TreeSegments',
               'TreeEstimates','TreeFindings','TreePayments','Logs'];
  var NOT_NUMBER = ['ZPM4No','DocNo','DeviceID','MJMNo','JobID','RoundID','SegID',
                    'PayID','EstID','FindID','Value','Key','Active'];
  var made = [];

  order.forEach(function (name) {
    var tsv = SEED[name];
    if (!tsv) return;
    var lines = tsv.split('\n');
    var headers = lines[0].split('\t');

    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.clear();

    var data = [headers];
    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split('\t');
      var row = [];
      for (var c = 0; c < headers.length; c++) {
        var v = cells[c] === undefined ? '' : cells[c];
        if (v !== '' && NOT_NUMBER.indexOf(headers[c]) < 0 && /^-?\d+(\.\d+)?$/.test(v)) {
          v = Number(v);
        }
        row.push(v);
      }
      data.push(row);
    }

    sh.getRange(1, 1, data.length, headers.length).setValues(data);
    var head = sh.getRange(1, 1, 1, headers.length);
    head.setBackground('#4A1D62').setFontColor('#FFFFFF').setFontWeight('bold')
        .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    var w = SEED_WIDTHS[name] || [];
    for (var k = 0; k < headers.length; k++) {
      if (w[k]) sh.setColumnWidth(k + 1, w[k] * 7);
    }
    made.push(name + ' (' + (data.length - 1) + ' แถว)');
  });

  // ลบแท็บเปล่าที่ Google สร้างมาให้ตอนแรก
  ss.getSheets().forEach(function (sh) {
    if (order.indexOf(sh.getName()) < 0 && ss.getSheets().length > 1) {
      try { ss.deleteSheet(sh); } catch (e) {}
    }
  });

  var msg = 'ติดตั้งฐานข้อมูลเรียบร้อย\n\n' + made.join('\n') +
            '\n\nเปิดชีตได้ที่\n' + ss.getUrl();
  Logger.log(msg);
  return msg;
}

/* ============================================================
   ข้อ 5 — แจ้งเตือนเข้ากลุ่มไลน์ (LINE Messaging API)
   ใส่ค่าสองตัวในแท็บ Config ก่อนใช้งาน
     LINE_TOKEN   = Channel access token ของ LINE Official Account
     LINE_TARGET  = groupId ของกลุ่มที่จะให้ส่งเข้า
   ถ้าเว้นว่างไว้ ระบบจะข้ามการส่งทั้งหมด ไม่มี error
   โควตาฟรี 200 ข้อความ/เดือน ที่ออกแบบไว้ใช้ราว 12 ข้อความ/เดือน
   ============================================================ */
function lineCfg_() {
  var c = getConfig_();
  return {
    token: String(c.LINE_TOKEN || '').trim(),
    target: String(c.LINE_TARGET || '').trim(),
    appUrl: String(c.APP_URL || 'https://aloofpea-aul.github.io/tree-ala/').trim()
  };
}

function linePush_(messages) {
  var cfg = lineCfg_();
  if (!cfg.token || !cfg.target) return false;
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + cfg.token },
      payload: JSON.stringify({ to: cfg.target, messages: messages }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 300) log_('system', 'linePushFail', String(code), res.getContentText().slice(0, 300));
    return code < 300;
  } catch (e) {
    log_('system', 'linePushError', '', String(e));
    return false;
  }
}

/* กันส่งซ้ำเรื่องเดิมภายใน 24 ชั่วโมง */
function lineOnce_(key) {
  try {
    var c = CacheService.getScriptCache();
    if (c.get('ln_' + key)) return false;
    c.put('ln_' + key, '1', 86400);
    return true;
  } catch (e) { return true; }
}

/* ส่งเฉพาะเวลาราชการ 07:00-19:00 (เรื่องด่วนข้ามข้อนี้ได้) */
function lineInHours_() {
  var h = Number(Utilities.formatDate(new Date(), 'Asia/Bangkok', 'H'));
  return h >= 7 && h < 19;
}

function lineFlex_(alt, head, color, title, note, rows, btnText) {
  var body = [];
  if (title) body.push({ type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true });
  if (note)  body.push({ type: 'text', text: note, size: 'sm', color: '#5F5C55', wrap: true, margin: 'sm' });
  if (rows && rows.length) {
    body.push({ type: 'separator', margin: 'lg' });
    body.push({
      type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
      contents: rows.map(function (r) {
        return {
          type: 'box', layout: 'baseline', spacing: 'sm',
          contents: [
            { type: 'text', text: String(r[0]), size: 'sm', color: '#75716A', flex: 4, wrap: true },
            { type: 'text', text: String(r[1]), size: 'sm', weight: 'bold', flex: 5, wrap: true, align: 'end' }
          ]
        };
      })
    });
  }
  var bubble = {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '14px',
      contents: [
        { type: 'text', text: head, color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true },
        { type: 'text', text: 'กฟส.อ่าวลึก · งานตัดต้นไม้', color: '#FFFFFFCC', size: 'xs', margin: 'xs' }
      ]
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: body }
  };
  if (btnText) {
    bubble.footer = {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: [{
        type: 'button', style: 'link', height: 'sm',
        action: { type: 'uri', label: btnText, uri: lineCfg_().appUrl }
      }]
    };
  }
  return [{ type: 'flex', altText: alt, contents: bubble }];
}

/* ---- 1. เตือนล่วงหน้าก่อนถึงรอบตัด (รันทุกวันจันทร์เช้า) ---- */
var TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                 'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function lineRoundReminder() {
  var cfg = lineCfg_();
  if (!cfg.token) return 'ยังไม่ได้ตั้งค่า LINE_TOKEN';
  var now = new Date();
  var soon = new Date(now.getTime() + 7 * 86400000);
  if (soon.getMonth() === now.getMonth()) return 'ยังไม่ถึงช่วงเตือน';   // เตือนเฉพาะสัปดาห์ก่อนขึ้นเดือนใหม่
  var nextMonth = TH_MONTHS[soon.getMonth()];
  var year = String(soon.getFullYear() + 543);

  var jobs = readTable_(TABLES.jobs).rows.filter(function (j) {
    return String(j.Year) === year && String(j.PlanMonths || '').indexOf(nextMonth) >= 0;
  });
  if (!jobs.length) return 'เดือนหน้าไม่มีแผน';
  if (!lineOnce_('round_' + year + '_' + nextMonth)) return 'ส่งไปแล้ว';

  var byCon = {};
  jobs.forEach(function (j) {
    var c = String(j.Contractor || 'ยังไม่ระบุผู้รับจ้าง');
    byCon[c] = byCon[c] || { n: 0, km: 0 };
    byCon[c].n++;
    byCon[c].km += parseFloat(j.PlanKm) || 0;
  });
  var rows = Object.keys(byCon).map(function (c) {
    return [c, byCon[c].n + ' ใบงาน · ' + byCon[c].km.toFixed(2) + ' กม.'];
  });
  rows.unshift(['เริ่มได้ตั้งแต่', '1 ' + nextMonth + ' ' + year]);

  return linePush_(lineFlex_('ใกล้ถึงรอบตัด ' + nextMonth,
    'ใกล้ถึงรอบตัด', '#4A1D62', 'เดือน' + nextMonth + ' ' + year,
    'อีก 7 วันเริ่มงานได้ เตรียมคนและแจ้งผู้รับจ้างล่วงหน้า', rows, 'เปิดแผนงาน')) ? 'ส่งแล้ว' : 'ส่งไม่สำเร็จ';
}

/* ---- 2. สรุปความก้าวหน้ารายสัปดาห์ (รันทุกวันจันทร์เย็น) ---- */
function lineWeekly() {
  var cfg = lineCfg_();
  if (!cfg.token) return 'ยังไม่ได้ตั้งค่า LINE_TOKEN';
  var year = String(new Date().getFullYear() + 543);
  var jobs = readTable_(TABLES.jobs).rows.filter(function (j) {
    return String(j.Year) === year && j.JobType === 'รายปี';
  });
  if (!jobs.length) return 'ไม่มีข้อมูลปีนี้';
  var ids = {}; jobs.forEach(function (j) { ids[j.JobID] = j; });
  var lines = readTable_(TABLES.lines).rows.filter(function (l) { return ids[l.JobID]; });
  if (!lines.length) return 'ไม่มีไลน์แยก';

  var cut = 0, total = lines.length * 3;
  lines.forEach(function (l) {
    [1, 2, 3].forEach(function (n) { if (String(l['R' + n + 'Date'] || '').trim()) cut++; });
  });
  var pct = Math.round(cut / total * 100);

  var byCon = {};
  jobs.forEach(function (j) {
    var c = String(j.Contractor || 'ยังไม่ระบุ');
    byCon[c] = byCon[c] || { done: 0, all: 0 };
  });
  lines.forEach(function (l) {
    var c = String(ids[l.JobID].Contractor || 'ยังไม่ระบุ');
    [1, 2, 3].forEach(function (n) {
      byCon[c].all++;
      if (String(l['R' + n + 'Date'] || '').trim()) byCon[c].done++;
    });
  });
  var rows = [['ตัดแล้วทั้งหมด', cut + ' / ' + total + ' (' + pct + '%)']];
  Object.keys(byCon).forEach(function (c) {
    if (!byCon[c].all) return;
    rows.push([c, Math.round(byCon[c].done / byCon[c].all * 100) + '%']);
  });

  return linePush_(lineFlex_('สรุปความก้าวหน้างานตัดต้นไม้',
    'สรุปสัปดาห์', '#2F7A55', 'ตัดแล้ว ' + pct + '%',
    'ข้อมูล ณ ' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'd MMM yyyy'),
    rows, 'เปิดแดชบอร์ด')) ? 'ส่งแล้ว' : 'ส่งไม่สำเร็จ';
}

/* ---- 3. จุดเสี่ยงด่วน (เรียกอัตโนมัติตอนบันทึกจุดที่พบ) ---- */
function lineRisk_(find, photoUrl) {
  try {
    var sev = String(find.Severity || '');
    if (sev.indexOf('เสี่ยง') < 0 && sev.indexOf('ด่วน') < 0) return;
    var job = null;
    readTable_(TABLES.jobs).rows.forEach(function (j) { if (j.JobID === find.JobID) job = j; });
    var rows = [
      ['อุปกรณ์', String(find.DeviceID || 'หมุดอิสระ')],
      ['ชนิดต้นไม้', String(find.TreeType || '-')],
      ['ผู้รับจ้าง', job ? String(job.Contractor || 'ยังไม่ระบุ') : '-'],
      ['ผู้แจ้ง', String(find.Reporter || '-')]
    ];
    var msgs = lineFlex_('จุดเสี่ยงต้องเข้าด่วน', 'จุดเสี่ยง ต้องเข้าด่วน', '#A32B2B',
      String(find.DeviceID || 'จุดที่พบใหม่'), String(find.Note || sev), rows, 'เปิดแผนที่');
    if (photoUrl) msgs.unshift({ type: 'image', originalContentUrl: photoUrl, previewImageUrl: photoUrl });
    linePush_(msgs);
  } catch (e) { /* แจ้งเตือนล้มเหลวไม่กระทบการบันทึก */ }
}

/* ---- 4. ตรวจรับผ่าน (เรียกอัตโนมัติตอนบันทึกรอบเป็นตรวจรับแล้ว) ---- */
function lineAccepted_(roundId, fields) {
  try {
    if (String(fields.Status || '').indexOf('ตรวจรับแล้ว') < 0) return;
    if (!lineOnce_('acc_' + roundId)) return;
    var round = null;
    readTable_(TABLES.rounds).rows.forEach(function (r) { if (r.RoundID === roundId) round = r; });
    if (!round) return;
    var job = null;
    readTable_(TABLES.jobs).rows.forEach(function (j) { if (j.JobID === round.JobID) job = j; });
    if (!job) return;
    var lines = readTable_(TABLES.lines).rows.filter(function (l) { return l.JobID === round.JobID; });
    var no = parseInt(round.RoundNo, 10) || 1;
    var cut = lines.filter(function (l) { return String(l['R' + no + 'Date'] || '').trim(); }).length;

    linePush_(lineFlex_('ตรวจรับงานผ่าน ' + job.MJMNo, 'ตรวจรับงานผ่าน', '#8A6512',
      String(job.MJMNo) + ' รอบ ' + no,
      String(job.Contractor || '') + ' · ฟีดเดอร์ ' + String(job.FeederID || ''),
      [['ไลน์ที่ตัด', cut + ' / ' + lines.length + ' เส้น'],
       ['ระยะทางตามแผน', (parseFloat(job.PlanKm) || 0).toFixed(2) + ' กม.'],
       ['วันตรวจรับ', String(fields.AcceptDate || round.AcceptDate || '-')],
       ['ผู้ตรวจรับ', String(fields.Inspector || round.Inspector || '-')],
       ['งวดที่เบิกได้', 'งวดที่ ' + no]],
      'เปิดใบงาน'));
  } catch (e) { /* ไม่กระทบการบันทึก */ }
}

/* ---- ติดตั้งตัวจับเวลา รันครั้งเดียว ---- */
function installLineTriggers() {
  var t = ScriptApp.getProjectTriggers();
  for (var i = 0; i < t.length; i++) {
    var fn = t[i].getHandlerFunction();
    if (fn === 'lineWeekly' || fn === 'lineRoundReminder') ScriptApp.deleteTrigger(t[i]);
  }
  ScriptApp.newTrigger('lineRoundReminder').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone('Asia/Bangkok').create();
  ScriptApp.newTrigger('lineWeekly').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(17).inTimezone('Asia/Bangkok').create();
  return 'ติดตั้งแล้ว — เตือนก่อนถึงรอบ จันทร์ 08:00 · สรุปสัปดาห์ จันทร์ 17:00';
}

/* ---- ทดสอบส่งข้อความ รันมือเพื่อเช็กว่าตั้งค่าถูก ---- */
function lineTest() {
  var cfg = lineCfg_();
  if (!cfg.token) return 'ยังไม่ได้ใส่ LINE_TOKEN ในแท็บ Config';
  if (!cfg.target) return 'ยังไม่ได้ใส่ LINE_TARGET ในแท็บ Config';
  var okSend = linePush_(lineFlex_('ทดสอบการแจ้งเตือน', 'ทดสอบการเชื่อมต่อ', '#4A1D62',
    'ต่อสำเร็จแล้ว', 'ข้อความนี้ส่งจากระบบงานตัดต้นไม้ กฟส.อ่าวลึก',
    [['เวลา', Utilities.formatDate(new Date(), 'Asia/Bangkok', 'd MMM yyyy HH:mm')]], 'เปิดแอป'));
  return okSend ? 'ส่งสำเร็จ ดูในกลุ่มไลน์ได้เลย' : 'ส่งไม่สำเร็จ ตรวจ token และ groupId อีกครั้ง (ดูรายละเอียดในแท็บ Logs)';
}

/* ---- เติมค่าที่ต้องใช้ลงแท็บ Config ให้ครบ รันครั้งเดียว ---- */
function setupLineConfig() {
  var sh = db_().getSheetByName(TABLES.config);
  if (!sh) return 'ไม่พบแท็บ Config';
  var v = sh.getDataRange().getValues();
  var have = {};
  for (var i = 1; i < v.length; i++) have[String(v[i][0]).trim()] = true;
  var want = [
    ['LINE_TOKEN',  '', 'Channel access token ของ LINE Official Account'],
    ['LINE_TARGET', '', 'groupId ของกลุ่มไลน์ที่จะให้ส่งเข้า'],
    ['APP_URL', 'https://aloofpea-aul.github.io/tree-ala/', 'ลิงก์แอป ใช้เป็นปุ่มในข้อความแจ้งเตือน']
  ];
  var added = [];
  want.forEach(function (row) {
    if (!have[row[0]]) { sh.appendRow(row); added.push(row[0]); }
  });
  return added.length ? 'เพิ่มแล้ว: ' + added.join(', ') : 'มีครบอยู่แล้ว';
}

/* ---- เขียนค่าลงแท็บ Config มีคีย์อยู่แล้วก็ทับ ไม่มีก็เพิ่มใหม่ ---- */
function setConfig_(key, value, note) {
  var sh = db_().getSheetByName(TABLES.config);
  if (!sh) return false;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]).trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      bumpStamp_();
      return true;
    }
  }
  sh.appendRow([key, value, note || '']);
  bumpStamp_();
  return true;
}

/* ====== ตัวรับ Webhook ของ LINE ======
   ใช้เพื่อ "จับ groupId ให้อัตโนมัติ" — ตั้ง Webhook URL เป็น URL ของเว็บแอปนี้
   แล้วพิมพ์อะไรก็ได้ในกลุ่มหนึ่งครั้ง ระบบจะเขียน LINE_TARGET ลงแท็บ Config ให้เอง
   พิมพ์คำว่า  รหัสกลุ่ม  ในกลุ่ม จะตอบรหัสกลับมาให้ดูด้วย (ถ้าใส่ token แล้ว)  */
function lineWebhook_(body) {
  try {
    var evs = body.events || [];
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i] || {};
      var src = ev.source || {};
      var id = src.groupId || src.roomId || src.userId || '';
      var kind = src.groupId ? 'group' : (src.roomId ? 'room' : 'user');
      if (!id) continue;

      var cur = String(getConfig_().LINE_TARGET || '').trim();
      var text = (ev.message && ev.message.type === 'text') ? String(ev.message.text || '').trim() : '';
      var asked = /^(id|รหัสกลุ่ม|groupid)$/i.test(text);

      if (!cur && src.groupId) {
        setConfig_('LINE_TARGET', id, 'groupId ของกลุ่มไลน์ที่จะให้ส่งเข้า');
        log_('line', 'lineGroupCaptured', id, 'บันทึก groupId อัตโนมัติจาก webhook');
        lineReply_(ev.replyToken, 'เชื่อมต่อกลุ่มเรียบร้อยแล้ว\nระบบงานตัดต้นไม้ กฟส.อ่าวลึก จะส่งแจ้งเตือนเข้ากลุ่มนี้');
      } else if (asked) {
        log_('line', 'lineIdAsked', id, kind);
        lineReply_(ev.replyToken, kind + 'Id ของที่นี่คือ\n' + id);
      } else {
        log_('line', 'lineEvent', id, kind + ' · ' + (ev.type || ''));
      }
    }
  } catch (err) {
    log_('line', 'lineWebhookError', '', String(err));
  }
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

/* ตอบกลับด้วย replyToken ไม่กินโควตา 200 ข้อความต่อเดือน */
function lineReply_(replyToken, text) {
  if (!replyToken) return false;
  var cfg = lineCfg_();
  if (!cfg.token) return false;
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + cfg.token },
      payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true
    });
    return true;
  } catch (e) { return false; }
}

/* ---- ดูว่าตอนนี้ตั้งค่า LINE ครบหรือยัง รันมือได้ ---- */
function lineStatus() {
  var cfg = lineCfg_();
  return [
    'LINE_TOKEN : ' + (cfg.token ? 'ใส่แล้ว (' + cfg.token.length + ' ตัวอักษร)' : 'ยังว่าง'),
    'LINE_TARGET: ' + (cfg.target ? cfg.target : 'ยังว่าง — พิมพ์อะไรก็ได้ในกลุ่มหนึ่งครั้ง ระบบจะจับให้เอง'),
    'APP_URL    : ' + cfg.appUrl
  ].join('\n');
}

/* ---- แก้รหัสฟีดเดอร์ของงานแรงสูง 115 kV ปี 2570 ให้เหมือนปี 2569 ----
   เดิม ALA03YB-101 ถูกใส่ฟีดเดอร์เป็น ALA03 และ ALA05YB-101 เป็น ALA05
   ซึ่งไปทับเป็นใบงานไลน์เมนของระบบจำหน่าย 33 kV ทำให้สีบนแผนที่ผิด
   ปี 2569 ใช้ KBB-ALA และ PN-ALA แยกไว้ จึงแก้ให้ตรงกัน  รันครั้งเดียว  */
function fixHvFeeder2570() {
  var pairs = [['J70-TT69000364', 'KBB-ALA'], ['J70-TT69000365', 'PN-ALA']];
  var done = [];
  pairs.forEach(function (pr) {
    try {
      updateRow_(TABLES.jobs, 'JobID', pr[0], { FeederID: pr[1] });
      done.push(pr[0] + ' -> ' + pr[1]);
    } catch (e) { done.push(pr[0] + ' ไม่สำเร็จ: ' + e.message); }
  });
  bumpStamp_();
  log_('system', 'fixHvFeeder2570', '', done.join(' | '));
  return done.join('\n');
}

/* ============================================================
   รูปหน้างานแบบไม่จำกัดจำนวน + เงื่อนไขล็อกการตรวจรับ
   ============================================================ */
var PHOTO_COLS = ['PhotoID','JobID','RoundNo','LineCode','DeviceID','FindID','Kind',
                  'Lat','Lng','Url','FileID','By','At','Note'];

/* สร้างแท็บถ้ายังไม่มี และเติมคอลัมน์ที่ขาด */
function ensureSheet_(name, cols) {
  var ss = db_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols])
      .setBackground('#4A1D62').setFontColor('#FFFFFF').setFontWeight('bold')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    return sh;
  }
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
               .map(function (h) { return String(h).trim(); });
  var add = cols.filter(function (c) { return head.indexOf(c) < 0; });
  if (add.length) {
    sh.getRange(1, head.length + 1, 1, add.length).setValues([add])
      .setBackground('#4A1D62').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  return sh;
}

function photoFolder_() {
  var cfg = getConfig_();
  var id = String(cfg.PHOTO_FOLDER_ID || '').trim();
  if (id) return DriveApp.getFolderById(id);
  /* ยังไม่ได้ตั้งค่า สร้างให้อัตโนมัติแล้วเขียนกลับลง Config */
  var f = DriveApp.createFolder('รูปงานตัดต้นไม้ กฟส.อ่าวลึก');
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var sh = db_().getSheetByName(TABLES.config);
  if (sh) {
    var v = sh.getDataRange().getValues(), found = false;
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][0]).trim() === 'PHOTO_FOLDER_ID') { sh.getRange(i + 1, 2).setValue(f.getId()); found = true; }
    }
    if (!found) sh.appendRow(['PHOTO_FOLDER_ID', f.getId(), 'โฟลเดอร์เก็บรูปหน้างาน สร้างอัตโนมัติ']);
  }
  return f;
}

function apiAddPhoto_(p) {
  var u = requireUser_(p);
  if (!p.photoBase64) throw new Error('ไม่พบรูป');
  var id = 'P' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMMddHHmmss') +
           Math.floor(Math.random() * 900 + 100);
  var parts = String(p.photoBase64).split(',');
  var data = parts.length > 1 ? parts[1] : parts[0];
  var mime = 'image/jpeg';
  var m = /^data:([^;]+);/.exec(String(p.photoBase64));
  if (m) mime = m[1];
  var blob = Utilities.newBlob(Utilities.base64Decode(data), mime, id + '.jpg');
  var file = photoFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var sh = ensureSheet_(TABLES.photos, PHOTO_COLS);
  var row = {
    PhotoID: id,
    JobID: p.jobId || '',
    RoundNo: p.roundNo || '',
    LineCode: p.lineCode || '',
    DeviceID: p.deviceId || '',
    FindID: p.findId || '',
    Kind: p.kind || 'ก่อน',
    Lat: p.lat || '', Lng: p.lng || '',
    Url: 'https://drive.google.com/uc?id=' + file.getId(),
    FileID: file.getId(),
    By: u.name,
    At: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'),
    Note: p.note || ''
  };
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
               .map(function (h) { return String(h).trim(); });
  sh.appendRow(head.map(function (h) { return row[h] !== undefined ? row[h] : ''; }));
  log_(u.name, 'addPhoto', id, (p.lineCode || p.deviceId || '') + ' ' + row.Kind);
  bumpStamp_();
  return { ok: true, photo: row };
}

function apiDelPhoto_(p) {
  var u = requireUser_(p);
  var sh = db_().getSheetByName(TABLES.photos);
  if (!sh) throw new Error('ยังไม่มีรูปในระบบ');
  var v = sh.getDataRange().getValues();
  var head = v[0].map(function (h) { return String(h).trim(); });
  var iId = head.indexOf('PhotoID'), iFile = head.indexOf('FileID'), iBy = head.indexOf('By');
  for (var r = 1; r < v.length; r++) {
    if (String(v[r][iId]) !== String(p.photoId)) continue;
    if (String(v[r][iBy]) !== u.name && !isSupervisor_(u.name))
      throw new Error('ลบได้เฉพาะรูปที่ตัวเองถ่าย');
    try { DriveApp.getFileById(String(v[r][iFile])).setTrashed(true); } catch (e) {}
    sh.deleteRow(r + 1);
    log_(u.name, 'delPhoto', String(p.photoId), '');
    bumpStamp_();
    return { ok: true };
  }
  throw new Error('ไม่พบรูปนี้');
}

/* ปรับสถานะจุดที่พบ เช่น ปรับปรุงแล้ว */
function apiFixFinding_(p) {
  var u = requireUser_(p);
  var clean = {};
  ['Status', 'FixedDate', 'PhotoAfter', 'Note'].forEach(function (k) {
    if (p.fields && p.fields[k] !== undefined) clean[k] = p.fields[k];
  });
  updateRow_(TABLES.findings, 'FindID', p.findId, clean);
  log_(u.name, 'fixFinding', p.findId, JSON.stringify(clean));
  bumpStamp_();
  return { ok: true };
}

/* ============ สิทธิ์ยกเว้นการล็อก ============
   ผู้จัดการ และหัวหน้าแผนก กดยกเว้นได้ ต้องใส่เหตุผลเสมอ  */
function isSupervisor_(name) {
  try {
    var cfg = getConfig_();
    if (!cfg.SLD_SHEET_ID) return false;
    var ss = SpreadsheetApp.openById(cfg.SLD_SHEET_ID);
    var sheets = ss.getSheets();
    var target = String(name).trim().toLowerCase();
    for (var i = 0; i < sheets.length; i++) {
      var meta = classifyUserSheet_(sheets[i]);
      if (!meta) continue;
      var v = sheets[i].getDataRange().getValues();
      for (var r = 1; r < v.length; r++) {
        if (String(v[r][0]).trim().toLowerCase() !== target) continue;
        var role = (meta.iRole >= 0 ? String(v[r][meta.iRole]) : meta.role).toLowerCase();
        if (role.indexOf('admin') >= 0 || role.indexOf('ผู้จัดการ') >= 0 ||
            role.indexOf('หัวหน้า') >= 0 || role.indexOf('manager') >= 0 ||
            role.indexOf('หน.') >= 0) return true;
      }
    }
  } catch (e) {}
  return false;
}

/* ตรวจเงื่อนไขก่อนให้ตรวจรับ — ตัดครบทุกเส้น และจุดที่พบต้องปรับปรุงครบ */
function acceptBlockers_(jobId, no) {
  var lines = readTable_(TABLES.lines).rows.filter(function (l) { return l.JobID === jobId; });
  var notCut = lines.filter(function (l) { return String(l['R' + no + 'Date'] || '').trim() === ''; });
  var finds = readTable_(TABLES.findings).rows.filter(function (f) {
    return f.JobID === jobId && String(f.Status || '').indexOf('ปรับปรุงแล้ว') < 0;
  });
  var out = [];
  if (notCut.length) out.push({
    key: 'cut', n: notCut.length,
    text: 'ไลน์ยังตัดไม่ครบ ' + notCut.length + ' เส้น',
    detail: notCut.slice(0, 5).map(function (l) { return l.LineCode; }).join(', ')
  });
  if (finds.length) out.push({
    key: 'find', n: finds.length,
    text: 'จุดที่พบยังไม่ปรับปรุง ' + finds.length + ' จุด',
    detail: finds.slice(0, 5).map(function (f) { return f.DeviceID || f.FindID; }).join(', ')
  });
  return out;
}
