/* ═══════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════ */
const COLS = 18, ROWS = 12, TOTAL = COLS * ROWS;

/* ═══════════════════════════════════════════════════════
   WEIGHTED RANDOM  (1~5 ≈ 84%,  6~9 ≈ 16%)
═══════════════════════════════════════════════════════ */
// cumulative weights for 1,2,3,4,5,6,7,8,9
const CUM_W = [22, 43, 62, 74, 84, 91, 96, 99, 100];
function randomApple() {
  const r = Math.random() * 100;
  for (let i = 0; i < CUM_W.length; i++) {
    if (r < CUM_W[i]) return i + 1;
  }
  return 5;
}

/* ═══════════════════════════════════════════════════════
   GAME STATE
═══════════════════════════════════════════════════════ */
let gameActive = false;
let timeLeft = 120;
let timerInterval = null;
let p2AI = true;
let aiTimeout = null;
let aiMoveTimeout = null;
let gameMode = null;
let countdownActive = false;
let countdownStep = null;
let recordingConsented = false; // 대기 화면에서 '음성 사용' 또는 '마이크 사용' 중 하나라도 체크해야 true

// Per-player state
const P = {
  1: { grid: [], cells: [], stones: new Set(), score: 0, removed: 0, attacks: 0 },
  2: { grid: [], cells: [], stones: new Set(), score: 0, removed: 0, attacks: 0 }
};

// Active drag (only one at a time)
let drag = { on: false, pid: null, areaEl: null, canvasEl: null, start: null, end: null, sel: [], sum: 0 };

/* ═══════════════════════════════════════════════════════
   DOM REFS
═══════════════════════════════════════════════════════ */
const $id = id => document.getElementById(id);
const p1Area = $id('p1Area'), p2Area = $id('p2Area');
const p1Canvas = $id('p1Canvas'), p2Canvas = $id('p2Canvas');
const p1Ctx = p1Canvas.getContext('2d'), p2Ctx = p2Canvas.getContext('2d');
const timerEl = $id('timerEl'), sumEl = $id('sumEl');
const goOverlay = $id('goOverlay');
