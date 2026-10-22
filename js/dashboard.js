/* ==========================================================
   코팅 설비 생산일지 대시보드 - js/dashboard.js
   전체 흐름 (아래 번호 순서대로 함수가 호출됩니다)
     1) handleFile      : 파일 선택 이벤트를 받아 전체 과정을 진행
     2) decodeText      : 파일 바이트를 글자로 변환 (UTF-8 / CP949 자동 판별)
     3) parseCsv        : 글자를 "행 x 열" 배열로 변환
     4) buildRecords    : 열 이름으로 값을 찾아 롤 1개 = 객체 1개로 정리
     5) calcSummary 등  : 요약 값, 설비별/일자별 집계 계산
     6) render~         : 계산 결과를 화면에 그림
   ========================================================== */

/* ----------------------------------------------------------
   [설정] CSV 열 정의 - 열 이름이 바뀌면 이 부분만 고치면 됩니다.
   header : CSV 첫 줄의 열 이름 (순서는 상관없고 이름으로 찾음)
   key    : 코드 안에서 쓰는 이름
   label  : 표 머리글에 보여 줄 이름
   type   : 표시 방식
            text  = 글자 그대로 (MES_NO 처럼 쉼표 없이 보여야 하는 값 포함)
            fixed = 항상 소수 첫째 자리 (예: 18 -> 18.0)
            num   = 소수 첫째 자리까지, 정수면 정수 (예: 724, 12.5)
            judge = 판정(OK/NG)
   ---------------------------------------------------------- */
const COLUMNS = [
  { header: '생산일자',    key: 'date',      label: '생산일자',      type: 'text'  },
  { header: '설비명',      key: 'equipment', label: '설비명',        type: 'text'  },
  { header: 'MES_NO',      key: 'mesNo',     label: 'MES_NO',        type: 'text'  },
  { header: '생산모델',    key: 'model',     label: '생산모델',      type: 'text'  },
  { header: '두께_좌',     key: 'thickL',    label: '두께 좌',       type: 'fixed' },
  { header: '두께_중',     key: 'thickC',    label: '두께 중',       type: 'fixed' },
  { header: '두께_우',     key: 'thickR',    label: '두께 우',       type: 'fixed' },
  { header: '무게',        key: 'weight',    label: '무게',          type: 'fixed' },
  { header: '통기도',      key: 'airPerm',   label: '통기도',        type: 'num'   },
  { header: '인장강도',    key: 'tensile',   label: '인장강도',      type: 'num'   },
  { header: '생산시간_분', key: 'prodMin',   label: '생산시간(분)',  type: 'num'   },
  { header: '로스시간_분', key: 'lossMin',   label: '로스시간(분)',  type: 'num'   },
  { header: '판정',        key: 'judge',     label: '판정',          type: 'judge' },
];

/* 계산에 꼭 필요한 열의 key. 하나라도 없으면 오류 메시지를 보여 줍니다. */
const REQUIRED_KEYS = ['date', 'equipment', 'prodMin', 'lossMin', 'judge'];

/* 숫자로 읽지 못한 값의 개수 (파일 하나를 읽을 때마다 0으로 초기화) */
let badNumberCount = 0;

/* 현재 불러온 데이터와 화면 상태. 버튼을 눌렀을 때 다시 그리려고 보관합니다. */
let allRecords = [];        // 롤 전체 목록
let showNgOnly = false;     // true 이면 표에 NG 행만 표시
let selectedEquip = '전체'; // 생산/로스시간 차트에서 선택한 설비 ('전체' 또는 설비명)

/* 화면 요소를 id 로 찾는 짧은 함수 */
function $(id) { return document.getElementById(id); }

/* ----------------------------------------------------------
   표시용 숫자 서식 (소수점은 첫째 자리까지만)
   ---------------------------------------------------------- */
