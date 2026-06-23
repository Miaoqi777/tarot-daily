/* ============================================================
   oracle.js — 占卜师光球向导系统
   光球漂浮动画 · 语音引导 · 三阶段每日演示 · 伪鼠标操控
   ============================================================ */

// ── Oracle State ──
const oracleState = {
  demoInProgress: false,
  idleAnimId: null,
  orbX: 55,
  orbY: 45,
  time: 0,
  orbEl: null,
  cursorEl: null,
  subtitleEl: null,
};

// ── Demo Keys (localStorage, once per day per phase) ──
const DEMO_KEYS = {
  phase1: 'oracle-demo-phase1',
  phase2: 'oracle-demo-phase2',
  phase3: 'oracle-demo-phase3',
};

// ── Guidance Voice Lines ──
const GUIDANCE = {
  phase1: {
    demo: [
      '你好，我是你的占卜助手。让我带你快速了解如何使用这个工具。',
      '首先，选择一个与你当前疑问相关的主题领域。',
      '你也可以选择是否包含小阿卡纳——共56张牌，能让解读内容更丰富。',
      'AI解读模式已开启。开启后你可以输入具体问题，或使用语音提问，获得更个性化的回答。',
      '洗牌按钮在这里。点击后牌面会扇形展开，供你挑选。',
      '从展开的牌阵中，选择你想要解读的牌。',
      '确认按钮在这里。当你选定所有牌后，亲手按下它——那一刻属于你自己。',
    ],
    normal: '欢迎回来。请选择你的查询领域，开始今天的解读。',
    afterDemo: '演示完毕。现在你可以自己动手，开始你的占卜了。',
  },
  phase2: {
    demo: [
      '接下来介绍账号系统。注册后可以保存你的占卜记录。',
      '点击注册按钮，创建一个新账号。',
      '也可以登录已有账号，恢复你的历史记录和运势分析。',
      '当然，你可以跳过这一步。不登录也能正常使用全部功能。',
      '登录只是让每次占卜记录得以保存和同步，并非使用的门槛。选择权在你手中。',
    ],
    normal: '',
    afterDemo: '演示完毕。你可以选择登录、注册，或直接关闭窗口继续占卜。',
  },
  phase3: {
    demo: [
      '解读结果已生成。来看看如何浏览。',
      '简洁模式提供一句话概括，适合快速了解。',
      '详细模式展示每张牌的完整信息：牌位含义、正逆位解析、综合总结。',
      '如果还有疑问，随时可以重新测算——每一次提问，都是一次新的开始。',
    ],
    normal: '',
    afterDemo: '塔罗是一面映照内心的镜子，帮助你更好地了解自己。你的选择，始终由你自己决定。',
  },
};

// ── Daily Demo Check ──
function isDemoNeeded(phaseKey) {
  const storageKey = DEMO_KEYS[phaseKey];
  if (!storageKey) return false;
  const stored = sessionStorage.getItem(storageKey);
  const today = new Date().toISOString().split('T')[0];
  return stored !== today;
}

function markDemoDone(phaseKey) {
  const storageKey = DEMO_KEYS[phaseKey];
  if (!storageKey) return;
  const today = new Date().toISOString().split('T')[0];
  sessionStorage.setItem(storageKey, today);
}

// ── Speak Oracle (text-only subtitle, no TTS) ──
function speakOracle(text, opts = {}) {
  showSubtitle(text);
  if (oracleState.orbEl) oracleState.orbEl.classList.add('speaking');
  return new Promise(resolve => {
    setTimeout(() => {
      if (oracleState.orbEl) oracleState.orbEl.classList.remove('speaking');
      hideSubtitle();
      resolve();
    }, text.length * 80 + 500);
  });
}

// ── Subtitle Bubble (viewport-clamped) ──
function showSubtitle(text) {
  const el = oracleState.subtitleEl;
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  el.classList.remove('below');
  _trackSubtitle(); // Initial positioning
  clearTimeout(el._hideTimeout);
  el._hideTimeout = setTimeout(() => { el.style.display = 'none'; }, text.length * 90 + 2000);
}

function hideSubtitle() {
  const el = oracleState.subtitleEl;
  if (!el) return;
  clearTimeout(el._hideTimeout);
  el.style.display = 'none';
}

