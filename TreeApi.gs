/**
 * TreeApi.gs — ส่วนเสริมให้ระบบอื่นขอเลขหนังสือได้
 * สำหรับโครงการ "ระบบออกเลขหนังสือ กฟอ.อ่าวลึก" (V3.38)
 *
 * เพิ่มเป็นไฟล์ใหม่ ไม่ต้องแก้ Code.gs เดิมแม้แต่บรรทัดเดียว
 * ใช้ฟังก์ชันเดิมของระบบทั้งหมด (getOrCreateSheet, getYearInfo_,
 * nextNumFromInfo_, formatBookNumber, toYearBE_, ss_) จึงได้เลขชุดเดียวกัน
 * ไม่ซ้ำ ไม่ข้าม และเริ่มใหม่ทุกปี พ.ศ. เหมือนที่ออกผ่านหน้าเว็บ
 *
 * ---------- ติดตั้ง 3 ขั้น ----------
 * 1) เพิ่มไฟล์นี้ในโครงการ (+ > Script) ตั้งชื่อ TreeApi แล้วบันทึก
 * 2) เลือกฟังก์ชัน makeTreeApiKey แล้วกด Run หนึ่งครั้ง
 *    ระบบจะสร้างรหัสเชื่อมระบบให้เอง แล้วคัดลอกรหัสที่ได้
 *    ไปใส่ช่อง BOOKNO_KEY ในแท็บ Config ของระบบงานตัดต้นไม้
 *    (รหัสเก็บใน Script Properties ของโครงการนี้เท่านั้น ไม่อยู่ในโค้ด ไม่อยู่ในชีต)
 * 3) Deploy > Manage deployments > ดินสอ > Version: New version > Deploy
 *    ตรวจให้แน่ใจว่า  ผู้มีสิทธิ์เข้าถึง = ทุกคน (Anyone)
 *    URL เดิมไม่เปลี่ยน หน้าเว็บเดิมใช้งานได้ตามปกติ
 *
 * ---------- วิธีเรียกใช้ ----------
 * POST ไปที่ URL ของเว็บแอป  body เป็น JSON
 *
 *   ขอดูเลขถัดไป (ไม่ออกเลขจริง)
 *   { "key":"...", "action":"peek", "category":"หนังสือทั่วไป", "date":"2026-10-13" }
 *
 *   ออกเลขจริง
 *   { "key":"...", "action":"issue", "category":"หนังสือทั่วไป",
 *     "date":"2026-10-13", "subject":"...", "detail":"...",
 *     "department":"...", "recorder":"...", "amount":104400 }
 *
 * คืนค่า { ok:true, bookNum:"045", num:45, year:2569, rowIndex:123 }
 */

var TREE_API_KEY_PROP = 'TREE_API_KEY';
var TREE_API_DEFAULT_CATEGORY = 'หนังสือทั่วไป';

function doPost(e) {
  var out;
  try {
    var p = {};
    if (e && e.postData && e.postData.contents) p = JSON.parse(e.postData.contents);

    var key = PropertiesService.getScriptProperties().getProperty(TREE_API_KEY_PROP);
    if (!key) throw new Error('ยังไม่ได้ตั้ง TREE_API_KEY ใน Script Properties');
    if (String(p.key || '') !== key) throw new Error('รหัสเชื่อมระบบไม่ถูกต้อง');

    switch (String(p.action || '')) {
      case 'ping':  out = { ok: true, app: 'BookNo API', time: new Date() }; break;
      case 'peek':  out = treeApiPeek_(p); break;
      case 'issue': out = treeApiIssue_(p); break;
      default: throw new Error('ไม่รู้จักคำสั่ง: ' + p.action);
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/** ดูว่าเลขถัดไปคือเลขอะไร โดยไม่เขียนอะไรลงชีต */
function treeApiPeek_(p) {
  var category = String(p.category || TREE_API_DEFAULT_CATEGORY);
  var sheet = ss_().getSheetByName(category);
  var yearBE = toYearBE_(p.date) || currentYearBE_();
  var info = getYearInfo_(sheet, category, yearBE);
  var num = nextNumFromInfo_(category, info);
  return {
    ok: true, category: category, year: yearBE, num: num,
    bookNum: formatBookNumber(category, num, yearBE),
    usedThisYear: info.used.size
  };
}

/** ออกเลขจริงและบันทึกลงชีตหนึ่งแถว — ใช้ Lock เหมือน saveData เดิม */
function treeApiIssue_(p) {
  var category = String(p.category || TREE_API_DEFAULT_CATEGORY);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getOrCreateSheet(ss_(), category);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    var yearBE = toYearBE_(p.date) || currentYearBE_();
    var info = getYearInfo_(sheet, category, yearBE);
    var num = nextNumFromInfo_(category, info);
    var bookNum = formatBookNumber(category, num, yearBE);

    // ชื่อคอลัมน์ตรงกับ fieldMapping ของ saveData เดิมทุกช่อง
    var map = {
      'วันที่': p.date,
      'วันเดือนปี': p.date,
      'เลขที่': bookNum,
      'หัวเรื่อง': p.subject,
      'รายละเอียดงานจ้าง': p.subject,
      'รายละเอียดงาน': p.detail,
      'จัดซื้อจัดจ้าง': p.procurement,
      'ประเภทงาน': p.procurement,
      'วงเงิน': p.amount,
      'ราคากลาง': p.medianPrice,
      'ชื่อผู้รับจ้าง': p.contractor,
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
      ok: true, category: category, year: yearBE, num: num,
      bookNum: bookNum, rowIndex: sheet.getLastRow()
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * สร้างรหัสเชื่อมระบบให้อัตโนมัติ — รันครั้งเดียว
 * คัดลอกรหัสที่ได้ไปใส่ช่อง BOOKNO_KEY ในแท็บ Config ของระบบงานตัดต้นไม้
 * ถ้าอยากออกรหัสใหม่ ให้ลบคุณสมบัติ TREE_API_KEY ในการตั้งค่าโครงการก่อน
 */
function makeTreeApiKey() {
  var pr = PropertiesService.getScriptProperties();
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

/** รันมือจากเครื่องมือแก้ไข เพื่อเช็กว่าตั้งค่าครบหรือยัง */
function treeApiStatus() {
  var key = PropertiesService.getScriptProperties().getProperty(TREE_API_KEY_PROP);
  var peek = treeApiPeek_({ category: TREE_API_DEFAULT_CATEGORY });
  return [
    'TREE_API_KEY : ' + (key ? 'ตั้งแล้ว (' + key.length + ' ตัวอักษร)' : 'ยังไม่ได้ตั้ง'),
    'หมวด         : ' + peek.category,
    'ปี พ.ศ.       : ' + peek.year,
    'ออกไปแล้ว     : ' + peek.usedThisYear + ' เลข',
    'เลขถัดไป      : ' + peek.bookNum
  ].join('\n');
}
