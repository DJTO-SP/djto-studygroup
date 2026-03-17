/**
 * 대전관광공사 학습동아리 - Google Apps Script 백엔드
 *
 * [초기 설정]
 * 1. Google Sheets 새 파일 생성 → 아래 시트들 자동 생성됨 (setupAllSheets 실행)
 *    - 동아리 / 신청 / 활동 / 결과보고서 / 지난결과
 * 2. Google Drive 폴더 생성 → 폴더 ID 복사 → DRIVE_FOLDER_ID에 입력
 * 3. SHEET_ID에 Sheets 파일 ID 입력 (URL 중간의 긴 문자열)
 * 4. ADMIN_PW에 관리자 비밀번호 설정
 * 5. 배포: 확장 프로그램 → Apps Script → 배포 → 새 배포 → 유형: 웹 앱
 *    - 액세스: 모든 사용자 (익명 포함)
 *    - 배포 URL을 복사하여 index.html의 SCRIPT_URL에 입력
 *
 * ※ 인증 방식: 동아리별 고유 코드 (관리자가 동아리 등록 시 설정)
 */

const SHEET_ID        = 'YOUR_SHEET_ID_HERE';
const DRIVE_FOLDER_ID = 'YOUR_DRIVE_FOLDER_ID_HERE';
const ADMIN_PW        = '1234';

// ── 시트 이름 상수 ──
const S_CLUBS    = '동아리';
const S_APPLY    = '신청';
const S_ACTIVITY = '활동';
const S_REPORT   = '결과보고서';
const S_PAST     = '지난결과';

// ══════════════════════════════════════════
// GET 라우터
// ══════════════════════════════════════════
function doGet(e) {
  const p = e.parameter;
  let result;
  try {
    switch (p.action) {
      case 'getClubs':           result = getClubs(); break;
      case 'getClubsAdmin':      result = checkAdmin(p.pw) ? getClubsAdmin() : {error:'권한 없음'}; break;
      case 'verifyClubCode':     result = verifyClubCode(p.clubId, p.code); break;
      case 'getApplications':    result = checkAdmin(p.pw) ? getApplications(p.status) : {error:'권한 없음'}; break;
      case 'getActivities':      result = getActivities(p.clubId, p.year); break;
      case 'getReports':         result = checkAdmin(p.pw) ? getReports(p.year) : {error:'권한 없음'}; break;
      case 'getPastResults':     result = getPastResults(p.year, p.clubId); break;
      case 'getAllFiles':         result = checkAdmin(p.pw) ? getAllFiles() : {error:'권한 없음'}; break;
      case 'getStats':           result = getStats(); break;
      default:                   result = {error: 'Unknown action'};
    }
  } catch(err) {
    result = {error: err.message};
  }
  return json(result);
}

// ══════════════════════════════════════════
// POST 라우터
// ══════════════════════════════════════════
function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  let result;
  try {
    switch (d.action) {
      case 'submitApplication': result = submitApplication(d); break;
      case 'reviewApplication': result = checkAdmin(d.pw) ? reviewApplication(d) : {error:'권한 없음'}; break;
      case 'uploadActivity':    result = uploadActivity(d); break;
      case 'uploadReport':      result = uploadReport(d); break;
      case 'savePastResult':    result = checkAdmin(d.pw) ? savePastResult(d) : {error:'권한 없음'}; break;
      case 'saveClub':          result = checkAdmin(d.pw) ? saveClub(d) : {error:'권한 없음'}; break;
      case 'deleteClub':        result = checkAdmin(d.pw) ? deleteClub(d.clubId) : {error:'권한 없음'}; break;
      case 'deleteFile':        result = checkAdmin(d.pw) ? deleteFile(d.id, d.sheetName) : {error:'권한 없음'}; break;
      default:                  result = {error: 'Unknown action'};
    }
  } catch(err) {
    result = {error: err.message};
  }
  return json(result);
}

// ══════════════════════════════════════════
// 헬퍼
// ══════════════════════════════════════════
function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
function checkAdmin(pw) { return pw === ADMIN_PW; }
function ss()  { return SpreadsheetApp.openById(SHEET_ID); }
function sheet(name) {
  const s = ss().getSheetByName(name);
  if (!s) throw new Error('시트를 찾을 수 없습니다: ' + name);
  return s;
}
function uid() { return Utilities.getUuid().replace(/-/g,'').substring(0,12); }
function now() { return new Date().toISOString(); }

