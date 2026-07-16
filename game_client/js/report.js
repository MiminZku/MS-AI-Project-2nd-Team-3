/* ═══════════════════════════════════════════════════════
   REPORT MODAL
═══════════════════════════════════════════════════════ */
let reportType='';
let reportTarget=null;

// type: 'chat' | 'voice'
// target: 특정 채팅 메시지를 신고할 때 { user, text, time } (없으면 채팅 전체에 대한 일반 신고)
function openReport(type, target=null) {
  reportType=type;
  reportTarget=target;
  document.querySelectorAll('input[name="reason"]').forEach(r=>r.checked=false);
  $id('modalTitle').textContent = type==='voice' ? '음성 채팅 신고' : '채팅 신고';

  const preview = $id('modalTargetPreview');
  if (target) {
    preview.style.display = 'block';
    preview.innerHTML = `<span class="rp-name">${escHtml(target.user)}</span><span class="rp-text">${escHtml(target.text)}</span>`;
  } else {
    preview.style.display = 'none';
    preview.innerHTML = '';
  }

  $id('modalSub').textContent = type==='voice' ? '신고할 유형을 선택해 주세요. 최근 30초 음성이 증거로 제출됩니다.' : '신고 유형을 선택해 주세요. 허위 신고는 제재를 받을 수 있습니다.';
  $id('overlay').classList.add('open');
}
function closeReport() { $id('overlay').classList.remove('open'); }
function bgClose(e) { if (e.target===$id('overlay')) closeReport(); }
async function submitReport() {
  const checked = document.querySelector('input[name="reason"]:checked');
  if (!checked) return;
  const targetUser = reportTarget ? reportTarget.user : opponentName();
  const isVoiceReport = reportType === 'voice';
  const payload = {
    reporter_id: MY_NAME,
    target_user_id: targetUser,
    channel: isVoiceReport ? 'voice' : 'text',
    content_text: isVoiceReport ? '' : (reportTarget?.text || ''),
    content_path: isVoiceReport ? `/recordings/${targetUser}.webm` : ''
  };

  try {
    const response = await fetch(`${getHttpBase()}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`report request failed: ${response.status}`);
    await response.json();
  } catch (err) {
    console.warn('신고 접수 요청 실패:', err);
    showToast('신고 접수에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    return;
  }

  const entryId = addReportHistory(targetUser, checked.value);
  closeReport();
  showToast(reportType==='voice' ? '음성 신고가 접수되었습니다.' : '채팅 신고가 접수되었습니다.');
  reportTarget = null;
  if (isVoiceReport) attachEvidenceAudio(entryId, targetUser);
}
function showToast(msg) {
  const el=$id('toast'); $id('toastMsg').textContent=msg;
  el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),3000);
}

/* ═══════════════════════════════════════════════════════
   신고 내역 (우편함)
═══════════════════════════════════════════════════════ */
const REPORT_REASON_LABEL = {
  abuse: '욕설 / 비하 발언',
  harass: '괴롭힘 / 지속적 공격',
  cheat: '핵 / 치팅 의심',
  spam: '스팸 / 광고',
  other: '기타'
};

let reportHistory = [];

function addReportHistory(targetUser, reasonValue) {
  const entry = {
    id: Date.now() + Math.random(),
    user: targetUser || '상대방',
    reason: REPORT_REASON_LABEL[reasonValue] || '기타',
    time: nowStr(),
    audioUrl: null,
    audioStatus: 'idle' // idle | loading | found | none
  };
  reportHistory.unshift(entry);
  renderMailbox();
  return entry.id;
}

// 신고 접수 직후, 서버에 저장된 그 유저의 최신 녹음을 조회해서 우편함에 증거로 붙인다.
async function attachEvidenceAudio(entryId, targetUser) {
  const entry = reportHistory.find(r => r.id === entryId);
  if (!entry) return;

  entry.audioStatus = 'loading';
  renderMailbox();

  try {
    const res = await fetch(`${getHttpBase()}/report-audio?user=${encodeURIComponent(targetUser)}`);
    if (!res.ok) { entry.audioStatus = 'none'; renderMailbox(); return; }
    const blob = await res.blob();
    entry.audioUrl = URL.createObjectURL(blob);
    entry.audioStatus = 'found';
  } catch (err) {
    entry.audioStatus = 'none';
  }
  renderMailbox();
}

function renderEvidence(r) {
  if (r.audioStatus === 'loading') return '<div class="mailbox-evidence status">🔎 증거 음성 조회 중...</div>';
  if (r.audioStatus === 'found') return `<audio class="mailbox-evidence" controls src="${r.audioUrl}"></audio>`;
  if (r.audioStatus === 'none') return '<div class="mailbox-evidence status">⚠️ 조회된 증거 음성이 없습니다</div>';
  return '';
}

function renderMailbox() {
  const list = $id('mailboxList');
  // 우편함 버튼이 헤더/게임오버 화면 등 여러 곳에 있을 수 있어 뱃지는 전부 동기화
  const badges = document.querySelectorAll('.mailbox-badge');

  if (!reportHistory.length) {
    list.innerHTML = '<div class="mailbox-empty">아직 신고한 내역이 없습니다</div>';
    badges.forEach(b => b.style.display = 'none');
    return;
  }

  badges.forEach(b => { b.style.display = 'flex'; b.textContent = reportHistory.length; });
  list.innerHTML = reportHistory.map(r => `
    <div class="mailbox-item">
      <div class="mailbox-item-title"><span class="mi-target">${escHtml(r.user)}</span>님을 신고했습니다</div>
      <div class="mailbox-item-meta"><span>${escHtml(r.reason)}</span><span>${r.time}</span></div>
      ${renderEvidence(r)}
    </div>
  `).join('');
}

function toggleMailbox() {
  $id('mailboxPanel').classList.toggle('open');
}

document.addEventListener('click', (e) => {
  const panel = $id('mailboxPanel');
  if (!panel.classList.contains('open')) return;
  const clickedTrigger = e.target.closest('.mailbox-btn');
  if (!panel.contains(e.target) && !clickedTrigger) {
    panel.classList.remove('open');
  }
});
