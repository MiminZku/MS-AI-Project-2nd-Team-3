/* ═══════════════════════════════════════════════════════
   ADMIN DASHBOARD — 데이터 & 로직
   (실제 서비스에서는 이 목데이터 대신 서버 API 응답으로 교체)
═══════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const REASON_LABELS = { abuse:'욕설/비하', harass:'괴롭힘', cheat:'핵/치팅', spam:'스팸/광고', other:'기타' };
const REASON_STYLE = {
  abuse:  'color:var(--danger); border-color:var(--danger); background:var(--danger-glow);',
  harass: 'color:var(--danger); border-color:var(--danger); background:var(--danger-glow);',
  cheat:  'color:#FF9F43; border-color:#FF9F43; background:rgba(255,159,67,.12);',
  spam:   'color:var(--text-muted); border-color:var(--border); background:transparent;',
  other:  'color:var(--text-muted); border-color:var(--border); background:transparent;',
};
const SANCTION_LABELS = { warn:'경고', mute_1d:'채팅 정지 1일', mute_7d:'채팅 정지 7일', ban_perm:'계정 영구정지' };
const SLA_WARN_MIN = 15, SLA_DANGER_MIN = 60;

const now = Date.now();
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

/* ── 목 데이터 ── */
let reports = [
  {
    id:'R-2041', targetUser:'악당유저123', reporterUser:'용사_Yujin', reason:'abuse', type:'chat',
    reportedAt: now - 6*MIN, duplicateCount:2, priorOffenses:1, status:'pending',
    context:[
      {user:'용사_Yujin', time:'14:02', text:'그 자리 좀 피해줄래요?'},
      {user:'악당유저123', time:'14:02', text:'ㅋㅋ 병신아 니가 비켜', flagged:true},
      {user:'용사_Yujin', time:'14:03', text:'말이 너무 심하네요'},
    ],
  },
  {
    id:'R-2042', targetUser:'헬퍼모드', reporterUser:'초보냥이', reason:'cheat', type:'chat',
    reportedAt: now - 40*MIN, duplicateCount:5, priorOffenses:0, status:'pending',
    context:[
      {user:'초보냥이', time:'13:20', text:'저 사람 반응속도 실화냐'},
      {user:'헬퍼모드', time:'13:20', text:'ㅇㅇ 매크로 씀 ㅋㅋ', flagged:true},
    ],
  },
  {
    id:'R-2043', targetUser:'광고업자', reporterUser:'플레이어_2831', reason:'spam', type:'chat',
    reportedAt: now - 90*MIN, duplicateCount:8, priorOffenses:2, status:'pending',
    context:[
      {user:'광고업자', time:'12:10', text:'게임머니 최저가 문의 카톡 gold1004', flagged:true},
      {user:'광고업자', time:'12:11', text:'게임머니 최저가 문의 카톡 gold1004', flagged:true},
    ],
  },
  {
    id:'R-2044', targetUser:'조용한스토커', reporterUser:'익명유저', reason:'harass', type:'voice',
    reportedAt: now - 12*MIN, duplicateCount:0, priorOffenses:0, status:'pending',
    context:[
      {user:'익명유저', time:'14:18', text:'(음성) 그만 좀 따라다니세요'},
      {user:'조용한스토커', time:'14:19', text:'(음성) 계속되는 욕설 및 위협 발언 — 최근 30초 녹음 증거 첨부됨', flagged:true},
    ],
  },
  {
    id:'R-2045', targetUser:'분노조절장애', reporterUser:'평화주의자', reason:'other', type:'chat',
    reportedAt: now - 3*MIN, duplicateCount:0, priorOffenses:0, status:'pending',
    context:[
      {user:'분노조절장애', time:'14:27', text:'이딴식으로 할거면 게임을 접어', flagged:true},
    ],
  },

  // ── 완료된 내역 ──
  {
    id:'R-1998', targetUser:'욕쟁이할배', reporterUser:'용사_Yujin', reason:'abuse', type:'chat',
    reportedAt: now - 5*HOUR, duplicateCount:3, priorOffenses:3, status:'sanctioned',
    handledBy:'CS_민지', handledAt: now - 4*HOUR, sanction:{ type:'mute_7d', reason:'반복적 욕설 및 비하 발언, 누적 3회 위반' },
    context:[ {user:'욕쟁이할배', time:'09:40', text:'ㅅㅂㅅㅂ 못하네 진짜', flagged:true} ],
  },
  {
    id:'R-1999', targetUser:'실수왕', reporterUser:'초보냥이', reason:'other', type:'chat',
    reportedAt: now - 1*DAY, duplicateCount:0, priorOffenses:0, status:'dismissed',
    handledBy:'CS_민지', handledAt: now - 23*HOUR, dismissReason:'단순 오해로 확인됨, 제재 사유 불충분',
    context:[ {user:'실수왕', time:'어제', text:'앗 미안 잘못 눌렀어요'} ],
  },
  {
    id:'R-2001', targetUser:'매크로킹', reporterUser:'플레이어_2831', reason:'cheat', type:'chat',
    reportedAt: now - 2*DAY, duplicateCount:6, priorOffenses:1, status:'sanctioned',
    handledBy:'CS_현우', handledAt: now - 2*DAY + 30*MIN, sanction:{ type:'ban_perm', reason:'매크로 사용 정황 다수 신고 및 로그 확인, 영구정지' },
    context:[ {user:'매크로킹', time:'그제', text:'(자동화 의심 패턴 로그 첨부)', flagged:true} ],
  },
  {
    id:'R-2002', targetUser:'광고봇22', reporterUser:'평화주의자', reason:'spam', type:'chat',
    reportedAt: now - 3*DAY, duplicateCount:12, priorOffenses:4, status:'sanctioned',
    handledBy:'CS_현우', handledAt: now - 3*DAY + 10*MIN, sanction:{ type:'ban_perm', reason:'상습 광고 스팸, 누적 4회 위반으로 영구정지' },
    context:[ {user:'광고봇22', time:'3일전', text:'대량 홍보 메시지 반복 전송', flagged:true} ],
  },
  {
    id:'R-2003', targetUser:'욱하는유저', reporterUser:'용사_Yujin', reason:'harass', type:'voice',
    reportedAt: now - 4*DAY, duplicateCount:1, priorOffenses:0, status:'sanctioned',
    handledBy:'CS_민지', handledAt: now - 4*DAY + 20*MIN, sanction:{ type:'warn', reason:'경미한 언쟁, 1차 경고 처리' },
    context:[ {user:'욱하는유저', time:'4일전', text:'(음성) 언성을 높이며 항의', flagged:true} ],
  },
];

