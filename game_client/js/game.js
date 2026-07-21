/* ═══════════════════════════════════════════════════════
   CANVAS SYNC
═══════════════════════════════════════════════════════ */
function syncCanvas() {
  p1Canvas.width  = p1Area.clientWidth;  p1Canvas.height = p1Area.clientHeight;
  p2Canvas.width  = p2Area.clientWidth;  p2Canvas.height = p2Area.clientHeight;
}
const ro = new ResizeObserver(syncCanvas);
ro.observe(p1Area);
ro.observe(p2Area);
syncCanvas();

/* ═══════════════════════════════════════════════════════
   COUNTDOWN → GAME START
   (재시작/모드 선택 등 게임을 시작하는 모든 진입점은 이 함수를 거침)
═══════════════════════════════════════════════════════ */
function beginGame() {
  if (countdownActive) return;
  countdownActive = true;

  // 진행 중이던 게임/타이머/녹음을 즉시 정지 (카운트다운 중 뒤에서 계속 도는 것 방지)
  clearInterval(timerInterval);
  clearTimeout(aiTimeout);
  clearTimeout(aiMoveTimeout);
  gameActive = false;
  if (drag.on) { drag.on = false; clearDragVisuals(drag.pid); }
  stopRecording();
  goOverlay.classList.remove('show');

  const overlay = $id('countdownOverlay');
  const numEl = $id('countdownNum');
  overlay.classList.add('show');

  let n = 3;
  const render = () => {
    numEl.textContent = n > 0 ? n : '시작!';
    numEl.classList.toggle('go', n <= 0);
    // 매초 펄스 애니메이션을 다시 재생하기 위한 강제 리플로우
    numEl.style.animation = 'none';
    void numEl.offsetWidth;
    numEl.style.animation = '';
  };
  render();

  clearInterval(countdownStep);
  countdownStep = setInterval(() => {
    n--;
    render();
    if (n <= 0) {
      clearInterval(countdownStep);
      setTimeout(() => {
        overlay.classList.remove('show');
        countdownActive = false;
        startGame();
      }, 400);
    }
  }, 1000);
}

/* ═══════════════════════════════════════════════════════
   GAME INIT
═══════════════════════════════════════════════════════ */
function startGame() {
  clearInterval(timerInterval);
  clearTimeout(aiTimeout);
  clearTimeout(aiMoveTimeout);
  timeLeft = 30;
  gameActive = true;
  goOverlay.classList.remove('show');
  timerEl.textContent = '2:00';
  timerEl.classList.remove('timer-warn');
  sumEl.textContent = '—'; sumEl.style.color = 'var(--text-muted)';

  if (drag.on) { drag.on = false; clearDragVisuals(drag.pid); }

  [1, 2].forEach(pid => {
    const p = P[pid];
    p.grid = Array.from({length: TOTAL}, randomApple);
    p.stones = new Set();
    p.score = 0; p.removed = 0; p.attacks = 0;

    const gridEl = $id(`p${pid}Grid`);
    gridEl.innerHTML = '';
    p.cells = [];
    for (let i = 0; i < TOTAL; i++) {
      const div = document.createElement('div');
      div.className = 'apple-cell';
      div.dataset.idx = i;
      div.textContent = p.grid[i];
      gridEl.appendChild(div);
      p.cells.push(div);
    }
    updateHUD(pid);
  });

  timerInterval = setInterval(tick, 1000);
  if (p2AI) scheduleAI();
  // 대기실이 아닌 실제 게임 시작 시점에만 음성 통화를 연결한다.
  maybeStartWebRTC();
  startRecording(); // 게임 시작과 동시에 음성 녹음 자동 시작 (AI/멀티 모드 공통)
}

function tick() {
  timeLeft--;
  const m = String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const s = String(timeLeft % 60).padStart(2, '0');
  timerEl.textContent = `${m}:${s}`;
  if (timeLeft <= 20) timerEl.classList.add('timer-warn');
  if (timeLeft <= 0) endGame();
}

function endGame() {
  clearInterval(timerInterval);
  clearTimeout(aiTimeout);
  clearTimeout(aiMoveTimeout);
  gameActive = false;
  stopRecording(); // 게임 종료 시점까지만 녹음
  stopMicCapture(); // 게임이 끝나면 마이크 장치도 즉시 해제
  closeWebRTC(); // 다음 게임에서 새 마이크 트랙으로 다시 연결할 수 있도록 초기화

  // 종료 시점에 드래그가 진행 중이었다면 취소하고 시각효과를 정리 (종료 후 점수 반영 방지)
  if (drag.on) { drag.on = false; clearDragVisuals(drag.pid); }

  const s1 = P[1].score, s2 = P[2].score;
  const winner = s1 > s2 ? 1 : s2 > s1 ? 2 : 0;
  const p2Name = p2AI ? '🤖 AI' : '🎮 플레이어 2';

  $id('goTitle').textContent = winner === 1 ? '🏆 플레이어 1 승리!' : winner === 2 ? (p2AI ? '🤖 AI 승리!' : '🏆 플레이어 2 승리!') : '🤝 무승부!';
  $id('goP1Score').textContent = s1.toLocaleString();
  $id('goP1Score').className = 'go-sv' + (winner === 1 ? ' winner' : '');
  $id('goP2Score').textContent = s2.toLocaleString();
  $id('goP2Score').className = 'go-sv' + (winner === 2 ? ' winner' : '');
  $id('goP2Name').textContent = p2Name;
  goOverlay.classList.add('show');
}

