/* ═══════════════════════════════════════════════════════
   CHAT
═══════════════════════════════════════════════════════ */
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function nowStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function sendMsg() {
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
   WEBSOCKET CHAT
═══════════════════════════════════════════════════════ */
let ws = null;
let MY_NAME = null; // auth.js의 닉네임 입력에서 설정됨 (모드 선택 전에 반드시 정해짐)
let currentOpponentName = null; // 서버가 'opponent' 메시지로 알려줌 (같은 방에 상대가 있을 때만 값이 있음)

function opponentName() {
  return currentOpponentName || '상대방';
}

function getHttpBase() {
  const addr = ($id('serverAddr')?.value || 'localhost:3000').trim();
  return `http://${addr}`;
}

function connectChat() {
  // 이전 연결이 남아있으면 먼저 정리 (중복 소켓/중복 메시지 수신 방지)
  if (ws) {
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.close();
  }

  const addr = ($id('serverAddr')?.value || 'localhost:3000').trim();
  const url = `ws://${addr}`;
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
      } else if (data.type === 'full') {
        setChatStatus('🔴 방이 가득 참', 'var(--danger)');
        appendSystemMsg('— 이미 다른 두 명이 접속 중입니다 —');
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
  div.innerHTML = `<div class="msg-meta"><span class="msg-name" style="color:${isMe ? 'var(--accent)' : '#00E5A0'}">${escHtml(msg.user)}</span><span class="msg-time">${msg.time}</span></div><div class="msg-text">${escHtml(msg.text)}</div>`;

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
