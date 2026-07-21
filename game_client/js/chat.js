/* ═══════════════════════════════════════════════════════
   CHAT
═══════════════════════════════════════════════════════ */
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function nowStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function sendMsg() {
  if (chatMuted) return;
  const inp = $id('chatInput'), text = inp.value.trim();
  if (!text) return;
  inp.value = '';

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chat', user: MY_NAME, text }));
  } else {
    // 서버 미연결 시 로컬 표시만
    appendChatMsg({ user: MY_NAME, text, time: nowStr() });
  }
}
$id('chatInput').addEventListener('keydown', e => { if (e.key==='Enter') sendMsg(); });

/* ═══════════════════════════════════════════════════════
   채팅 금지(MUTE) — 로그인 응답의 is_muted, 또는 게임 중 서버의
   {"type":"system", "text":"..."} 메시지로 트리거됨
═══════════════════════════════════════════════════════ */
let chatMuted = false;

function applyChatMuted(muted, message) {
  chatMuted = muted;
  const input = $id('chatInput');
  const sendButton = $id('sendBtn');
  if (input) {
    input.disabled = muted;
    input.placeholder = muted ? '채팅 금지 상태입니다' : '메시지 입력...';
  }
  if (sendButton) sendButton.disabled = muted;
  if (muted && message) appendSystemMsg(`— ${escHtml(message)} —`);
}

/* ═══════════════════════════════════════════════════════
   WEBSOCKET CHAT
═══════════════════════════════════════════════════════ */
let ws = null;
let MY_NAME = null; // auth.js의 닉네임 입력에서 설정됨 (모드 선택 전에 반드시 정해짐)
let currentOpponentName = null; // 서버가 'opponent' 메시지로 알려줌 (같은 방에 상대가 있을 때만 값이 있음)
let pendingBanMessage = null; // BAN system 메시지를 받으면 채워두고, 뒤이어 오는 onclose에서 소비함

function getServerAddr() {
  const input = document.getElementById('serverAddr');
  return input ? input.value.trim() : 'localhost:3000';
}

function opponentName() {
  return currentOpponentName || '상대방';
}

function getHttpBase() {
  return `http://${getServerAddr()}`;
}

function showSanctionPopup({ text = '', aiReason = '', isBan = false }) {
  document.getElementById('sanctionPopup')?.remove();

  const popup = document.createElement('div');
  popup.id = 'sanctionPopup';
  popup.className = 'sanction-popup-overlay';
  popup.innerHTML = `
    <div class="sanction-popup" role="alertdialog" aria-modal="true">
      <div class="sanction-popup-title">제재 안내</div>
      <div class="sanction-popup-summary">${escHtml(text || '제재 안내를 받았습니다.')}</div>
      ${aiReason ? `<div class="sanction-popup-reason"><div class="sanction-popup-label">상세 제재 사유</div><div>${escHtml(String(aiReason))}</div></div>` : ''}
      <button type="button" class="sanction-popup-confirm">${isBan ? '로그인 화면으로' : '확인'}</button>
    </div>`;

  const close = () => {
    popup.remove();
    if (isBan) kickToLogin(text || '계정이 정지되어 강제 퇴장되었습니다.', { silent: true });
  };
  popup.querySelector('.sanction-popup-confirm').addEventListener('click', close);
  document.body.appendChild(popup);
}

