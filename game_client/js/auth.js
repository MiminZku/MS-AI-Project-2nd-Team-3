/* ═══════════════════════════════════════════════════════
   로그인 → 닉네임 → 모드 선택 진입 플로우

   로그인 시 /api/login을 호출해 정지(banned) 여부를 확인한다.
   정지된 계정이면 안내 문구를 띄우고 로그인 화면에 그대로 머무른다.
═══════════════════════════════════════════════════════ */
function formatRestrictionTime(value) {
  if (!value) return '영구 정지';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace(/:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/, '');

  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

let appealSubmitting = false;

function openAppealModal() {
  const loginId = $id('loginId')?.value.trim() || '';
  $id('appealUserId').value = loginId;
  $id('appealReason').value = '';
  $id('appealError').textContent = '';
  $id('appealLatest').classList.remove('show');
  $id('appealLatest').textContent = '';
  $id('appealOverlay').classList.add('open');
  setTimeout(() => $id('appealUserId')?.focus(), 0);
  if (loginId) loadLatestAppeal(loginId);
}

function appealStatusLabel(status) {
  return ({ PENDING: '검토 대기', APPROVED: '승인', REJECTED: '반려' })[status] || status || '상태 확인 중';
}

async function loadLatestAppeal(userId) {
  const latest = $id('appealLatest');
  try {
    const response = await fetch(`${getHttpBase()}/api/client/appeals/latest?user_id=${encodeURIComponent(userId)}`);
    if (!response.ok) throw new Error(`latest appeal request failed: ${response.status}`);
    const data = await response.json();
    const appeal = data.appeal;
    if (!appeal) return;

    latest.innerHTML = `<strong>최근 이의신청</strong><br>상태: ${appealStatusLabel(appeal.status)}<br>사유: ${escHtml(String(appeal.reason || '-'))}<br>접수: ${formatRestrictionTime(appeal.created_at)}`;
    latest.classList.add('show');
  } catch (error) {
    console.warn('최근 이의신청 조회 실패:', error);
  }
}

function closeAppealModal() {
  if (appealSubmitting) return;
  $id('appealOverlay').classList.remove('open');
}

function closeAppealOnBackground(event) {
  if (event.target === $id('appealOverlay')) closeAppealModal();
}

async function submitAppeal() {
  if (appealSubmitting) return;

  const userId = $id('appealUserId').value.trim();
  const reason = $id('appealReason').value.trim();
  const error = $id('appealError');
  const button = $id('appealSubmitBtn');

  if (!userId || !reason) {
    error.textContent = '아이디와 이의신청 사유를 모두 입력해 주세요.';
    return;
  }

  appealSubmitting = true;
  button.disabled = true;
  button.textContent = '전송 중...';
  error.textContent = '서버로 이의신청을 전송하고 있습니다.';

  try {
    const response = await fetch(`${getHttpBase()}/api/client/appeals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, reason })
    });

    if (!response.ok) throw new Error(`appeal request failed: ${response.status}`);

    error.style.color = 'var(--success)';
    error.textContent = '이의신청이 접수되었습니다.';
    button.textContent = '접수 완료';
    const latest = $id('appealLatest');
    latest.innerHTML = `<strong>최근 이의신청</strong><br>상태: 검토 대기<br>사유: ${escHtml(reason)}<br>접수: 방금 전`;
    latest.classList.add('show');
    setTimeout(() => {
      $id('appealOverlay').classList.remove('open');
      error.style.color = '';
      button.disabled = false;
      button.textContent = '전송';
      appealSubmitting = false;
    }, 1200);
  } catch (submitError) {
    console.warn('이의신청 전송 실패:', submitError);
    error.style.color = '';
    error.textContent = '서버에 접속하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    button.disabled = false;
    button.textContent = '전송';
    appealSubmitting = false;
  }
}

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

  if (btn) {
    btn.innerHTML = '<span class="login-spinner" aria-hidden="true"></span><span>로그인 중...</span>';
    btn.classList.add('is-loading');
  }

  try {
    const res = await fetch(`${getHttpBase()}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: id })
    });
    const data = await res.json();

    if (data.status === 'banned') {
      const message = `계정이 정지되었습니다.\n정지 해제 일시: ${formatRestrictionTime(data.banned_until)}`;
      alert(message);
      err.textContent = message.replace('\n', ' ');
      err.style.display = 'block';
      $id('loginOverlay').style.display = 'flex';
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
    const p1BannerName = $id('p1BannerName');
    if (p1BannerName) p1BannerName.textContent = id;
    $id('goP1Name').textContent = `🎮 ${id}`;
    $id('loginOverlay').style.display = 'none';
    // 강제 퇴장 후 재로그인하는 경우 숨겨져 있던 모드 선택 화면을 복구한다.
    $id('modeOverlay').style.display = 'flex';
    $id('sidePanel').style.display = 'none';

    applyChatMuted(Boolean(data.is_muted)); // 이전 계정의 MUTE 상태가 남지 않도록 매번 갱신
  } catch (fetchErr) {
    console.warn('로그인 요청 실패:', fetchErr);
    err.textContent = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
    err.style.display = 'block';
  } finally {
    if (btn) btn.classList.remove('is-loading');
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
  const p1BannerName = $id('p1BannerName');
  if (p1BannerName) p1BannerName.textContent = nickname;
  $id('goP1Name').textContent = `🎮 ${nickname}`;

  $id('nicknameOverlay').classList.remove('show');
  // 모드 선택 화면은 이미 그 아래 깔려 있으므로 별도 표시 처리 불필요
}

$id('loginId').addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });
