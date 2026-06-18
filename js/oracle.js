/* ============================================================
   oracle.js — 占卜师光球向导系统
   光球漂浮动画 · 语音引导 · 每日演示 · 伪鼠标操控
   ============================================================ */

// ── Oracle State ──
const oracleState = {
  demoInProgress: false,
  idleAnimId: null,
  orbX: 55,          // viewport percentage
  orbY: 45,
  time: 0,
  voiceMuted: false,
  orbEl: null,
  cursorEl: null,
  subtitleEl: null,
};

// ── Demo Keys (localStorage) ──
const DEMO_KEYS = {
  theme:     'oracle-demo-theme',
  subSpread: 'oracle-demo-subspread',
  shuffle:   'oracle-demo-shuffle',
  select:    'oracle-demo-select',
  confirm:   'oracle-demo-confirm',
};

// ── Guidance Voice Lines ──
const GUIDANCE = {
  theme: {
    demo: [
      '观测到新的查询节点。正在演示：查询类型选择。',
      '观测我的操作。点击你感兴趣的生命领域。',
    ],
    normal: '请选择与你灵魂共振的查询类型。',
    afterDemo: '演示完毕。现在，请亲手选择你的查询类型。',
  },
  subSpread: {
    demo: [
      '协议类型已确认。正在演示：协议深度选择。',
      '不同的牌阵，对应不同深度的神谕解析。',
    ],
    normal: '请选择你期望的协议深度。',
    afterDemo: '演示完毕。请选择你的牌阵协议。',
  },
  shuffle: {
    demo: [
      '牌阵已就绪。正在演示：洗牌协议启动。',
      '命运之牌将从中心绽放为扇形阵列。',
    ],
    normal: '请启动洗牌协议，让命运之牌展开。',
    afterDemo: '演示完毕。请亲手启动洗牌协议。',
  },
  select: {
    demo: [
      '扇形阵列已展开。正在演示：命运之牌选取。',
      '点击牌面以锁定你的命运变量。',
    ],
    normal: '请从扇形阵列中，选取你的命运之牌。',
    afterDemo: '演示完毕。请选取你的命运之牌。',
  },
  confirm: {
    demo: [
      '变量已满额。正在演示：神谕确认。',
      '确认后，命运算法将为你生成解读。',
    ],
    normal: '变量已就绪。请确认执行神谕。',
    afterDemo: '演示完毕。请确认你的命运变量。',
  },
};

// ── Daily Demo Check ──
function isDemoNeeded(stepKey) {
  const storageKey = DEMO_KEYS[stepKey];
  if (!storageKey) return false;
  const stored = localStorage.getItem(storageKey);
  const today = new Date().toISOString().split('T')[0];
  return stored !== today;
}

function markDemoDone(stepKey) {
  const storageKey = DEMO_KEYS[stepKey];
  if (!storageKey) return;
  const today = new Date().toISOString().split('T')[0];
  localStorage.setItem(storageKey, today);
}

// ── TTS Capability ──
function hasTTS() {
  return !!(window.speechSynthesis && window.speechSynthesis.getVoices().length > 0);
}

// ── Speak Oracle ──
function speakOracle(text, opts = {}) {
  if (oracleState.voiceMuted) return Promise.resolve();
  if (typeof speakResult !== 'function') return Promise.resolve();

  // Show subtitle regardless of TTS
  showSubtitle(text);

  return new Promise(resolve => {
    const success = speakResult(text, {
      rate: opts.rate || 0.85,
      pitch: opts.pitch || 0.95,
      onStart: () => {
        if (oracleState.orbEl) oracleState.orbEl.classList.add('speaking');
      },
      onEnd: () => {
        if (oracleState.orbEl) oracleState.orbEl.classList.remove('speaking');
        hideSubtitle();
        resolve();
      },
    });
    // If TTS not available, still resolve after estimated reading time
    if (!success) {
      if (oracleState.orbEl) oracleState.orbEl.classList.add('speaking');
      setTimeout(() => {
        if (oracleState.orbEl) oracleState.orbEl.classList.remove('speaking');
        hideSubtitle();
        resolve();
      }, text.length * 80 + 500); // ~80ms per char reading time
    }
  });
}

// ── Subtitle Bubble ──
function showSubtitle(text) {
  const el = oracleState.subtitleEl;
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  // Auto-hide after TTS would finish
  clearTimeout(el._hideTimeout);
  el._hideTimeout = setTimeout(() => { el.style.display = 'none'; }, text.length * 90 + 2000);
}

