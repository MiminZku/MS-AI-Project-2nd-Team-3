/* ═══════════════════════════════════════════════════════
   HTTP 라우트: 라운드별 음성 업로드 / 신고 시 증거 조회
   (팀 논의 결과: 실시간 음성 통화 대신, 각자 자기 목소리를 녹음해
   서버에 올려두고 신고 시 그 유저의 최신 녹음을 찾아 보여주는 방식)
═══════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { latestRecordingByUser } = require('../state');

const MAX_NAME_LEN = 40;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 라운드 하나치 음성이라 20MB면 충분

const RECORDINGS_DIR = path.join(__dirname, '..', '..', 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR);

// POST /upload-voice — 라운드 종료 시 자동 업로드됨 (body: 오디오 원본, 헤더: X-User)
function uploadVoice(req, res) {
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
    const filepath = path.join(RECORDINGS_DIR, `${safeUser}.wav`);
    fs.writeFile(filepath, buffer, (err) => {
      if (err) { res.writeHead(500); res.end('write error'); return; }
      latestRecordingByUser.set(user, { filepath, time: Date.now() });
      res.writeHead(200); res.end('ok');
    });
  });
}

// GET /report-audio?user=X — 신고 접수 시 대상 유저의 최신 녹음 조회
function reportAudio(req, res, url) {
  const targetUser = (url.searchParams.get('user') || '').slice(0, MAX_NAME_LEN);
  const rec = latestRecordingByUser.get(targetUser);
  if (!rec || !fs.existsSync(rec.filepath)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': 'audio/wav' });
  fs.createReadStream(rec.filepath).pipe(res);
}

module.exports = { uploadVoice, reportAudio };