/* 정수는 정수로, 소수가 있으면 첫째 자리까지: 337 -> "337", 12.54 -> "12.5" */
function fmtNum(v) {
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}
/* 항상 소수 첫째 자리: 18 -> "18.0" */
function fmtFixed(v) {
  return v.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
/* 퍼센트. 계산할 수 없으면(null) "-" 표시 */
function fmtPercent(v) {
  return v === null ? '-' : fmtFixed(v) + '%';
}

/* ----------------------------------------------------------
   1) 파일 선택 처리 - 이 함수가 전체 과정을 지휘합니다.
   ---------------------------------------------------------- */
async function handleFile(event) {
  const file = event.target.files[0];
  if (!file) return;                       // 선택을 취소한 경우
  $('file-name').textContent = file.name;
  badNumberCount = 0;

  try {
    const buffer = await file.arrayBuffer();           // 파일을 바이트로 읽기
    const rows = parseCsv(decodeText(buffer));         // 글자 -> 행/열
    const records = buildRecords(rows);                // 행/열 -> 롤 객체 목록

    // 계산
    const summary = calcSummary(records);
    const byEquipment = countBy(records, r => r.equipment)
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)); // 많은 순
    const byDate = countBy(records, r => r.date)
      .sort((a, b) => a.label.localeCompare(b.label));                      // 날짜 순

    // 화면 그리기
    allRecords = records;
    selectedEquip = '전체';
    const byModel = countBy(records, r => r.model)
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)); // 많은 순
    renderSummary(summary);
    renderBars('chart-equipment', byEquipment);
    renderBars('chart-model', byModel);
    renderBars('chart-daily', byDate, d => d.slice(5));   // 2026-05-11 -> 05-11
    renderEquipTabs(byEquipment.map(e => e.label).sort());
    renderTimeChart();
    renderNgSummary(records);
    setFilter(false);                                     // 표는 "전체 보기" 로 시작
    $('dashboard').hidden = false;

    let msg = records.length + '개 롤을 불러왔습니다.';
    if (badNumberCount > 0) {
      msg += ' (숫자로 읽을 수 없는 값 ' + badNumberCount + '건은 0으로 계산했습니다.)';
    }
    showMessage(msg, false);
  } catch (err) {
    // 어떤 단계에서든 문제가 생기면 대시보드를 숨기고 이유를 알려 줍니다.
    $('dashboard').hidden = true;
    showMessage('파일을 읽지 못했습니다: ' + err.message, true);
  }
}

/* 메시지 영역에 글자 표시. isError 가 true 면 빨간 글씨 */
function showMessage(text, isError) {
  const el = $('message');
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

/* ----------------------------------------------------------
   2) 인코딩 판별
   한국 엑셀이 저장한 CSV 는 UTF-8 이 아니라 CP949(EUC-KR) 인 경우가 많습니다.
   먼저 UTF-8 로 엄격하게 읽어 보고, 실패하면 euc-kr 로 다시 읽습니다.
   (브라우저의 'euc-kr' 디코더는 CP949 를 포함합니다)
   ---------------------------------------------------------- */
function decodeText(buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (e) {
    text = new TextDecoder('euc-kr').decode(buffer);
  }
  return text.replace(/^\uFEFF/, '');      // 맨 앞 BOM(보이지 않는 표시) 제거
}

/* ----------------------------------------------------------
   3) CSV 파싱: 글자 -> [[셀, 셀, ...], ...]
   쉼표와 줄바꿈으로 나누되, "큰따옴표" 안의 쉼표/줄바꿈은 값의 일부로 취급합니다.
   줄바꿈은 윈도우(\r\n)와 맥/리눅스(\n) 모두 처리합니다.
   ---------------------------------------------------------- */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;                     // 지금 따옴표 안인지 여부

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }   // "" 는 따옴표 문자 하나
        else inQuote = false;                            // 따옴표 닫힘
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {               // 셀 끝
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') { // 줄 끝
      if (ch === '\r' && text[i + 1] === '\n') i++;      // \r\n 을 한 번만 처리
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); } // 마지막 줄

  // 완전히 빈 줄은 버립니다.
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/* ----------------------------------------------------------
   4) 롤 객체 만들기
   첫 줄(머리글)에서 COLUMNS 의 header 위치를 찾고, 이후 줄을 객체로 변환합니다.
   결과 예: { date:'2026-05-11', equipment:'C21', prodMin:14, lossMin:0, judge:'OK', ... }
   ---------------------------------------------------------- */
