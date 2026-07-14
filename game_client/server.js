const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 2;
const MAX_HISTORY = 50;
const MAX_NAME_LEN = 40;
const MAX_TEXT_LEN = 500;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 라운드 하나치 음성이라 20MB면 충분

const RECORDINGS_DIR = path.join(__dirname, 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR);

const clients = new Set();
const history = [];
const latestRecordingByUser = new Map(); // user -> { filepath, time } — 유저당 가장 최근 녹음 1개만 보관 (신고 증거 = 최신 라운드면 충분)

function send(client, data) {
  if (client.readyState === client.OPEN) client.send(JSON.stringify(data));
}

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
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

function nowStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-User, Content-Type');
}

/* ═══════════════════════════════════════════════════════
   HTTP: 라운드별 음성 업로드 / 신고 시 증거 조회
   (팀 논의 결과: 실시간 음성 통화 대신, 각자 자기 목소리를 녹음해
   서버에 올려두고 신고 시 그 유저의 최신 녹음을 찾아 보여주는 방식)
═══════════════════════════════════════════════════════ */
const httpServer = http.createServer((req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/upload-voice') {
    // 클라이언트가 헤더 인코딩 제약(ISO-8859-1) 때문에 encodeURIComponent로 보낸 사용자명을 복원
    let user = 'unknown';
    try { user = decodeURIComponent((req.headers['x-user'] || 'unknown').toString()); } catch { /* 인코딩이 이상하면 unknown 유지 */ }
    user = user.slice(0, MAX_NAME_LEN);
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD_BYTES) { tooLarge = true; req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) { res.writeHead(413); res.end('too large'); return; }
      if (!chunks.length) { res.writeHead(400); res.end('empty'); return; }
      const buffer = Buffer.concat(chunks);
      const safeUser = user.replace(/[^a-zA-Z0-9_가-힣]/g, '_') || 'unknown';
      const filepath = path.join(RECORDINGS_DIR, `${safeUser}.webm`);
      fs.writeFile(filepath, buffer, (err) => {
        if (err) { res.writeHead(500); res.end('write error'); return; }
        latestRecordingByUser.set(user, { filepath, time: Date.now() });
        res.writeHead(200); res.end('ok');
      });
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/report-audio') {
    const targetUser = (url.searchParams.get('user') || '').slice(0, MAX_NAME_LEN);
    const rec = latestRecordingByUser.get(targetUser);
    if (!rec || !fs.existsSync(rec.filepath)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'audio/webm' });
    fs.createReadStream(rec.filepath).pipe(res);
    return;
  }

  res.writeHead(404); res.end('not found');
});

/* ═══════════════════════════════════════════════════════
   WebSocket: 채팅 + 입장 알림 (HTTP와 같은 포트를 공유)
═══════════════════════════════════════════════════════ */
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
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
    broadcastPresence();
    broadcastOpponentInfo();
  });
});

httpServer.listen(PORT, () => {
  console.log(`서버 실행 중 — http://0.0.0.0:${PORT} (채팅 WebSocket도 같은 포트에서 대기)`);
});
