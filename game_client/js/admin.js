/* ═══════════════════════════════════════════════════════
   ADMIN DASHBOARD — DB 스키마 기반 데이터 & 로직
   (실제 서비스에서는 서버 API 응답으로 대체 가능)
═══════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const REPORT_STATUS_LABELS = {
  PENDING: '대기',
  COMPLETED: '처리 완료',
  MANUAL_REVIEW_REQUIRED: '수동 검토 필요',
  DISMISSED: '신고 취소',
};
const SANCTION_TYPE_LABELS = {
  MUTE: '채팅 금지',
  BAN: '계정 정지',
};
const APPEAL_STATUS_LABELS = {
  PENDING: '대기',
  APPROVED: '인용',
  REJECTED: '기각',
};
const SLA_WARN_MIN = 15, SLA_DANGER_MIN = 60;
const now = Date.now();
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

let reports = [
  {
    id: 101,
    created_at: now - 6 * MIN,
    reporter_id: 'user_01',
    reported_id: 'user_02',
    status: 'PENDING',
    content_type: 'TEXT',
    content_path: '욕설/비하 발언: "병신아 니가 비켜"',
    reviewed_at: null,
    reviewed_by: null,
    review_result: null,
  },
  {
    id: 102,
    created_at: now - 40 * MIN,
    reporter_id: 'user_03',
    reported_id: 'user_04',
    status: 'MANUAL_REVIEW_REQUIRED',
    content_type: 'TEXT',
    content_path: '매크로 사용 의심 패턴 로그 첨부',
    reviewed_at: null,
    reviewed_by: null,
    review_result: null,
  },
  {
    id: 103,
    created_at: now - 90 * MIN,
    reporter_id: 'user_05',
    reported_id: 'user_06',
    status: 'PENDING',
    content_type: 'VOICE',
    content_path: '/uploads/voice/report_103.wav',
    reviewed_at: null,
    reviewed_by: null,
    review_result: null,
  },
  {
    id: 104,
    created_at: now - 5 * HOUR,
    reporter_id: 'user_07',
    reported_id: 'user_02',
    status: 'COMPLETED',
    content_type: 'TEXT',
    content_path: '반복적 욕설 및 비하 발언',
    reviewed_at: now - 4 * HOUR,
    reviewed_by: 'CS_민지',
    review_result: '욕설 3단계, 채팅 제한 7일',
  },
  {
    id: 105,
    created_at: now - 1 * DAY,
    reporter_id: 'user_08',
    reported_id: 'user_09',
    status: 'DISMISSED',
    content_type: 'TEXT',
    content_path: '오해로 확인된 단순 발언',
    reviewed_at: now - 23 * HOUR,
    reviewed_by: 'CS_현우',
    review_result: '허위 신고로 판단되어 취소',
  },
];

let sanctions = [
  {
    id: 1,
    created_at: now - 4 * HOUR,
    user_id: 'user_02',
    ai_result: '욕설 3단계',
    type: 'MUTE',
    duration_days: 7,
    ended_at: now + 7 * DAY,
  },
  {
    id: 2,
    created_at: now - 2 * DAY,
    user_id: 'user_04',
    ai_result: '매크로 사용 의심',
    type: 'BAN',
    duration_days: 30,
    ended_at: null,
  },
];

let appeals = [
  {
    id: 1,
    report_id: 101,
    user_id: 'user_02',
    reason: '허위 신고로 판단됨',
    status: 'PENDING',
    created_at: now - 30 * MIN,
  },
  {
    id: 2,
    report_id: 105,
    user_id: 'user_09',
    reason: '신고 사유가 불충분함',
    status: 'REJECTED',
    created_at: now - 1 * DAY,
  },
];

let activeTab = 'queue';
let sanctionTargetId = null, dismissTargetId = null;

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function initials(name) {
  return String(name).replace(/[^가-힣a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '??';
}
function fmtElapsed(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / MIN);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 ${m % 60}분`;
  return `${Math.floor(h / 24)}일 ${h % 24}시간`;
}
function fmtDateTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function getReportStatusText(status) {
  return REPORT_STATUS_LABELS[status] || status;
}
function getSanctionTypeLabel(type) {
  return SANCTION_TYPE_LABELS[type] || type;
}
function getAppealStatusText(status) {
  return APPEAL_STATUS_LABELS[status] || status;
}
function isSanctionActive(item) {
  return !item.ended_at || new Date(item.ended_at).getTime() > Date.now();
}
function slaClass(ts) {
  const m = (Date.now() - ts) / MIN;
  if (m >= SLA_DANGER_MIN) return 'danger';
  if (m >= SLA_WARN_MIN) return 'warn';
  return 'ok';
}
function renderStats() {
  const pendingReports = reports.filter(r => ['PENDING', 'MANUAL_REVIEW_REQUIRED'].includes(r.status));
  const handledToday = reports.filter(r => ['COMPLETED', 'DISMISSED'].includes(r.status) && (Date.now() - (r.reviewed_at || r.created_at)) < DAY);
  const pendingAppeals = appeals.filter(a => a.status === 'PENDING');
  const activeSanctions = sanctions.filter(isSanctionActive);
  const avgMin = handledToday.length
    ? Math.round(handledToday.reduce((sum, r) => sum + Math.max(0, (r.reviewed_at || r.created_at) - r.created_at), 0) / handledToday.length / MIN)
    : 0;

  $('statTotalToday').textContent = reports.filter(r => (Date.now() - r.created_at) < DAY).length;
  $('statPending').textContent = pendingReports.length;
  $('statPendingSub').textContent = pendingAppeals.length > 0 ? `⚠ ${pendingAppeals.length}건 이의 신청` : '이의 신청 없음';
  $('statHandledToday').textContent = handledToday.length;
  $('statAvgTime').textContent = handledToday.length ? `${avgMin}분` : '—';
  $('queueCount').textContent = pendingReports.length;
  $('queueCount').classList.toggle('zero', pendingReports.length === 0);
}
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.adm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('queuePanel').style.display = tab === 'queue' ? '' : 'none';
  $('historyPanel').style.display = tab === 'history' ? '' : 'none';
  $('sanctionsPanel').style.display = tab === 'sanctions' ? '' : 'none';
  $('appealsPanel').style.display = tab === 'appeals' ? '' : 'none';
}
function renderQueue() {
  let list = reports.filter(r => ['PENDING', 'MANUAL_REVIEW_REQUIRED'].includes(r.status));
  const statusF = $('qFilterStatus').value;
  const typeF = $('qFilterType').value;
  const search = $('qSearch').value.trim().toLowerCase();

  if (statusF !== 'all') list = list.filter(r => r.status === statusF);
  if (typeF !== 'all') list = list.filter(r => r.content_type === typeF);
  if (search) list = list.filter(r => [r.id, r.reporter_id, r.reported_id, r.content_path].join(' ').toLowerCase().includes(search));

  const sort = $('qSort').value;
  if (sort === 'oldest') list.sort((a, b) => a.created_at - b.created_at);
  else list.sort((a, b) => b.created_at - a.created_at);

  const wrap = $('queueList');
  if (!list.length) {
    wrap.innerHTML = '<div class="q-empty">조건에 맞는 대기 중인 신고가 없습니다.</div>';
    return;
  }

  wrap.innerHTML = list.map(r => {
    const sla = slaClass(r.created_at);
    return `
    <div class="q-card ${sla === 'danger' ? 'sla-danger' : ''}">
      <div class="q-card-top">
        <div class="q-user">
          <div class="q-avatar">${initials(r.reported_id)}</div>
          <div>
            <div class="q-username">신고 #${escHtml(r.id)} · ${escHtml(r.reported_id)}</div>
            <div class="q-meta">신고자 ${escHtml(r.reporter_id)} · ${r.content_type === 'VOICE' ? '🎙 음성' : '💬 텍스트'}</div>
          </div>
        </div>
        <div class="q-badges">
          <span class="q-reason-tag" style="color:var(--accent); border-color:var(--accent); background:var(--accent-glow);">${getReportStatusText(r.status)}</span>
          <span class="q-sla ${sla}">${fmtElapsed(r.created_at)} 경과</span>
        </div>
      </div>
      <div class="q-context">
        <div class="q-ctx-line flagged">
          <span class="q-ctx-name">원문/경로</span>
          <div class="q-ctx-text">${escHtml(r.content_path || '내용 없음')}</div>
        </div>
        <div class="q-ctx-line">
          <span class="q-ctx-name">접수 시각</span><span class="q-ctx-time">${fmtDateTime(r.created_at)}</span>
          <div class="q-ctx-text">${getReportStatusText(r.status)} 상태로 접수됨</div>
        </div>
      </div>
      <div class="q-footer">
        <div class="q-history-note">DB 기준: reports 테이블의 ${escHtml(r.status)} 상태</div>
        <div class="q-actions">
          <button class="btn btn-dismiss" onclick="openDismissModal('${r.id}')">수동 검토</button>
          <button class="btn btn-sanction" onclick="openSanctionModal('${r.id}')">제재 처리</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function renderHistory() {
  let list = reports.filter(r => ['COMPLETED', 'DISMISSED'].includes(r.status));
  const periodF = $('hFilterPeriod').value;
  const resultF = $('hFilterResult').value;
  const search = $('hSearch').value.trim().toLowerCase();

  if (periodF !== 'all') {
    const span = periodF === 'today' ? DAY : periodF === '7d' ? 7 * DAY : 30 * DAY;
    list = list.filter(r => (Date.now() - (r.reviewed_at || r.created_at)) < span);
  }
  if (resultF !== 'all') list = list.filter(r => r.status === resultF);
  if (search) list = list.filter(r => [r.reported_id, r.reviewed_by, r.review_result].join(' ').toLowerCase().includes(search));

  list.sort((a, b) => (b.reviewed_at || b.created_at) - (a.reviewed_at || a.created_at));

  const tbody = $('historyBody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="q-empty">조건에 맞는 완료 내역이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(r => `
    <tr onclick="openDetailModal('${r.id}')">
      <td>${fmtDateTime(r.reviewed_at || r.created_at)}</td>
      <td>#${escHtml(r.id)}</td>
      <td>${escHtml(r.reported_id)}</td>
      <td>${escHtml(r.reporter_id)}</td>
      <td><span class="result-tag ${r.status === 'COMPLETED' ? 'sanctioned' : 'dismissed'}">${r.status === 'COMPLETED' ? '제재 처리' : '신고 취소'}</span></td>
      <td>${escHtml(r.reviewed_by || '—')}</td>
    </tr>`).join('');
}
function renderSanctions() {
  let list = [...sanctions];
  const typeF = $('sFilterType').value;
  const search = $('sSearch').value.trim().toLowerCase();
  if (typeF !== 'all') list = list.filter(s => s.type === typeF);
  if (search) list = list.filter(s => [s.user_id, s.ai_result, s.type].join(' ').toLowerCase().includes(search));
  list.sort((a, b) => b.created_at - a.created_at);

  const tbody = $('sanctionsBody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="q-empty">조건에 맞는 제재 내역이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(s => `
    <tr>
      <td>#${escHtml(s.id)}</td>
      <td>${escHtml(s.user_id)}</td>
      <td>${escHtml(s.ai_result)}</td>
      <td>${getSanctionTypeLabel(s.type)}${s.duration_days ? ` · ${s.duration_days}일` : ''}</td>
      <td>${s.duration_days ? `${s.duration_days}일` : '—'}</td>
      <td>${s.ended_at ? fmtDateTime(s.ended_at) : '영구'}</td>
    </tr>`).join('');
}
function renderAppeals() {
  let list = [...appeals];
  const statusF = $('aFilterStatus').value;
  const search = $('aSearch').value.trim().toLowerCase();
  if (statusF !== 'all') list = list.filter(a => a.status === statusF);
  if (search) list = list.filter(a => [a.user_id, a.reason, a.report_id].join(' ').toLowerCase().includes(search));
  list.sort((a, b) => b.created_at - a.created_at);

  const tbody = $('appealsBody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="q-empty">조건에 맞는 이의 신청이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(a => `
    <tr>
      <td>#${escHtml(a.id)}</td>
      <td>#${escHtml(a.report_id)}</td>
      <td>${escHtml(a.user_id)}</td>
      <td>${escHtml(a.reason)}</td>
      <td>${getAppealStatusText(a.status)}</td>
      <td>${fmtDateTime(a.created_at)}</td>
    </tr>`).join('');
}
function openSanctionModal(id) {
  sanctionTargetId = Number(id);
  const r = reports.find(x => x.id === sanctionTargetId);
  $('sanctionTargetName').textContent = r ? r.reported_id : '';
  $('sanctionReasonText').value = '';
  $('sanctionType').value = 'MUTE';
  $('sanctionOverlay').classList.add('open');
}
function closeSanctionModal() {
  $('sanctionOverlay').classList.remove('open');
  sanctionTargetId = null;
}
function confirmSanction() {
  const r = reports.find(x => x.id === sanctionTargetId);
  if (!r) return;
  const type = $('sanctionType').value;
  const reasonText = $('sanctionReasonText').value.trim();
  sanctions.unshift({
    id: sanctions.length ? sanctions[0].id + 1 : 1,
    created_at: Date.now(),
    user_id: r.reported_id,
    ai_result: reasonText || `${getSanctionTypeLabel(type)} 처리`,
    type,
    duration_days: type === 'BAN' ? 30 : 7,
    ended_at: type === 'BAN' ? null : Date.now() + 7 * DAY,
  });
  r.status = 'COMPLETED';
  r.reviewed_by = CURRENT_ADMIN;
  r.reviewed_at = Date.now();
  r.review_result = reasonText || `${getSanctionTypeLabel(type)} 처리`;
  closeSanctionModal();
  showToast(`${r.reported_id}님에게 "${getSanctionTypeLabel(type)}" 처리를 완료했습니다.`);
  renderAll();
}
function openDismissModal(id) {
  dismissTargetId = Number(id);
  const r = reports.find(x => x.id === dismissTargetId);
  $('dismissTargetName').textContent = r ? r.reported_id : '';
  $('dismissReasonText').value = '';
  $('dismissOverlay').classList.add('open');
}
function closeDismissModal() {
  $('dismissOverlay').classList.remove('open');
  dismissTargetId = null;
}
function confirmDismiss() {
  const r = reports.find(x => x.id === dismissTargetId);
  if (!r) return;
  const reasonText = $('dismissReasonText').value.trim();
  if (!reasonText) {
    $('dismissReasonText').focus();
    return;
  }
  r.status = 'DISMISSED';
  r.reviewed_by = CURRENT_ADMIN;
  r.reviewed_at = Date.now();
  r.review_result = reasonText;
  closeDismissModal();
  showToast(`${r.reported_id}님에 대한 신고를 취소 처리했습니다.`);
  renderAll();
}
function openDetailModal(id) {
  const r = reports.find(x => x.id === Number(id));
  if (!r) return;
  const resultLine = r.status === 'COMPLETED'
    ? `<span class="result-tag sanctioned">${escHtml(r.review_result || '처리 완료')}</span>`
    : `<span class="result-tag dismissed">${escHtml(r.review_result || '신고 취소')}</span>`;
  $('detailBody').innerHTML = `
    <dl class="detail-grid">
      <dt>신고번호</dt><dd>#${escHtml(r.id)}</dd>
      <dt>신고자</dt><dd>${escHtml(r.reporter_id)}</dd>
      <dt>피신고자</dt><dd>${escHtml(r.reported_id)}</dd>
      <dt>유형</dt><dd>${r.content_type === 'VOICE' ? '음성' : '텍스트'}</dd>
      <dt>접수 시각</dt><dd>${fmtDateTime(r.created_at)}</dd>
      <dt>처리 결과</dt><dd>${resultLine}</dd>
      <dt>처리자</dt><dd>${escHtml(r.reviewed_by || '—')}</dd>
      <dt>처리 시각</dt><dd>${fmtDateTime(r.reviewed_at || r.created_at)}</dd>
      <dt>원문/경로</dt><dd>${escHtml(r.content_path)}</dd>
    </dl>`;
  $('detailOverlay').classList.add('open');
}
function closeDetailModal() {
  $('detailOverlay').classList.remove('open');
}
function showToast(msg) {
  $('toastMsg').textContent = msg;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 3000);
}
function renderAll() {
  renderStats();
  renderQueue();
  renderHistory();
  renderSanctions();
  renderAppeals();
}
const CURRENT_ADMIN = 'CS_민지';
document.addEventListener('DOMContentLoaded', () => {
  $('adminName').textContent = CURRENT_ADMIN;
  switchTab('queue');
  renderAll();
  ['qFilterStatus', 'qFilterType', 'qSort'].forEach(id => $(id).addEventListener('change', renderQueue));
  $('qSearch').addEventListener('input', renderQueue);
  ['hFilterPeriod', 'hFilterResult'].forEach(id => $(id).addEventListener('change', renderHistory));
  $('hSearch').addEventListener('input', renderHistory);
  $('sFilterType').addEventListener('change', renderSanctions);
  $('sSearch').addEventListener('input', renderSanctions);
  $('aFilterStatus').addEventListener('change', renderAppeals);
  $('aSearch').addEventListener('input', renderAppeals);
  setInterval(() => {
    renderStats();
    renderQueue();
  }, 30000);
});
