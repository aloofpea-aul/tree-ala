/**
 * Tree2.gs — ฟีเจอร์ชุดที่สองของระบบงานตัดต้นไม้ กฟส.อ่าวลึก
 *
 *   1) ปุ่มพาโทรลต้นไม้   ถ่ายรูปที่ไหนก็ได้ จับพิกัดเทียบกับแผน แล้วแจ้งต่อ
 *   2) คณะกรรมการตรวจรับ  เก็บรายชื่อแยกตามปี มีประธานและกรรมการ
 *   3) รายงานเบิกจ่ายเงิน  ดึงข้อมูลไปพิมพ์เป็นเอกสารแนบท้ายบันทึก
 *
 * ---------- แก้ Code.gs แค่บรรทัดเดียว ----------
 * หาบรรทัด    case 'sldPoints':   out = apiSldPoints_(p); break;
 * เพิ่มต่อท้าย case 'tree2':       out = apiTree2_(p); break;
 *
 * ต่อจากนี้ฟีเจอร์ใหม่ทุกตัวเข้าทางนี้ ไม่ต้องแก้ Code.gs อีกเลย
 * ---------- ติดตั้ง ----------
 * รันฟังก์ชัน setupTree2 หนึ่งครั้ง แล้ว Deploy เวอร์ชันใหม่
 */

// ====== ตารางใหม่ ======
var PATROL_COLS = ['PatrolID', 'Date', 'Time', 'By', 'Lat', 'Lng', 'PhotoUrl', 'FileID',
                   'JobID', 'LineCode', 'PlaceName', 'DistM', 'Severity', 'Note',
                   'Status', 'FindID', 'Notified', 'SrcApp', 'SrcID'];

var COMMITTEE_COLS = ['Year', 'Seq', 'Name', 'Position', 'Role', 'Active', 'Note'];

var TABLES2 = { patrol: 'TreePatrol', committee: 'TreeCommittee' };

// ====== ตัวแจกงาน — ประตูเดียวของฟีเจอร์ชุดใหม่ ======
function apiTree2_(p) {
  var fn = String(p.fn || '').trim();
  switch (fn) {
    case 'patrol':        return apiPatrol_(p);
    case 'patrolList':    return apiPatrolList_(p);
    case 'patrolClose':   return apiPatrolClose_(p);
    case 'patrolSummary': return apiPatrolSummary_(p);
    case 'patrolNear':    return apiPatrolNear_(p);
    case 'patrolAssign':  return apiPatrolAssign_(p);
    case 'patrolPull':    return apiPatrolPull_(p);   // อยู่ในไฟล์ PatrolLink.gs
    case 'committeeGet':  return apiCommitteeGet_(p);
    case 'committeeSave': return apiCommitteeSave_(p);
    case 'payReport':     return apiPayReport_(p);
    case 'payGroups':     return apiPayGroups_(p);
    case 'payReportSet':  return apiPayReportSet_(p);
    case 'payDocNo':      return apiPayDocNo_(p);     // อยู่ในไฟล์ BookNo.gs
    case 'payDocNoSet':   return apiPayDocNoSet_(p);  // อยู่ในไฟล์ BookNo.gs
    default: throw new Error('ยังไม่รู้จักคำสั่งย่อย: ' + (fn || '(ว่าง)'));
  }
}

/* ============================================================
   ส่วนที่ 1  ปุ่มพาโทรลต้นไม้
   ============================================================ */

