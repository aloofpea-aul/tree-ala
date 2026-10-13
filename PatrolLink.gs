/**
 * PatrolLink.gs — สะพานเชื่อม "Patrol ระบบจำหน่าย" เข้ากับ "งานตัดต้นไม้"
 *
 * ทำอะไร
 *   1) ทุก 15 นาที ไปอ่านแท็บ PatrolFinding ในชีต SLD อ่าวลึก - ฐานข้อมูล
 *      หยิบเฉพาะจุดที่พบประเภท TREE (ต้นไม้ใกล้สาย) ที่ยังไม่เคยหยิบ
 *      มาสร้างเป็นเรื่องพาโทรลในแท็บ TreePatrol ให้อัตโนมัติ
 *   2) เขียนสถานะกลับไปบอกแอป Patrol ด้วยคำที่แอปนั้นใช้เอง
 *        หยิบเข้าคิว            -> รับเรื่องแล้ว
 *        เปิดเป็นจุดที่พบในใบงาน -> เข้าแผนแล้ว  (+ เลขใบสั่งงานในช่อง OrderNo)
 *        ปิดเรื่อง              -> ปิด          (+ ClosedAt ClosedBy CloseReason)
 *
 * ไม่แก้ไขโปรแกรมของแอป Patrol เลย อ่านกับเขียนผ่านชีตเท่านั้น
 * ปิดการทำงานได้ด้วยคีย์ PATROL_LINK_ON = FALSE ในแท็บ Config
 *
 * ---------- ติดตั้ง ----------
 * รัน setupPatrolLink หนึ่งครั้ง แล้ว Deploy เวอร์ชันใหม่
 */

var PLK = {
  finding: 'PatrolFinding',
  photo:   'PatrolPhoto',
  type:    'PatrolType'
};

/* สถานะของแอป Patrol ที่ยังรอคนจัดการ — นอกจากนี้ถือว่าเขาจัดการเองแล้ว ไม่ต้องหยิบ */
var PLK_OPEN = ['', 'ใหม่', 'รับเรื่องแล้ว'];

/* ====================== ตัวช่วยพื้นฐาน ====================== */

function plkOn_() {
  var v = String(getConfig_().PATROL_LINK_ON || '').trim().toUpperCase();
  return v !== 'FALSE' && v !== 'OFF' && v !== '0';
}

function plkTypeCode_() {
  var v = String(getConfig_().PATROL_TREE_TYPE || '').trim();
  return v || 'TREE';
}

function plkDb_() {
  return SpreadsheetApp.openById(getConfig_().SLD_SHEET_ID);
}

/** อ่านแท็บในชีตของ Patrol — คืนค่าดิบ ไม่แปลงวันที่ทิ้ง */
function plkRead_(name) {
  var sh = plkDb_().getSheetByName(name);
  if (!sh) return { headers: [], rows: [] };
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { headers: values[0] || [], rows: [] };
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i].join('') === '') continue;
    var o = {};
    for (var c = 0; c < headers.length; c++) o[headers[c]] = values[i][c];
    o._row = i + 1;
    rows.push(o);
  }
  return { headers: headers, rows: rows };
}

/** เขียนกลับไปที่แถวของ Patrol — ล้มแล้วไม่ทำให้งานหลักพัง */
function plkWriteBack_(findingId, fields) {
  try {
    if (!findingId || !plkOn_()) return false;
    var sh = plkDb_().getSheetByName(PLK.finding);
    if (!sh) return false;
    var values = sh.getDataRange().getValues();
    var headers = values[0].map(function (h) { return String(h).trim(); });
    var k = headers.indexOf('FindingID');
    if (k < 0) return false;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][k]) !== String(findingId)) continue;
      Object.keys(fields).forEach(function (f) {
        var c = headers.indexOf(f);
        if (c >= 0) sh.getRange(i + 1, c + 1).setValue(fields[f]);
      });
      return true;
    }
  } catch (e) { /* เขียนกลับไม่สำเร็จ ไม่กระทบงานตัดต้นไม้ */ }
  return false;
}

/** วันเวลาจาก Patrol -> {date:'yyyy-MM-dd', time:'HH:mm'} */
function plkWhen_(v) {
  var d = null;
  if (v instanceof Date) d = v;
  else {
    var s = String(v || '').trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2})/);
    if (m) d = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
    else if (s) { var t = new Date(s); if (!isNaN(t.getTime())) d = t; }
  }
  if (!d) d = new Date();
  return {
    date: Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd'),
    time: Utilities.formatDate(d, 'Asia/Bangkok', 'HH:mm')
  };
}

