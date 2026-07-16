/* ═══════════════════════════════════════════════════════
   공유 인메모리 상태 — routes(HTTP)와 sockets(WebSocket)가 함께 참조
═══════════════════════════════════════════════════════ */
const MAX_HISTORY = 50;

const clients = new Set();               // 접속 중인 WebSocket 클라이언트 (ws.nickname을 붙여서 씀)
const history = [];                       // 최근 채팅 메시지
const latestRecordingByUser = new Map();  // user -> { filepath, time } — 유저당 최신 녹음 1개만 보관

function send(client, data) {
  if (client.readyState === client.OPEN) client.send(JSON.stringify(data));
}

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

module.exports = { MAX_HISTORY, clients, history, latestRecordingByUser, send, broadcast };