function sheetToObjects(sheetName) {
  const s = sheet(sheetName);
  const data = s.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1)
    .filter(row => row[0] !== '')
    .map((row, i) => {
      const obj = { _rowIndex: i + 2 };
      headers.forEach((h, j) => obj[h] = row[j]);
      return obj;
    });
}

function saveToSheet(sheetName, rowObj) {
  const s = sheet(sheetName);
  const headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  const row = headers.map(h => rowObj[h] !== undefined ? rowObj[h] : '');
  s.appendRow(row);
}

function updateRowById(sheetName, id, updates) {
  const s = sheet(sheetName);
  const data = s.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      Object.keys(updates).forEach(key => {
        const col = headers.indexOf(key);
        if (col >= 0) s.getRange(i + 1, col + 1).setValue(updates[key]);
      });
      return true;
    }
  }
  return false;
}

function deleteRowById(sheetName, id) {
  const s = sheet(sheetName);
  const data = s.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idCol]) === String(id)) { s.deleteRow(i + 1); return true; }
  }
  return false;
}

function saveToDrive(base64Data, fileName, mimeType, subFolder) {
  if (!base64Data) return { fileId: '', driveUrl: '' };
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  let targetFolder = folder;
  if (subFolder) {
    const existing = folder.getFoldersByName(subFolder);
    targetFolder = existing.hasNext() ? existing.next() : folder.createFolder(subFolder);
  }
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
  const file = targetFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { fileId: file.getId(), driveUrl: file.getUrl() };
}

// ══════════════════════════════════════════
// 동아리
// ══════════════════════════════════════════
// 공개 API: 코드 필드 제외
function getClubs() {
  return sheetToObjects(S_CLUBS)
    .filter(c => c.status !== '종료' || false)
    .map(c => ({
      id: c.id, name: c.name, type: c.type,
      desc: c.desc, color: c.color, status: c.status
    }));
}

// 관리자 API: 코드 포함
function getClubsAdmin() {
  return sheetToObjects(S_CLUBS).map(c => ({
    id: c.id, name: c.name, type: c.type,
    desc: c.desc, color: c.color, code: c.code, status: c.status
  }));
}

// 동아리 코드 검증
function verifyClubCode(clubId, code) {
  if (!clubId || !code) return { ok: false };
  const clubs = sheetToObjects(S_CLUBS);
  const club = clubs.find(c => c.id === clubId);
  if (!club) return { ok: false };
  if (String(club.code).trim() !== String(code).trim()) return { ok: false };
  return { ok: true, clubName: club.name };
}

function saveClub(d) {
  initSheet(S_CLUBS, ['id','name','type','desc','color','code','status','createdAt']);
  if (d.rowId) {
    updateRowById(S_CLUBS, d.rowId, {
      name:d.name, type:d.type, desc:d.desc||'',
      color:d.color||'#16a34a', code:d.code||'', status:d.status||'운영중'
    });
  } else {
    saveToSheet(S_CLUBS, {
      id:uid(), name:d.name, type:d.type||'학습동아리',
      desc:d.desc||'', color:d.color||'#16a34a',
      code:d.code||uid().substring(0,6).toUpperCase(),
      status:d.status||'운영중', createdAt:now()
    });
  }
  return { ok: true };
}

function deleteClub(clubId) {
  deleteRowById(S_CLUBS, clubId);
  return { ok: true };
}

// ══════════════════════════════════════════
// 통계 (홈 화면용)
// ══════════════════════════════════════════
function getStats() {
  const clubs = sheetToObjects(S_CLUBS).filter(c => c.status !== '종료');
  const activities = sheetToObjects(S_ACTIVITY);
  const reports = sheetToObjects(S_REPORT);
  const applies = sheetToObjects(S_APPLY);
  return {
    clubCount: clubs.length,
    activityCount: activities.length,
    reportCount: reports.length,
    applyCount: applies.filter(a => a.status === '대기').length
  };
}

// ══════════════════════════════════════════
// 동아리 신청
// ══════════════════════════════════════════
function submitApplication(d) {
  initSheet(S_APPLY, ['id','type','clubName','name','dept','contact','fileId','driveUrl','fileName','status','comment','submittedAt']);
  const { fileId, driveUrl } = saveToDrive(d.fileData, d.fileName, d.fileType, '신청서');
  const id = uid();
  saveToSheet(S_APPLY, {
    id, type: d.type, clubName: d.clubName,
    name: d.name, dept: d.dept||'', contact: d.contact||'',
    fileId, driveUrl, fileName: d.fileName||'',
    status: '대기', comment: '', submittedAt: now()
  });
  return { ok: true, id };
}

