/* ═══════════════════════════════════════════════════════
   로그인 → 닉네임 → 모드 선택 진입 플로우

   ⚠️ 로그인은 지금 실제 인증(계정 DB/비밀번호 검증)이 없는 프론트엔드 목업입니다.
   아이디/비밀번호를 둘 다 입력하면 통과시키고, 실제로 서버에 검증을 요청하지 않습니다.
   나중에 진짜 로그인 API가 생기면 submitLogin() 안의 통과 조건만 바꾸면 됩니다.
═══════════════════════════════════════════════════════ */
function submitLogin() {
  const id = $id('loginId').value.trim();
  const pw = $id('loginPw').value.trim();
  const err = $id('loginError');

  if (!id || !pw) {
    err.style.display = 'block';
    return;
  }
  err.style.display = 'none';

  $id('loginOverlay').style.display = 'none';
  $id('nicknameOverlay').classList.add('show');
  $id('nicknameInput').focus();
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

  $id('nicknameOverlay').classList.remove('show');
  // 모드 선택 화면은 이미 그 아래 깔려 있으므로 별도 표시 처리 불필요
}

$id('loginId').addEventListener('keydown', e => { if (e.key === 'Enter') $id('loginPw').focus(); });
$id('loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });
$id('nicknameInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitNickname(); });
