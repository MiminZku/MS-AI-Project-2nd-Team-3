const reports = [
      { id: 101, created_at: '2026-07-16 14:10', reporter_id: 'user_01', reported_id: 'user_02', status: 'PENDING', result: '대기', content: '욕설/비하 발언', reported_message: '병신아 니가 비켜', review_reason: '' },
      { id: 102, created_at: '2026-07-16 12:40', reporter_id: 'user_03', reported_id: 'user_04', status: 'MANUAL_REVIEW_REQUIRED', result: '수동 검토 필요', content: '매크로 사용 의심 패턴 로그 첨부', reported_message: '안녕하세요', review_reason: '' },
      { id: 103, created_at: '2026-07-16 09:20', reporter_id: 'user_05', reported_id: 'user_06', status: 'COMPLETED', result: '제재 처리 완료', content: '반복적 욕설 및 비하 발언', reported_message: '계속 그렇게 하면 가만 안 둔다', review_reason: '반복적 욕설' },
      { id: 104, created_at: '2026-07-15 22:10', reporter_id: 'user_07', reported_id: 'user_02', status: 'DISMISSED', result: '신고 취소', content: '오해로 확인된 단순 발언', reported_message: '다음 판 같이 하실래요?', review_reason: '허위 신고로 확인됨' }
    ];
    const sanctions = [
      { id: 1, created_at: '2026-07-16 10:00', user_id: 'user_02', ai_result: '욕설 3단계', type: 'MUTE', duration_days: 7 },
      { id: 2, created_at: '2026-07-15 18:05', user_id: 'user_04', ai_result: '매크로 사용 의심', type: 'BAN', duration_days: 30 }
    ];
    const appeals = [
      { id: 1, report_id: 101, user_id: 'user_02', reason: '허위 신고로 판단됨', status: 'PENDING' },
      { id: 2, report_id: 104, user_id: 'user_07', reason: '신고 사유가 불충분함', status: 'REJECTED' }
    ];
    let activeReportId = null;
    let activeSanctionType = 'MUTE';

    function escapeHtml(value) {
      return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function showToast(message) {
      document.getElementById('toastMsg').textContent = message;
      const toast = document.getElementById('toast');
      toast.style.display = 'block';
      clearTimeout(showToast.timeout);
      showToast.timeout = setTimeout(() => toast.style.display = 'none', 2200);
    }
    function showPendingAlert() {
      const report = reports.find(r => ['PENDING', 'MANUAL_REVIEW_REQUIRED'].includes(r.status));
      if (!report) return;
      document.getElementById('alertMeta').textContent = `#${report.id} · ${report.reporter_id} → ${report.reported_id}`;
      document.getElementById('alertContent').textContent = report.reported_message || report.content;
      document.getElementById('alertPanel').style.display = 'block';
      document.getElementById('alertReview').onclick = () => openReviewSheet(report.id);
      document.getElementById('alertDismiss').onclick = () => document.getElementById('alertPanel').style.display = 'none';
    }
    function renderReports() {
      const status = document.getElementById('reportStatusFilter').value;
      const query = document.getElementById('reportSearch').value.trim().toLowerCase();
      const rows = reports.filter(r => (status === 'all' || r.status === status) && (!query || `${r.reporter_id} ${r.reported_id} ${r.result}`.toLowerCase().includes(query)));
      document.getElementById('reportBody').innerHTML = rows.map(r => {
        const badgeClass = r.status === 'PENDING' ? 'pending' : r.status === 'MANUAL_REVIEW_REQUIRED' ? 'review' : r.status === 'COMPLETED' ? 'done' : 'dismiss';
        return `<tr><td>#${r.id}</td><td>${r.created_at}</td><td>${r.reporter_id}</td><td>${r.reported_id}</td><td><button class="status-btn badge ${badgeClass}" type="button" onclick="openReviewSheet(${r.id})">${r.result}</button></td></tr>`;
      }).join('');
    }
    function renderSanctions() {
      const type = document.getElementById('sanctionTypeFilter').value;
      const query = document.getElementById('sanctionSearch').value.trim().toLowerCase();
      const rows = sanctions.filter(s => (type === 'all' || s.type === type) && (!query || `${s.user_id} ${s.ai_result}`.toLowerCase().includes(query)));
      document.getElementById('sanctionBody').innerHTML = rows.map(s => `<tr><td>#${s.id}</td><td>${s.created_at}</td><td>${s.user_id}</td><td>${s.ai_result}</td><td><span class="badge ${s.type === 'MUTE' ? 'mute' : 'ban'}">${s.type === 'MUTE' ? '채팅 금지' : '계정 정지'}</span></td><td>${s.duration_days}일</td></tr>`).join('');
    }
    function renderAppeals() {
      const status = document.getElementById('appealStatusFilter').value;
      const query = document.getElementById('appealSearch').value.trim().toLowerCase();
      const rows = appeals.filter(a => (status === 'all' || a.status === status) && (!query || `${a.user_id} ${a.reason}`.toLowerCase().includes(query)));
      document.getElementById('appealBody').innerHTML = rows.map(a => `<tr><td>#${a.id}</td><td>#${a.report_id}</td><td>${a.user_id}</td><td>${a.reason}</td><td><span class="badge ${a.status === 'APPROVED' ? 'approve' : a.status === 'REJECTED' ? 'reject' : 'pending'}">${a.status === 'APPROVED' ? '인용' : a.status === 'REJECTED' ? '기각' : '대기'}</span></td></tr>`).join('');
    }
    function updateSummary() {
      document.getElementById('statToday').textContent = reports.length;
      document.getElementById('statPending').textContent = reports.filter(r => r.status === 'PENDING' || r.status === 'MANUAL_REVIEW_REQUIRED').length;
      document.getElementById('statDone').textContent = reports.filter(r => r.status === 'COMPLETED' || r.status === 'DISMISSED').length;
      document.getElementById('statSanction').textContent = sanctions.length;
    }
    function populateReportTime(report) {
      document.getElementById('sheetReportTime').textContent = report ? report.created_at : '';
    }
    function setSanctionPills(type) {
      activeSanctionType = type;
      document.getElementById('sheetSanctionType').value = type;
      document.getElementById('sheetDurationDays').value = type === 'BAN' ? 30 : 7;
    }
    function openReviewSheet(reportId) {
      activeReportId = reportId;
      const report = reports.find(r => r.id === reportId);
      if (!report) return;
      activeSanctionType = 'MUTE';
      document.getElementById('sheetHead').textContent = `신고 접수 #${report.id}`;
      document.getElementById('sheetSub').textContent = `${report.reporter_id} → ${report.reported_id}`;
      document.getElementById('sheetUsers').textContent = `${report.reporter_id} / ${report.reported_id}`;
      document.getElementById('sheetContent').textContent = report.reported_message || report.content;
      document.getElementById('sheetDurationDays').value = activeSanctionType === 'BAN' ? 30 : 7;
      document.getElementById('sheetReason').value = report.review_reason || '';
      populateReportTime(report);
      setSanctionPills('MUTE');
      document.getElementById('sheetOverlay').style.display = 'flex';
    }
    function closeReviewSheet() {
      document.getElementById('sheetOverlay').style.display = 'none';
      activeReportId = null;
    }
    function applyDecision() {
      const report = reports.find(r => r.id === activeReportId);
      if (!report) return;
      const reason = document.getElementById('sheetReason').value.trim();
      const sanctionType = activeSanctionType;
      const durationDays = Number(document.getElementById('sheetDurationDays').value) || 7;
      report.review_reason = reason || '검토 기록 없음';
      if (sanctionType === 'DISMISS') {
        report.status = 'DISMISSED';
        report.result = '신고 취소';
      } else {
        report.status = 'COMPLETED';
        report.result = '제재 처리 완료';
        sanctions.unshift({ id: sanctions.length + 1, created_at: '2026-07-16 15:00', user_id: report.reported_id, ai_result: reason || '제재 자동 적용', type: sanctionType, duration_days: durationDays });
      }
      closeReviewSheet();
      updateSummary();
      renderReports();
      renderSanctions();
      renderAppeals();
      showToast(sanctionType === 'DISMISS' ? '신고를 취소 처리했습니다.' : '제재를 적용했습니다.');
    }
    document.getElementById('loginBtn').addEventListener('click', () => {
      const id = document.getElementById('loginId').value.trim();
      const pw = document.getElementById('loginPw').value.trim();
      const msg = document.getElementById('loginMsg');
      if (id === 'admin01' && pw === 'admin1234') {
        msg.textContent = '';
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('dashboardWrap').style.display = 'block';
        showPendingAlert();
      } else {
        msg.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
      }
    });
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });
    ['reportStatusFilter', 'reportSearch'].forEach(id => document.getElementById(id).addEventListener('input', renderReports));
    ['reportStatusFilter'].forEach(id => document.getElementById(id).addEventListener('change', renderReports));
    ['sanctionTypeFilter', 'sanctionSearch'].forEach(id => document.getElementById(id).addEventListener('input', renderSanctions));
    ['sanctionTypeFilter'].forEach(id => document.getElementById(id).addEventListener('change', renderSanctions));
    ['appealStatusFilter', 'appealSearch'].forEach(id => document.getElementById(id).addEventListener('input', renderAppeals));
    ['appealStatusFilter'].forEach(id => document.getElementById(id).addEventListener('change', renderAppeals));
    document.getElementById('sheetSanctionType').addEventListener('change', (event) => setSanctionPills(event.target.value));
    document.getElementById('sheetClose').addEventListener('click', closeReviewSheet);
    document.getElementById('sheetApply').addEventListener('click', applyDecision);
    document.getElementById('sheetOverlay').addEventListener('click', (event) => { if (event.target.id === 'sheetOverlay') closeReviewSheet(); });
    updateSummary();
    renderReports();
    renderSanctions();
    renderAppeals();
