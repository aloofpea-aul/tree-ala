/**
 * BookNo.gs — เชื่อมระบบงานตัดต้นไม้เข้ากับระบบออกเลขหนังสือ กฟอ.อ่าวลึก
 * เพิ่มเป็นไฟล์ใหม่ในโครงการ TreeALA_API (ไม่ต้องแก้ Code.gs ยกเว้น 1 บรรทัด)
 *
 * ---------- ติดตั้ง ----------
 * 1) เพิ่มไฟล์นี้ในโครงการ (+ > Script) ตั้งชื่อ BookNo แล้วบันทึก
 * 2) เปิดไฟล์ Code.gs หาบรรทัด
 *        case 'sldPoints':   out = apiSldPoints_(p); break;
 *    แล้วเพิ่มบรรทัดนี้ต่อท้าย
 *        case 'payDocNo':    out = apiPayDocNo_(p); break;
 * 3) เลือกฟังก์ชัน setupBookConfig แล้วกด Run หนึ่งครั้ง
 *    จะเพิ่ม 4 บรรทัดในแท็บ Config ให้เอง
 * 4) กรอกค่าในแท็บ Config
 *        BOOKNO_URL   ลิงก์เว็บแอปของระบบออกเลขหนังสือ (ลงท้าย /exec)
 *        BOOKNO_KEY   รหัสเดียวกับ TREE_API_KEY ที่ตั้งไว้ฝั่งโน้น
 *        BOOKNO_DEPT  ชื่อแผนกที่จะบันทึกลงทะเบียนหนังสือ
 *        DOC_PREFIX   คำนำหน้าเลขที่ตอนพิมพ์เอกสาร เช่น ต.2อล.
 * 5) Deploy > Manage deployments > New version > Deploy
 * 6) เลือกฟังก์ชัน bookNoTest แล้วกด Run เพื่อตรวจว่าต่อติด
 */

// ====== ค่าตั้งต้น ======
function bookCfg_() {
  var c = getConfig_();
  return {
    url:    String(c.BOOKNO_URL  || '').trim(),
    key:    String(c.BOOKNO_KEY  || '').trim(),
    dept:   String(c.BOOKNO_DEPT || 'แผนกปฏิบัติการระบบไฟฟ้า').trim(),
    prefix: String(c.DOC_PREFIX  || 'ต.2อล.').trim()
  };
}

/** เติม 4 บรรทัดที่ต้องใช้ลงแท็บ Config — รันครั้งเดียว */
function setupBookConfig() {
  var sh = db_().getSheetByName(TABLES.config);
  if (!sh) return 'ไม่พบแท็บ Config';
  var v = sh.getDataRange().getValues();
  var have = {};
  for (var i = 1; i < v.length; i++) have[String(v[i][0]).trim()] = true;
  var want = [
    ['BOOKNO_URL',  '', 'ลิงก์เว็บแอปของระบบออกเลขหนังสือ ลงท้าย /exec'],
    ['BOOKNO_KEY',  '', 'รหัสเชื่อมระบบ ต้องตรงกับ TREE_API_KEY ของระบบออกเลขหนังสือ'],
    ['BOOKNO_DEPT', 'แผนกปฏิบัติการระบบไฟฟ้า', 'ชื่อแผนกที่จะบันทึกลงทะเบียนหนังสือ'],
    ['DOC_PREFIX',  'ต.2อล.', 'คำนำหน้าเลขที่หนังสือตอนพิมพ์เอกสาร']
  ];
  var added = [];
  want.forEach(function (row) {
    if (!have[row[0]]) { sh.appendRow(row); added.push(row[0]); }
  });
  bumpStamp_();
  return added.length ? 'เพิ่มแล้ว: ' + added.join(', ') : 'มีครบอยู่แล้ว';
}

// ====== เรียกไปที่ระบบออกเลขหนังสือ ======
function bookCall_(action, payload) {
  var cfg = bookCfg_();
  if (!cfg.url) throw new Error('ยังไม่ได้ใส่ BOOKNO_URL ในแท็บ Config');
  if (!cfg.key) throw new Error('ยังไม่ได้ใส่ BOOKNO_KEY ในแท็บ Config');

  var body = { key: cfg.key, action: action };
  for (var k in payload) if (payload.hasOwnProperty(k)) body[k] = payload[k];

  var res = UrlFetchApp.fetch(cfg.url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    followRedirects: true,
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code >= 300) {
    log_('system', 'bookNoHttp', String(code), text.slice(0, 300));
    throw new Error('ระบบออกเลขหนังสือตอบกลับรหัส ' + code);
  }
  var out;
  try { out = JSON.parse(text); }
  catch (e) {
    log_('system', 'bookNoParse', '', text.slice(0, 300));
    throw new Error('ระบบออกเลขหนังสือตอบกลับไม่ใช่ JSON — ตรวจว่า Deploy เวอร์ชันใหม่แล้วหรือยัง');
  }
  if (!out.ok) throw new Error(out.error || 'ขอเลขหนังสือไม่สำเร็จ');
  return out;
}

// ====== ตัวช่วย ======
function todayISO_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

/** เติมคอลัมน์ที่ยังไม่มีให้แท็บที่ระบุ (ไม่แตะข้อมูลเดิม) */
function ensureCols_(sheetName, cols) {
  var sh = db_().getSheetByName(sheetName);
  if (!sh) return false;
  var last = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, last).getValues()[0];
  var add = cols.filter(function (c) { return headers.indexOf(c) === -1; });
  if (!add.length) return false;
  sh.getRange(1, last + 1, 1, add.length).setValues([add]);
  SpreadsheetApp.flush();
  return true;
}