function buildRecords(rows) {
  if (rows.length < 2) throw new Error('데이터 행이 없습니다.');

  const header = rows[0].map(h => h.trim());
  // 각 열이 몇 번째 칸인지 기록 (없으면 -1)
  const index = {};
  COLUMNS.forEach(c => { index[c.key] = header.indexOf(c.header); });

  // 필수 열 확인
  const missing = COLUMNS
    .filter(c => REQUIRED_KEYS.includes(c.key) && index[c.key] === -1)
    .map(c => c.header);
  if (missing.length > 0) {
    throw new Error('필수 열이 없습니다 → ' + missing.join(', '));
  }

  return rows.slice(1).map(cells => {
    const rec = {};
    COLUMNS.forEach(c => {
      const raw = index[c.key] === -1 ? '' : (cells[index[c.key]] || '').trim();
      if (c.key === 'date')                  rec[c.key] = normalizeDate(raw);
      else if (c.key === 'judge')            rec[c.key] = raw.toUpperCase(); // ng -> NG
      else if (c.type === 'fixed' || c.type === 'num') rec[c.key] = toNumber(raw);
      else                                   rec[c.key] = raw;
    });
    return rec;
  });
}

/* 날짜를 YYYY-MM-DD 로 통일 (2026/5/1, 2026.05.01 도 허용) → 글자 정렬이 곧 날짜 정렬 */
function normalizeDate(s) {
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  return m ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : s;
}

/* 글자 -> 숫자. 빈 칸/잘못된 값은 null 로 두고 개수만 셉니다. */
function toNumber(s) {
  if (s === '') return null;
  const n = Number(s.replace(/,/g, ''));
  if (Number.isNaN(n)) { badNumberCount++; return null; }
  return n;
}

/* ----------------------------------------------------------
   5) 계산
   ---------------------------------------------------------- */
/* 요약 카드 값. null 은 0 으로 취급해서 합산합니다. */
function calcSummary(records) {
  const totalRolls = records.length;
  const ngRolls = records.filter(r => r.judge === 'NG').length;
  const prodSum = records.reduce((sum, r) => sum + (r.prodMin || 0), 0);
  const lossSum = records.reduce((sum, r) => sum + (r.lossMin || 0), 0);
  const timeSum = prodSum + lossSum;

  return {
    totalRolls, ngRolls, lossSum,
    // 불량률(%) = NG 롤 수 / 총 롤 수 x 100
    defectRate: totalRolls === 0 ? null : (ngRolls / totalRolls) * 100,
    // 가동률(%) = 생산시간 합계 / (생산시간 + 로스시간 합계) x 100
    utilization: timeSum === 0 ? null : (prodSum / timeSum) * 100,
  };
}

/* 기준(keyFn)별 롤 수 세기 → [{label:'C21', value:63}, ...]
   예: countBy(records, r => r.equipment) 는 설비명별 개수 */
function countBy(records, keyFn) {
  const map = new Map();
  records.forEach(r => {
    const key = keyFn(r) || '(미입력)';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map, ([label, value]) => ({ label, value }));
}

/* ----------------------------------------------------------
   6) 화면 그리기
   ---------------------------------------------------------- */
/* 요약 카드 4개 */
function renderSummary(s) {
  $('kpi-rolls').textContent = fmtNum(s.totalRolls);
  $('kpi-rolls-sub').textContent = '';
  $('kpi-defect').textContent = fmtPercent(s.defectRate);
  $('kpi-defect-sub').textContent = 'NG ' + fmtNum(s.ngRolls) + '롤';
  $('kpi-util').textContent = fmtPercent(s.utilization);
  $('kpi-loss').textContent = fmtNum(s.lossSum) + '분';
  $('kpi-loss-sub').textContent = '약 ' + fmtFixed(s.lossSum / 60) + '시간';
  $('kpi-ng').textContent = fmtNum(s.ngRolls) + '롤';
  $('kpi-ng-sub').textContent = 'OK ' + fmtNum(s.totalRolls - s.ngRolls) + '롤';
}

/* 세로 막대 그리기 (차트 라이브러리 없이 div 의 height 퍼센트로 표현)
   가장 큰 값을 100% 로 두고 나머지는 비율로 계산합니다.
   labelFn : (선택) 아래에 표시할 이름을 바꾸는 함수. 예: 날짜에서 연도 제거 */
function renderBars(containerId, items, labelFn) {
  const box = $(containerId);
  box.textContent = '';                    // 이전 내용 지우기
  const max = Math.max(...items.map(i => i.value), 1);

  items.forEach(item => {
    const col = document.createElement('div');       // 막대 한 칸
    col.className = 'vcol';
    col.title = item.label + ': ' + fmtNum(item.value);

    const value = document.createElement('span');    // 막대 위 숫자
    value.className = 'vcol-value';
    value.textContent = fmtNum(item.value);

    const plot = document.createElement('div');      // 막대가 서 있는 영역(높이 고정)
    plot.className = 'vcol-plot';
    const fill = document.createElement('div');      // 실제 막대
    fill.className = 'vcol-fill';
    fill.style.height = (item.value / max * 100) + '%';
    plot.appendChild(fill);

    const label = document.createElement('span');    // 막대 아래 이름
    label.className = 'vcol-label';
    label.textContent = labelFn ? labelFn(item.label) : item.label;

    col.append(value, plot, label);
    box.appendChild(col);
  });
}

/* 설비 선택 버튼('전체' + 설비명들)을 만들고, 누르면 차트를 다시 그립니다. */
function renderEquipTabs(names) {
  const box = $('time-tabs');
  box.textContent = '';
  ['전체'].concat(names).forEach(name => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab' + (name === selectedEquip ? ' is-active' : '');
    btn.textContent = name;
    btn.setAttribute('aria-pressed', name === selectedEquip);
    btn.addEventListener('click', () => {
      selectedEquip = name;
      box.querySelectorAll('.tab').forEach(b => {      // 누른 버튼만 강조
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-pressed', b === btn);
      });
      renderTimeChart();
    });
    box.appendChild(btn);
  });
}

