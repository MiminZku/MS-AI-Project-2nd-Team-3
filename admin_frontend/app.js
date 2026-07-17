const loginAccount = {
  id: 'admin01',
  password: 'admin1234',
};

const reports = [
  {
    id: 'RPT-20260716-001',
    targetPlayer: 'DarkRush77',
    reporter: 'LunaBlade',
    reason: '욕설',
    gameMode: 'Aether Arena / 랭크전',
    aiRisk: '높음',
    reportCount: 7,
    status: '미처리',
    manager: '관리자A',
    severity: '심각',
    categories: ['가족 비하', '반복 욕설', '팀원 모욕'],
    logs: [
      '14:02 DarkRush77: 너 때문에 졌잖아. 게임 접어라.',
      '14:03 DarkRush77: 모욕성 표현을 반복 사용',
      '14:04 LunaBlade: 신고합니다. 그만하세요.',
    ],
    history: ['2026-07-12 채팅 제한 1일', '2026-07-08 경고'],
    evidence: ['채팅 로그 3건', '신고자 스크린샷 1장', '매치 ID #84920'],
    suggestedAction: '채팅 제한 7일',
  },
  {
    id: 'RPT-20260716-002',
    targetPlayer: 'GoldFarmPro',
    reporter: 'MintHealer',
    reason: '스팸',
    gameMode: 'World Chat / 전체 채팅',
    aiRisk: '중간',
    reportCount: 4,
    status: '미처리',
    manager: '관리자B',
    severity: '주의',
    categories: ['상업 홍보', '외부 링크', '반복 메시지'],
    logs: [
      '13:21 GoldFarmPro: 빠른 레벨업 대행 문의',
      '13:22 GoldFarmPro: 동일 홍보 문구 3회 반복',
      '13:23 GoldFarmPro: 외부 링크 공유',
    ],
    history: ['제재 이력 없음'],
    evidence: ['채팅 로그 6건', '외부 링크 탐지 결과'],
    suggestedAction: '경고',
  },
  {
    id: 'RPT-20260716-003',
    targetPlayer: 'QueueGhost',
    reporter: 'BlueComet',
    reason: '어뷰징',
    gameMode: 'Battle Rush / 경쟁전',
    aiRisk: '매우 높음',
    reportCount: 12,
    status: '미처리',
    manager: '관리자A',
    severity: '매우 심각',
    categories: ['고의 패배', '반복 탈주', '매칭 악용'],
    logs: [
      '12:51 QueueGhost: 이번 판은 그냥 던질게',
      '12:53 동일 파티 계정과 5회 연속 매칭',
      '12:56 전투 참여 없이 리스폰 지역 대기',
    ],
    history: ['2026-07-10 게임 제한 3일', '2026-07-01 경고'],
    evidence: ['게임 기록 2건', '매칭 로그', '전투 참여율 0%'],
    suggestedAction: '게임 제한 15일',
  },
  {
    id: 'RPT-20260715-014',
    targetPlayer: 'MacroRunner',
    reporter: 'IronToast',
    reason: '어뷰징',
    gameMode: 'Dungeon Raid / 이벤트 던전',
    aiRisk: '매우 높음',
    reportCount: 19,
    status: '처리완료',
    manager: '관리자C',
    severity: '매우 심각',
    categories: ['자동 입력', '비정상 반복 행동'],
    logs: [
      '19:20 0.7초 간격으로 동일 행동 반복',
      '19:25 전투 상황 변화에도 입력 패턴 동일',
      '19:31 이전 동일 유형 제재 3회 확인',
    ],
    history: ['2026-07-13 영구 정지'],
    evidence: ['행동 로그 120건', '자동 입력 탐지 리포트'],
    suggestedAction: '영구 정지',
  },
];

const state = {
  filter: 'all',
  reason: 'all',
  search: '',
  selectedId: reports[0].id,
};

const riskClassMap = {
  낮음: 'low',
  중간: 'medium',
  높음: 'high',
  '매우 높음': 'critical',
};

function getFilteredReports() {
  return reports.filter((report) => {
    const matchesFilter =
      state.filter === 'all' ||
      (state.filter === 'pending' && report.status === '미처리') ||
      (state.filter === 'completed' && report.status === '처리완료') ||
      (state.filter === 'high' && ['높음', '매우 높음'].includes(report.aiRisk));
    const matchesReason = state.reason === 'all' || report.reason === state.reason;
    const keyword = `${report.id} ${report.targetPlayer} ${report.reporter}`.toLowerCase();
    const matchesSearch = keyword.includes(state.search.toLowerCase());

    return matchesFilter && matchesReason && matchesSearch;
  });
}