function getApplications(status) {
  let list = sheetToObjects(S_APPLY);
  if (status) list = list.filter(a => a.status === status);
  return list.sort((a,b) => new Date(b.submittedAt) - new Date(a.submittedAt)).map(a => ({
    id: a.id, type: a.type, clubName: a.clubName,
    name: a.name, dept: a.dept, contact: a.contact,
    driveUrl: a.driveUrl, fileName: a.fileName,
    status: a.status, comment: a.comment, submittedAt: a.submittedAt
  }));
}

function reviewApplication(d) {
  updateRowById(S_APPLY, d.id, { status: d.status, comment: d.comment||'' });
  return { ok: true };
}

// ══════════════════════════════════════════
// 활동현황 (고유 코드 인증)
// ══════════════════════════════════════════
function uploadActivity(d) {
  // 서버 측 코드 검증
  const v = verifyClubCode(d.clubId, d.clubCode);
  if (!v.ok) return { error: '동아리 코드가 올바르지 않습니다.' };

  initSheet(S_ACTIVITY, ['id','clubId','clubName','title','category','desc','uploadedBy','fileId','driveUrl','fileName','fileType','fileSize','uploadedAt']);
  const { fileId, driveUrl } = saveToDrive(d.fileData, d.fileName, d.fileType, d.clubName);
  saveToSheet(S_ACTIVITY, {
    id: uid(), clubId: d.clubId, clubName: d.clubName,
    title: d.title, category: d.category||'활동자료', desc: d.desc||'',
    uploadedBy: d.uploadedBy||'', fileId, driveUrl,
    fileName: d.fileName||'', fileType: d.fileType||'', fileSize: d.fileSize||0,
    uploadedAt: now()
  });
  return { ok: true };
}

function getActivities(clubId, year) {
  let list = sheetToObjects(S_ACTIVITY);
  if (clubId) list = list.filter(a => a.clubId === clubId);
  if (year)   list = list.filter(a => String(a.uploadedAt).startsWith(year));
  return list.sort((a,b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)).map(a => ({
    id:a.id, clubId:a.clubId, clubName:a.clubName, title:a.title, category:a.category,
    desc:a.desc, uploadedBy:a.uploadedBy, driveUrl:a.driveUrl,
    fileType:a.fileType, fileSize:a.fileSize, uploadedAt:a.uploadedAt
  }));
}

// ══════════════════════════════════════════
// 성과보고서 (고유 코드 인증)
// ══════════════════════════════════════════
function uploadReport(d) {
  // 서버 측 코드 검증
  const v = verifyClubCode(d.clubId, d.clubCode);
  if (!v.ok) return { error: '동아리 코드가 올바르지 않습니다.' };

  initSheet(S_REPORT, ['id','clubId','clubName','year','title','uploadedBy','fileId','driveUrl','fileName','fileType','fileSize','uploadedAt']);
  const { fileId, driveUrl } = saveToDrive(d.fileData, d.fileName, d.fileType, '결과보고서');
  saveToSheet(S_REPORT, {
    id: uid(), clubId: d.clubId, clubName: d.clubName,
    year: d.year||new Date().getFullYear(),
    title: d.title, uploadedBy: d.uploadedBy||'',
    fileId, driveUrl, fileName: d.fileName||'', fileType: d.fileType||'', fileSize: d.fileSize||0,
    uploadedAt: now()
  });
  return { ok: true };
}

function getReports(year) {
  let list = sheetToObjects(S_REPORT);
  if (year) list = list.filter(r => String(r.year) === String(year) || String(r.uploadedAt).startsWith(year));
  return list.sort((a,b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)).map(r => ({
    id:r.id, clubId:r.clubId, clubName:r.clubName, year:r.year,
    title:r.title, uploadedBy:r.uploadedBy,
    driveUrl:r.driveUrl, fileType:r.fileType, uploadedAt:r.uploadedAt
  }));
}