let activeTab = 'queue';
let sanctionTargetId = null, dismissTargetId = null;

/* ── 유틸 ── */
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function initials(name){ return name.replace(/[^가-힣a-zA-Z0-9]/g,'').slice(0,2).toUpperCase() || '??'; }
function fmtElapsed(ts){
  const diff = Date.now() - ts;
  const m = Math.floor(diff / MIN);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}시간 ${m%60}분`;
  return `${Math.floor(h/24)}일 ${h%24}시간`;
}
function slaClass(ts){
  const m = (Date.now()-ts)/MIN;
  if (m >= SLA_DANGER_MIN) return 'danger';
  if (m >= SLA_WARN_MIN) return 'warn';
  return 'ok';
}
function fmtDateTime(ts){
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* ── 통계 ── */
function renderStats(){
  const pending = reports.filter(r=>r.status==='pending');
  const todayHandled = reports.filter(r=>r.status!=='pending' && (Date.now()-r.handledAt) < DAY);
  const avgMin = todayHandled.length
    ? Math.round(todayHandled.reduce((s,r)=> s + (r.handledAt - r.reportedAt), 0) / todayHandled.length / MIN)
    : 0;
  const slaBreach = pending.filter(r => (Date.now()-r.reportedAt)/MIN >= SLA_DANGER_MIN).length;

  $('statPending').textContent = pending.length;
  $('statPendingSub').textContent = slaBreach>0 ? `⚠ ${slaBreach}건 지연` : '지연 없음';
  $('statHandledToday').textContent = todayHandled.length;
  $('statAvgTime').textContent = todayHandled.length ? `${avgMin}분` : '—';
  $('statTotalToday').textContent = pending.length + todayHandled.length;
}

/* ── 탭 ── */
function switchTab(tab){
  activeTab = tab;
  document.querySelectorAll('.adm-tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  $('queuePanel').style.display = tab==='queue' ? '' : 'none';
  $('historyPanel').style.display = tab==='history' ? '' : 'none';
}

/* ── 대기 큐 렌더링 ── */
function renderQueue(){
  let list = reports.filter(r=>r.status==='pending');

  const reasonF = $('qFilterReason').value;
  const typeF = $('qFilterType').value;
  const search = $('qSearch').value.trim().toLowerCase();
  if (reasonF !== 'all') list = list.filter(r=>r.reason===reasonF);
  if (typeF !== 'all') list = list.filter(r=>r.type===typeF);
  if (search) list = list.filter(r=>r.targetUser.toLowerCase().includes(search));

  const sort = $('qSort').value;
  if (sort === 'oldest') list.sort((a,b)=>a.reportedAt-b.reportedAt);
  else if (sort === 'dupCount') list.sort((a,b)=>b.duplicateCount-a.duplicateCount);
  else list.sort((a,b)=>b.reportedAt-a.reportedAt); // latest (default)

  $('queueCount').textContent = reports.filter(r=>r.status==='pending').length;
  $('queueCount').classList.toggle('zero', reports.filter(r=>r.status==='pending').length===0);

  const wrap = $('queueList');
  if (!list.length){
    wrap.innerHTML = `<div class="q-empty">조건에 맞는 대기 중인 신고가 없습니다.</div>`;
    return;
  }
  wrap.innerHTML = list.map(r=>{
    const sla = slaClass(r.reportedAt);
    return `
    <div class="q-card ${sla==='danger'?'sla-danger':''}">
      <div class="q-card-top">
        <div class="q-user">
          <div class="q-avatar">${initials(r.targetUser)}</div>
          <div>
            <div class="q-username">${escHtml(r.targetUser)}</div>
            <div class="q-meta">신고자 ${escHtml(r.reporterUser)} · ${r.type==='voice'?'🎙 음성':'💬 채팅'}</div>
          </div>
        </div>
        <div class="q-badges">
          <span class="q-reason-tag" style="${REASON_STYLE[r.reason]}">${REASON_LABELS[r.reason]}</span>
          ${r.duplicateCount>0?`<span class="q-dup">+${r.duplicateCount}건 추가신고</span>`:''}
          <span class="q-sla ${sla}">${fmtElapsed(r.reportedAt)} 경과</span>
        </div>
      </div>
      <div class="q-context">
        ${r.context.map(c=>`
          <div class="q-ctx-line ${c.flagged?'flagged':''}">
            <span class="q-ctx-name">${escHtml(c.user)}</span><span class="q-ctx-time">${c.time}</span>
            <div class="q-ctx-text">${escHtml(c.text)}</div>
          </div>`).join('')}
      </div>
      <div class="q-footer">
        <div class="q-history-note ${r.priorOffenses>0?'warn':''}">${r.priorOffenses>0?`⚠ 과거 제재 이력 ${r.priorOffenses}회`:'과거 제재 이력 없음'}</div>
        <div class="q-actions">
          <button class="btn btn-dismiss" onclick="openDismissModal('${r.id}')">신고 취소</button>
          <button class="btn btn-sanction" onclick="openSanctionModal('${r.id}')">제재 처리</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ── 완료 내역 렌더링 ── */