/** ระยะทางระหว่างสองพิกัด หน่วยเมตร */
function distM_(lat1, lng1, lat2, lng2) {
  var R = 6371000, d = Math.PI / 180;
  var a = (lat2 - lat1) * d, b = (lng2 - lng1) * d;
  var s = Math.sin(a / 2) * Math.sin(a / 2) +
          Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(b / 2) * Math.sin(b / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

/** รัศมีที่ถือว่า "ตรงกับแผน" ตั้งได้ในแท็บ Config คีย์ PATROL_RADIUS_M */
function patrolRadius_() {
  var v = parseFloat(getConfig_().PATROL_RADIUS_M);
  return isFinite(v) && v > 0 ? v : 100;
}

/** พิกัดอุปกรณ์จากระบบ SLD — ใช้แคชร่วมกับ apiSldPoints_ */
function sldPointsCached_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('sldPoints');
  if (hit) { try { return JSON.parse(hit).points || []; } catch (e) {} }
  var out = apiSldPoints_({ user: 'system', token: makeToken_('system'), _internal: true });
  return (out && out.points) || [];
}

/**
 * จับคู่พิกัดกับไลน์ในแผน
 * คืนรายการที่อยู่ในรัศมี เรียงจากใกล้ไปไกล พร้อมรายละเอียดงาน
 */
function patrolMatch_(lat, lng, year, radius) {
  radius = radius || patrolRadius_();
  var lines = readTable_(TABLES.lines).rows;
  if (year) lines = lines.filter(function (l) { return String(l.Year) === String(year); });

  var byCode = {};
  lines.forEach(function (l) {
    var c = String(l.LineCode || '').replace(/\s+/g, '').toUpperCase();
    if (c && !byCode[c]) byCode[c] = l;
  });

  var jobs = {};
  readTable_(TABLES.jobs).rows.forEach(function (j) { jobs[j.JobID] = j; });

  /* เก็บแค่จุดที่ใกล้ที่สุดของแต่ละไลน์ ไม่งั้นรัศมีกว้าง ๆ จะได้เป็นหมื่นจุดจนสคริปต์ล้ม */
  var best = {};
  sldPointsCached_().forEach(function (pt) {
    var code = String(pt.id || '').replace(/\s+/g, '').toUpperCase();
    if (!byCode[code]) return;
    var d = distM_(lat, lng, pt.lat, pt.lng);
    if (d > radius) return;
    if (!best[code] || d < best[code].d) best[code] = { d: d, pt: pt };
  });

  var hits = [];
  Object.keys(best).forEach(function (code) {
    var d = best[code].d, pt = best[code].pt, line = byCode[code];
    var job = jobs[line.JobID] || {};
    hits.push({
      distM: d,
      lineCode: line.LineCode,
      placeName: line.PlaceName || pt.desc || '',
      lat: pt.lat, lng: pt.lng,
      jobId: line.JobID,
      jobName: job.JobName || '',
      mjmNo: job.MJMNo || '',
      feeder: job.FeederID || pt.feeder || '',
      system: job.System || '',
      voltLevel: job.VoltLevel || '',
      contractor: job.Contractor || '',
      planKm: job.PlanKm || '',
      year: line.Year || job.Year || '',
      cut: { r1: line.R1Date || '', r2: line.R2Date || '', r3: line.R3Date || '' }
    });
  });
  hits.sort(function (a, b) { return a.distM - b.distM; });
  return hits;
}

/** พาโทรล — ถ่ายรูปที่ไหนก็ได้ ใช้ได้ทุกคนที่ล็อกอิน */
function apiPatrol_(p) {
  var u = requireUser_(p);
  var lat = parseFloat(p.lat), lng = parseFloat(p.lng);
  if (!isFinite(lat) || !isFinite(lng)) throw new Error('ยังไม่ได้พิกัด กรุณาเปิดตำแหน่งที่ตั้งแล้วลองอีกครั้ง');

  /* ค้นหาเฉย ๆ ไม่บันทึก — ใช้ตอนกดดูก่อนถ่ายรูป */
  var radius = parseFloat(p.radius) || patrolRadius_();
  var hits = patrolMatch_(lat, lng, p.year, radius);
  if (p.peek) return { ok: true, peek: true, radius: radius, matches: hits.slice(0, 5) };

  if (!p.photoBase64) throw new Error('ไม่พบรูป กรุณาถ่ายรูปก่อน');

  var id = 'PT' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMMddHHmmss') +
           Math.floor(Math.random() * 90 + 10);

  /* เก็บรูปลงโฟลเดอร์เดียวกับรูปหน้างาน */
  var parts = String(p.photoBase64).split(',');
  var data = parts.length > 1 ? parts[1] : parts[0];
  var mime = 'image/jpeg';
  var m = /^data:([^;]+);/.exec(String(p.photoBase64));
  if (m) mime = m[1];
  var blob = Utilities.newBlob(Utilities.base64Decode(data), mime, id + '.jpg');
  var file = photoFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var photoUrl = 'https://drive.google.com/uc?id=' + file.getId();

  var top = hits.length ? hits[0] : null;
  var urgent = String(p.severity || '') === 'เร่งด่วน';
  var now = new Date();

  /* เร่งด่วนและตรงกับแผน — เปิดเป็นจุดที่พบในใบงานนั้นเลย */
  var findId = '';
  if (urgent && top) {
    findId = 'F' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyMMddHHmmss') +
             Math.floor(Math.random() * 90 + 10);
    appendRow_(TABLES.findings, {
      FindID: findId,
      JobID: top.jobId,
      RoundID: '',
      SegID: '',
      DeviceID: top.lineCode,
      Lat: lat, Lng: lng,
      TreeType: p.treeType || '',
      Severity: 'เร่งด่วน',
      PhotoBefore: photoUrl,
      PhotoAfter: '',
      Reporter: u.name,
      ReportDate: Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd'),
      FixedDate: '',
      Status: 'รอปรับปรุง',
      Note: 'จากการพาโทรล ' + (p.note || '')
    });
  }

  var sh = ensureSheet_(TABLES2.patrol, PATROL_COLS);
  var row = {
    PatrolID: id,
    Date: Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd'),
    Time: Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm'),
    By: u.name,
    Lat: lat, Lng: lng,
    PhotoUrl: photoUrl, FileID: file.getId(),
    JobID: top ? top.jobId : '',
    LineCode: top ? top.lineCode : '',
    PlaceName: top ? top.placeName : '',
    DistM: top ? top.distM : '',
    Severity: urgent ? 'เร่งด่วน' : 'ปกติ',
    Note: p.note || '',
    Status: findId ? 'เปิดเป็นจุดที่พบแล้ว' : (top ? 'แจ้งแล้ว' : 'นอกแผน'),
    FindID: findId,
    Notified: ''
  };
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
               .map(function (h) { return String(h).trim(); });
  sh.appendRow(head.map(function (h) { return row[h] !== undefined ? row[h] : ''; }));

  log_(u.name, 'patrol', id, (row.LineCode || 'นอกแผน') + ' ' + row.Severity);
  bumpStamp_();

  /* ยิงไลน์ทันทีเฉพาะเรื่องเร่งด่วน  เรื่องปกติรอรวมส่งรอบเดียวตอนเย็น
     เพื่อไม่ให้เปลืองโควต้าซึ่งนับเป็นรายคนในกลุ่ม */
  var pushed = false;
  if (urgent) {
    pushed = patrolPush_(row, top);
    if (pushed) {
      try { updateRow_(TABLES2.patrol, 'PatrolID', id, { Notified: 'ด่วน ' + row.Time }); } catch (e) {}
    }
  }

  return {
    ok: true, patrolId: id, photo: photoUrl, findId: findId,
    radius: radius, matches: hits.slice(0, 5), match: top,
    lineSent: pushed,
    note: top ? '' : 'พิกัดนี้ไม่อยู่ในรัศมี ' + radius + ' เมตร ของไลน์ไหนในแผน บันทึกไว้เป็นข้อมูลนอกแผน'
  };
}


/** ลิงก์เปิดแอป ให้เด้งออกจากเบราว์เซอร์ในตัวไลน์ ไปเบราว์เซอร์จริงของเครื่อง
    openExternalBrowser=1 เป็นคำสั่งของไลน์เอง ใช้ได้ทั้งแอนดรอยด์และไอโฟน */
function appLink_(query) {
  var base = String(lineCfg_().appUrl || '').trim();
  if (!base) return '';
  var join = base.indexOf('?') >= 0 ? '&' : '?';
  var q = String(query || '').replace(/^[?&]/, '');
  return base + join + (q ? q + '&' : '') + 'openExternalBrowser=1';
}

/** การ์ดไลน์ของเรื่องเร่งด่วน รวมรูปไว้ในการ์ดเดียว ประหยัดโควต้า */
function patrolPush_(row, top) {
  var rows = [
    ['ผู้แจ้ง', row.By],
    ['เวลา', row.Date + ' ' + row.Time]
  ];
  if (top) {
    rows.push(['ไลน์', top.lineCode + (top.placeName ? ' · ' + top.placeName : '')]);
    rows.push(['ใบงาน', top.mjmNo || top.jobId]);
    rows.push(['ฟีดเดอร์', top.feeder + (top.voltLevel ? ' · ' + top.voltLevel : '')]);
    rows.push(['ผู้รับจ้าง', top.contractor || '-']);
    rows.push(['ห่างจุดในแผน', top.distM + ' ม.']);
  } else {
    rows.push(['ตำแหน่ง', 'ไม่อยู่ในแผน']);
  }
  if (row.Note) rows.push(['หมายเหตุ', row.Note]);
  rows.push(['แผนที่', 'กดปุ่มด้านล่าง']);

  var msgs = lineFlex_('พาโทรลพบจุดเร่งด่วน', 'พาโทรลพบจุดเร่งด่วน', '#C0392B',
    top ? (top.lineCode + ' ' + (top.placeName || '')) : 'จุดนอกแผน',
    'ถ่ายจากการพาโทรล ต้องดำเนินการต่อ', rows, 'เปิดเรื่องนี้ในแอป');

  /* ให้ปุ่มพาเข้าหน้ารายละเอียดของเรื่องนี้เลย ไม่ใช่หน้าแรก */
  try {
    var link = appLink_('patrol=' + row.PatrolID);
    if (link) msgs[0].contents.footer.contents[0].action.uri = link;
  } catch (e) {}

  /* แนบรูปในข้อความเดียวกัน — LINE นับเป็น 1 ข้อความต่อคน ไม่ใช่ 2 */
  if (row.FileID) {
    /* LINE ดึงรูปจาก uc?id= ไม่ค่อยได้ ใช้ลิงก์แบบ thumbnail แทน */
    var img = 'https://drive.google.com/thumbnail?id=' + row.FileID + '&sz=w1000';
    msgs[0].contents.hero = {
      type: 'image', url: img, size: 'full', aspectRatio: '4:3', aspectMode: 'cover',
      action: { type: 'uri', uri: img }
    };
  }
  if (top) {
    msgs[0].contents.footer.contents.push({
      type: 'button', style: 'link', height: 'sm',
      action: { type: 'uri', label: 'เปิดแผนที่จุดนี้',
                uri: 'https://www.google.com/maps/search/?api=1&query=' + row.Lat + ',' + row.Lng }
    });
  }
  return linePush_(msgs);
}

/** รวมเรื่องปกติส่งรอบเดียวตอนเย็น — ตั้ง Trigger เวลา 17:00 */
function patrolDigest() {
  var sh = db_().getSheetByName(TABLES2.patrol);
  if (!sh) return 'ยังไม่มีแท็บ ' + TABLES2.patrol;
  var t = readTable_(TABLES2.patrol);
  var today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  var wait = t.rows.filter(function (r) {
    return String(r.Notified || '').trim() === '' && String(r.Date) === today;
  });
  if (!wait.length) return 'วันนี้ไม่มีรายการใหม่ ไม่ต้องส่ง';

  var byLine = {};
  wait.forEach(function (r) {
    var k = r.LineCode || 'นอกแผน';
    byLine[k] = (byLine[k] || 0) + 1;
  });
  var rows = Object.keys(byLine).slice(0, 8).map(function (k) {
    return [k, byLine[k] + ' จุด'];
  });
  var people = {};
  wait.forEach(function (r) { if (r.By) people[r.By] = 1; });

  var msgs = lineFlex_('สรุปพาโทรลวันนี้', 'สรุปพาโทรลต้นไม้วันนี้', '#4A1D62',
    'พบ ' + wait.length + ' จุด',
    'ผู้พาโทรล ' + Object.keys(people).join(', ') + ' · รวมส่งรอบเดียวเพื่อประหยัดโควต้า',
    rows, 'เปิดรายการพาโทรล');
  try {
    var dlink = appLink_('view=patrol');
    if (dlink) msgs[0].contents.footer.contents[0].action.uri = dlink;
  } catch (e) {}
  var ok = linePush_(msgs);

  if (ok) {
    var stamp = 'สรุป ' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'HH:mm');
    wait.forEach(function (r) {
      try { updateRow_(TABLES2.patrol, 'PatrolID', r.PatrolID, { Notified: stamp }); } catch (e) {}
    });
  }
  return (ok ? 'ส่งแล้ว ' : 'ส่งไม่สำเร็จ ') + wait.length + ' รายการ';
}