function updateP2ScoreLabel() {
  if (gameMode !== 'multi' || p2AI) return;
  const hint = $id('p2BannerHint');
  if (hint) hint.textContent = `점수: ${(P[2]?.score || 0).toLocaleString()}점`;
}

function updateHUD(pid) {
  const p = P[pid];
  $id(`p${pid}Score`).textContent = p.score.toLocaleString();
  $id(`p${pid}Removed`).textContent = p.removed;
  $id(`p${pid}Attacks`).textContent = p.attacks;
  if (pid === 2) updateP2ScoreLabel();
}

/* ═══════════════════════════════════════════════════════
   MOUSE / TOUCH CONTROLS
═══════════════════════════════════════════════════════ */
function relPos(point, el) {
  const r = el.getBoundingClientRect();
  return { x: point.clientX - r.left, y: point.clientY - r.top };
}

function startDrag(e, pid) {
  if (!gameActive) return;
  if (pid === 2 && p2AI) return; // AI controls P2
  if (pid === 2 && gameMode === 'multi') return; // 멀티플레이에서는 P2 보드를 원격 플레이어만 조작
  const areaEl  = pid === 1 ? p1Area : p2Area;
  const canvasEl = pid === 1 ? p1Canvas : p2Canvas;
  // 터치 이벤트는 e.touches[0]에서 좌표를, preventDefault는 원본 이벤트(e)에서 호출해야 함
  const point = e.touches ? e.touches[0] : e;
  const pos = relPos(point, areaEl);
  drag = { on: true, pid, areaEl, canvasEl, start: pos, end: pos, sel: [], sum: 0 };
  e.preventDefault();
}

p1Area.addEventListener('mousedown', e => startDrag(e, 1));
p2Area.addEventListener('mousedown', e => startDrag(e, 2));
p1Area.addEventListener('touchstart', e => startDrag(e, 1), {passive:false});
p2Area.addEventListener('touchstart', e => startDrag(e, 2), {passive:false});

document.addEventListener('mousemove', e => {
  if (!drag.on) return;
  drag.end = relPos(e, drag.areaEl);
  processSelection();
});
document.addEventListener('touchmove', e => {
  if (!drag.on) return;
  drag.end = relPos(e.touches[0], drag.areaEl);
  processSelection();
  e.preventDefault(); // 드래그 중 페이지 스크롤 방지
}, {passive:false});

document.addEventListener('mouseup',  endDrag);
document.addEventListener('touchend', endDrag);

function endDrag() {
  if (!drag.on) return;
  drag.on = false;
  if (gameActive && drag.sum === 10 && drag.sel.length > 0) {
    executeRemove(drag.pid, drag.sel);
  }
  clearDragVisuals(drag.pid);
}

/* ═══════════════════════════════════════════════════════
   SELECTION
═══════════════════════════════════════════════════════ */
function processSelection() {
  if (!drag.on) return;
  const { pid, areaEl, canvasEl, start, end } = drag;
  const p = P[pid];

  const sx = Math.min(start.x, end.x), sy = Math.min(start.y, end.y);
  const ex = Math.max(start.x, end.x), ey = Math.max(start.y, end.y);

  const areaRect = areaEl.getBoundingClientRect();
  let sum = 0;
  const sel = [];

  p.cells.forEach((el, idx) => {
    if (p.grid[idx] === 0 || p.stones.has(idx)) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width  / 2 - areaRect.left;
    const cy = r.top  + r.height / 2 - areaRect.top;
    if (cx >= sx && cx <= ex && cy >= sy && cy <= ey) {
      sel.push(idx); sum += p.grid[idx];
    }
  });

  // Update cell classes
  p.cells.forEach(el => el.classList.remove('sel-partial','sel-match','sel-over'));
  const cls = sum === 10 ? 'sel-match' : sum > 10 ? 'sel-over' : 'sel-partial';
  sel.forEach(idx => p.cells[idx].classList.add(cls));

  drag.sel = sel; drag.sum = sum;

  // Update sum HUD (P1 only)
  if (pid === 1) {
    if (!sel.length) { sumEl.textContent = '—'; sumEl.style.color = 'var(--text-muted)'; }
    else if (sum === 10) { sumEl.textContent = '10 ✓'; sumEl.style.color = 'var(--success)'; }
    else if (sum > 10)  { sumEl.textContent = sum + ' ✗'; sumEl.style.color = 'var(--danger)'; }
    else                { sumEl.textContent = sum + ' / 10'; sumEl.style.color = 'var(--accent)'; }
  }

  // Draw selection rectangle
  drawSelRect(canvasEl.getContext('2d'), canvasEl, sx, sy, ex - sx, ey - sy, sum, sel.length);
}

