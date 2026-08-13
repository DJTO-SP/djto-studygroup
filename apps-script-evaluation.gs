/**
 * 학습동아리 중간평가 (2026) - 백엔드
 *
 * [설치]
 * 1. Apps Script 편집기에서 파일 추가 → 이름: evaluation
 * 2. 이 파일 내용을 통째로 붙여넣기
 * 3. Code.gs 의 doPost switch 에 아래 2줄 추가
 *      case 'evalLogin':  result = evalLogin(d); break;
 *      case 'evalSave':   result = evalSave(d); break;
 *    Code.gs 의 doGet switch 에 아래 1줄 추가
 *      case 'evalResults': result = checkAdmin(p.pw) ? evalResults() : {error:'권한 없음'}; break;
 * 4. 저장 → 배포 → 배포 관리 → 연필(✏️) → 버전 '새 버전' → 배포
 *
 * [필요한 시트]
 * - 구성원 (기존)  : 동아리명 | 이름 | 부서 | 비고
 * - 중간평가 (자동 생성)
 *
 * ※ 한 사람이 여러 동아리에 속한 경우 '구성원' 시트에 줄을 나눠 넣으면
 *   그 동아리들이 모두 평가 대상에서 자동 제외된다.
 *   집계상 소속은 '구성원 시트에서 먼저 나오는 동아리'로 고정된다.
 *   (어느 동아리 코드로 접속하든 결과가 같도록 — 순서를 바꾸려면 시트 행 순서를 조정)
 */

const S_MEMBER = '구성원';
const S_EVAL   = '중간평가';

// 평가 기간 (YYYY-MM-DD). 비우면 기간 제한 없음
const EVAL_START = '';
const EVAL_END   = '';

const EVAL_HEADERS = [
  'id','evaluatorClub','evaluatorName','evaluatorDept','evaluatorRole',
  'targetClub','org','innovation','feasibility','performance','total',
  'good','improve','status','submittedAt'
];

// ══════════════════════════════════════════
// 로그인 — 동아리 코드 + 이름
// ══════════════════════════════════════════
function evalLogin(d) {
  const code = String(d.clubCode || '').trim();
  const name = String(d.name || '').trim();
  if (!code || !name) return { ok: false, error: '동아리 코드와 이름을 모두 입력해 주세요.' };

  const period = evalCheckPeriod_();
  if (!period.ok) return period;

  const clubs = evalClubs_();
  const club = clubs.find(c => String(c.code).trim().toLowerCase() === code.toLowerCase());
  if (!club) return { ok: false, error: '동아리 코드가 올바르지 않습니다.' };

  const members = evalMembers_();
  const me = members.find(m => m.club === club.name && m.name === name);
  if (!me) {
    return { ok: false, error: '‘' + club.name + '’ 명단에서 ' + name + ' 님을 찾을 수 없습니다. 이름과 코드를 다시 확인해 주세요.' };
  }

  // 본인이 속한 모든 동아리 (이름 + 부서가 같으면 동일인)
  const mine = members.filter(m => m.name === me.name && m.dept === me.dept);
  const myClubs = mine.map(m => m.club);

  // 집계상 소속 = 구성원 시트에서 먼저 나오는 동아리 (접속 코드와 무관하게 고정)
  const primaryClub = mine[0].club;

  // 평가 대상 = 본인 소속을 제외한 나머지
  const targets = clubs
    .filter(c => myClubs.indexOf(c.name) < 0)
    .map(c => ({ name: c.name, desc: c.desc || '' }));

  if (targets.length === 0) {
    return { ok: false, error: '소속 동아리를 제외하면 평가할 대상이 없어 참여 대상이 아닙니다. 담당자에게 문의해 주세요.' };
  }

  return {
    ok: true,
    club: primaryClub,        // 저장·집계 기준
    loginClub: club.name,     // 접속에 사용한 코드의 동아리
    name: me.name,
    dept: me.dept,
    role: mine[0].role || me.role || '',
    myClubs: myClubs,
    targets: targets,
    answers: evalLoadAnswers_(primaryClub, me.name, me.dept)
  };
}

// ══════════════════════════════════════════
// 저장 — 임시저장 / 최종제출 공통
// ══════════════════════════════════════════
function evalSave(d) {
  const login = evalLogin({ clubCode: d.clubCode, name: d.name });
  if (!login.ok) return login;

  const status = d.status === '제출' ? '제출' : '임시저장';
  const items = d.items || [];
  const allowed = login.targets.map(t => t.name);

  // 최종 제출일 때만 필수값 검사
  if (status === '제출') {
    if (items.length !== allowed.length) {
      return { ok: false, error: '평가 대상 ' + allowed.length + '개를 모두 작성해 주세요.' };
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const miss = ['org','innovation','feasibility','performance'].filter(k => !Number(it[k]));
      if (miss.length) return { ok: false, error: '‘' + it.targetClub + '’ 의 점수를 모두 선택해 주세요.' };
      if (String(it.good || '').trim().length < 15)    return { ok: false, error: '‘' + it.targetClub + '’ 의 인상 깊었던 점을 15자 이상 작성해 주세요.' };
      if (String(it.improve || '').trim().length < 15) return { ok: false, error: '‘' + it.targetClub + '’ 의 보완하면 좋을 점을 15자 이상 작성해 주세요.' };
    }
    // 모든 대상에 같은 총점을 준 경우 차단 (대상이 2개 이상일 때만)
    if (items.length >= 2) {
      const totals = items.map(it => evalTotal_(it));
      if (totals.every(t => t === totals[0])) {
        return { ok: false, error: '모든 동아리에 같은 총점을 부여할 수 없습니다. 다시 검토해 주세요.' };
      }
    }
  }

  initSheet(S_EVAL, EVAL_HEADERS);
  evalDeleteRows_(login.club, login.name, login.dept);

  const stamp = now();
  items.forEach(it => {
    if (allowed.indexOf(it.targetClub) < 0) return; // 대상 아닌 동아리는 무시
    saveToSheet(S_EVAL, {
      id: uid(),
      evaluatorClub: login.club,
      evaluatorName: login.name,
      evaluatorDept: login.dept,
      evaluatorRole: login.role,
      targetClub: it.targetClub,
      org: Number(it.org) || '',
      innovation: Number(it.innovation) || '',
      feasibility: Number(it.feasibility) || '',
      performance: Number(it.performance) || '',
      total: evalTotal_(it) || '',
      good: String(it.good || '').trim(),
      improve: String(it.improve || '').trim(),
      status: status,
      submittedAt: stamp
    });
  });

  return { ok: true, status: status, savedAt: stamp };
}