/** รายการพาโทรล — กรองตามปี ไลน์ หรือใบงาน */
/** ชีตเก็บช่องเวลาเป็นค่าเวลาจริง อ่านกลับมาจะเป็นวันที่ปี 1899 จึงต้องแปลงเป็น HH:mm ก่อนส่งออก */
function hhmm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Bangkok', 'HH:mm');
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : s;
}

function patrolFix_(r) {
  if (r) r.Time = hhmm_(r.Time);
  return r;
}

function apiPatrolList_(p) {
  requireUser_(p);
  var t = readTable_(TABLES2.patrol);
  var rows = t.rows;
  if (p.jobId)    rows = rows.filter(function (r) { return r.JobID === p.jobId; });
  if (p.lineCode) rows = rows.filter(function (r) {
    return String(r.LineCode).replace(/\s+/g, '').toUpperCase() ===
           String(p.lineCode).replace(/\s+/g, '').toUpperCase();
  });
  if (p.openOnly) rows = rows.filter(function (r) { return String(r.Status) === 'แจ้งแล้ว'; });
  var f = String(p.filter || '').trim();
  if (f === 'waiting') rows = rows.filter(function (r) {
    var st = String(r.Status || ''); return st !== 'ปิดเรื่อง' && st !== 'เปิดเป็นจุดที่พบแล้ว'; });
  if (f === 'urgent')  rows = rows.filter(function (r) {
    var st = String(r.Status || '');
    return String(r.Severity || '') === 'เร่งด่วน' && st !== 'ปิดเรื่อง'; });
  if (f === 'matched') rows = rows.filter(function (r) { return String(r.JobID || '').trim() !== ''; });
  if (f === 'outplan') rows = rows.filter(function (r) { return String(r.JobID || '').trim() === ''; });
  if (f === 'closed')  rows = rows.filter(function (r) { return String(r.Status) === 'ปิดเรื่อง'; });
  rows.forEach(patrolFix_);
  rows.sort(function (a, b) {
    return String(b.Date + b.Time).localeCompare(String(a.Date + a.Time));
  });
  return { ok: true, rows: rows.slice(0, parseInt(p.limit, 10) || 200), total: rows.length };
}