function renderHistory(){
  let list = reports.filter(r=>r.status!=='pending');

  const periodF = $('hFilterPeriod').value;
  const resultF = $('hFilterResult').value;
  const search = $('hSearch').value.trim().toLowerCase();
  if (periodF !== 'all'){
    const span = periodF==='today' ? DAY : periodF==='7d' ? 7*DAY : 30*DAY;
    list = list.filter(r => (Date.now()-r.handledAt) < span);
  }
  if (resultF !== 'all') list = list.filter(r=>r.status===resultF);
  if (search) list = list.filter(r=>r.targetUser.toLowerCase().includes(search) || r.handledBy.toLowerCase().includes(search));

  list.sort((a,b)=>b.handledAt-a.handledAt);

  const tbody = $('historyBody');
  if (!list.length){
    tbody.innerHTML = `<tr><td colspan="6" class="q-empty">조건에 맞는 완료 내역이 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(r=>`
    <tr onclick="openDetailModal('${r.id}')">
      <td>${fmtDateTime(r.handledAt)}</td>
      <td>${escHtml(r.targetUser)}</td>
      <td><span class="q-reason-tag" style="${REASON_STYLE[r.reason]}">${REASON_LABELS[r.reason]}</span></td>
      <td>${r.type==='voice'?'🎙 음성':'💬 채팅'}</td>
      <td><span class="result-tag ${r.status}">${r.status==='sanctioned'? SANCTION_LABELS[r.sanction.type] : '신고 취소'}</span></td>
      <td>${escHtml(r.handledBy)}</td>
    </tr>`).join('');
}

/* ── 제재 처리 모달 ── */
function openSanctionModal(id){
  sanctionTargetId = id;
  const r = reports.find(x=>x.id===id);
  $('sanctionTargetName').textContent = r.targetUser;
  $('sanctionReasonText').value = '';
  $('sanctionType').value = 'warn';
  $('sanctionOverlay').classList.add('open');
}
function closeSanctionModal(){ $('sanctionOverlay').classList.remove('open'); sanctionTargetId=null; }
function confirmSanction(){
  const r = reports.find(x=>x.id===sanctionTargetId);
  if (!r) return;
  const type = $('sanctionType').value;
  const reasonText = $('sanctionReasonText').value.trim();
  r.status = 'sanctioned';
  r.handledBy = CURRENT_ADMIN;
  r.handledAt = Date.now();
  r.sanction = { type, reason: reasonText || `${SANCTION_LABELS[type]} 처리` };
  closeSanctionModal();
  showToast(`${r.targetUser}님에게 "${SANCTION_LABELS[type]}" 처리를 완료했습니다.`);
  renderAll();
}

/* ── 신고 취소 모달 ── */
function openDismissModal(id){
  dismissTargetId = id;
  const r = reports.find(x=>x.id===id);
  $('dismissTargetName').textContent = r.targetUser;
  $('dismissReasonText').value = '';
  $('dismissOverlay').classList.add('open');
}
function closeDismissModal(){ $('dismissOverlay').classList.remove('open'); dismissTargetId=null; }
function confirmDismiss(){
  const r = reports.find(x=>x.id===dismissTargetId);
  if (!r) return;
  const reasonText = $('dismissReasonText').value.trim();
  if (!reasonText){ $('dismissReasonText').focus(); return; }
  r.status = 'dismissed';
  r.handledBy = CURRENT_ADMIN;
  r.handledAt = Date.now();
  r.dismissReason = reasonText;
  closeDismissModal();
  showToast(`${r.targetUser}님에 대한 신고를 취소 처리했습니다.`);
  renderAll();
}

/* ── 상세 보기 모달 (완료 내역) ── */
function openDetailModal(id){
  const r = reports.find(x=>x.id===id);
  const resultLine = r.status==='sanctioned'
    ? `<span class="result-tag sanctioned">${SANCTION_LABELS[r.sanction.type]}</span>`
    : `<span class="result-tag dismissed">신고 취소</span>`;
  $('detailBody').innerHTML = `
    <dl class="detail-grid">
      <dt>대상 유저</dt><dd>${escHtml(r.targetUser)}</dd>
      <dt>신고자</dt><dd>${escHtml(r.reporterUser)}</dd>
      <dt>신고 사유</dt><dd>${REASON_LABELS[r.reason]} (${r.type==='voice'?'음성':'채팅'})</dd>
      <dt>접수 시각</dt><dd>${fmtDateTime(r.reportedAt)}</dd>
      <dt>처리 결과</dt><dd>${resultLine}</dd>
      <dt>처리자</dt><dd>${escHtml(r.handledBy)}</dd>
      <dt>처리 시각</dt><dd>${fmtDateTime(r.handledAt)}</dd>
      <dt>처리 사유</dt><dd>${escHtml(r.status==='sanctioned' ? r.sanction.reason : r.dismissReason)}</dd>
    </dl>
    <div class="q-context">
      ${r.context.map(c=>`
        <div class="q-ctx-line ${c.flagged?'flagged':''}">
          <span class="q-ctx-name">${escHtml(c.user)}</span><span class="q-ctx-time">${c.time}</span>
          <div class="q-ctx-text">${escHtml(c.text)}</div>
        </div>`).join('')}
    </div>`;
  $('detailOverlay').classList.add('open');
}
function closeDetailModal(){ $('detailOverlay').classList.remove('open'); }

/* ── 토스트 ── */
function showToast(msg){
  $('toastMsg').textContent = msg;
  $('toast').classList.add('show');
  setTimeout(()=> $('toast').classList.remove('show'), 3000);
}

/* ── 전체 렌더 ── */
function renderAll(){ renderStats(); renderQueue(); renderHistory(); }

const CURRENT_ADMIN = 'CS_민지';

document.addEventListener('DOMContentLoaded', () => {
  $('adminName').textContent = CURRENT_ADMIN;
  switchTab('queue');
  renderAll();
  ['qFilterReason','qFilterType','qSort'].forEach(id => $(id).addEventListener('change', renderQueue));
  $('qSearch').addEventListener('input', renderQueue);
  ['hFilterPeriod','hFilterResult'].forEach(id => $(id).addEventListener('change', renderHistory));
  $('hSearch').addEventListener('input', renderHistory);
  setInterval(()=>{ renderStats(); renderQueue(); }, 30000); // SLA 경과시간 자동 갱신
});