// Keep subtitle pinned to the orb's current position
function _trackSubtitle() {
  const el = oracleState.subtitleEl;
  const orb = oracleState.orbEl;
  if (!el || !orb || el.style.display === 'none') return;

  const orbRect = orb.getBoundingClientRect();
  const orbCenterX = orbRect.left + orbRect.width / 2;
  const gap = 16;
  const bubbleRect = el.getBoundingClientRect();
  const halfW = bubbleRect.width / 2;
  const clampedLeft = Math.max(halfW + 8, Math.min(window.innerWidth - halfW - 8, orbCenterX));
  el.style.left = clampedLeft + 'px';

  if (orbRect.top - gap - bubbleRect.height > 0) {
    el.style.top = (orbRect.top - gap) + 'px';
    el.style.transform = 'translate(-50%, -100%)';
    el.classList.remove('below');
  } else {
    el.style.top = (orbRect.bottom + gap) + 'px';
    el.style.transform = 'translate(-50%, 0)';
    el.classList.add('below');
  }
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
  setTimeout(() => { cursor.style.display = 'none'; }, 200);
}

function moveCursorTo(el, duration = 400) {
  const cursor = oracleState.cursorEl;
  if (!cursor || !el) return Promise.resolve();

  const targetRect = el.getBoundingClientRect();
  const cx = targetRect.left + targetRect.width / 2;
  const cy = targetRect.top + targetRect.height / 2;
  const offsetX = -8;
  const offsetY = -6;

  cursor.style.transition = `left ${duration}ms cubic-bezier(0.34, 1.56, 0.64, 1), top ${duration}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
  cursor.style.left = (cx + offsetX) + 'px';
  cursor.style.top = (cy + offsetY) + 'px';

  return new Promise(resolve => setTimeout(resolve, duration + 30));
}

function cursorClick() {
  const cursor = oracleState.cursorEl;
  if (!cursor) return Promise.resolve();

  cursor.style.transform = 'scale(0.75)';
  const ring = cursor.querySelector('.demo-cursor-click-ring');
  if (ring) {
    ring.style.animation = 'none';
    ring.offsetHeight;
    ring.style.animation = 'cursorClickRing 0.5s ease-out forwards';
  }

  return new Promise(resolve => {
    setTimeout(() => { cursor.style.transform = 'scale(1)'; resolve(); }, 180);
  });
}

function highlightTarget(el) {
  if (!el) return;
  el.classList.add('demo-target-highlight');
  setTimeout(() => el.classList.remove('demo-target-highlight'), 1000);
}

// ── Demo helper: temporarily lift lock for internal calls ──
function _demoUnlock(fn) {
  window.__oracleDemoLock = false;
  try {
    const result = fn();
    window.__oracleDemoLock = true;
    return result;
  } catch (e) {
    window.__oracleDemoLock = true;
    throw e;
  }
}

// ── Orb Positioning ──
function _orbToDemoPosition() {
  stopOrbIdleAnimation();
  const orb = oracleState.orbEl;
  if (!orb) return;
  orb.style.transition = 'left 0.6s ease, top 0.6s ease';
  orb.style.left = '78%';
  orb.style.top = '45%';
  orb.style.transform = 'translate(-50%, -50%)';
}

function _orbToFloatPosition() {
  const orb = oracleState.orbEl;
  if (!orb) return;
  orb.style.transition = '';
  orb.style.left = oracleState.orbX + '%';
  orb.style.top = oracleState.orbY + '%';
  startOrbIdleAnimation();
}

// ── Orb Floating Animation ──
function startOrbIdleAnimation() {
  const orb = oracleState.orbEl;
  if (!orb) return;
  if (oracleState.idleAnimId) return;

  oracleState.time = performance.now() * 0.001;

  function animate(now) {
    const t = now * 0.001;
    oracleState.time = t;

    const x = 50 + Math.sin(t * 0.13) * 22 + Math.cos(t * 0.07 + 1.3) * 14;
    const y = 50 + Math.cos(t * 0.09 + 0.7) * 18 + Math.sin(t * 0.17) * 12;

    oracleState.orbX = x;
    oracleState.orbY = y;
    orb.style.left = x + '%';
    orb.style.top = y + '%';
    orb.style.transform = 'translate(-50%, -50%)';

    // Keep subtitle pinned to the orb while visible
    _trackSubtitle();

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

// ================================================================
//  三阶段演示编排
// ================================================================

async function runDemoForPhase(phaseKey) {
  if (oracleState.demoInProgress) return;
  oracleState.demoInProgress = true;
  window.__oracleDemoLock = true;

  const orb = oracleState.orbEl;
  if (orb) orb.classList.add('demo-mode');
  _orbToDemoPosition();
  await sleep(650); // Wait for orb to reach demo position

  const guidance = GUIDANCE[phaseKey];
  if (!guidance) { _finishDemo(phaseKey); return; }

  showCursor();

  try {
    switch (phaseKey) {
      case 'phase1': await demoPhase1(); break;
      case 'phase2': await demoPhase2(); break;
      case 'phase3': await demoPhase3(); break;
    }
  } catch (e) {
    console.warn('[Oracle] Demo error:', e);
  }

  hideCursor();

  if (guidance.afterDemo) {
    await speakOracle(guidance.afterDemo);
  }

  _finishDemo(phaseKey);
}

function _finishDemo(phaseKey) {
  markDemoDone(phaseKey);
  const orb = oracleState.orbEl;
  if (orb) orb.classList.remove('demo-mode');
  oracleState.demoInProgress = false;
  window.__oracleDemoLock = false;
  // Reset orb to a pleasant default position before returning to float
  oracleState.orbX = 75;
  oracleState.orbY = 45;
  _orbToFloatPosition();
}

// ── Phase 1: 选题 → 小阿卡纳 → AI → 洗牌 → 选牌 → 悬浮确认 ──
async function demoPhase1() {
  const lines = GUIDANCE.phase1.demo;

  // Intro line — no action
  await speakOracle(lines[0]);

  // 1. Click first theme
  await speakOracle(lines[1]);
  await sleep(300);
  const firstTheme = document.querySelector('.spread-option');
  if (!firstTheme) return;
  await moveCursorTo(firstTheme, 250);
  await sleep(200);
  highlightTarget(firstTheme);
  await cursorClick();
  const themeId = firstTheme.dataset.theme;
  if (themeId && typeof selectTheme === 'function') {
    _demoUnlock(() => selectTheme(themeId, firstTheme));
  }
  await sleep(400);

  // 2. Toggle minor arcana
  await speakOracle(lines[2]);
  await sleep(300);
  const minorToggle = document.getElementById('toggle-minor-arcana');
  if (minorToggle) {
    await moveCursorTo(minorToggle, 250);
    await sleep(200);
    highlightTarget(minorToggle);
    await cursorClick();
    if (typeof toggleMinorArcana === 'function') {
      _demoUnlock(() => toggleMinorArcana());
    }
    await sleep(300);
  }

  // 3. Toggle AI
  await speakOracle(lines[3]);
  await sleep(300);
  const aiToggle = document.getElementById('toggle-ai-switch');
  if (aiToggle) {
    await moveCursorTo(aiToggle, 250);
    await sleep(200);
    highlightTarget(aiToggle);
    await cursorClick();
    if (typeof toggleAI === 'function') {
      _demoUnlock(() => toggleAI());
    }
    await sleep(400);
  }

  // 4. Shuffle
  await speakOracle(lines[4]);
  await sleep(300);
  const shuffleBtn = document.getElementById('btn-shuffle');
  if (shuffleBtn) {
    await moveCursorTo(shuffleBtn, 250);
    await sleep(200);
    highlightTarget(shuffleBtn);
    await cursorClick();
    if (typeof startShuffle === 'function') {
      await _demoUnlock(() => startShuffle());
    }
    await sleep(400);
  }

  // 5. Select cards
  await speakOracle(lines[5]);
  await sleep(300);
  const required = (typeof state !== 'undefined' && state.selectedSpread)
    ? state.selectedSpread.card_count : 3;
  const cards = document.querySelectorAll('.card-cell');
  for (let i = 0; i < Math.min(required, cards.length); i++) {
    const card = cards[i];
    await moveCursorTo(card, 220);
    await sleep(150);
    highlightTarget(card);
    await cursorClick();
    if (typeof selectCard === 'function') {
      _demoUnlock(() => selectCard(i, card));
    }
    await sleep(300);
  }

  // 6. Hover over confirm button
  await speakOracle(lines[6]);
  await sleep(300);
  const confirmBtn = document.querySelector('#confirm-popup .btn-confirm');
  if (confirmBtn) {
    await moveCursorTo(confirmBtn, 300);
    await sleep(1000);
  }

  // 7. Full reset — resetDivination() now handles all state + DOM
  await sleep(300);
  _demoUnlock(() => {
    if (typeof resetDivination === 'function') resetDivination();
  });
  await sleep(300);
}

// ── Phase 2: 登录/注册演示 ──
async function demoPhase2() {
  const lines = GUIDANCE.phase2.demo;
  const authOverlay = document.getElementById('auth-overlay');
  if (!authOverlay || authOverlay.classList.contains('hidden')) return;

  await speakOracle(lines[0]);
  await sleep(300);

  // 1. Switch to register tab
  await speakOracle(lines[1]);
  await sleep(300);
  const registerTab = document.getElementById('tab-register-btn');
  const loginTab = document.getElementById('tab-login-btn');
  if (registerTab && !registerTab.classList.contains('active')) {
    await moveCursorTo(registerTab, 250);
    await sleep(200);
    highlightTarget(registerTab);
    await cursorClick();
    registerTab.click();
    await sleep(400);
  }

  // 2. Switch back to login tab
  await speakOracle(lines[2]);
  await sleep(300);
  if (loginTab && !loginTab.classList.contains('active')) {
    await moveCursorTo(loginTab, 250);
    await sleep(200);
    highlightTarget(loginTab);
    await cursorClick();
    loginTab.click();
    await sleep(400);
  }

  // 3. Hover over close button — explain can skip
  await speakOracle(lines[3]);
  await sleep(300);
  const closeBtn = authOverlay.querySelector('.auth-close');
  if (closeBtn) {
    await moveCursorTo(closeBtn, 300);
    await sleep(1000);
  }

  // 4. Return to login tab — leave modal open
  await speakOracle(lines[4]);
  await sleep(300);
  if (loginTab && !loginTab.classList.contains('active')) {
    await moveCursorTo(loginTab, 250);
    await sleep(200);
    highlightTarget(loginTab);
    await cursorClick();
    loginTab.click();
    await sleep(400);
  }
  await sleep(300);
}

// ── Phase 3: 简详切换 + 悬浮重新测算 + 结语 ──
async function demoPhase3() {
  const lines = GUIDANCE.phase3.demo;

  await speakOracle(lines[0]);
  await sleep(300);

  // 1. Toggle to detailed mode
  await speakOracle(lines[1]);
  await sleep(300);
  const detailedBtn = document.querySelector('.seg-btn[data-mode="detailed"]');
  const simpleBtn = document.querySelector('.seg-btn[data-mode="simple"]');
  if (detailedBtn) {
    await moveCursorTo(detailedBtn, 250);
    await sleep(200);
    highlightTarget(detailedBtn);
    await cursorClick();
    if (typeof setAnswerMode === 'function') {
      _demoUnlock(() => setAnswerMode('detailed'));
    }
    await sleep(400);
  }

  // 2. Toggle back to simple mode
  await speakOracle(lines[2]);
  await sleep(300);
  if (simpleBtn) {
    await moveCursorTo(simpleBtn, 250);
    await sleep(200);
    highlightTarget(simpleBtn);
    await cursorClick();
    if (typeof setAnswerMode === 'function') {
      _demoUnlock(() => setAnswerMode('simple'));
    }
    await sleep(400);
  }

  // 3. Hover over reset button
  await speakOracle(lines[3]);
  await sleep(300);
  const resetBtn = document.querySelector('.result-actions .btn-action.primary');
  if (resetBtn) {
    await moveCursorTo(resetBtn, 300);
    await sleep(800);
  }

  // 4. Switch back to simple mode — keep results visible
  await sleep(300);
  _demoUnlock(() => {
    if (typeof setAnswerMode === 'function') setAnswerMode('simple');
  });
  await sleep(300);
}

// ── Main Guide Function ──
async function guidePhase(phaseKey) {
  if (oracleState.demoInProgress) return;

  if (isDemoNeeded(phaseKey)) {
    await runDemoForPhase(phaseKey);
  } else {
    const guidance = GUIDANCE[phaseKey];
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
    setTimeout(() => {
      oracleState.orbEl.classList.add('visible');
    }, 1500);

    oracleState.orbEl.addEventListener('click', () => {
      if (oracleState.demoInProgress) return;
      // Brief pulse feedback on click
      oracleState.orbEl.classList.add('hovered');
      setTimeout(() => oracleState.orbEl.classList.remove('hovered'), 600);
    });

    oracleState.orbEl.addEventListener('mouseenter', () => {
      oracleState.orbEl.classList.add('hovered');
    });
    oracleState.orbEl.addEventListener('mouseleave', () => {
      oracleState.orbEl.classList.remove('hovered');
    });
  }

  startOrbIdleAnimation();
  console.log('[Oracle] 占卜师光球系统已初始化 · 三阶段演示模式');
}

// ── Mood-based Orb Color ──
function setOrbMood(mood) {
  const orb = oracleState.orbEl;
  if (!orb) return;
  const moodColors = {
    excited: '#f0c040', happy: '#e8b84b', calm: '#d4a843',
    neutral: '#b8913a', anxious: '#6a9ec2', sad: '#557799', tired: '#665588',
  };
  orb.style.setProperty('--orb-color', moodColors[mood] || 'var(--amber-400, #e8b84b)');
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
  hideSubtitle();
  // Reset page state
  if (typeof resetDivination === 'function') resetDivination();
  oracleState.orbX = 75;
  oracleState.orbY = 45;
  _orbToFloatPosition();
}