/** ปิดเรื่อง หรือยกระดับเป็นจุดที่พบในใบงาน */
function apiPatrolClose_(p) {
  var u = requireUser_(p);
  var t = readTable_(TABLES2.patrol);
  var cur = null;
  t.rows.forEach(function (r) { if (r.PatrolID === p.patrolId) cur = r; });
  if (!cur) throw new Error('ไม่พบรายการพาโทรลนี้');
  if (String(cur.By) !== u.name && !isSupervisor_(u.name))
    throw new Error('ปิดเรื่องได้เฉพาะผู้แจ้งเอง หรือผู้จัดการและหัวหน้าแผนก');

  if (p.promote) {
    if (!cur.JobID) throw new Error('รายการนี้อยู่นอกแผน ยกระดับเป็นจุดที่พบไม่ได้');
    if (cur.FindID) throw new Error('รายการนี้เปิดเป็นจุดที่พบไว้แล้ว');
    var findId = 'F' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMMddHHmmss') +
                 Math.floor(Math.random() * 90 + 10);
    appendRow_(TABLES.findings, {
      FindID: findId, JobID: cur.JobID, RoundID: '', SegID: '',
      DeviceID: cur.LineCode, Lat: cur.Lat, Lng: cur.Lng,
      TreeType: '', Severity: cur.Severity || 'ปกติ',
      PhotoBefore: cur.PhotoUrl, PhotoAfter: '',
      Reporter: cur.By,
      ReportDate: cur.Date, FixedDate: '', Status: 'รอปรับปรุง',
      Note: 'จากการพาโทรล ' + (cur.Note || '')
    });
    updateRow_(TABLES2.patrol, 'PatrolID', p.patrolId,
               { Status: 'เปิดเป็นจุดที่พบแล้ว', FindID: findId });
    try { plkOnPromote_(cur, cur.JobID); } catch (e) {}
    log_(u.name, 'patrolPromote', p.patrolId, findId);
    bumpStamp_();
    return { ok: true, findId: findId };
  }

  var why = String(p.reason || '').trim();
  if (!why) throw new Error('ปิดเรื่องต้องเลือกเหตุผลก่อน');
  updateRow_(TABLES2.patrol, 'PatrolID', p.patrolId, {
    Status: 'ปิดเรื่อง',
    Note: (cur.Note ? cur.Note + ' | ' : '') + 'ปิดเรื่อง: ' + why + ' (โดย ' + u.name + ')'
  });
  try { plkOnClose_(cur, why, u.name); } catch (e) {}
  log_(u.name, 'patrolClose', p.patrolId, why);
  bumpStamp_();
  return { ok: true, reason: why };
}

/* ============================================================
   เพิ่มเติม — สรุปจำนวน หาไลน์ใกล้สุด และผูกเรื่องนอกแผนเข้าใบงาน
   ============================================================ */

/** นับจำนวนไว้ติดป้ายบนปุ่มกล้อง เรียกบ่อยจึงทำให้เบาที่สุด */
function apiPatrolSummary_(p) {
  requireUser_(p);
  var rows = readTable_(TABLES2.patrol).rows;
  var waiting = 0, urgent = 0, matched = 0, outplan = 0, closed = 0;
  rows.forEach(function (r) {
    var st = String(r.Status || '');
    var open = st !== 'ปิดเรื่อง' && st !== 'เปิดเป็นจุดที่พบแล้ว';
    if (open) {
      waiting++;
      if (String(r.Severity || '') === 'เร่งด่วน') urgent++;
      if (String(r.JobID || '').trim()) matched++; else outplan++;
    } else if (st === 'ปิดเรื่อง') closed++;
  });
  return { ok: true, waiting: waiting, urgent: urgent, matched: matched,
           outplan: outplan, closed: closed, total: rows.length };
}

