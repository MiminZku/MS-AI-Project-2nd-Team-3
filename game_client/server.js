/* ═══════════════════════════════════════════════════════
   진입점 — HTTP 서버 생성, 라우트/소켓 연결, listen만 담당
   실제 로직은 server/routes(HTTP), server/sockets(WebSocket)에 기능별로 분리됨
═══════════════════════════════════════════════════════ */
const http = require('http');
const { WebSocketServer } = require('ws');

const voiceRoutes = require('./server/routes/voice');
const chatSocket = require('./server/sockets/chat');

const PORT = process.env.PORT || 3000;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-User, Content-Type');
}

const httpServer = http.createServer((req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/upload-voice') return voiceRoutes.uploadVoice(req, res);
  if (req.method === 'GET' && url.pathname === '/report-audio') return voiceRoutes.reportAudio(req, res, url);

  res.writeHead(404); res.end('not found');
});

/* WebSocket(채팅 + 입장 알림)은 HTTP와 같은 포트를 공유 */
const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', chatSocket.handleConnection);

httpServer.listen(PORT, () => {
  console.log(`서버 실행 중 — http://0.0.0.0:${PORT} (채팅 WebSocket도 같은 포트에서 대기)`);
});
