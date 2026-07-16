/* ═══════════════════════════════════════════════════════
   MODE SELECTION
═══════════════════════════════════════════════════════ */
function showModeSelect() {
  clearInterval(timerInterval);
  clearTimeout(aiTimeout);
  clearTimeout(aiMoveTimeout);
  clearInterval(countdownStep);
  countdownActive = false;
  gameActive = false;
  if (drag.on) { drag.on = false; clearDragVisuals(drag.pid); }
  stopRecording();
  if (ws) { ws.close(); ws = null; } // 멀티 중이었다면 즉시 연결을 끊어서 상대방 참가자 목록도 바로 갱신되게 함
  $id('goOverlay').classList.remove('show');
  $id('countdownOverlay').classList.remove('show');
  $id('readyOverlay').classList.remove('show');
  $id('modeOverlay').style.display = 'flex';
}

async function selectMode(mode) {
  gameMode = mode;
  $id('modeOverlay').style.display = 'none';

  if (mode === 'multi') {
    p2AI = false;
    $id('sidePanel').style.display = 'flex';
    $id('aiBtn').textContent = '👥 2P 모드';
    $id('aiBtn').classList.remove('on');
    currentOpponentName = null; // 이전 매치의 상대 정보가 남아있지 않도록 초기화
    updateOpponentDisplay();
    setPresence(1); // 서버 응답이 오기 전까지는 나뿐이므로 대기 화면부터 표시
    $id('chatHistory').innerHTML = '';
    const loginOk = await loginToChatServer();
    if (!loginOk) {
      $id('sidePanel').style.display = 'none';
      $id('modeOverlay').style.display = 'flex';
      return;
    }
    seedDemoChatMessages(); // 임시: 신고 버튼 테스트용 예시 채팅
    connectChat();
  } else {
    p2AI = true;
    $id('sidePanel').style.display = 'none';
    $id('aiBtn').textContent = '🤖 AI 모드';
    $id('aiBtn').classList.add('on');
    $id('p2Label').textContent = '🤖 AI';
    $id('p2BannerName').textContent = '🤖 AI';
    $id('p2BannerHint').textContent = '자동 플레이 중';
    $id('p2Waiting').classList.remove('show');
  }

  showReadyScreen(mode);
}

/* ═══════════════════════════════════════════════════════
   READY SCREEN — 모드 선택 후, '게임 시작'을 눌러야 카운트다운이 시작됨
═══════════════════════════════════════════════════════ */
function showReadyScreen(mode) {
  $id('readyIcon').textContent = mode === 'multi' ? '👥' : '🤖';
  $id('readyTitle').textContent = mode === 'multi' ? '멀티플레이' : 'AI 모드';
  $id('readyPlayerList').style.display = mode === 'multi' ? 'block' : 'none';
  if (mode === 'multi') updateReadyPlayerList();
  $id('readyOverlay').classList.add('show');
}

function confirmGameStart() {
  // '음성 사용' 또는 '마이크 사용' 중 하나라도 체크돼 있으면 이번 라운드는 녹음 진행
  recordingConsented = $id('consentVoice').checked || $id('consentMic').checked;
  $id('readyOverlay').classList.remove('show');
  beginGame();
}

/* ═══════════════════════════════════════════════════════
   PRESENCE (멀티플레이 — 상대 접속 여부)
═══════════════════════════════════════════════════════ */
function setPresence(count) {
  const waiting = $id('p2Waiting');
  if (gameMode === 'multi' && count < 2) {
    waiting.classList.add('show');
  } else {
    waiting.classList.remove('show');
  }
  updateReadyPlayerList();
}

function updateReadyPlayerList() {
  if (gameMode !== 'multi') return;

  const selfName = $id('readySelfName');
  const opponentNameEl = $id('readyOpponentName');
  const opponentStatus = $id('readyOpponentStatus');
  if (!selfName || !opponentNameEl || !opponentStatus) return;

  selfName.textContent = MY_NAME || '나';
  if (currentOpponentName) {
    opponentNameEl.textContent = currentOpponentName;
    opponentStatus.textContent = '접속 중';
    opponentStatus.classList.add('connected');
  } else {
    opponentNameEl.textContent = '상대 플레이어 대기 중';
    opponentStatus.textContent = '대기 중';
    opponentStatus.classList.remove('connected');
  }
}

// 상대방의 실제 닉네임을 P2 배너/라벨에 반영 — 대기 중엔 '기다리는 중', 알게 되면 이름으로 표시
function updateOpponentDisplay() {
  if (gameMode !== 'multi') return;
  updateReadyPlayerList();
  if (currentOpponentName) {
    $id('p2Label').textContent = `👤 ${currentOpponentName}`;
    $id('p2BannerName').textContent = currentOpponentName;
    $id('p2BannerHint').textContent = '상대 플레이어가 조작 중';
  } else {
    $id('p2Label').textContent = '🎮 플레이어 2';
    $id('p2BannerName').textContent = '🎮 플레이어 2';
    $id('p2BannerHint').textContent = '상대 플레이어를 기다리는 중';
  }
}