/** ไลน์ในแผนที่ใกล้จุดนั้นที่สุด ไม่จำกัดรัศมี ใช้ตอนเรื่องอยู่นอกแผน */
function apiPatrolNear_(p) {
  requireUser_(p);
  var lat = parseFloat(p.lat), lng = parseFloat(p.lng);
  if ((!isFinite(lat) || !isFinite(lng)) && p.patrolId) {
    readTable_(TABLES2.patrol).rows.forEach(function (r) {
      if (r.PatrolID === p.patrolId) { lat = parseFloat(r.Lat); lng = parseFloat(r.Lng); }
    });
  }
  if (!isFinite(lat) || !isFinite(lng)) throw new Error('ไม่พบพิกัดของรายการนี้');
  var hits = patrolMatch_(lat, lng, p.year, parseFloat(p.radius) || 5000);
  return { ok: true, lat: lat, lng: lng,
           near: hits.slice(0, parseInt(p.limit, 10) || 3) };
}

/** ผูกเรื่องนอกแผนเข้ากับใบงานที่เลือกเอง แล้วเปิดเป็นจุดที่พบต่อได้ทันที */
function apiPatrolAssign_(p) {
  var u = requireUser_(p);
  var cur = null;
  readTable_(TABLES2.patrol).rows.forEach(function (r) { if (r.PatrolID === p.patrolId) cur = r; });
  if (!cur) throw new Error('ไม่พบรายการพาโทรลนี้');
  if (String(cur.By) !== u.name && !isSupervisor_(u.name))
    throw new Error('ผูกใบงานได้เฉพาะผู้แจ้งเอง หรือผู้จัดการและหัวหน้าแผนก');
  if (cur.FindID) throw new Error('รายการนี้เปิดเป็นจุดที่พบไว้แล้ว');

  var jobId = String(p.jobId || '').trim();
  if (!jobId) throw new Error('ยังไม่ได้เลือกใบงาน');
  var job = null;
  readTable_(TABLES.jobs).rows.forEach(function (j) { if (j.JobID === jobId) job = j; });
  if (!job) throw new Error('ไม่พบใบงาน ' + jobId);

  var fields = {
    JobID: jobId,
    LineCode: String(p.lineCode || cur.LineCode || ''),
    PlaceName: String(p.placeName || cur.PlaceName || ''),
    DistM: p.distM !== undefined && p.distM !== '' ? p.distM : cur.DistM,
    Status: 'แจ้งแล้ว',
    Note: (cur.Note ? cur.Note + ' | ' : '') + 'ผูกเข้าใบงานเองโดย ' + u.name
  };
  updateRow_(TABLES2.patrol, 'PatrolID', p.patrolId, fields);
  log_(u.name, 'patrolAssign', p.patrolId, jobId);
  bumpStamp_();

  if (p.promote) {
    var merged = {};
    Object.keys(cur).forEach(function (k) { merged[k] = cur[k]; });
    Object.keys(fields).forEach(function (k) { merged[k] = fields[k]; });
    return apiPatrolClose_({ user: p.user, token: p.token, patrolId: p.patrolId, promote: 1 });
  }
  return { ok: true, jobId: jobId, lineCode: fields.LineCode };
}

/* ============================================================
   ส่วนที่ 2  คณะกรรมการตรวจรับ เก็บแยกตามปี
   ============================================================ */

function apiCommitteeGet_(p) {
  requireUser_(p);
  var t = readTable_(TABLES2.committee);
  var rows = t.rows.filter(function (r) {
    return String(r.Active).toUpperCase() !== 'FALSE';
  });
  if (p.year) rows = rows.filter(function (r) { return String(r.Year) === String(p.year); });
  rows.sort(function (a, b) {
    if (String(a.Year) !== String(b.Year)) return String(a.Year).localeCompare(String(b.Year));
    return (parseInt(a.Seq, 10) || 99) - (parseInt(b.Seq, 10) || 99);
  });
  var years = {};
  t.rows.forEach(function (r) { if (r.Year) years[String(r.Year)] = 1; });
  var cfg = getConfig_();
  return {
    ok: true, rows: rows, years: Object.keys(years).sort(),
    signers: {
      supervisorName: cfg.SUPERVISOR_NAME || '',
      supervisorPos:  cfg.SUPERVISOR_POS  || 'ผู้ควบคุมงาน',
      managerName:    cfg.MANAGER_NAME    || '',
      managerPos:     cfg.MANAGER_POS     || 'ผู้จัดการ กฟส.อ่าวลึก'
    }
  };
}

/** บันทึกรายชื่อทั้งปี แทนของเดิมทั้งชุด — ผู้จัดการและหัวหน้าแผนกเท่านั้น */
function apiCommitteeSave_(p) {
  var u = requireUser_(p);
  if (!isSupervisor_(u.name))
    throw new Error('แก้รายชื่อคณะกรรมการได้เฉพาะผู้จัดการและหัวหน้าแผนก');
  var year = String(p.year || '').trim();
  if (!year) throw new Error('ยังไม่ได้ระบุปี');
  var list = p.members || [];
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = []; } }
  if (!list.length) throw new Error('ยังไม่ได้ใส่รายชื่อ');

  var chair = list.filter(function (m) { return String(m.role || '').indexOf('ประธาน') >= 0; });
  if (chair.length !== 1) throw new Error('ต้องมีประธานหนึ่งคนเท่านั้น');

  var sh = ensureSheet_(TABLES2.committee, COMMITTEE_COLS);
  var v = sh.getDataRange().getValues();
  for (var r = v.length - 1; r >= 1; r--) {
    if (String(v[r][0]).trim() === year) sh.deleteRow(r + 1);
  }
  list.forEach(function (m, i) {
    sh.appendRow([year, i + 1, String(m.name || '').trim(), String(m.position || '').trim(),
                  String(m.role || 'กรรมการ').trim(), 'TRUE', String(m.note || '')]);
  });
  log_(u.name, 'committeeSave', year, list.length + ' คน');
  bumpStamp_();
  return { ok: true, year: year, count: list.length };
}

