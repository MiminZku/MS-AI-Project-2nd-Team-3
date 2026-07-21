let reports = [];
let sanctions = [];
let appeals = [];
let activeReportId = null;
let activeSanctionType = 'MUTE';
let dashboardLoaded = false;
let adminStream = null;
let reportPolling = null;
let seenReportIds = new Set();

const QUEUE_STATUSES = ['PENDING', 'MANUAL_REVIEW_REQUIRED', 'PENDING_HITL'];

function byId(id) {
  return document.getElementById(id);
}

function apiUrl(path) {
  return `http://172.16.30.143:3000${path}`;
}

function statusLabel(status) {
  if (status === 'PENDING') return '대기';
  if (status === 'MANUAL_REVIEW_REQUIRED') return '수동 검토 필요';
  if (status === 'PENDING_HITL') return '수동 검토 필요';
  if (status === 'COMPLETED') return '처리 완료';
  if (status === 'DISMISSED') return '신고 기각';
  if (status === 'APPROVED') return '인용';
  if (status === 'REJECTED') return '기각';
  return status || '-';
}

function reportResult(report) {
  return statusLabel(report.status);
}

function contentTypeLabel(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'voice') return '음성';
  if (normalized === 'text' || normalized === 'chat') return '채팅';
  return type || '-';
}

function badgeClass(status) {
  if (status === 'PENDING') return 'pending';
  if (status === 'MANUAL_REVIEW_REQUIRED') return 'review';
  if (status === 'PENDING_HITL') return 'review';
  if (status === 'COMPLETED') return 'done';
  if (status === 'DISMISSED') return 'dismiss';
  if (status === 'APPROVED') return 'approve';
  if (status === 'REJECTED') return 'reject';
  return 'pending';
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 19);
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function reportContent(report) {
  return report.content_text || report.reported_message || report.content_path || report.content || '(신고 내용 없음)';
}

function audioUrlForReport(report) {
  if (String(report.content_type || '').toLowerCase() !== 'voice' || !report.id) return '';
  return apiUrl(`/api/admin/reports/${report.id}/audio`);
}

function fallbackAudioUrlForReport(report) {
  if (String(report.content_type || '').toLowerCase() !== 'voice' || !report.reported_id) return '';
  return apiUrl(`/report-audio?user=${encodeURIComponent(report.reported_id || '')}`);
}

const POLICY_BY_DISPLAY_STAGE = {
  1: {
    label: '1단계',
    summary: '정상 또는 해당 없음',
    detail: '정책상 유해발언으로 보기 어렵습니다. 대상이 특정되지 않은 감정 표현, 항의, 경고, 신고 의사, 중재 발언은 원칙적으로 1단계로 봅니다.'
  },
  2: {
    label: '2단계',
    summary: '경미',
    detail: '정책상 경미한 위반입니다. 대상 미특정 짧은 비속어, 간접적 성적 암시, 가족 관계를 에둘러 언급하는 표현, 구체적 위해 없는 거친 감정 표출이 여기에 해당합니다.'
  },
  3: {
    label: '3단계',
    summary: '중간',
    detail: '정책상 중간 위반입니다. 특정 이용자를 향한 욕설·비방·모욕적 별명, 짧은 시간 내 반복, 신체 부위 직접 언급, 부모·가족 구성원 직접 비하, 대상자에 대한 직접 협박이나 위해 암시가 해당합니다.'
  },
  4: {
    label: '4단계',
    summary: '심각',
    detail: '정책상 심각한 위반입니다. 지속·반복 욕설, 명예훼손성 조롱, 차별적 비하, 성행위·신체 노출 직접 묘사, 부모·가족 대상 노골적 욕설, 살상·폭행·고문 등 잔인한 폭력 묘사가 해당합니다.'
  },
  5: {
    label: '5단계',
    summary: '최상급',
    detail: '정책상 최상급 위반입니다. 집단적 욕설, 성적·폭력적 위협 결합, 미성년자 대상 성적 언급, 성착취물 관련 언급, 고인 모독 결합 패드립, 특정 인물·장소에 대한 실제 위해 예고, 범죄 교사·방조·선동은 즉시 강한 조치와 관리자 확인이 필요합니다.'
  }
};