function renderSummary() {
  const todayReports = reports.filter((report) => report.id.includes('20260716'));
  const pendingReports = reports.filter((report) => report.status === '미처리');
  const highRiskReports = reports.filter((report) => ['높음', '매우 높음'].includes(report.aiRisk));
  const completedReports = reports.filter((report) => report.status === '처리완료');

  document.querySelector('#todayCount').textContent = todayReports.length;
  document.querySelector('#pendingCount').textContent = pendingReports.length;
  document.querySelector('#highRiskCount').textContent = highRiskReports.length;
  document.querySelector('#avgTime').textContent = '18분';
  document.querySelector('#sanctionRate').textContent = `${Math.round((completedReports.length / reports.length) * 100)}%`;
}

function renderQueue() {
  const rows = getFilteredReports();
  const tbody = document.querySelector('#reportRows');

  tbody.innerHTML = rows.map((report) => `
    <tr class="${report.id === state.selectedId ? 'selected' : ''}" data-report-id="${report.id}">
      <td><strong>${report.id}</strong></td>
      <td>${report.targetPlayer}</td>
      <td>${report.reason}</td>
      <td>${report.gameMode}</td>
      <td><span class="badge ${riskClassMap[report.aiRisk]}">${report.aiRisk}</span></td>
      <td>${report.reportCount}회</td>
      <td><span class="badge ${report.status === '미처리' ? 'pending' : 'completed'}">${report.status}</span></td>
      <td>${report.manager}</td>
    </tr>
  `).join('');

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8">조건에 맞는 신고가 없습니다.</td></tr>';
  }
}

function renderDetail() {
  const report = reports.find((item) => item.id === state.selectedId) || getFilteredReports()[0] || reports[0];
  state.selectedId = report.id;

  document.querySelector('#detailPanel').innerHTML = `
    <p class="eyebrow">신고 상세</p>
    <h2>${report.targetPlayer}</h2>
    <p class="muted">${report.id} · ${report.gameMode}</p>

    <section class="detail-section">
      <h3>채팅 로그 / 게임 기록</h3>
      <ul class="log-list">${report.logs.map((log) => `<li>${log}</li>`).join('')}</ul>
    </section>

    <section class="detail-section">
      <h3>신고자·피신고자 정보</h3>
      <div class="info-grid">
        <div><span>신고자</span><strong>${report.reporter}</strong></div>
        <div><span>피신고자</span><strong>${report.targetPlayer}</strong></div>
        <div><span>담당자</span><strong>${report.manager}</strong></div>
        <div><span>신고 횟수</span><strong>${report.reportCount}회</strong></div>
      </div>
    </section>

    <section class="detail-section">
      <h3>과거 제재 이력</h3>
      <ul class="history-list">${report.history.map((item) => `<li>${item}</li>`).join('')}</ul>
    </section>

    <section class="detail-section">
      <h3>유해발언 카테고리 / 심각도</h3>
      <div class="info-grid">
        <div><span>카테고리</span><strong>${report.categories.join(', ')}</strong></div>
        <div><span>심각도</span><strong>${report.severity}</strong></div>
        <div><span>AI 위험도</span><strong>${report.aiRisk}</strong></div>
        <div><span>추천 조치</span><strong>${report.suggestedAction}</strong></div>
      </div>
    </section>

    <section class="detail-section">
      <h3>증거 자료</h3>
      <ul class="evidence-list">${report.evidence.map((item) => `<li>${item}</li>`).join('')}</ul>
    </section>

    <section class="detail-section">
      <h3>제재 처리</h3>
      <div class="action-grid">
        <button type="button" data-action="경고">경고</button>
        <button type="button" data-action="채팅 제한">채팅 제한</button>
        <button type="button" data-action="게임 제한">게임 제한</button>
        <button class="danger" type="button" data-action="영구 정지">영구 정지</button>
      </div>
    </section>
  `;
}

function render() {
  renderSummary();
  renderQueue();
  renderDetail();
}

document.querySelector('#loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const adminId = String(form.get('adminId') || '');
  const password = String(form.get('password') || '');

  if (adminId !== loginAccount.id || password !== loginAccount.password) {
    document.querySelector('#loginError').textContent = '운영자 ID 또는 비밀번호가 올바르지 않습니다.';
    return;
  }

  document.querySelector('#loginScreen').hidden = true;
  document.querySelector('#dashboard').hidden = false;
  render();
});

document.querySelectorAll('nav button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.filter = button.dataset.filter;
    state.selectedId = getFilteredReports()[0]?.id || reports[0].id;
    render();
  });
});

document.querySelector('#reasonFilter').addEventListener('change', (event) => {
  state.reason = event.target.value;
  state.selectedId = getFilteredReports()[0]?.id || reports[0].id;
  render();
});

document.querySelector('#searchInput').addEventListener('input', (event) => {
  state.search = event.target.value;
  state.selectedId = getFilteredReports()[0]?.id || reports[0].id;
  render();
});

document.querySelector('#reportRows').addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-report-id]');
  if (!row) return;
  state.selectedId = row.dataset.reportId;
  render();
});

document.querySelector('#detailPanel').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const report = reports.find((item) => item.id === state.selectedId);
  if (!report) return;
  report.status = '처리완료';
  report.suggestedAction = button.dataset.action;
  render();
});