/* ============================================================
   ส่วนที่ 3  ข้อมูลสำหรับพิมพ์รายงานเบิกจ่ายเงิน
   ============================================================ */

/** งวดเงินตามที่ใช้จริง รอบ 1 และ 2 ร้อยละ 40 รอบ 3 ร้อยละ 20 */
var PAY_PERCENT = { 1: 40, 2: 40, 3: 20 };

function apiPayReport_(p) {
  requireUser_(p);
  var jobId = String(p.jobId || '').trim();
  var no = parseInt(p.installment || p.roundNo, 10);
  if (!jobId) throw new Error('ยังไม่ได้เลือกใบงาน');
  if (!(no >= 1 && no <= 3)) throw new Error('งวดต้องเป็น 1 2 หรือ 3');

  var job = null;
  readTable_(TABLES.jobs).rows.forEach(function (j) { if (j.JobID === jobId) job = j; });
  if (!job) throw new Error('ไม่พบใบงาน ' + jobId);

  var round = null;
  readTable_(TABLES.rounds).rows.forEach(function (r) {
    if (r.JobID === jobId && String(r.RoundNo) === String(no)) round = r;
  });

  var pay = null;
  readTable_(TABLES.payments).rows.forEach(function (r) {
    if (r.JobID === jobId && String(r.Installment) === String(no)) pay = r;
  });

  /* จำนวนเงินคิดจากราคาตามสัญญา ไม่ใช่ราคาประเมิน */
  var contract = parseFloat(job.ContractPrice) || 0;
  var pct = pay && parseFloat(pay.Percent) ? parseFloat(pay.Percent) : PAY_PERCENT[no];
  var amount = pay && parseFloat(pay.Amount) ? parseFloat(pay.Amount)
                                             : Math.round(contract * pct) / 100;

  var lines = readTable_(TABLES.lines).rows.filter(function (l) { return l.JobID === jobId; });
  var col = 'R' + no + 'Date';
  var done = lines.filter(function (l) { return String(l[col] || '').trim() !== ''; });

  var finds = readTable_(TABLES.findings).rows.filter(function (f) { return f.JobID === jobId; });
  var photos = readTable_(TABLES.photos).rows.filter(function (ph) {
    return ph.JobID === jobId && (!ph.RoundNo || String(ph.RoundNo) === String(no));
  });

  var cm = apiCommitteeGet_({ user: p.user, token: p.token, year: job.Year });

  return {
    ok: true,
    job: job,
    round: round,
    payment: pay,
    installment: no,
    percent: pct,
    amount: amount,
    contractPrice: contract,
    amountText: bahtText_(amount),
    lines: lines.map(function (l) {
      return { lineCode: l.LineCode, placeName: l.PlaceName, cutDate: l[col] || '', by: l['R' + no + 'By'] || '' };
    }),
    cutCount: done.length,
    lineCount: lines.length,
    findings: finds,
    photos: photos.map(function (ph) {
      return { url: ph.Url, kind: ph.Kind, lineCode: ph.LineCode, at: ph.At, by: ph.By };
    }),
    committee: cm.rows,
    signers: cm.signers,
    docNo: pay ? (pay.DocNo || '') : '',
    docDate: pay ? (pay.DocDate || '') : '',
    docNoFull: payDocNoFull_(pay, job),
    canIssue: roundReadySafe_(jobId, no).ok,
    blockReason: roundReadySafe_(jobId, no).text,
    bookReady: !!(getConfig_().BOOKNO_URL && getConfig_().BOOKNO_KEY),
    org: getConfig_().ORG_NAME || 'กฟส.อ่าวลึก'
  };
}

/** เลขหนังสือแบบเต็ม เช่น ต.2อล.185/2569 */
function payDocNoFull_(pay, job) {
  if (!pay || !String(pay.DocNo || '').trim()) return '';
  var cfg = getConfig_();
  var prefix = String(cfg.DOC_PREFIX || '').trim();
  var yr = String(pay.DocDate || '').slice(0, 4);
  var be = yr ? (Number(yr) + 543) : (job ? job.Year : '');
  return prefix + String(pay.DocNo).trim() + (be ? '/' + be : '');
}

/** เรียกกฎเดียวจาก BookNo.gs แบบไม่ให้ล้มถ้ายังไม่ได้ติดตั้งไฟล์นั้น */
function roundReadySafe_(jobId, no) {
  try { return roundReadyInfo_(jobId, no); }
  catch (e) {
    var r = null;
    readTable_(TABLES.rounds).rows.forEach(function (x) {
      if (x.JobID === jobId && String(x.RoundNo) === String(no)) r = x;
    });
    var miss = [];
    if (!r) miss.push('ไม่พบรอบที่ ' + no + ' ของใบงานนี้');
    else {
      if (String(r.Status || '').indexOf('ตรวจรับแล้ว') < 0) miss.push('สถานะยังไม่เป็น ตรวจรับแล้ว');
      if (String(r.AcceptDate || '').trim() === '')          miss.push('ยังไม่ได้ลงวันตรวจรับ');
    }
    return { ok: miss.length === 0, missing: miss, text: miss.join(' · '), round: r };
  }
}

/* ============================================================
   ส่วนที่ 4  รายงานรวมหลายใบงานในงวดเดียว
   เลือกได้สองทาง  ตามกลุ่มเดือนในแผน  หรือ  ติ๊กเองทีละใบ
   ออกเลขหนังสือเลขเดียวต่อหนึ่งชุด แล้วเขียนเลขนั้นลงทุกใบที่รวมอยู่
   ============================================================ */