/* 선택한 설비의 일자별 생산시간(파랑)/로스시간(주황) 합계를 짝지은 세로 막대로 그립니다.
   막대 높이는 "선택 범위 안에서 가장 큰 값"을 100% 로 한 비율입니다. */
function renderTimeChart() {
  const recs = selectedEquip === '전체'
    ? allRecords : allRecords.filter(r => r.equipment === selectedEquip);

  // 날짜별 합계: Map { '2026-05-11' => { prod: 분, loss: 분 } }
  const byDay = new Map();
  recs.forEach(r => {
    const d = byDay.get(r.date) || { prod: 0, loss: 0 };
    d.prod += r.prodMin || 0;
    d.loss += r.lossMin || 0;
    byDay.set(r.date, d);
  });
  const days = Array.from(byDay.keys()).sort();
  const sums = Array.from(byDay.values());
  const max = Math.max(...sums.map(d => Math.max(d.prod, d.loss)), 1);

  // 범례 옆 요약 문구: 선택 범위 전체의 가동률
  const prodSum = sums.reduce((t, d) => t + d.prod, 0);
  const lossSum = sums.reduce((t, d) => t + d.loss, 0);
  const util = prodSum + lossSum === 0 ? null : prodSum / (prodSum + lossSum) * 100;
  $('time-note').textContent = selectedEquip + ' · 로스 합계 ' + fmtNum(lossSum) +
    '분 · 가동률 ' + fmtPercent(util);

  const box = $('chart-time');
  box.textContent = '';
  days.forEach(day => {
    const d = byDay.get(day);
    const col = document.createElement('div');
    col.className = 'vcol pair';
    col.title = day + ' 생산 ' + fmtNum(d.prod) + '분 / 로스 ' + fmtNum(d.loss) + '분';

    const values = document.createElement('div');    // 막대 위 숫자 2개
    values.className = 'pair-values';
    const vProd = document.createElement('span'); vProd.textContent = fmtNum(d.prod);
    const vLoss = document.createElement('span'); vLoss.textContent = fmtNum(d.loss);
    values.append(vProd, vLoss);

    const plot = document.createElement('div');      // 막대 2개를 나란히
    plot.className = 'vcol-plot';
    [[d.prod, ''], [d.loss, ' loss']].forEach(([v, extra]) => {
      const fill = document.createElement('div');
      fill.className = 'vcol-fill' + extra;
      fill.style.height = (v / max * 100) + '%';
      plot.appendChild(fill);
    });

    const label = document.createElement('span');
    label.className = 'vcol-label';
    label.textContent = day.slice(5);

    col.append(values, plot, label);
    box.appendChild(col);
  });
}

