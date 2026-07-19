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
        if (data.name) maybeStartWebRTC();
      } else if (data.type === 'webrtc_offer' || data.type === 'webrtc_answer' || data.type === 'webrtc_ice_candidate' || data.type === 'webrtc_renegotiate') {
        handleWebRtcMessage(data);
      } else if (data.type === 'full') {
        setChatStatus('🔴 방이 가득 참', 'var(--danger)');
        appendSystemMsg('— 이미 다른 두 명이 접속 중입니다 —');
      } else if (data.type === 'system') {
        const text = typeof data.text === 'string' ? data.text : '';
        if (text.includes('정지') || text.includes('강제 퇴장')) {
          // BAN 알림 — 서버가 이 메시지 직후 소켓을 강제로 닫으므로, 실제 처리는 onclose에서 함
          pendingBanMessage = text || '계정이 정지되어 강제 퇴장되었습니다.';
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
