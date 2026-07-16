/* ═══════════════════════════════════════════════════════
   WebSocket: 채팅 + 입장 알림
═══════════════════════════════════════════════════════ */
const { MAX_HISTORY, clients, history, send, broadcast } = require('../state');

const MAX_PLAYERS = 2;
const MAX_NAME_LEN = 40;
const MAX_TEXT_LEN = 500;

function nowStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function broadcastPresence() {
  broadcast({ type: 'presence', count: clients.size });
}

// 각 클라이언트에게 "지금 같은 방에 있는 상대방의 닉네임"을 알려줌 (1v1이라 최대 1명)
function broadcastOpponentInfo() {
  const list = Array.from(clients);
  for (const c of list) {
    const other = list.find(x => x !== c);
    send(c, { type: 'opponent', name: (other && other.nickname) || null });
  }
}

function handleConnection(ws) {
  // 방(1v1)이 이미 가득 찼으면 접속을 거절 — P1/P2 두 명으로만 구성되는 게임이라 3번째는 받지 않음
  if (clients.size >= MAX_PLAYERS) {
    send(ws, { type: 'full' });
    ws.close();
    return;
  }

  ws.nickname = null; // 클라이언트가 'identify' 메시지로 알려줄 때까지는 모름
  clients.add(ws);
  send(ws, { type: 'history', messages: history });
  send(ws, { type: 'presence', count: clients.size });
  broadcastPresence();

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === 'identify') {
      if (typeof data.user !== 'string' || !data.user.trim()) return;
      ws.nickname = data.user.slice(0, MAX_NAME_LEN);
      broadcastOpponentInfo();
      return;
    }

    if (['webrtc_offer', 'webrtc_answer', 'webrtc_ice_candidate'].includes(data.type)) {
      for (const other of clients) {
        if (other !== ws) send(other, data);
      }
      return;
    }

    if (data.type !== 'chat') return;
    if (typeof data.user !== 'string' || typeof data.text !== 'string') return;
    const text = data.text.trim().slice(0, MAX_TEXT_LEN);
    if (!text) return;

    const message = {
      user: data.user.slice(0, MAX_NAME_LEN),
      text,
      time: nowStr()
    };
    history.push(message);
    if (history.length > MAX_HISTORY) history.shift();
    broadcast({ type: 'chat', message });
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (clients.size === 0) history.length = 0; // 둘 다 나가면 다음 매치를 위해 채팅 기록 초기화
    broadcastPresence();
    broadcastOpponentInfo();
  });
}

module.exports = { handleConnection };
