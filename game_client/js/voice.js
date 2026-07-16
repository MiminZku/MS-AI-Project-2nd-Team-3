/* ═══════════════════════════════════════════════════════
   VOICE — 실제 마이크 캡처 (getUserMedia + MediaRecorder)
   인게임에는 별도 "음성 채팅" 패널을 두지 않음 — 헤더의 🎤/🔊 아이콘으로만 제어하고,
   실제 녹음은 게임 시작~종료 동안 배경에서 자동으로 진행됨.
   업로드/서버 저장은 됨 (memory: voice_recording_scope 참고).

   ⚠️ 녹음 대상에 대한 중요한 메모:
   신고 증거로는 원래 "상대방이 말한 것"을 녹음해야 하지만, 지금은 두 브라우저
   사이에 오디오를 주고받는 통로(WebRTC 등 실시간 음성 연결) 자체가 없어서
   상대방 오디오를 받아올 방법이 없다. 그래서 getRecordingSource()는 remoteAudioStream이
   설정되기 전까지 임시로 "내 마이크"를 폴백으로 사용한다.
   나중에 실시간 음성 연결을 붙이면, 그쪽 코드에서 setRemoteAudioStream(stream)만
   호출해 주면 이후 녹음은 자동으로 상대방 오디오를 잡기 시작한다 (다른 코드 수정 불필요).
═══════════════════════════════════════════════════════ */
let recOn = false;

let micStream = null;           // 최초 허용 후 세션 동안 재사용 (재시작마다 권한 재요청 방지)
let micPermissionDenied = false;
let mediaRecorder = null;
let recordedChunks = [];
let lastRecordingBlob = null;   // 가장 최근 라운드 녹음 결과

let micMuted = false;      // 입력(마이크) 음소거 — 실제 트랙을 꺼서 녹음에도 그대로 반영됨
let outputMuted = false;   // 출력(스피커) 음소거 — 향후 상대방 음성 재생(WebRTC 등) 붙을 때 이 플래그로 제어

let remoteAudioStream = null; // 실시간 음성 연결이 붙으면 setRemoteAudioStream()으로 여기에 채워짐 (현재는 항상 null)

function setRemoteAudioStream(stream) {
  remoteAudioStream = stream;
}

// 지금 이 라운드에서 녹음할 오디오 소스를 고른다.
// 상대방 오디오(remoteAudioStream)가 있으면 그걸 우선 쓰고, 없으면(현재 상태) 임시로 내 마이크를 쓴다.
async function getRecordingSource() {
  if (remoteAudioStream) return remoteAudioStream;
  return ensureMicStream();
}

async function ensureMicStream() {
  if (micStream) return micStream;
  if (micPermissionDenied) return null;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    micPermissionDenied = true;
    return null;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getAudioTracks().forEach(t => t.enabled = !micMuted); // 이전에 꺼둔 상태였다면 유지
    return micStream;
  } catch (err) {
    micPermissionDenied = true;
    console.warn('마이크 권한을 얻지 못해 음성 녹음을 건너뜁니다:', err);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════
   헤더 아이콘: 마이크 온/오프, 음성 출력 온/오프
═══════════════════════════════════════════════════════ */
function toggleMicMute() {
  micMuted = !micMuted;
  if (micStream) micStream.getAudioTracks().forEach(t => t.enabled = !micMuted);
  updateMicMuteUI();
}

function updateMicMuteUI() {
  const btn = $id('micMuteBtn');
  if (!btn) return;
  btn.classList.toggle('muted', micMuted);
  btn.title = micMuted ? '마이크 꺼짐 (클릭하여 켜기)' : '마이크 켜짐 (클릭하여 끄기)';
}

function toggleOutputMute() {
  outputMuted = !outputMuted;
  // 지금은 재생 중인 원격 오디오가 없어 상태만 바뀌지만, 페이지에 audio/video가 생기면 즉시 반영됨
  document.querySelectorAll('audio, video').forEach(el => { el.muted = outputMuted; });
  updateOutputMuteUI();
}

function updateOutputMuteUI() {
  const btn = $id('outputMuteBtn');
  if (!btn) return;
  btn.classList.toggle('muted', outputMuted);
  btn.title = outputMuted ? '음성 출력 꺼짐 (클릭하여 켜기)' : '음성 출력 켜짐 (클릭하여 끄기)';
}

// 헤더 마이크 아이콘 모서리에 녹음 중임을 알리는 작은 빨간 점
function updateRecIndicator() {
  const dot = $id('recDotBadge');
  if (dot) dot.style.display = recOn ? 'block' : 'none';
}

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

async function startRecording() {
  if (recOn) return;

  if (!recordingConsented) {
    showToast('음성/마이크 사용에 동의하지 않아 녹음되지 않습니다');
    return;
  }

  const stream = await getRecordingSource();
  if (recOn) return; // await 대기 중 이미 다른 경로로 시작/정지됐다면 중복 방지

  if (!stream) {
    showToast('마이크 권한이 없어 녹음되지 않습니다');
    return;
  }

  recOn = true;
  recordedChunks = [];
  const mimeType = pickMimeType();
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    lastRecordingBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    recordedChunks = [];
    uploadRecording(lastRecordingBlob);
  };
  mediaRecorder.start();

  updateRecIndicator();
}

function stopRecording() {
  if (!recOn) return;
  recOn = false;

  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();

  updateRecIndicator();
}

/* ═══════════════════════════════════════════════════════
   라운드 종료 시 서버에 내 녹음 업로드
   (신고 시 상대방의 최신 녹음을 조회하는 방식이라, 각자 자기 녹음을 올려둬야 함)
═══════════════════════════════════════════════════════ */
function uploadRecording(blob) {
  if (gameMode !== 'multi' || !blob || !blob.size) return; // AI 모드는 신고 대상이 없어 업로드 의미 없음
  try {
    fetch(`${getHttpBase()}/upload-voice`, {
      method: 'POST',
      // HTTP 헤더 값은 ISO-8859-1만 허용되어 한글 사용자명을 그대로 넣으면 fetch가 즉시 예외를 던짐
      headers: { 'X-User': encodeURIComponent(MY_NAME) },
      body: blob
    }).catch(err => console.warn('음성 업로드 실패:', err));
  } catch (err) {
    console.warn('음성 업로드 요청 생성 실패:', err);
  }
}