function drawSelRect(ctx, canvas, x, y, w, h, sum, count) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (w < 2 && h < 2) return;
  // 합계 10 성공 상태에서는 선택 범위 전체에 반투명 레이어를 깔지 않고 테두리만 표시한다.
  // 선택 범위가 넓을 때 보드 전체가 흐릿해 보이는 현상을 방지한다.
  const fill   = sum === 10 ? 'rgba(0,0,0,0)' : sum > 10 ? 'rgba(224,51,90,.12)' : 'rgba(108,99,255,.12)';
  const stroke = sum === 10 ? '#0EA968'               : sum > 10 ? '#E0335A'            : '#6C63FF';
  ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 2;
  ctx.setLineDash(sum === 10 ? [] : [5,3]);
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
  // Sum label inside rect
  if (count > 0) {
    ctx.fillStyle = stroke;
    ctx.font = 'bold 12px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    const label = sum === 10 ? '✓ 10' : sum > 10 ? `${sum} ✗` : `${sum} / 10`;
    const lx = Math.min(x + w - 4, Math.max(x + 4, x + w / 2));
    const ly = y + h + 16;
    ctx.globalAlpha = .9;
    ctx.fillText(label, lx, Math.min(ly, canvas.height - 4));
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}

function clearDragVisuals(pid) {
  P[pid].cells.forEach(el => el.classList.remove('sel-partial','sel-match','sel-over'));
  const ctx = pid === 1 ? p1Ctx : p2Ctx;
  const cv  = pid === 1 ? p1Canvas : p2Canvas;
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (pid === 1) { sumEl.textContent = '—'; sumEl.style.color = 'var(--text-muted)'; }
}

/* ═══════════════════════════════════════════════════════
   REMOVE APPLES
═══════════════════════════════════════════════════════ */
function executeRemove(pid, indices) {
  if (!indices.length) return;
  const p = P[pid];
  const opp = pid === 1 ? 2 : 1;
  const count = indices.length;
  const pts   = count * 10;

  // Find centroid in area coords
  const areaEl = pid === 1 ? p1Area : p2Area;
  const areaRect = areaEl.getBoundingClientRect();
  let cx = 0, cy = 0;
  indices.forEach(idx => {
    const r = p.cells[idx].getBoundingClientRect();
    cx += r.left + r.width / 2 - areaRect.left;
    cy += r.top  + r.height / 2 - areaRect.top;
  });
  cx /= count; cy /= count;

  // Pop
  indices.forEach(idx => {
    p.grid[idx] = 0;
    const el = p.cells[idx];
    el.classList.remove('sel-partial','sel-match','sel-over','stone');
    el.classList.add('popping');
    el.addEventListener('animationend', () => { el.className='apple-cell empty'; el.textContent=''; }, {once:true});
  });

  p.score += pts; p.removed += count;
  updateHUD(pid);
  showScorePop(`+${pts}`, areaEl, cx, cy);

  // Stone attack if 4+
  if (count >= 4) {
    p.attacks++;
    updateHUD(pid);
    setTimeout(() => {
      addStone(opp);
      showAttackNotif(pid, opp, count);
    }, 200);
  }
}

/* ═══════════════════════════════════════════════════════
   STONE APPLE
═══════════════════════════════════════════════════════ */
function addStone(targetPid) {
  const p = P[targetPid];
  const available = [];
  p.grid.forEach((v, i) => { if (v > 0 && !p.stones.has(i)) available.push(i); });
  if (!available.length) return;

  const idx = available[Math.floor(Math.random() * available.length)];
  p.stones.add(idx);

  const el = p.cells[idx];
  el.classList.remove('sel-partial','sel-match','sel-over');
  el.classList.add('stone','stone-appear');
  el.textContent = '';
  el.addEventListener('animationend', () => el.classList.remove('stone-appear'), {once:true});

  // Flash the area border
  const areaEl = targetPid === 1 ? p1Area : p2Area;
  areaEl.classList.add('stone-flash');
  areaEl.addEventListener('animationend', () => areaEl.classList.remove('stone-flash'), {once:true});
}

/* ═══════════════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════════════ */
function showScorePop(text, areaEl, x, y) {
  const el = document.createElement('div');
  el.className = 'score-pop';
  el.textContent = text;
  el.style.cssText = `left:${x - 22}px;top:${y - 10}px;position:absolute`;
  areaEl.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), {once:true});
}

function showAttackNotif(attackPid, defendPid, count) {
  const a = document.createElement('div');
  a.className = 'attack-notif send';
  a.textContent = `🚀 ${count}개 제거 → 돌 투척!`;
  document.body.appendChild(a);
  a.addEventListener('animationend', () => a.remove(), {once:true});

  const d = document.createElement('div');
  d.className = 'attack-notif recv';
  d.textContent = `🪨 돌 사과 공격 받음!`;
  document.body.appendChild(d);
  d.addEventListener('animationend', () => d.remove(), {once:true});
}