// ══════════════════════════════════════════
// 지난결과 (관리자 등록, 전체 공개)
// ══════════════════════════════════════════
function savePastResult(d) {
  initSheet(S_PAST, ['id','year','clubName','title','desc','fileId','driveUrl','fileName','fileType','fileSize','uploadedAt']);
  let fileId='', driveUrl='', fileName='', fileType='', fileSize=0;
  if (d.fileData) {
    const saved = saveToDrive(d.fileData, d.fileName, d.fileType, '지난결과/' + d.year);
    fileId = saved.fileId; driveUrl = saved.driveUrl;
    fileName = d.fileName; fileType = d.fileType; fileSize = d.fileSize||0;
  }
  if (d.rowId) {
    const updates = { year:d.year, clubName:d.clubName, title:d.title, desc:d.desc||'' };
    if (fileId) Object.assign(updates, { fileId, driveUrl, fileName, fileType, fileSize });
    updateRowById(S_PAST, d.rowId, updates);
  } else {
    saveToSheet(S_PAST, {
      id:uid(), year:d.year, clubName:d.clubName||'',
      title:d.title, desc:d.desc||'',
      fileId, driveUrl, fileName, fileType, fileSize, uploadedAt:now()
    });
  }
  return { ok: true };
}

function getPastResults(year, clubId) {
  let list = sheetToObjects(S_PAST);
  if (year)   list = list.filter(r => String(r.year) === String(year));
  if (clubId) list = list.filter(r => r.clubId === clubId);
  return list.sort((a,b) => {
    if (String(b.year) !== String(a.year)) return String(b.year).localeCompare(String(a.year));
    return new Date(b.uploadedAt) - new Date(a.uploadedAt);
  }).map(r => ({
    id:r.id, year:r.year, clubName:r.clubName,
    title:r.title, desc:r.desc, driveUrl:r.driveUrl,
    fileType:r.fileType, fileName:r.fileName, uploadedAt:r.uploadedAt
  }));
}

// ══════════════════════════════════════════
// 전체 파일 목록 (관리자)
// ══════════════════════════════════════════
function getAllFiles() {
  const results = [];
  [[S_ACTIVITY,'활동자료'], [S_REPORT,'성과보고서'], [S_APPLY,'신청서'], [S_PAST,'지난결과']].forEach(([sName, label]) => {
    sheetToObjects(sName).forEach(r => {
      if (!r.driveUrl) return;
      results.push({
        id: r.id, sheetName: sName, fileType_label: label,
        clubName: r.clubName||'', title: r.title||r.clubName||'',
        uploadedBy: r.uploadedBy||r.name||'',
        driveUrl: r.driveUrl, fileName: r.fileName||'',
        uploadedAt: r.uploadedAt||r.submittedAt||''
      });
    });
  });
  return results.sort((a,b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

// ══════════════════════════════════════════
// 파일 삭제
// ══════════════════════════════════════════
function deleteFile(id, sheetName) {
  const list = sheetToObjects(sheetName);
  const item = list.find(r => r.id === id);
  if (item?.fileId) {
    try { DriveApp.getFileById(item.fileId).setTrashed(true); } catch(e) {}
  }
  deleteRowById(sheetName, id);
  return { ok: true };
}

// ══════════════════════════════════════════
// 시트 헤더 자동 초기화
// ══════════════════════════════════════════
function initSheet(name, headers) {
  const s = ss().getSheetByName(name);
  if (!s) {
    const ns = ss().insertSheet(name);
    ns.appendRow(headers);
    ns.setFrozenRows(1);
    ns.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#16a34a').setFontColor('#ffffff');
    return;
  }
  if (s.getLastRow() === 0) {
    s.appendRow(headers);
    s.setFrozenRows(1);
    s.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#16a34a').setFontColor('#ffffff');
  }
}

function setupAllSheets() {
  initSheet(S_CLUBS,    ['id','name','type','desc','color','code','status','createdAt']);
  initSheet(S_APPLY,    ['id','type','clubName','name','dept','contact','fileId','driveUrl','fileName','status','comment','submittedAt']);
  initSheet(S_ACTIVITY, ['id','clubId','clubName','title','category','desc','uploadedBy','fileId','driveUrl','fileName','fileType','fileSize','uploadedAt']);
  initSheet(S_REPORT,   ['id','clubId','clubName','year','title','uploadedBy','fileId','driveUrl','fileName','fileType','fileSize','uploadedAt']);
  initSheet(S_PAST,     ['id','year','clubName','title','desc','fileId','driveUrl','fileName','fileType','fileSize','uploadedAt']);
  SpreadsheetApp.getUi().alert('✅ 시트 초기화 완료!');
}
