/* ═══════════════════════════════════════════════════════
   AI (P2)
═══════════════════════════════════════════════════════ */
function scheduleAI() {
  if (!p2AI || !gameActive) return;
  aiTimeout = setTimeout(() => {
    if (gameActive && p2AI) doAIMove();
  }, 3500 + Math.random() * 2500);
}

function doAIMove() {
  const combos = findCombos(2);
  if (!combos.length) { scheduleAI(); return; }

  // Prefer 4+ combos 50% of the time (for stone attack)
  const big = combos.filter(c => c.length >= 4);
  let pick;
  if (big.length && Math.random() < 0.5) {
    pick = big[Math.floor(Math.random() * Math.min(5, big.length))];
  } else {
    pick = combos[Math.floor(Math.random() * Math.min(10, combos.length))];
  }

  // Flash highlight
  pick.forEach(idx => P[2].cells[idx].classList.add('sel-match'));

  aiMoveTimeout = setTimeout(() => {
    pick.forEach(idx => P[2].cells[idx].classList.remove('sel-match'));
    // AI가 꺼졌거나 게임이 끝난 상태로 전환됐다면 이 수는 실행하지 않음
    if (!gameActive || !p2AI) return;
    executeRemove(2, pick);
    scheduleAI();
  }, 800);
}

function findCombos(pid) {
  const p = P[pid];
  const results = [];

  for (let r1 = 0; r1 < ROWS; r1++) {
    for (let c1 = 0; c1 < COLS; c1++) {
      for (let r2 = r1; r2 < ROWS; r2++) {
        for (let c2 = c1; c2 < COLS; c2++) {
          let sum = 0;
          const cells = [];
          for (let r = r1; r <= r2; r++) {
            for (let c = c1; c <= c2; c++) {
              const idx = r * COLS + c;
              if (p.grid[idx] > 0 && !p.stones.has(idx)) {
                sum += p.grid[idx];
                cells.push(idx);
              }
            }
          }
          if (sum === 10 && cells.length > 0) {
            results.push(cells);
            if (results.length >= 60) return results;
          }
        }
      }
    }
  }
  return results;
}

function toggleAI() {
  p2AI = !p2AI;
  clearTimeout(aiTimeout);
  clearTimeout(aiMoveTimeout);

  const btn = $id('aiBtn');
  btn.textContent = p2AI ? '🤖 AI 모드' : '👥 2P 로컬';
  btn.classList.toggle('on', p2AI);
  const p2Name = p2AI ? '🤖 AI' : '🎮 플레이어 2';
  $id('p2Label').textContent = p2Name;
  $id('p2BannerName').textContent = p2Name;
  $id('p2BannerHint').textContent = p2AI ? '자동 플레이 중' : '마우스로 드래그';
  if (p2AI && gameActive) scheduleAI();
}