/* NG 정리 표 2개(설비별, 생산 모델별)를 채웁니다. */
function renderNgSummary(records) {
  fillNgTable('ng-by-equipment', records, r => r.equipment);
  fillNgTable('ng-by-model', records, r => r.model);
}

/* keyFn 기준으로 [전체 롤, NG 롤, 불량률] 을 집계해 표 본문에 넣습니다. NG 많은 순. */
function fillNgTable(tableId, records, keyFn) {
  const map = new Map();                             // 이름 -> { total, ng }
  records.forEach(r => {
    const key = keyFn(r) || '(미입력)';
    const s = map.get(key) || { total: 0, ng: 0 };
    s.total++;
    if (r.judge === 'NG') s.ng++;
    map.set(key, s);
  });
  const list = Array.from(map, ([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.ng - a.ng || a.name.localeCompare(b.name));

  const tbody = document.querySelector('#' + tableId + ' tbody');
  tbody.textContent = '';
  list.forEach(item => {
    const tr = document.createElement('tr');
    const cells = [
      [item.name, ''], [fmtNum(item.total), 'num'],
      [fmtNum(item.ng), 'num ng-count'], [fmtPercent(item.ng / item.total * 100), 'num'],
    ];
    cells.forEach(([text, cls]) => {
      const td = document.createElement('td');
      td.textContent = text; td.className = cls;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

/* 한 칸에 보여 줄 글자 만들기 (COLUMNS 의 type 에 따라) */
function formatCell(col, value) {
  if (value === null || value === undefined || value === '') return '';
  if (col.type === 'fixed') return fmtFixed(value);
  if (col.type === 'num')   return fmtNum(value);
  return String(value);
}

/* 전체 롤 표. NG 행에는 is-ng 클래스를 붙여 배경색으로 구분합니다.
   showNgOnly 가 true 이면 NG 행만 보여 줍니다.
   값은 textContent 로 넣어, CSV 안의 특수문자가 HTML 로 해석되지 않게 합니다. */
function renderTable(records) {
  const rows = showNgOnly ? records.filter(r => r.judge === 'NG') : records;

  // 머리글
  const headRow = document.createElement('tr');
  COLUMNS.forEach(c => {
    const th = document.createElement('th');
    th.textContent = c.label;
    if (c.type === 'fixed' || c.type === 'num') th.className = 'num'; // 숫자는 오른쪽 정렬
    headRow.appendChild(th);
  });
  const thead = document.querySelector('#roll-table thead');
  thead.textContent = '';
  thead.appendChild(headRow);

  // 본문 (한 번에 모아서 붙이면 빠릅니다)
  const frag = document.createDocumentFragment();
  if (rows.length === 0) {                           // 보여 줄 행이 없을 때 안내
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = COLUMNS.length;
    td.textContent = 'NG 롤이 없습니다.';
    tr.appendChild(td);
    frag.appendChild(tr);
  }
  rows.forEach(rec => {
    const tr = document.createElement('tr');
    if (rec.judge === 'NG') tr.className = 'is-ng';
    COLUMNS.forEach(c => {
      const td = document.createElement('td');
      td.textContent = formatCell(c, rec[c.key]);
      if (c.type === 'fixed' || c.type === 'num') td.className = 'num';
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  const tbody = document.querySelector('#roll-table tbody');
  tbody.textContent = '';
  tbody.appendChild(frag);

  $('table-count').textContent = showNgOnly
    ? 'NG ' + fmtNum(rows.length) + '행 (전체 ' + fmtNum(records.length) + '행)'
    : fmtNum(records.length) + '행';
}

/* 표 필터 변경: ngOnly 가 true 면 NG만, false 면 전체. 버튼 강조도 함께 바꿉니다. */
function setFilter(ngOnly) {
  showNgOnly = ngOnly;
  document.querySelectorAll('#filter-tabs .tab').forEach(btn => {
    const active = (btn.dataset.filter === 'ng') === ngOnly;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active);
  });
  renderTable(allRecords);
}

/* 시작: 파일 선택 상자가 바뀌면 handleFile 실행 */
$('csv-input').addEventListener('change', handleFile);
/* "전체 보기 / NG만 보기" 버튼 클릭 연결 */
document.querySelectorAll('#filter-tabs .tab').forEach(btn => {
  btn.addEventListener('click', () => setFilter(btn.dataset.filter === 'ng'));
});
