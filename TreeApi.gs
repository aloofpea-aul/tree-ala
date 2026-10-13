/**
 * TreeApi.gs — ช่องทางให้ "ระบบงานตัดต้นไม้" ขอเลขหนังสือได้
 * สำหรับโครงการ "ระบบออกเลขหนังสือ กฟอ.อ่าวลึก" V4.0 (ตัวที่ Deploy อยู่จริง)
 *
 * เพิ่มเป็นไฟล์ใหม่ ไม่แก้ Code.gs เดิมแม้แต่บรรทัดเดียว
 *
 * ---------- หลักความปลอดภัย ----------
 * 1) ใช้ "รหัสเฉพาะระบบต้นไม้" คนละตัวกับรหัสสำนักงาน
 *    ระบบต้นไม้จึงไม่ต้องรู้รหัสสำนักงาน และถ้ารหัสนี้หลุด
 *    ก็ทำได้แค่ขอเลขหมวดทั่วไป เข้าหน้าเว็บของสำนักงานไม่ได้
 * 2) ออกได้เฉพาะหมวด "หนังสือทั่วไป" เท่านั้น
 *    แตะหมวดสัญญาจ้าง คำสั่ง และใบสำคัญจ่ายไม่ได้เลย
 * 3) ใช้ LockService และตรวจเลขซ้ำทั้งปี แบบเดียวกับ saveData เดิม
 *    เลขจึงเป็นชุดเดียวกัน ไม่ซ้ำ ไม่ข้าม
 * 4) อ่านอย่างเดียวไม่ได้ทำอะไรกับชีตอื่น และไม่แตะการตั้งค่าระบบ
 *
 * ---------- ติดตั้ง ----------
 * 1) เพิ่มไฟล์นี้ในโครงการ แล้วบันทึก
 * 2) เลือกฟังก์ชัน makeTreeApiKey กด Run หนึ่งครั้ง
 *    คัดลอกรหัสที่ได้ ไปใส่ช่อง BOOKNO_KEY ในแท็บ Config ของระบบงานตัดต้นไม้
 * 3) Deploy > Manage deployments > ดินสอ > Version: New version > Deploy
 *    URL เดิมไม่เปลี่ยน หน้าเว็บบน GitHub Pages ใช้งานได้ตามปกติ
 * 4) เลือกฟังก์ชัน treeApiStatus กด Run เพื่อตรวจว่าพร้อมแล้ว
 */

var TREE_API_KEY_PROP = 'TREE_API_KEY';
var TREE_ONLY_CATEGORY = 'หนังสือทั่วไป';

/** ขึ้นทะเบียนคำสั่งใหม่เข้ากับ API เดิม — ถ้ายังไม่พร้อมจะเงียบ ไม่ทำให้ระบบเดิมพัง */
try {
  API_FUNCS_.treeNextDoc = treeNextDoc;
  API_FUNCS_.treeIssueDoc = treeIssueDoc;
} catch (e) { /* ปล่อยผ่าน ระบบเดิมทำงานต่อได้ตามปกติ */ }

// ====== รหัสเฉพาะระบบต้นไม้ ======

/** สร้างรหัสให้อัตโนมัติ รันครั้งเดียว แล้วคัดลอกไปใส่ BOOKNO_KEY ฝั่งระบบต้นไม้ */
function makeTreeApiKey() {
  var pr = props_();
  var cur = pr.getProperty(TREE_API_KEY_PROP);
  if (cur) {
    return 'มีรหัสอยู่แล้ว\n\n' + cur +
           '\n\nถ้าต้องการออกรหัสใหม่ ให้ลบคุณสมบัติ TREE_API_KEY ในการตั้งค่าโครงการก่อน';
  }
  var key = 'tree-' + Utilities.getUuid().replace(/-/g, '').slice(0, 24);
  pr.setProperty(TREE_API_KEY_PROP, key);
  return 'สร้างรหัสเรียบร้อย\n\n' + key +
         '\n\nคัดลอกบรรทัดบนไปใส่ช่อง BOOKNO_KEY ในแท็บ Config ของระบบงานตัดต้นไม้';
}