/** รอบนั้นตรวจรับผ่านแล้วหรือยัง */
function roundAccepted_(jobId, no) {
  var found = false;
  readTable_(TABLES.rounds).rows.forEach(function (r) {
    if (String(r.JobID) === String(jobId) && Number(r.RoundNo) === Number(no)) {
      if (String(r.Status || '').indexOf('ตรวจรับแล้ว') >= 0) found = true;
    }
  });
  return found;
}

/** ข้อความเรื่องที่จะลงทะเบียนหนังสือ */
function payDocSubject_(job, no) {
  return 'ขออนุมัติเบิกจ่ายเงินค่าจ้างเหมาตัดต้นไม้ใกล้แนวระบบจำหน่าย '
       + 'ใบงาน ' + String(job.MJMNo || job.JobID) + ' งวดที่ ' + no;
}

function payDocDetail_(job, no, amount) {
  var parts = [
    'ฟีดเดอร์ ' + String(job.FeederID || '-'),
    'ระบบ ' + String(job.VoltLevel || '-'),
    'ผู้รับจ้าง ' + String(job.Contractor || 'ยังไม่ระบุ'),
    'รอบที่ ' + no,
    'ระยะทางตามแผน ' + (parseFloat(job.PlanKm) || 0).toFixed(2) + ' กม.',
    'จำนวนเงิน ' + Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' บาท'
  ];
  return parts.join(' · ');
}

// ====== คำสั่งหลัก: ขอเลขหนังสือของงวดเงิน ======
/**
 * p = { user, token, jobId, no, peek }
 *   peek = true  → ดูเลขถัดไปเฉย ๆ ไม่ออกเลขจริง
 * ออกเลขครั้งเดียวต่อหนึ่งงวด ครั้งถัดไปคืนเลขเดิม
 */
function apiPayDocNo_(p) {
  var u = requireUser_(p);
  var jobId = String(p.jobId || '').trim();
  var no = parseInt(p.no, 10) || 1;
  if (!jobId) throw new Error('ไม่ได้ระบุใบงาน');

  var job = null;
  readTable_(TABLES.jobs).rows.forEach(function (j) { if (String(j.JobID) === jobId) job = j; });
  if (!job) throw new Error('ไม่พบใบงาน ' + jobId);

  var pay = null;
  readTable_(TABLES.payments).rows.forEach(function (r) {
    if (String(r.JobID) === jobId && Number(r.Installment) === no) pay = r;
  });
  if (!pay) throw new Error('ไม่พบงวดที่ ' + no + ' ของใบงานนี้');

  // มีเลขแล้ว คืนเลขเดิม ไม่กินเลขเพิ่ม
  var existing = String(pay.DocNo || '').trim();
  if (existing && !p.peek) {
    return {
      ok: true, reused: true, docNo: existing,
      docDate: String(pay.DocDate || ''),
      docNoFull: bookCfg_().prefix + existing + '/' + (String(pay.DocDate || '').slice(0, 4) || ''),
      amount: pay.Amount, percent: pay.Percent
    };
  }

  // ยังไม่มีเลข ต้องตรวจรับรอบนั้นก่อน
  if (!p.peek && !roundAccepted_(jobId, no)) {
    throw new Error('รอบที่ ' + no + ' ยังไม่ผ่านการตรวจรับ จึงยังออกเลขหนังสือไม่ได้');
  }

  var date = todayISO_();

  if (p.peek) {
    var pk = bookCall_('peek', { category: 'หนังสือทั่วไป', date: date });
    return { ok: true, peek: true, next: pk.bookNum, year: pk.year, usedThisYear: pk.usedThisYear };
  }

  var got = bookCall_('issue', {
    category:   'หนังสือทั่วไป',
    date:       date,
    subject:    payDocSubject_(job, no),
    detail:     payDocDetail_(job, no, pay.Amount),
    amount:     pay.Amount,
    contractor: job.Contractor,
    department: bookCfg_().dept,
    recorder:   u.name
  });

  ensureCols_(TABLES.payments, ['DocDate']);
  updateRow_(TABLES.payments, 'PayID', pay.PayID, { DocNo: got.bookNum, DocDate: date });
  log_(u.name, 'payDocNo', pay.PayID, got.bookNum);
  bumpStamp_();

  return {
    ok: true, reused: false,
    docNo: got.bookNum, docDate: date, year: got.year,
    docNoFull: bookCfg_().prefix + got.bookNum + '/' + got.year,
    amount: pay.Amount, percent: pay.Percent
  };
}

// ====== ทดสอบ รันมือจากเครื่องมือแก้ไข ======
function bookNoTest() {
  var cfg = bookCfg_();
  if (!cfg.url) return 'ยังไม่ได้ใส่ BOOKNO_URL ในแท็บ Config';
  if (!cfg.key) return 'ยังไม่ได้ใส่ BOOKNO_KEY ในแท็บ Config';
  try {
    var ping = bookCall_('ping', {});
    var peek = bookCall_('peek', { category: 'หนังสือทั่วไป', date: todayISO_() });
    return [
      'เชื่อมต่อสำเร็จ',
      'ปี พ.ศ.     : ' + peek.year,
      'ออกไปแล้ว   : ' + peek.usedThisYear + ' เลข',
      'เลขถัดไป    : ' + peek.bookNum,
      'พิมพ์ในเอกสารเป็น : ' + cfg.prefix + peek.bookNum + '/' + peek.year,
      '',
      'ตัวนี้เป็นการดูเฉย ๆ ยังไม่ได้ออกเลขจริง'
    ].join('\n');
  } catch (e) {
    return 'เชื่อมต่อไม่สำเร็จ — ' + e.message;
  }
}