/** รายชื่อกลุ่มเดือนตามแผนของปีนั้น ไว้ให้หน้าเว็บทำเป็นตัวเลือก */
function apiPayGroups_(p) {
  requireUser_(p);
  var year = String(p.year || '').trim();
  var jobs = readTable_(TABLES.jobs).rows.filter(function (j) {
    return (!year || String(j.Year) === year) && String(j.JobType || '') === 'รายปี';
  });
  var g = {};
  jobs.forEach(function (j) {
    var k = String(j.PlanMonths || '').trim() || '(ยังไม่ระบุเดือน)';
    if (!g[k]) g[k] = { planMonths: k, monthGroup: j.MonthGroup || '', jobs: [] };
    g[k].jobs.push(j.JobID);
  });
  var out = Object.keys(g).map(function (k) {
    return { planMonths: k, monthGroup: g[k].monthGroup, count: g[k].jobs.length, jobIds: g[k].jobs };
  });
  out.sort(function (a, b) { return (Number(a.monthGroup) || 99) - (Number(b.monthGroup) || 99); });
  return { ok: true, year: year, groups: out, totalJobs: jobs.length };
}

/** แปลงรายการใบงานที่ส่งมา ให้เป็นอาร์เรย์เสมอ */
function idList_(v) {
  if (!v) return [];
  if (Object.prototype.toString.call(v) === '[object Array]') return v;
  var s = String(v).trim();
  if (s.charAt(0) === '[') { try { return JSON.parse(s); } catch (e) {} }
  return s.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}

/** ข้อมูลรายงานรวมของหลายใบงานในงวดเดียวกัน */
function apiPayReportSet_(p) {
  requireUser_(p);
  var ids = idList_(p.jobIds);
  var no = parseInt(p.installment, 10);
  if (!ids.length) throw new Error('ยังไม่ได้เลือกใบงาน');
  if (!(no >= 1 && no <= 3)) throw new Error('งวดต้องเป็น 1 2 หรือ 3');

  var jobMap = {};
  readTable_(TABLES.jobs).rows.forEach(function (j) { jobMap[j.JobID] = j; });
  var rounds = readTable_(TABLES.rounds).rows;
  var pays   = readTable_(TABLES.payments).rows;
  var lines  = readTable_(TABLES.lines).rows;
  var col = 'R' + no + 'Date';

  var items = [], total = 0, blocked = [], docNos = {}, year = '';
  ids.forEach(function (id) {
    var job = jobMap[id];
    if (!job) { blocked.push(id + ' ไม่พบใบงาน'); return; }
    year = year || String(job.Year || '');

    var rnd = null;
    rounds.forEach(function (r) { if (r.JobID === id && String(r.RoundNo) === String(no)) rnd = r; });
    var pay = null;
    pays.forEach(function (r) { if (r.JobID === id && String(r.Installment) === String(no)) pay = r; });

    var contract = parseFloat(job.ContractPrice) || 0;
    var pct = pay && parseFloat(pay.Percent) ? parseFloat(pay.Percent) : PAY_PERCENT[no];
    var amt = pay && parseFloat(pay.Amount) ? parseFloat(pay.Amount)
                                            : Math.round(contract * pct) / 100;
    total += amt;

    var mine = lines.filter(function (l) { return l.JobID === id; });
    var done = mine.filter(function (l) { return String(l[col] || '').trim() !== ''; });

    var rd = roundReadySafe_(id, no);
    if (!rd.ok) blocked.push((job.MJMNo || id) + ' — ' + rd.text);
    var dn = pay ? String(pay.DocNo || '').trim() : '';
    if (dn) docNos[dn] = true;

    items.push({
      jobId: id, mjmNo: job.MJMNo || id, jobName: job.JobName || '',
      feeder: job.FeederID || '', voltLevel: job.VoltLevel || '', system: job.System || '',
      contractor: job.Contractor || '', planKm: job.PlanKm || '', zpm4: job.ZPM4No || '',
      contractPrice: contract, percent: pct, amount: amt,
      cutCount: done.length, lineCount: mine.length,
      acceptDate: rnd ? (rnd.AcceptDate || '') : '',
      roundStatus: rnd ? (rnd.Status || '') : '',
      inspector: rnd ? (rnd.Inspector || '') : '',
      ready: rd.ok, blockReason: rd.text,
      docNo: dn, payId: pay ? pay.PayID : ''
    });
  });

  var cm = apiCommitteeGet_({ user: p.user, token: p.token, year: year });
  var cfg = getConfig_();
  var keys = Object.keys(docNos);
  var common = keys.length === 1 ? keys[0] : '';
  var prefix = String(cfg.DOC_PREFIX || '').trim();
  var anyPay = null;
  items.forEach(function (it) { if (!anyPay && it.docNo) anyPay = it; });

  return {
    ok: true,
    installment: no, year: year,
    items: items, count: items.length,
    total: total, totalText: bahtText_(total),
    committee: cm.rows, signers: cm.signers,
    canIssue: blocked.length === 0,
    blockReason: blocked.join(' | '),
    mixedDocNo: keys.length > 1,
    docNo: common,
    docNoFull: common ? (prefix + common + (year ? '/' + year : '')) : '',
    bookReady: !!(cfg.BOOKNO_URL && cfg.BOOKNO_KEY),
    org: cfg.ORG_NAME || 'กฟส.อ่าวลึก'
  };
}