/** ความรุนแรงของ Patrol 1/2/3 -> คำที่งานตัดต้นไม้ใช้ */
function plkSeverity_(v) {
  return String(v).trim() === '1' ? 'เร่งด่วน' : 'ปกติ';
}

/** เติมคอลัมน์ SrcApp / SrcID ในแท็บ TreePatrol ถ้ายังไม่มี */
function plkEnsureCols_() {
  var sh = db_().getSheetByName(TABLES2.patrol);
  if (!sh) return;
  var last = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, last).getValues()[0]
                  .map(function (h) { return String(h).trim(); });
  ['SrcApp', 'SrcID'].forEach(function (name) {
    if (headers.indexOf(name) >= 0) return;
    last += 1;
    sh.getRange(1, last).setValue(name);
    headers.push(name);
  });
}

/* ====================== ตัวหลัก — ไปหยิบเรื่องมา ====================== */

/**
 * หยิบจุดที่พบประเภทต้นไม้จากแอป Patrol เข้ามาเป็นเรื่องพาโทรล
 * ใช้ได้ทั้งตัวตั้งเวลาและปุ่มในแอป
 */
function patrolPullTree() {
  if (!plkOn_()) return { ok: true, added: 0, skipped: 0, off: true };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: true, added: 0, busy: true }; }

  try {
    plkEnsureCols_();

    var want = plkTypeCode_().toUpperCase();
    var src  = plkRead_(PLK.finding).rows.filter(function (r) {
      var type = String(r.ProblemType || '').trim().toUpperCase();
      var st   = String(r.Status || '').trim();
      return type === want && PLK_OPEN.indexOf(st) >= 0;
    });
    if (!src.length) return { ok: true, added: 0, skipped: 0 };

    /* เรื่องที่เคยหยิบมาแล้ว ไม่หยิบซ้ำ */
    var seen = {};
    readTable_(TABLES2.patrol).rows.forEach(function (r) {
      var id = String(r.SrcID || '').trim();
      if (id) seen[id] = true;
    });

    /* รูปก่อนปรับปรุงใบแรกของแต่ละจุดที่พบ */
    var pic = {};
    plkRead_(PLK.photo).rows.forEach(function (r) {
      if (String(r.ParentType || '').toUpperCase() !== 'FINDING') return;
      var pid = String(r.ParentID || '').trim();
      if (!pid || pic[pid]) return;
      if (String(r.PhotoKind || '').toLowerCase() === 'after') return;
      pic[pid] = { url: String(r.DriveUrl || ''), id: String(r.DriveFileId || '') };
    });

    var added = 0, skipped = 0, picked = [];

    src.forEach(function (r) {
      var fid = String(r.FindingID || '').trim();
      if (!fid || seen[fid]) { skipped++; return; }

      var lat = parseFloat(r.Lat), lng = parseFloat(r.Lon);
      var hit = null;
      if (isFinite(lat) && isFinite(lng)) {
        var hits = patrolMatch_(lat, lng, '', patrolRadius_());
        hit = hits.length ? hits[0] : null;
      }

      var when = plkWhen_(r.CreatedAt);
      var ph   = pic[fid] || { url: '', id: '' };
      var note = [String(r.Detail || '').trim(),
                  String(r.NearPlace || '').trim()]
                 .filter(function (x) { return x; }).join(' · ');

      var id = 'PT' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMMddHHmmss') +
               Math.floor(Math.random() * 90 + 10);

      appendRow_(TABLES2.patrol, {
        PatrolID: id,
        Date: when.date, Time: when.time,
        By: String(r.CreatedBy || '').trim() || 'Patrol ระบบจำหน่าย',
        Lat: isFinite(lat) ? lat : '', Lng: isFinite(lng) ? lng : '',
        PhotoUrl: ph.url, FileID: ph.id,
        JobID: hit ? hit.jobId : '',
        LineCode: hit ? hit.lineCode : '',
        PlaceName: hit ? hit.placeName : '',
        DistM: hit ? hit.distM : '',
        Severity: plkSeverity_(r.Severity),
        Note: note,
        Status: 'แจ้งแล้ว',
        FindID: '', Notified: '',
        SrcApp: 'Patrol', SrcID: fid
      });

      plkWriteBack_(fid, { Status: 'รับเรื่องแล้ว' });
      picked.push(fid);
      added++;
      Utilities.sleep(60);
    });

    if (added) { bumpStamp_(); log_('system', 'patrolPull', 'Patrol', picked.join(',')); }
    return { ok: true, added: added, skipped: skipped };

  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** ปุ่ม "ดึงเรื่องจาก Patrol เดี๋ยวนี้" ในแอป */
function apiPatrolPull_(p) {
  var u = requireUser_(p);
  var out = patrolPullTree();
  out.by = u.name;
  return out;
}

/* ====================== เขียนสถานะกลับ ====================== */

/** งานตัดต้นไม้เปิดเรื่องนี้เป็นจุดที่พบในใบงานแล้ว */
function plkOnPromote_(cur, jobId) {
  var srcId = String(cur.SrcID || '').trim();
  if (!srcId) return;
  var order = '';
  try {
    readTable_(TABLES.jobs).rows.forEach(function (j) {
      if (String(j.JobID) === String(jobId)) order = String(j.MJMNo || j.JobID || '');
    });
  } catch (e) {}
  plkWriteBack_(srcId, {
    Status: 'เข้าแผนแล้ว',
    OrderNo: order,
    OrderDate: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd')
  });
}

/** งานตัดต้นไม้ปิดเรื่องนี้แล้ว */
function plkOnClose_(cur, why, byName) {
  var srcId = String(cur.SrcID || '').trim();
  if (!srcId) return;
  plkWriteBack_(srcId, {
    Status: 'ปิด',
    ClosedAt: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'),
    ClosedBy: byName || '',
    CloseReason: 'งานตัดต้นไม้: ' + (why || '')
  });
}

/* ====================== ติดตั้ง ====================== */

function setupPatrolLink() {
  var out = [];

  plkEnsureCols_();
  out.push('เพิ่มคอลัมน์ SrcApp และ SrcID ในแท็บ ' + TABLES2.patrol + ' แล้ว');

  var sh = db_().getSheetByName(TABLES.config);
  var have = {};
  readTable_(TABLES.config).rows.forEach(function (r) { have[String(r.Key).trim()] = true; });
  [['PATROL_LINK_ON', 'TRUE', 'เปิดสะพานรับเรื่องต้นไม้จากแอป Patrol ใส่ FALSE เพื่อปิด'],
   ['PATROL_TREE_TYPE', 'TREE', 'รหัสประเภทปัญหาในแอป Patrol ที่ถือว่าเป็นเรื่องต้นไม้']
  ].forEach(function (row) {
    if (have[row[0]]) return;
    sh.appendRow(row);
    out.push('เพิ่มคีย์ ' + row[0] + ' = ' + row[1]);
  });

  var exists = false;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'patrolPullTree') exists = true;
  });
  if (!exists) {
    ScriptApp.newTrigger('patrolPullTree').timeBased().everyMinutes(15).create();
    out.push('ตั้งให้ไปหยิบเรื่องจากแอป Patrol ทุก 15 นาที');
  } else {
    out.push('ตัวตั้งเวลาทุก 15 นาที มีอยู่แล้ว');
  }

  var first = patrolPullTree();
  out.push('ลองหยิบรอบแรก — เข้ามาใหม่ ' + first.added + ' เรื่อง · ข้ามไป ' + (first.skipped || 0));

  var msg = out.join('\n');
  console.log(msg);
  return msg;
}