const POLICY_CATEGORIES = '욕설강도, 음란성발언, 패드립, 폭력성발언 4개 카테고리 중 가장 높은 정책 단계를 기준으로 표시합니다.';

function displayStageNumber(data) {
  const raw = Number(data.stage_level ?? data.display_level ?? data.final_level ?? data.level ?? data.sanction_level);
  if (!Number.isFinite(raw)) return 3;
  if (raw >= 1 && raw <= 5) return raw;
  if (raw >= 0 && raw <= 4) return raw + 1;
  return Math.max(1, Math.min(5, Math.round(raw)));
}

function policyForStage(rawLevel) {
  const policy = POLICY_BY_DISPLAY_STAGE[rawLevel] || POLICY_BY_DISPLAY_STAGE[3];
  return `${policy.label} (${policy.summary}) 정책: ${policy.detail} ${POLICY_CATEGORIES}`;
}

function showToast(message) {
  byId('toastMsg').textContent = message;
  const toast = byId('toast');
  toast.style.display = 'block';
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => { toast.style.display = 'none'; }, 2200);
}

function showLoadError(message) {
  const body = byId('reportBody');
  body.innerHTML = `<tr><td colspan="6" class="muted">${message}</td></tr>`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(apiUrl(url), {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function loadDashboard() {
  const [allReports, allSanctions, allAppeals] = await Promise.all([
    requestJson('/api/admin/reports'),
    requestJson('/api/admin/sanctions'),
    requestJson('/api/admin/appeals')
  ]);
  reports = Array.isArray(allReports) ? allReports : [];
  sanctions = Array.isArray(allSanctions) ? allSanctions : [];
  appeals = Array.isArray(allAppeals) ? allAppeals : [];
  if (!dashboardLoaded && seenReportIds.size === 0) rememberSeenReports(reports);
  dashboardLoaded = true;
  updateSummary();
  renderReports();
  renderSanctions();
  renderAppeals();
}

async function refreshDashboard() {
  try {
    await loadDashboard();
    showPendingAlert();
  } catch (error) {
    showLoadError(`대시보드 데이터를 불러오지 못했습니다: ${error.message}`);
  }
}

function parseStreamEvent(event) {
  if (!event.data) return null;
  try {
    return JSON.parse(event.data);
  } catch (error) {
    console.warn('관리자 실시간 이벤트를 해석하지 못했습니다.', error);
    return null;
  }
}

function rememberSeenReports(nextReports = reports) {
  nextReports.forEach((report) => {
    const reportId = Number(report.id ?? report.report_id);
    if (Number.isFinite(reportId)) seenReportIds.add(reportId);
  });
}

function findNewReports(nextReports) {
  return nextReports.filter((report) => {
    const reportId = Number(report.id ?? report.report_id);
    return Number.isFinite(reportId) && !seenReportIds.has(reportId);
  });
}

async function openReviewSheetFromAlert(reportId, panel) {
  await refreshDashboard();
  const numericReportId = Number(reportId);
  if (!Number.isFinite(numericReportId)) return;
  const report = reports.find((item) => Number(item.id) === numericReportId);
  if (!report) {
    showToast('신고 상세를 찾지 못했습니다. 목록을 새로고침해 주세요.');
    return;
  }
  if (panel) panel.style.display = 'none';
  openReviewSheet(numericReportId);
}

function hitlStageLabel(data) {
  const displayLevel = displayStageNumber(data);
  const policy = POLICY_BY_DISPLAY_STAGE[displayLevel] || POLICY_BY_DISPLAY_STAGE[3];
  if (data.confidence !== undefined && data.confidence !== null) {
    return `${policy.label} · ${policy.summary} · 신뢰도 ${Math.round(Number(data.confidence) * 100)}%`;
  }
  return `${policy.label} · ${policy.summary}`;
}

function showReportAlert(message, options = {}) {
  const data = message.data || message;
  const panel = byId('alertPanel');
  const reportId = Number(data.report_id ?? data.id);
  const reporter = data.reporter || data.reporter_id || '-';
  const target = data.target || data.target_user_id || data.reported_id || '-';
  const content = data.text || data.content_text || data.content_path || data.content || '(신고 내용 없음)';
  const stage = hitlStageLabel(data);
  const policy = policyForStage(displayStageNumber(data));
  panel.classList.toggle('hitl', Boolean(options.hitl));
  byId('alertTitle').textContent = '새 신고 접수';
  byId('alertMeta').textContent = `#${reportId || '-'} · 신고자 ${reporter} → 대상 ${target}`;
  byId('alertContent').textContent = content;
  byId('alertStageBox').style.display = 'grid';
  byId('alertStage').textContent = stage;
  byId('alertReasonBox').style.display = 'block';
  byId('alertReason').textContent = policy;
  byId('alertReview').textContent = options.hitl ? '바로 검토' : '수동 검토';
  byId('alertReview').onclick = () => openReviewSheetFromAlert(reportId, panel);
  byId('alertDismiss').onclick = () => { panel.style.display = 'none'; };
  panel.style.display = 'block';
  showToast(options.hitl ? '수동 검토가 필요한 신고가 들어왔습니다.' : '새 신고가 접수되었습니다.');
}

async function handleAdminStreamMessage(event) {
  const message = parseStreamEvent(event);
  await refreshDashboard();
  if (message && message.type === 'new_report') {
    showReportAlert(message, { forceStage: true });
  }
  if (message && message.type === 'new_hitl') {
    showReportAlert(message, { hitl: true });
  }
}

function bindReportPolling() {
  // SSE (Server-Sent Events) 스트림을 전적으로 사용하므로 3초 주기 HTTP 폴링은 비활성화합니다.
  if (reportPolling) {
    clearInterval(reportPolling);
    reportPolling = null;
  }
}

function bindAdminStream() {
  if (!window.EventSource || adminStream) return;
  adminStream = new EventSource(apiUrl('/api/admin/stream'));
  adminStream.onmessage = handleAdminStreamMessage;
  adminStream.onerror = () => {
    showToast('실시간 연결이 끊겼습니다. 브라우저가 자동으로 재연결을 시도합니다.');
  };
}

function showPendingAlert() {
  const panel = byId('alertPanel');
  const report = reports.find((r) => QUEUE_STATUSES.includes(r.status));
  if (!report) {
    panel.style.display = 'none';
    return;
  }
  byId('alertMeta').textContent = `#${report.id} · ${report.reporter_id} → ${report.reported_id}`;
  byId('alertContent').textContent = reportContent(report);
  byId('alertTitle').textContent = '새 신고 접수';
  byId('alertStageBox').style.display = 'grid';
  byId('alertStage').textContent = '3단계 · 중간';
  byId('alertReasonBox').style.display = 'block';
  byId('alertReason').textContent = policyForStage(3);
  byId('alertReview').textContent = ['MANUAL_REVIEW_REQUIRED', 'PENDING_HITL'].includes(report.status) ? '바로 검토' : '수동 검토';
  panel.classList.toggle('hitl', ['MANUAL_REVIEW_REQUIRED', 'PENDING_HITL'].includes(report.status));
  panel.style.display = 'block';
  byId('alertReview').onclick = () => openReviewSheetFromAlert(report.id, panel);
  byId('alertDismiss').onclick = () => { panel.style.display = 'none'; };
}

function renderReports() {
  const status = byId('reportStatusFilter').value;
  const sort = byId('reportSort').value;
  const query = byId('reportSearch').value.trim().toLowerCase();
  const rows = reports.filter((report) => {
    const haystack = `${report.reporter_id} ${report.reported_id} ${reportResult(report)} ${contentTypeLabel(report.content_type)} ${reportContent(report)}`.toLowerCase();
    return (status === 'all' || report.status === status) && (!query || haystack.includes(query));
  });
  rows.sort((a, b) => {
    const left = new Date(a.created_at || 0).getTime() || 0;
    const right = new Date(b.created_at || 0).getTime() || 0;
    return sort === 'oldest' ? left - right : right - left;
  });

  byId('reportBody').innerHTML = rows.map((report) => (
    `<tr>
      <td>#${report.id}</td>
      <td>${formatDateTime(report.created_at)}</td>
      <td><span class="badge ${String(report.content_type || '').toLowerCase() === 'voice' ? 'voice' : 'text'}">${contentTypeLabel(report.content_type)}</span></td>
      <td>${report.reporter_id || '-'}</td>
      <td>${report.reported_id || '-'}</td>
      <td><button class="status-btn badge ${badgeClass(report.status)}" type="button" onclick="openReviewSheet(${report.id})">${reportResult(report)}</button></td>
    </tr>`
  )).join('');

  if (!rows.length) {
    byId('reportBody').innerHTML = '<tr><td colspan="6" class="muted">표시할 신고가 없습니다.</td></tr>';
  }
}

function renderSanctions() {
  const type = byId('sanctionTypeFilter').value;
  const query = byId('sanctionSearch').value.trim().toLowerCase();
  const rows = sanctions.filter((sanction) => {
    const haystack = `${sanction.user_id} ${sanction.ai_result}`.toLowerCase();
    return (type === 'all' || sanction.type === type) && (!query || haystack.includes(query));
  });

  byId('sanctionBody').innerHTML = rows.map((sanction) => (
    `<tr>
      <td>#${sanction.id}</td>
      <td>${formatDateTime(sanction.created_at)}</td>
      <td>${sanction.user_id || '-'}</td>
      <td>${sanction.ai_result || '-'}</td>
      <td><span class="badge ${sanction.type === 'MUTE' ? 'mute' : 'ban'}">${sanction.type || '-'}</span></td>
      <td>${sanction.duration_days ?? 0}일</td>
    </tr>`
  )).join('');

  if (!rows.length) {
    byId('sanctionBody').innerHTML = '<tr><td colspan="6" class="muted">표시할 제재 내역이 없습니다.</td></tr>';
  }
}

function renderAppeals() {
  const status = byId('appealStatusFilter').value;
  const query = byId('appealSearch').value.trim().toLowerCase();
  const rows = appeals.filter((appeal) => {
    const haystack = `${appeal.user_id} ${appeal.reason}`.toLowerCase();
    return (status === 'all' || appeal.status === status) && (!query || haystack.includes(query));
  });

  byId('appealBody').innerHTML = rows.map((appeal) => (
    `<tr>
      <td>#${appeal.id}</td>
      <td>#${appeal.report_id}</td>
      <td>${appeal.user_id || '-'}</td>
      <td>${appeal.reason || '-'}</td>
      <td><span class="badge ${badgeClass(appeal.status)}">${statusLabel(appeal.status)}</span></td>
    </tr>`
  )).join('');

  if (!rows.length) {
    byId('appealBody').innerHTML = '<tr><td colspan="5" class="muted">표시할 이의신청이 없습니다.</td></tr>';
  }
}

function updateSummary() {
  const today = new Date().toISOString().slice(0, 10);
  byId('statToday').textContent = reports.filter((report) => String(report.created_at || '').slice(0, 10) === today).length || reports.length;
  byId('statPending').textContent = reports.filter((report) => QUEUE_STATUSES.includes(report.status)).length;
  byId('statDone').textContent = reports.filter((report) => ['COMPLETED', 'DISMISSED'].includes(report.status)).length;
  byId('statSanction').textContent = sanctions.length;
}

function setSanctionPills(type) {
  activeSanctionType = type;
  byId('sheetSanctionType').value = type;
  byId('sheetDurationDays').value = type === 'BAN' ? 30 : 7;
}

function openReviewSheet(reportId) {
  activeReportId = reportId;
  const report = reports.find((item) => item.id === reportId);
  if (!report) return;
  byId('sheetHead').textContent = `신고 접수 #${report.id}`;
  byId('sheetSub').textContent = `${report.reporter_id} → ${report.reported_id}`;
  byId('sheetReportTime').textContent = formatDateTime(report.created_at);
  byId('sheetUsers').textContent = `${report.reporter_id} / ${report.reported_id}`;
  byId('sheetContent').textContent = reportContent(report);
  const audioUrl = audioUrlForReport(report);
  const fallbackAudioUrl = fallbackAudioUrlForReport(report);
  byId('sheetAudioStatus').textContent = '';
  byId('sheetAudio').onerror = () => {
    if (fallbackAudioUrl && byId('sheetAudio').src !== fallbackAudioUrl) {
      byId('sheetAudio').src = fallbackAudioUrl;
      byId('sheetAudioLink').href = fallbackAudioUrl;
      byId('sheetAudioStatus').textContent = '신고 ID 기반 파일을 찾지 못해 최신 녹음 조회로 다시 시도합니다.';
      return;
    }
    byId('sheetAudioStatus').textContent = '음성 파일을 찾을 수 없습니다. 백엔드 재시작 또는 녹음 업로드 상태를 확인해 주세요.';
  };
  byId('sheetAudioRow').style.display = audioUrl ? 'block' : 'none';
  byId('sheetAudio').src = audioUrl;
  byId('sheetAudioLink').href = audioUrl;
  byId('sheetReason').value = report.review_reason || '';
  setSanctionPills('MUTE');
  byId('sheetOverlay').style.display = 'flex';
}

function closeReviewSheet() {
  byId('sheetAudio').onerror = null;
  byId('sheetAudioStatus').textContent = '';
  byId('sheetAudio').pause();
  byId('sheetAudio').removeAttribute('src');
  byId('sheetAudio').load();
  byId('sheetOverlay').style.display = 'none';
  activeReportId = null;
}

function sanctionTypeForBackend(type, durationDays) {
  if (type === 'BAN') return 'ban_perm';
  if (type === 'MUTE' && durationDays <= 1) return 'mute_1d';
  return 'mute_7d';
}

async function applyDecision() {
  const report = reports.find((item) => item.id === activeReportId);
  if (!report) return;
  const reason = byId('sheetReason').value.trim() || '관리자 대시보드 수동 처리';
  const durationDays = Number(byId('sheetDurationDays').value) || 7;

  try {
    if (activeSanctionType === 'DISMISS') {
      await requestJson(`/api/admin/reports/${report.id}/dismiss`, {
        method: 'POST',
        body: JSON.stringify({ reason, reviewer_id: 'admin' })
      });
      showToast('신고를 기각했습니다.');
    } else {
      await requestJson(`/api/admin/reports/${report.id}/sanction`, {
        method: 'POST',
        body: JSON.stringify({
          sanction_type: sanctionTypeForBackend(activeSanctionType, durationDays),
          reason,
          reviewer_id: 'admin'
        })
      });
      showToast('제재를 적용했습니다.');
    }
    closeReviewSheet();
    await refreshDashboard();
  } catch (error) {
    showToast(`처리에 실패했습니다: ${error.message}`);
  }
}

async function handleLogin() {
  const id = byId('loginId').value.trim();
  const pw = byId('loginPw').value.trim();
  const msg = byId('loginMsg');
  if (id === 'admin01' && pw === 'admin1234') {
    msg.textContent = '';
    byId('loginScreen').style.display = 'none';
    byId('dashboardWrap').style.display = 'block';
    if (!dashboardLoaded) await refreshDashboard();
    showPendingAlert();
  } else {
    msg.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
  }
}

function bindEvents() {
  byId('loginBtn').addEventListener('click', handleLogin);
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      byId(tab.dataset.tab).classList.add('active');
    });
  });
  ['reportStatusFilter', 'reportSort', 'reportSearch'].forEach((id) => byId(id).addEventListener('input', renderReports));
  byId('reportStatusFilter').addEventListener('change', renderReports);
  byId('reportSort').addEventListener('change', renderReports);
  ['sanctionTypeFilter', 'sanctionSearch'].forEach((id) => byId(id).addEventListener('input', renderSanctions));
  byId('sanctionTypeFilter').addEventListener('change', renderSanctions);
  ['appealStatusFilter', 'appealSearch'].forEach((id) => byId(id).addEventListener('input', renderAppeals));
  byId('appealStatusFilter').addEventListener('change', renderAppeals);
  byId('sheetSanctionType').addEventListener('change', (event) => setSanctionPills(event.target.value));
  byId('sheetClose').addEventListener('click', closeReviewSheet);
  byId('sheetApply').addEventListener('click', applyDecision);
  byId('sheetOverlay').addEventListener('click', (event) => {
    if (event.target.id === 'sheetOverlay') closeReviewSheet();
  });
}

window.openReviewSheet = openReviewSheet;

bindEvents();
bindAdminStream();
bindReportPolling();
updateSummary();
renderReports();
renderSanctions();
renderAppeals();
refreshDashboard();