function treeKeyOk_(k) {
  var want = props_().getProperty(TREE_API_KEY_PROP);
  if (!want) throw new Error('TREE_KEY_NOT_SET');
  if (String(k || '') !== want) { failDelay_(); throw new Error('TREE_KEY_INVALID'); }
  return true;
}

/** อนุญาตเฉพาะหมวดทั่วไป */
function treeCat_(c) {
  var cat = String(c || TREE_ONLY_CATEGORY).trim() || TREE_ONLY_CATEGORY;
  if (cat !== TREE_ONLY_CATEGORY) throw new Error('CATEGORY_NOT_ALLOWED');
  return cat;
}

// ====== คำสั่งที่เปิดให้ระบบต้นไม้เรียก ======

/** ดูเลขถัดไป ไม่เขียนอะไรลงชีต */
function treeNextDoc(apiKey, category, dateStr) {
  treeKeyOk_(apiKey);
  var cat = treeCat_(category);
  var sheet = ss_().getSheetByName(cat);
  var yearBE = toYearBE_(dateStr) || currentYearBE_();
  var info = getYearInfo_(sheet, cat, yearBE);
  var next = nextNumFromInfo_(cat, info);
  return {
    ok: true, category: cat, year: yearBE, num: next,
    bookNum: formatBookNumber(cat, next, yearBE),
    usedThisYear: info.used.size
  };
}

/** ออกเลขจริงและบันทึกหนึ่งแถวในแท็บ "หนังสือทั่วไป" */
function treeIssueDoc(apiKey, p) {
  treeKeyOk_(apiKey);
  p = p || {};
  var cat = treeCat_(p.category);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getOrCreateSheet(ss_(), cat);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    var yearBE = toYearBE_(p.date) || currentYearBE_();
    var info = getYearInfo_(sheet, cat, yearBE);
    var num = nextNumFromInfo_(cat, info);
    var bookNum = formatBookNumber(cat, num, yearBE);

    // ชื่อคอลัมน์ตรงกับ fieldMapping ของ saveData เดิม
    var map = {
      'วันที่': p.date,
      'วันเดือนปี': p.date,
      'เลขที่': bookNum,
      'หัวเรื่อง': p.subject,
      'รายละเอียดงาน': p.detail,
      'จัดซื้อจัดจ้าง': p.procurement,
      'วงเงิน': p.amount,
      'ราคากลาง': p.medianPrice,
      'แผนก': p.department,
      'ผู้บันทึก': p.recorder
    };

    var row = [];
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      row.push(map[h] === undefined || map[h] === '' ? '' : map[h]);
    }
    row[0] = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd HH:mm:ss');

    sheet.appendRow(row);
    SpreadsheetApp.flush();

    return {
      ok: true, category: cat, year: yearBE, num: num,
      bookNum: bookNum, rowIndex: sheet.getLastRow()
    };
  } finally {
    lock.releaseLock();
  }
}

// ====== ตรวจสภาพ รันมือจากเครื่องมือแก้ไข ======
function treeApiStatus() {
  var key = props_().getProperty(TREE_API_KEY_PROP);
  var registered = false;
  try { registered = !!(API_FUNCS_ && API_FUNCS_.treeIssueDoc); } catch (e) {}

  var sheet = ss_().getSheetByName(TREE_ONLY_CATEGORY);
  var yearBE = currentYearBE_();
  var info = getYearInfo_(sheet, TREE_ONLY_CATEGORY, yearBE);
  var next = nextNumFromInfo_(TREE_ONLY_CATEGORY, info);

  return [
    'รหัสเฉพาะระบบต้นไม้ : ' + (key ? 'ตั้งแล้ว (' + key.length + ' ตัวอักษร)' : 'ยังไม่ได้ตั้ง — ให้รัน makeTreeApiKey'),
    'ขึ้นทะเบียนกับ API  : ' + (registered ? 'เรียบร้อย' : 'ยังไม่ขึ้นทะเบียน — แจ้งผมด้วย'),
    'หมวดที่อนุญาต       : ' + TREE_ONLY_CATEGORY + ' เท่านั้น',
    'ปี พ.ศ.              : ' + yearBE,
    'ออกไปแล้วปีนี้       : ' + info.used.size + ' เลข',
    'เลขถัดไป            : ' + formatBookNumber(TREE_ONLY_CATEGORY, next, yearBE)
  ].join('\n');
}