function hideSubtitle() {
  const el = oracleState.subtitleEl;
  if (!el) return;
  clearTimeout(el._hideTimeout);
  el.style.display = 'none';
}

// ── Fake Cursor ──
function showCursor() {
  const cursor = oracleState.cursorEl;
  if (!cursor) return;
  cursor.style.display = 'block';
  cursor.style.opacity = '1';
  cursor.style.transform = 'scale(1)';
}

function hideCursor() {
  const cursor = oracleState.cursorEl;
  if (!cursor) return;
  cursor.style.opacity = '0';
  setTimeout(() => { cursor.style.display = 'none'; }, 300);
}

function moveCursorTo(el, duration = 500) {
  const cursor = oracleState.cursorEl;
  if (!cursor || !el) return Promise.resolve();

  const targetRect = el.getBoundingClientRect();
  const cx = targetRect.left + targetRect.width / 2;
  const cy = targetRect.top + targetRect.height / 2;

  // Position cursor slightly offset (like a real hand)
  const offsetX = -8;
  const offsetY = -6;

  cursor.style.transition = `left ${duration}ms cubic-bezier(0.34, 1.56, 0.64, 1), top ${duration}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
  cursor.style.left = (cx + offsetX) + 'px';
  cursor.style.top = (cy + offsetY) + 'px';

  return new Promise(resolve => setTimeout(resolve, duration + 50));
}

function cursorClick() {
  const cursor = oracleState.cursorEl;
  if (!cursor) return Promise.resolve();

  cursor.style.transform = 'scale(0.8)';
  const ring = cursor.querySelector('.demo-cursor-click-ring');
  if (ring) {
    ring.style.animation = 'none';
    ring.offsetHeight; // reflow
    ring.style.animation = 'cursorClickRing 0.5s ease-out forwards';
  }

  return new Promise(resolve => {
    setTimeout(() => {
      cursor.style.transform = 'scale(1)';
      resolve();
    }, 200);
  });
}

function highlightTarget(el) {
  if (!el) return;
  el.classList.add('demo-target-highlight');
  setTimeout(() => el.classList.remove('demo-target-highlight'), 1200);
}

// ── Demo helper: temporarily lift lock for internal calls ──
function _demoUnlock(fn) {
  window.__oracleDemoLock = false;
  try {
    const result = fn();
    window.__oracleDemoLock = true;  // Restore immediately — fn already passed its lock gate
    return result;
  } catch (e) {
    window.__oracleDemoLock = true;
    throw e;
  }
}

// ── Orb Floating Animation ──
function startOrbIdleAnimation() {
  const orb = oracleState.orbEl;
  if (!orb) return;

  oracleState.time = performance.now() * 0.001;

  function animate(now) {
    const t = now * 0.001;
    const dt = t - oracleState.time;
    oracleState.time = t;

    // Two independent sine waves for organic floating
    const xFreq1 = 0.13, xFreq2 = 0.07;
    const yFreq1 = 0.09, yFreq2 = 0.17;

    const x = 50
      + Math.sin(t * xFreq1) * 22
      + Math.cos(t * xFreq2 + 1.3) * 14;
    const y = 50
      + Math.cos(t * yFreq1 + 0.7) * 18
      + Math.sin(t * yFreq2) * 12;

    oracleState.orbX = x;
    oracleState.orbY = y;

    orb.style.left = x + '%';
    orb.style.top = y + '%';
    orb.style.transform = 'translate(-50%, -50%)';

    oracleState.idleAnimId = requestAnimationFrame(animate);
  }

  oracleState.idleAnimId = requestAnimationFrame(animate);
}

function stopOrbIdleAnimation() {
  if (oracleState.idleAnimId) {
    cancelAnimationFrame(oracleState.idleAnimId);
    oracleState.idleAnimId = null;
  }
}

// ── Demo Execution Per Step ──
async function runDemoForStep(stepKey) {
  if (oracleState.demoInProgress) return;
  oracleState.demoInProgress = true;
  window.__oracleDemoLock = true;

  const orb = oracleState.orbEl;
  if (orb) orb.classList.add('demo-mode');

  const guidance = GUIDANCE[stepKey];
  // Speak demo lines
  for (const line of guidance.demo) {
    await speakOracle(line);
  }

  showCursor();

  try {
    switch (stepKey) {
      case 'theme': await demoThemeSelection(); break;
      case 'subSpread': await demoSubSpreadSelection(); break;
      case 'shuffle': await demoShuffle(); break;
      case 'select': await demoCardSelection(); break;
      case 'confirm': await demoConfirm(); break;
    }
  } catch (e) {
    console.warn('[Oracle] Demo error:', e);
  }

  hideCursor();
  await speakOracle(guidance.afterDemo);

  markDemoDone(stepKey);

  if (orb) orb.classList.remove('demo-mode');
  oracleState.demoInProgress = false;
  window.__oracleDemoLock = false;
}

// ── Individual Demo Steps ──

async function demoThemeSelection() {
  const firstTheme = document.querySelector('.spread-option');
  if (!firstTheme) return;

  await moveCursorTo(firstTheme, 600);
  await sleep(300);
  highlightTarget(firstTheme);
  await cursorClick();

  // Actually perform the action (unlock temporarily)
  const themeId = firstTheme.dataset.theme;
  if (themeId && typeof selectTheme === 'function') {
    _demoUnlock(() => selectTheme(themeId, firstTheme));
  }

  await sleep(2000);

  // Undo
  _demoUnlock(() => resetThemeSelection());
  await sleep(400);
}

function resetThemeSelection() {
  if (typeof state !== 'undefined' && state) state.selectedTheme = null;
  document.querySelectorAll('.spread-option').forEach(o => o.classList.remove('selected'));
  const sub = document.getElementById('spread-sub-section');
  if (sub) sub.classList.remove('visible');
  const subSelector = document.getElementById('spread-sub-selector');
  if (subSelector) subSelector.innerHTML = '';
}

async function demoSubSpreadSelection() {
  // Need theme selected first to show sub-spreads
  const firstTheme = document.querySelector('.spread-option');
  if (!firstTheme) return;

  const themeId = firstTheme.dataset.theme || 'love';
  if (typeof selectTheme === 'function') {
    _demoUnlock(() => selectTheme(themeId, firstTheme));
  }
  await sleep(500);

  const firstSub = document.querySelector('.spread-sub-option');
  if (!firstSub) { _demoUnlock(() => resetThemeSelection()); return; }

  await moveCursorTo(firstSub, 600);
  await sleep(300);
  highlightTarget(firstSub);
  await cursorClick();

  const spreadId = firstSub.dataset.spreadId;
  if (spreadId && typeof selectSubSpread === 'function') {
    _demoUnlock(() => selectSubSpread(spreadId, firstSub));
  }

  await sleep(2000);

  // Undo
  _demoUnlock(() => resetSubSpreadSelection());
  await sleep(400);
}

function resetSubSpreadSelection() {
  if (typeof state !== 'undefined' && state) {
    state.selectedSpread = null;
    state.selectedTheme = null;
  }
  document.querySelectorAll('.spread-sub-option').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('.spread-option').forEach(o => o.classList.remove('selected'));
  const shuffleArea = document.getElementById('shuffle-area');
  if (shuffleArea) shuffleArea.style.display = 'none';
  const sub = document.getElementById('spread-sub-section');
  if (sub) sub.classList.remove('visible');
  const subSelector = document.getElementById('spread-sub-selector');
  if (subSelector) subSelector.innerHTML = '';
}

async function demoShuffle() {
  // Set up state: theme + sub-spread selected
  const firstTheme = document.querySelector('.spread-option');
  if (!firstTheme) return;

  const themeId = firstTheme.dataset.theme || 'love';
  if (typeof selectTheme === 'function') _demoUnlock(() => selectTheme(themeId, firstTheme));
  await sleep(400);

  const firstSub = document.querySelector('.spread-sub-option');
  if (!firstSub) { _demoUnlock(() => resetThemeSelection()); return; }

  const spreadId = firstSub.dataset.spreadId;
  if (spreadId && typeof selectSubSpread === 'function') _demoUnlock(() => selectSubSpread(spreadId, firstSub));
  await sleep(400);

  const shuffleBtn = document.getElementById('btn-shuffle');
  if (!shuffleBtn) { _demoUnlock(() => resetSubSpreadSelection()); return; }

  await moveCursorTo(shuffleBtn, 600);
  await sleep(300);
  highlightTarget(shuffleBtn);
  await cursorClick();

  if (typeof startShuffle === 'function') {
    await _demoUnlock(() => startShuffle());
  }

  await sleep(2500);

  // Undo
  _demoUnlock(() => resetShuffleState());
  await sleep(400);
}

function resetShuffleState() {
  if (typeof state !== 'undefined' && state) {
    state.isShuffling = false;
    state.gridCards = [];
    state.selectedCards = [];
    state.selectedSpread = null;
    state.selectedTheme = null;
  }
  const gridContainer = document.getElementById('card-grid-container');
  if (gridContainer) gridContainer.style.display = 'none';
  const fanContainer = document.getElementById('card-fan-container');
  if (fanContainer) fanContainer.innerHTML = '';
  const shuffleBtn = document.getElementById('btn-shuffle');
  if (shuffleBtn) {
    shuffleBtn.disabled = false;
    shuffleBtn.textContent = '◆ 启动洗牌协议';
  }
  const selectionCounter = document.getElementById('selection-counter');
  if (selectionCounter) selectionCounter.style.display = 'none';
  const shuffleArea = document.getElementById('shuffle-area');
  if (shuffleArea) shuffleArea.style.display = 'none';
  document.querySelectorAll('.spread-option').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('.spread-sub-option').forEach(o => o.classList.remove('selected'));
  const sub = document.getElementById('spread-sub-section');
  if (sub) sub.classList.remove('visible');
  const subSelector = document.getElementById('spread-sub-selector');
  if (subSelector) subSelector.innerHTML = '';
}

async function demoCardSelection() {
  // Set up: theme → sub-spread → shuffle
  const firstTheme = document.querySelector('.spread-option');
  if (!firstTheme) return;
  const themeId = firstTheme.dataset.theme || 'love';
  if (typeof selectTheme === 'function') _demoUnlock(() => selectTheme(themeId, firstTheme));
  await sleep(400);
  const firstSub = document.querySelector('.spread-sub-option');
  if (!firstSub) { _demoUnlock(() => resetThemeSelection()); return; }
  const spreadId = firstSub.dataset.spreadId;
  if (spreadId && typeof selectSubSpread === 'function') _demoUnlock(() => selectSubSpread(spreadId, firstSub));
  await sleep(400);
  if (typeof startShuffle === 'function') await _demoUnlock(() => startShuffle());
  await sleep(1200);

  const required = (typeof state !== 'undefined' && state.selectedSpread)
    ? state.selectedSpread.card_count : 3;

  // Click required number of cards
  const cards = document.querySelectorAll('.card-cell');
  for (let i = 0; i < Math.min(required, cards.length); i++) {
    const card = cards[i];
    await moveCursorTo(card, 500);
    await sleep(200);
    highlightTarget(card);
    await cursorClick();

    if (typeof selectCard === 'function') {
      _demoUnlock(() => selectCard(i, card));
    }
    await sleep(600);
  }

  await sleep(2000);

  // Undo
  _demoUnlock(() => resetCardSelection());
  await sleep(400);
}

function resetCardSelection() {
  if (typeof state !== 'undefined' && state) {
    state.selectedCards = [];
    state.isShuffling = false;
    state.gridCards = [];
    state.selectedSpread = null;
    state.selectedTheme = null;
  }
  // Hide confirm popup
  const popup = document.getElementById('confirm-popup');
  if (popup) popup.classList.add('hidden');
  // Deselect all cards
  document.querySelectorAll('.card-cell').forEach(el => {
    el.classList.remove('selected');
    // Restore fan position
    const x = parseFloat(el.dataset.x) || 0;
    const y = parseFloat(el.dataset.y) || 0;
    const rot = parseFloat(el.dataset.rot) || 0;
    el.style.transform = `translateX(${x}px) translateY(${y}px) rotate(${rot}deg) scale(1)`;
  });
  // Hide card grid
  const gridContainer = document.getElementById('card-grid-container');
  if (gridContainer) gridContainer.style.display = 'none';
  const fanContainer = document.getElementById('card-fan-container');
  if (fanContainer) fanContainer.innerHTML = '';
  const selectionCounter = document.getElementById('selection-counter');
  if (selectionCounter) selectionCounter.style.display = 'none';
  const shuffleArea = document.getElementById('shuffle-area');
  if (shuffleArea) shuffleArea.style.display = 'none';
  document.querySelectorAll('.spread-option').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('.spread-sub-option').forEach(o => o.classList.remove('selected'));
  const sub = document.getElementById('spread-sub-section');
  if (sub) sub.classList.remove('visible');
  const subSelector = document.getElementById('spread-sub-selector');
  if (subSelector) subSelector.innerHTML = '';
}

async function demoConfirm() {
  // Set up full flow: theme → sub-spread → shuffle → select all cards
  const firstTheme = document.querySelector('.spread-option');
  if (!firstTheme) return;
  const themeId = firstTheme.dataset.theme || 'love';
  if (typeof selectTheme === 'function') _demoUnlock(() => selectTheme(themeId, firstTheme));
  await sleep(400);
  const firstSub = document.querySelector('.spread-sub-option');
  if (!firstSub) { _demoUnlock(() => resetThemeSelection()); return; }
  const spreadId = firstSub.dataset.spreadId;
  if (spreadId && typeof selectSubSpread === 'function') _demoUnlock(() => selectSubSpread(spreadId, firstSub));
  await sleep(400);
  if (typeof startShuffle === 'function') await _demoUnlock(() => startShuffle());
  await sleep(1200);

  const required = (typeof state !== 'undefined' && state.selectedSpread)
    ? state.selectedSpread.card_count : 3;
  const cards = document.querySelectorAll('.card-cell');
  for (let i = 0; i < Math.min(required, cards.length); i++) {
    if (typeof selectCard === 'function') _demoUnlock(() => selectCard(i, cards[i]));
    await sleep(400);
  }

  await sleep(1000);

  // Show confirm popup if not already visible
  const popup = document.getElementById('confirm-popup');
  const confirmBtn = popup ? popup.querySelector('.btn-confirm') : null;
  if (!confirmBtn) { _demoUnlock(() => resetCardSelection()); return; }

  await moveCursorTo(confirmBtn, 600);
  await sleep(300);
  highlightTarget(confirmBtn);
  await cursorClick();

  // Actually confirm and go through flow
  if (typeof confirmReading === 'function') {
    await _demoUnlock(() => confirmReading());
  }

  await sleep(3000);

  // Undo - full reset
  if (typeof resetDivination === 'function') {
    _demoUnlock(() => resetDivination());
  }
  await sleep(400);
}

// ── Main Guide Function ──
async function guideStep(stepKey) {
  // Don't interrupt an ongoing demo
  if (oracleState.demoInProgress) return;

  if (isDemoNeeded(stepKey)) {
    await runDemoForStep(stepKey);
  } else {
    // Just voice guidance
    const guidance = GUIDANCE[stepKey];
    if (guidance && guidance.normal) {
      speakOracle(guidance.normal);
    }
  }
}

// ── Init ──
function initOracle() {
  oracleState.orbEl = document.getElementById('oracle-orb');
  oracleState.cursorEl = document.getElementById('demo-cursor');
  oracleState.subtitleEl = document.getElementById('orb-subtitle');

  if (oracleState.orbEl) {
    // Show orb with delay
    setTimeout(() => {
      oracleState.orbEl.classList.add('visible');
    }, 1500);

    // Click orb to toggle mute
    oracleState.orbEl.addEventListener('click', () => {
      if (oracleState.demoInProgress) return;
      oracleState.voiceMuted = !oracleState.voiceMuted;
      if (oracleState.voiceMuted) {
        oracleState.orbEl.classList.add('muted');
        showSubtitle('语音已静音 · 点击光球恢复');
      } else {
        oracleState.orbEl.classList.remove('muted');
        hideSubtitle();
      }
    });

    // Hover: pause floating briefly
    oracleState.orbEl.addEventListener('mouseenter', () => {
      oracleState.orbEl.classList.add('hovered');
    });
    oracleState.orbEl.addEventListener('mouseleave', () => {
      oracleState.orbEl.classList.remove('hovered');
    });
  }

  // Start floating
  startOrbIdleAnimation();

  console.log('[Oracle] 占卜师光球系统已初始化');
}

// ── Mood-based Orb Color ──
function setOrbMood(mood) {
  const orb = oracleState.orbEl;
  if (!orb) return;

  const moodColors = {
    excited: '#f0c040',
    happy: '#e8b84b',
    calm: '#d4a843',
    neutral: '#b8913a',
    anxious: '#6a9ec2',
    sad: '#557799',
    tired: '#665588',
  };

  const color = moodColors[mood] || 'var(--amber-400, #e8b84b)';
  orb.style.setProperty('--orb-color', color);
}

function showOrb() {
  if (oracleState.orbEl) oracleState.orbEl.classList.add('visible');
}

function hideOrb() {
  if (oracleState.orbEl) oracleState.orbEl.classList.remove('visible');
}

function cancelDemo() {
  if (!oracleState.demoInProgress) return;
  oracleState.demoInProgress = false;
  window.__oracleDemoLock = false;
  hideCursor();
  if (oracleState.orbEl) oracleState.orbEl.classList.remove('demo-mode');
  stopSpeaking();
  hideSubtitle();
}