function connectChat() {
  // 이전 연결이 남아있으면 먼저 정리 (중복 소켓/중복 메시지 수신 방지)
  if (ws) {
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.close();
  }

  const url = `ws://${getServerAddr()}`;
  setChatStatus('🟡 연결 중...', '#FF9F43');
  try {
    ws = new WebSocket(url);

    ws.onopen = () => {
      setChatStatus('🟢 서버 연결됨', 'var(--success)');
      appendSystemMsg('— 채팅 서버에 연결되었습니다 —');
      ws.send(JSON.stringify({ type: 'identify', user: MY_NAME })); // 내 닉네임을 서버에 알림
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'history') {
        data.messages.forEach(m => appendChatMsg(m));
      } else if (data.type === 'chat') {
        appendChatMsg(data.message);
      } else if (data.type === 'presence') {
        setPresence(data.count);
      } else if (data.type === 'opponent') {
        const prevOpponent = currentOpponentName;
        currentOpponentName = data.name; // 같은 방 상대방의 닉네임 (없으면 null)

        if (data.name && data.name !== prevOpponent) {
          appendSystemMsg(`— ${escHtml(data.name)}님이 입장했습니다 —`);
          showToast(`${data.name}님이 입장했습니다`);
        } else if (!data.name && prevOpponent) {
          appendSystemMsg(`— ${escHtml(prevOpponent)}님이 퇴장했습니다 —`);
        }
        updateOpponentDisplay();
      } else if (data.type === 'webrtc_offer' || data.type === 'webrtc_answer' || data.type === 'webrtc_ice_candidate' || data.type === 'webrtc_renegotiate') {
        handleWebRtcMessage(data);
      } else if (data.type === 'request_voice_upload') {
        if (typeof uploadCurrentRecording === 'function') {
          uploadCurrentRecording();
        }
      } else if (data.type === 'game_start') {
        if ($id('readyOverlay').classList.contains('show')) {
          showToast("상대방이 게임을 시작했습니다.");
          if (typeof confirmGameStart === 'function') {
            confirmGameStart(true);
          }
        }
      } else if (data.type === 'sanction_notice') {
        addSanctionNotice(data);
        showToast(data.text || '제재 안내가 우편함에 도착했습니다.');
      } else if (data.type === 'full') {
        setChatStatus('🔴 방이 가득 참', 'var(--danger)');
        appendSystemMsg('— 이미 다른 두 명이 접속 중입니다 —');
      } else if (data.type === 'system') {
        const text = typeof data.text === 'string' ? data.text : '';
        const action = String(data.action || data.sanction_type || '').toLowerCase();
        const isBanNotice = action === 'ban' || action === 'banned' || /계정.*정지|강제\s*퇴장/.test(text);
        const isWarningNotice = action === 'warning' || action === 'warn' || /경고|주의/.test(text);
        const isMuteNotice = action === 'mute' || action === 'muted' || /채팅\s*금지/.test(text);
        const isMuteReleasedNotice = action === 'mute_released' || /채팅\s*금지.*해제/.test(text);

        if (isMuteReleasedNotice) {
          applyChatMuted(false, text || '채팅 금지가 해제되었습니다.');
          showSanctionPopup({ text: text || '채팅 금지가 해제되었습니다.' });
          return;
        }
        if (isBanNotice) {
          pendingBanMessage = null;
          showSanctionPopup({ text, aiReason: data.ai_reason, isBan: true });
          return;
        }
        if (isWarningNotice) {
          appendSystemMsg(escHtml(text || '경고가 적용되었습니다.'));
          showSanctionPopup({ text, aiReason: data.ai_reason });
          return;
        }
        if (isMuteNotice) {
          applyChatMuted(true, text || '채팅 금지 상태입니다.');
          showSanctionPopup({ text, aiReason: data.ai_reason });
          return;
        }
        showSanctionPopup({ text, aiReason: data.ai_reason });
        return;
        // 서버가 보내는 경고 메시지는 채팅 금지로 오인하지 않고 별도 팝업으로 안내한다.
        if (action === 'warning' || action === 'warn' || /경고|주의/.test(text)) {
          appendSystemMsg(escHtml(text || '경고가 적용되었습니다.'));
          alert(`경고 안내\n${text || '운영 정책에 따라 경고가 적용되었습니다.'}`);
          return;
        }
        if (action === 'ban' || action === 'banned' || /계정.*정지|강제\s*퇴장/.test(text)) {
          pendingBanMessage = null;
          kickToLogin(text || '계정이 정지되어 강제 퇴장되었습니다.');
          return;
        }
        if (action === 'mute' || action === 'muted') {
          alert(`채팅 금지 안내\n${text || '채팅 금지 상태가 적용되었습니다.'}`);
        }
        if (data.action === 'mute_released' || text.includes('채팅 금지가 해제') || text.includes('채팅 금지 해제')) {
          applyChatMuted(false, text || '채팅 금지가 해제되었습니다.');
        } else if (text.includes('정지') || text.includes('강제 퇴장')) {
          // BAN 알림을 받는 즉시 팝업과 로그인 화면 전환을 실행한다.
          // 서버가 곧바로 소켓을 닫으므로 onclose에서는 중복 처리하지 않는다.
          const banMessage = text || '계정이 정지되어 강제 퇴장되었습니다.';
          pendingBanMessage = null;
          kickToLogin(banMessage);
        } else {
          applyChatMuted(true, text || '채팅이 금지되었습니다.');
        }
      }
    };

    ws.onerror = () => {
      setChatStatus('🔴 연결 실패', 'var(--danger)');
      appendSystemMsg('— 서버 연결 실패. server.js를 먼저 실행하세요 (node server.js) —');
      setPresence(1); // 연결이 없으니 상대 입장 여부도 알 수 없음 → 대기 상태로
    };

    ws.onclose = () => {
      setChatStatus('🔴 연결 끊김', 'var(--danger)');
      setPresence(1);
      currentOpponentName = null;
      if (pendingBanMessage) {
        const msg = pendingBanMessage;
        pendingBanMessage = null;
        kickToLogin(msg);
      }
    };
  } catch (err) {
    setChatStatus('🔴 WebSocket 오류', 'var(--danger)');
  }
}