/** ตรวจว่าสะพานเห็นข้อมูลของแอป Patrol ไหม โดยไม่เขียนอะไรเลย */
function patrolLinkCheck() {
  var want = plkTypeCode_().toUpperCase();
  var all = plkRead_(PLK.finding).rows;
  var tree = all.filter(function (r) {
    return String(r.ProblemType || '').trim().toUpperCase() === want;
  });
  var open = tree.filter(function (r) {
    return PLK_OPEN.indexOf(String(r.Status || '').trim()) >= 0;
  });
  var seen = {};
  readTable_(TABLES2.patrol).rows.forEach(function (r) {
    var id = String(r.SrcID || '').trim(); if (id) seen[id] = true;
  });
  var fresh = open.filter(function (r) { return !seen[String(r.FindingID || '').trim()]; });

  var msg = [
    'สะพาน Patrol -> งานตัดต้นไม้',
    'สถานะสะพาน: ' + (plkOn_() ? 'เปิด' : 'ปิด'),
    'รหัสประเภทที่ถือว่าเป็นต้นไม้: ' + want,
    'จุดที่พบทั้งหมดในแอป Patrol: ' + all.length,
    'เป็นเรื่องต้นไม้: ' + tree.length,
    'เรื่องต้นไม้ที่ยังรอจัดการ: ' + open.length,
    'ที่ยังไม่เคยหยิบเข้ามา: ' + fresh.length
  ].join('\n');
  console.log(msg);
  return msg;
}
