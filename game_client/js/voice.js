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
  return ensureMicStream();
}

async function ensureMicStream() {
  if (micStream) return micStream;
  if (micPermissionDenied) return null;
  if (!navigator.mediaDevices?.getUserMedia) {
    micPermissionDenied = true;
    return null;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return micStream;
  } catch (err) {
    micPermissionDenied = true;
    console.warn('마이크 권한을 얻지 못해 음성 녹음을 건너뜁니다:', err);
    return null;
  }
}

async function handleMicConsentChange(event) {
  if (!event.target.checked) return;

  const stream = await ensureMicStream();
  if (!stream) {
    event.target.checked = false;
    recordingConsented = false;
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      showToast('마이크는 HTTPS 또는 localhost에서만 사용할 수 있습니다.');
    } else {
      showToast('마이크 권한이 거부되었거나 사용할 수 없습니다.');
    }
    return;
  }
  
  // 이미 연결된 WebRTC가 있으면 재협상(Renegotiation) 수행
  if (peerConnection && webRtcCallStarted) {
    const senders = peerConnection.getSenders();
    const hasAudio = senders.some(s => s.track && s.track.kind === 'audio');
    if (!hasAudio) {
      stream.getAudioTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
      });
      // 발신자(ID가 작은 쪽)가 다시 Offer를 보내도록 유도
      if (String(MY_NAME) < String(currentOpponentName)) {
        webRtcCallStarted = false;
        startCall();
      } else {
        sendWebRtcMessage({ type: 'webrtc_renegotiate' });
      }
    }
  }
}

$id('consentMic')?.addEventListener('change', handleMicConsentChange);

/* ═══════════════════════════════════════════════════════
   헤더 아이콘: 마이크 온/오프, 음성 출력 온/오프
═══════════════════════════════════════════════════════ */
function toggleMicMute() {
  micMuted = !micMuted;
  if (micStream) {
    micStream.getAudioTracks().forEach(track => { track.enabled = !micMuted; });
  }
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

  if (!window.MediaRecorder) {
    showToast('이 브라우저는 음성 녹음을 지원하지 않습니다.');
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

function stopMicCapture() {
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  micMuted = false;
  updateMicMuteUI();
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

/* =========================
   WEBRTC VOICE CHAT
   ========================= */
let peerConnection = null;
let webRtcStarting = false;
let webRtcCallStarted = false;
let webRtcRestartPending = false;
let remoteDescriptionSet = false;
let pendingIceCandidates = [];

const WEBRTC_CONFIGURATION = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function isVoiceEnabled() {
  const micConsent = $id('consentMic');
  const speakerConsent = $id('consentVoice');
  return Boolean(micConsent?.checked || speakerConsent?.checked);
}

function isSpeakerOutputEnabled() {
  return Boolean($id('consentVoice')?.checked);
}

function sendWebRtcMessage(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function ensureRemoteAudioElement() {
  let audioEl = $id('remoteAudio');
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = 'remoteAudio';
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.setAttribute('aria-label', '상대방 음성');
    document.body.appendChild(audioEl);
  }
  return audioEl;
}

async function flushPendingIceCandidates() {
  if (!peerConnection?.remoteDescription) return;
  const candidates = pendingIceCandidates.splice(0);
  for (const candidate of candidates) {
    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (err) {
      console.warn('대기 중인 ICE 후보 추가 실패:', err);
    }
  }
}

async function initWebRTC() {
  if (peerConnection) return peerConnection;

  peerConnection = new RTCPeerConnection(WEBRTC_CONFIGURATION);
  remoteDescriptionSet = false;

  const micEnabled = Boolean($id('consentMic')?.checked);
  if (micEnabled) {
    const myStream = await ensureMicStream();
    if (myStream) {
      myStream.getAudioTracks().forEach(track => {
        track.enabled = !micMuted;
        peerConnection.addTrack(track, myStream);
      });
    }
  }

  // 마이크를 쓰지 않는 사용자도 상대방 음성을 받을 수 있도록 수신 슬롯을 만든다.
  if (!peerConnection.getTransceivers().some(t => t.receiver.track.kind === 'audio')) {
    peerConnection.addTransceiver('audio', { direction: micEnabled ? 'sendrecv' : 'recvonly' });
  }

  peerConnection.ontrack = (event) => {
    const remoteStream = event.streams?.[0] || new MediaStream([event.track]);
    setRemoteAudioStream(remoteStream);
    const audioEl = ensureRemoteAudioElement();
    audioEl.srcObject = remoteStream;
    audioEl.muted = outputMuted || !isSpeakerOutputEnabled();
    audioEl.play().catch(() => {
      // 브라우저 자동 재생 정책으로 실패할 수 있으며, 사용자 상호작용 후 재생을 재시도한다.
    });
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendWebRtcMessage({ type: 'webrtc_ice_candidate', candidate: event.candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(peerConnection.connectionState)) {
      const audioEl = $id('remoteAudio');
      if (audioEl) audioEl.srcObject = null;
      setRemoteAudioStream(null);
    }
  };

  return peerConnection;
}

async function startCall() {
  if (!isVoiceEnabled() || webRtcCallStarted || webRtcStarting) return;
  webRtcStarting = true;
  try {
    const pc = await initWebRTC();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (sendWebRtcMessage({
      type: 'webrtc_offer',
      offer: pc.localDescription,
      restart: webRtcRestartPending
    })) {
      webRtcCallStarted = true;
      webRtcRestartPending = false;
    }
  } catch (err) {
    console.warn('WebRTC 통화 시작 실패:', err);
    closeWebRTC();
  } finally {
    webRtcStarting = false;
  }
}

async function handleWebRtcMessage(data) {
  if (!data?.type) return;

  try {
    if (data.type === 'webrtc_offer') {
      if (data.restart) closeWebRTC();
      const pc = await initWebRTC();
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      remoteDescriptionSet = true;
      await flushPendingIceCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWebRtcMessage({ type: 'webrtc_answer', answer: pc.localDescription });
      webRtcCallStarted = true;
    } else if (data.type === 'webrtc_answer') {
      if (!peerConnection) return;
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      remoteDescriptionSet = true;
      await flushPendingIceCandidates();
    } else if (data.type === 'webrtc_ice_candidate' && data.candidate) {
      const candidate = new RTCIceCandidate(data.candidate);
      if (peerConnection?.remoteDescription) {
        await peerConnection.addIceCandidate(candidate);
      } else {
        pendingIceCandidates.push(candidate);
      }
    } else if (data.type === 'webrtc_renegotiate') {
      if (String(MY_NAME) < String(currentOpponentName)) {
        webRtcCallStarted = false;
        startCall();
      }
    }
  } catch (err) {
    console.warn('WebRTC 시그널 처리 실패:', err);
  }
}

function maybeStartWebRTC() {
  if (!isVoiceEnabled() || !currentOpponentName || !MY_NAME) return;
  // 두 클라이언트가 동시에 Offer를 만들지 않도록 ID가 작은 쪽만 발신한다.
  if (String(MY_NAME) < String(currentOpponentName)) startCall();
}

function closeWebRTC() {
  webRtcCallStarted = false;
  webRtcStarting = false;
  remoteDescriptionSet = false;
  pendingIceCandidates = [];
  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.close();
    peerConnection = null;
  }
  const audioEl = $id('remoteAudio');
  if (audioEl) audioEl.srcObject = null;
  setRemoteAudioStream(null);
}