function setChatStatus(text, color) {
  const el = $id('chatStatus');
  if (el) { el.textContent = text; el.style.color = color; }
}

function appendChatMsg(msg) {
  const ch = $id('chatHistory');
  const div = document.createElement('div');
  div.className = 'msg';
  const isMe = msg.user === MY_NAME;
  div.innerHTML = `<div class="msg-meta"><span class="msg-name" style="color:${isMe ? 'var(--accent)' : '#0EA968'}">${escHtml(msg.user)}</span><span class="msg-time">${msg.time}</span></div><div class="msg-text">${escHtml(msg.text)}</div>`;

  // 상대방 메시지에만 개별 신고 버튼 노출 (내 메시지는 신고 불가)
  if (!isMe) {
    const reportBtn = document.createElement('button');
    reportBtn.className = 'msg-report-btn';
    reportBtn.type = 'button';
    reportBtn.title = '이 메시지 신고';
    reportBtn.textContent = '⚑';
    reportBtn.onclick = () => openReport('chat', msg);
    div.querySelector('.msg-meta').appendChild(reportBtn);
  }

  ch.appendChild(div);
  ch.scrollTop = ch.scrollHeight;
}

function appendSystemMsg(text) {
  const ch = $id('chatHistory');
  const div = document.createElement('div');
  div.className = 'msg system';
  div.innerHTML = `<div class="msg-text">${text}</div>`;
  ch.appendChild(div);
  ch.scrollTop = ch.scrollHeight;
}

/* ═══════════════════════════════════════════════════════
   임시: 신고 기능 테스트용 예시 채팅
   (실 서버 채팅 히스토리가 없을 때도 신고 버튼을 확인할 수 있게)
═══════════════════════════════════════════════════════ */
function seedDemoChatMessages() {
  const demoMessages = [
    { user: '상대방', text: '오 잘하시네요 ㅋㅋ', time: nowStr() },
    { user: '상대방', text: '아 짜증나네 진짜', time: nowStr() },
    { user: '상대방', text: '광고) 무료 코인 받아가세요 bit.ly/xxxxx', time: nowStr() }
  ];
  demoMessages.forEach(appendChatMsg);
}