/** อ่านจำนวนเงินเป็นตัวหนังสือ */
function bahtText_(n) {
  n = Math.round((parseFloat(n) || 0) * 100) / 100;
  var num = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  var pos = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];
  function chunk(s) {
    s = String(s).replace(/^0+/, '');
    if (!s) return '';
    var out = '', len = s.length;
    for (var i = 0; i < len; i++) {
      var d = parseInt(s.charAt(i), 10), place = len - i - 1;
      if (d === 0) continue;
      if (place === 0 && d === 1 && len > 1) out += 'เอ็ด';
      else if (place === 1 && d === 1) out += 'สิบ';
      else if (place === 1 && d === 2) out += 'ยี่สิบ';
      else out += num[d] + pos[place];
    }
    return out;
  }
  function whole(s) {
    s = String(parseInt(s, 10) || 0);
    if (s === '0') return 'ศูนย์';
    var out = '';
    while (s.length > 6) {
      out += chunk(s.slice(0, s.length - 6)) + 'ล้าน';
      s = s.slice(s.length - 6);
    }
    return out + chunk(s);
  }
  var i = Math.floor(n), f = Math.round((n - i) * 100);
  var txt = whole(String(i)) + 'บาท';
  txt += f ? whole(String(f)) + 'สตางค์' : 'ถ้วน';
  return txt;
}

/* ============================================================
   ติดตั้งครั้งเดียว
   ============================================================ */
function setupTree2() {
  var out = [];

  ensureSheet_(TABLES2.patrol, PATROL_COLS);
  out.push('แท็บ ' + TABLES2.patrol + ' พร้อมใช้');

  var sh = ensureSheet_(TABLES2.committee, COMMITTEE_COLS);
  if (sh.getLastRow() < 2) {
    [['2569', 1, '', '', 'ประธาน', 'TRUE', 'เติมชื่อแล้วบันทึกจากในแอปได้'],
     ['2569', 2, '', '', 'กรรมการ', 'TRUE', ''],
     ['2569', 3, '', '', 'กรรมการ', 'TRUE', ''],
     ['2570', 1, '', '', 'ประธาน', 'TRUE', 'ปี 2570 มีกรรมการ 4 คน'],
     ['2570', 2, '', '', 'กรรมการ', 'TRUE', ''],
     ['2570', 3, '', '', 'กรรมการ', 'TRUE', ''],
     ['2570', 4, '', '', 'กรรมการ', 'TRUE', '']].forEach(function (r) { sh.appendRow(r); });
    out.push('ใส่โครงรายชื่อปี 2569 (3 คน) และ 2570 (4 คน) ไว้ให้ รอเติมชื่อ');
  } else {
    out.push('แท็บ ' + TABLES2.committee + ' มีข้อมูลอยู่แล้ว ไม่แตะต้อง');
  }

  [['PATROL_RADIUS_M', '100', 'รัศมีที่ถือว่าพาโทรลตรงกับจุดในแผน หน่วยเมตร'],
   ['SUPERVISOR_NAME', '', 'ชื่อผู้ควบคุมงาน สำหรับช่องเซ็นในรายงานเบิกจ่าย'],
   ['SUPERVISOR_POS', 'ผู้ควบคุมงาน', 'ตำแหน่งผู้ควบคุมงาน'],
   ['MANAGER_NAME', '', 'ชื่อผู้จัดการ สำหรับช่องเซ็นในรายงานเบิกจ่าย'],
   ['MANAGER_POS', 'ผู้จัดการ กฟส.อ่าวลึก', 'ตำแหน่งผู้จัดการ']
  ].forEach(function (c) { setConfig_(c[0], c[1], c[2]); });
  out.push('เพิ่มคีย์ตั้งค่า 5 ตัวในแท็บ Config');

  /* Trigger สรุปพาโทรลตอนเย็น */
  var tg = ScriptApp.getProjectTriggers();
  for (var i = 0; i < tg.length; i++) {
    if (tg[i].getHandlerFunction() === 'patrolDigest') ScriptApp.deleteTrigger(tg[i]);
  }
  ScriptApp.newTrigger('patrolDigest').timeBased().atHour(17).nearMinute(5).everyDays(1).create();
  out.push('ตั้งเวลาสรุปพาโทรลเข้าไลน์ทุกวัน 17:05 แล้ว');

  bumpStamp_();
  var msg = out.join('\n');
  console.log(msg);
  return msg;
}

/** ตรวจสภาพฟีเจอร์ชุดสอง */
function tree2Status() {
  var ss = db_();
  var p = ss.getSheetByName(TABLES2.patrol);
  var c = ss.getSheetByName(TABLES2.committee);
  var cfg = getConfig_();
  var cmYears = {};
  if (c) readTable_(TABLES2.committee).rows.forEach(function (r) { if (r.Year) cmYears[r.Year] = (cmYears[r.Year] || 0) + 1; });
  var digest = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'patrolDigest';
  }).length;

  var msg = [
    'แท็บ TreePatrol      : ' + (p ? (p.getLastRow() - 1) + ' รายการ' : 'ยังไม่มี — ให้รัน setupTree2'),
    'แท็บ TreeCommittee   : ' + (c ? JSON.stringify(cmYears) : 'ยังไม่มี — ให้รัน setupTree2'),
    'รัศมีพาโทรล          : ' + patrolRadius_() + ' เมตร',
    'ผู้ควบคุมงาน         : ' + (cfg.SUPERVISOR_NAME || 'ยังไม่ได้กรอกในแท็บ Config'),
    'ผู้จัดการ            : ' + (cfg.MANAGER_NAME || 'ยังไม่ได้กรอกในแท็บ Config'),
    'สรุปพาโทรลตอนเย็น    : ' + (digest ? 'ตั้งแล้ว' : 'ยังไม่ได้ตั้ง'),
    'เชื่อมเลขหนังสือ     : ' + (cfg.BOOKNO_URL && cfg.BOOKNO_KEY ? 'พร้อม' : 'ยังไม่ได้ตั้งค่า BOOKNO_URL หรือ BOOKNO_KEY')
  ].join('\n');
  console.log(msg);
  return msg;
}