// ══════════════════════════════════════════
// 관리자 — 전체 응답 조회
// ══════════════════════════════════════════
function evalResults() {
  const clubs = evalClubs_().map(c => c.name);

  // 평가자 명단 — 이름+부서로 중복 제거, 소속은 첫 등장 동아리
  const seen = {};
  const evaluators = [];
  evalMembers_().forEach(m => {
    const key = m.name + '|' + m.dept;
    if (seen[key]) { seen[key].clubs.push(m.club); return; }
    const o = { name: m.name, dept: m.dept, role: m.role, club: m.club, clubs: [m.club] };
    seen[key] = o;
    evaluators.push(o);
  });
  evaluators.forEach(e => { e.targetCount = clubs.length - e.clubs.length; });

  let rows = [];
  try { rows = sheetToObjects(S_EVAL); } catch(e) { rows = []; }

  return {
    ok: true,
    clubs: clubs,
    evaluators: evaluators,
    rows: rows.map(r => ({
      evaluatorClub: r.evaluatorClub, evaluatorName: r.evaluatorName,
      evaluatorDept: r.evaluatorDept, evaluatorRole: r.evaluatorRole,
      targetClub: r.targetClub,
      org: r.org, innovation: r.innovation,
      feasibility: r.feasibility, performance: r.performance,
      total: r.total, good: r.good, improve: r.improve,
      status: r.status, submittedAt: r.submittedAt
    }))
  };
}

// ══════════════════════════════════════════
// 내부 헬퍼
// ══════════════════════════════════════════
function evalTotal_(it) {
  return (Number(it.org) || 0) + (Number(it.innovation) || 0)
       + (Number(it.feasibility) || 0) + (Number(it.performance) || 0);
}

function evalCheckPeriod_() {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  if (EVAL_START && today < EVAL_START) return { ok: false, error: '평가 기간이 아직 시작되지 않았습니다. (' + EVAL_START + ' 부터)' };
  if (EVAL_END   && today > EVAL_END)   return { ok: false, error: '평가가 마감되었습니다. (' + EVAL_END + ' 까지)' };
  return { ok: true };
}

// 운영중인 동아리 목록 (코드 포함)
function evalClubs_() {
  return sheetToObjects(S_CLUBS)
    .filter(c => c.status !== '종료')
    .map(c => ({ name: String(c.name).trim(), code: c.code, desc: c.desc, status: c.status }));
}

// 구성원 시트 → {club, name, dept, role}
function evalMembers_() {
  let rows = [];
  try { rows = sheetToObjects(S_MEMBER); } catch(e) { return []; }
  return rows.map(r => ({
    club: String(r['동아리명'] || '').trim(),
    name: String(r['이름'] || '').trim(),
    dept: String(r['부서'] || '').trim(),
    role: String(r['비고'] || '').trim()
  })).filter(m => m.club && m.name);
}

// 기존 응답 불러오기 → { 동아리명: {org, innovation, ...} }
function evalLoadAnswers_(club, name, dept) {
  let rows = [];
  try { rows = sheetToObjects(S_EVAL); } catch(e) { return { status: '', items: {} }; }
  const mine = rows.filter(r =>
    String(r.evaluatorClub).trim() === club &&
    String(r.evaluatorName).trim() === name &&
    String(r.evaluatorDept).trim() === dept
  );
  const items = {};
  mine.forEach(r => {
    items[String(r.targetClub).trim()] = {
      org: r.org, innovation: r.innovation,
      feasibility: r.feasibility, performance: r.performance,
      good: r.good, improve: r.improve
    };
  });
  return { status: mine.length ? String(mine[0].status || '') : '', items: items };
}

// 해당 평가자의 기존 응답 삭제 (아래에서 위로 순회)
function evalDeleteRows_(club, name, dept) {
  const s = ss().getSheetByName(S_EVAL);
  if (!s || s.getLastRow() < 2) return;
  const data = s.getDataRange().getValues();
  const h = data[0];
  const ci = {
    club: h.indexOf('evaluatorClub'),
    name: h.indexOf('evaluatorName'),
    dept: h.indexOf('evaluatorDept')
  };
  if (ci.club < 0 || ci.name < 0) return;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][ci.club]).trim() === club &&
        String(data[i][ci.name]).trim() === name &&
        String(data[i][ci.dept]).trim() === dept) {
      s.deleteRow(i + 1);
    }
  }
}
