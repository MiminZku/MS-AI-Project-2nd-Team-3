/* ═══════════════════════════════════════════════════════
   로그인 → 닉네임 → 모드 선택 진입 플로우

   로그인 시 /api/login을 호출해 정지(banned) 여부를 확인한다.
   정지된 계정이면 안내 문구를 띄우고 로그인 화면에 그대로 머무른다.
═══════════════════════════════════════════════════════ */
async function submitLogin() {
  const id = $id('loginId').value.trim();
  const err = $id('loginError');
  const btn = $id('loginSubmitBtn');

  if (!id) {
    err.textContent = '아이디를 입력해 주세요';
    err.style.display = 'block';
    return;
  }
  err.style.display = 'none';

  if (btn) { btn.disabled = true; btn.textContent = '로그인 중...'; }

  try {
    const res = await fetch(`${getHttpBase()}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: id })
    });
    const data = await res.json();

    if (data.status === 'banned') {
      err.textContent = `계정이 정지되었습니다. 정지 해제 일시: ${data.banned_until}`;
      err.style.display = 'block';
      return; // 로그인 화면에 그대로 머무름
    }

    if (!res.ok) {
      err.textContent = '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
      err.style.display = 'block';
      return;
    }

    MY_NAME = id;
    $id('playerName').textContent = id;
    $id('playerAvatar').textContent = id.slice(0, 2);
    $id('p1Label').textContent = id;
    $id('p1BannerName').textContent = id;
    $id('goP1Name').textContent = `🎮 ${id}`;
    $id('loginOverlay').style.display = 'none';

    if (data.is_muted) applyChatMuted(true); // 채팅 금지 계정 — 채팅 입력창을 미리 막아둠
  } catch (fetchErr) {
    console.warn('로그인 요청 실패:', fetchErr);
    err.textContent = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
    err.style.display = 'block';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '로그인'; }
  }
}

function submitNickname() {
  const nickname = $id('nicknameInput').value.trim();
  const err = $id('nicknameError');

  if (!nickname) {
    err.style.display = 'block';
    return;
  }
  err.style.display = 'none';

  // 이 닉네임이 곧 채팅/신고 시스템에서 쓰는 내 식별자가 됨
  MY_NAME = nickname;
  $id('playerName').textContent = nickname;
  $id('playerAvatar').textContent = nickname.slice(0, 2);

  // "플레이어 1" 자리(HUD/배너/결과화면)를 전부 내 닉네임으로 교체 — 모드와 무관하게 나는 항상 P1
  $id('p1Label').textContent = nickname;
  $id('p1BannerName').textContent = nickname;
  $id('goP1Name').textContent = `🎮 ${nickname}`;

  $id('nicknameOverlay').classList.remove('show');
  // 모드 선택 화면은 이미 그 아래 깔려 있으므로 별도 표시 처리 불필요
}

$id('loginId').addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });
