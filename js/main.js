/* ============================================================
   main.js — 核心占卜流程控制
   ============================================================ */

// ---------- Global State ----------
const state = {
  selectedSpread: null,
  gridCards: [],
  selectedCards: [],
  isShuffling: false,
  divinationResult: null,
  noisePlaying: false,
  noiseSound: 'rain',
  includeMinorArcana: false,
  // AI 相关
  aiEnabled: false,
  userQuestion: '',
  selectedMood: null,
  // 回答模式
  answerMode: 'simple',  // 'simple' | 'detailed'
};

// ---------- Initialization ----------
document.addEventListener('DOMContentLoaded', async () => {
  await loadCardData();
  setupIntro();
  renderSpreadOptions();
  setupSidebar();
  setupFanHover();
  setupAuthForms();
  updateSidebarUser();
  initWeather();
  initWhiteNoise();
  spawnIntroEmojis();
  initOracle();
});

// ---------- Intro Overlay ----------
async function runStartupSequence() {
  // Phase 1 demo (or skip if already done)
  await guidePhase('phase1');
  // After phase1, show auth modal if not logged in and not dismissed today
  const user = getCurrentUser();
  const dismissed = authDismissedToday();
  console.log('[Auth] runStartupSequence:', { user, dismissed, willShow: !user && !dismissed });
  if (!user && !dismissed) {
    window._authSource = 'divination';
    showAuthModal();
    // Oracle phase2 demo for auth system
    setTimeout(() => guidePhase('phase2'), 500);
  }
}

function setupIntro() {
  const shown = sessionStorage.getItem('tarot-intro-shown');
  const overlay = document.getElementById('intro-overlay');
  if (shown) {
    overlay.classList.add('dismissed');
    setTimeout(() => overlay.remove(), 600);
    setTimeout(() => runStartupSequence(), 800);
    return;
  }
  overlay.addEventListener('click', () => {
    overlay.classList.add('dismissed');
    sessionStorage.setItem('tarot-intro-shown', '1');
    setTimeout(() => overlay.remove(), 600);
    // Oracle phase1 demo after intro, then auth
    setTimeout(() => runStartupSequence(), 800);
  });
}

function spawnIntroEmojis() {
  const container = document.getElementById('intro-stars');
  if (!container) return;
  const emojis = ['◆', '◇', '◈', '⟡', '⬥', '◉', '◎', '⬦'];
  for (let i = 0; i < 20; i++) {
    const el = document.createElement('span');
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    el.style.cssText = `
      position:absolute;
      left:${Math.random() * 100}%;
      top:${Math.random() * 100}%;
      font-size:${1 + Math.random() * 2}rem;
      opacity:${0.2 + Math.random() * 0.4};
      animation: floatUp ${4 + Math.random() * 6}s linear infinite;
      animation-delay:${Math.random() * 4}s;
    `;
    container.appendChild(el);
  }
}

// ---------- Spread Type Selection ----------
function renderSpreadOptions() {
  const container = document.getElementById('spread-selector');
  if (!spreads.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">加载牌型中...</p>';
    return;
  }
  container.innerHTML = spreads.map(t => `
    <div class="spread-option glass-card" data-theme="${t.theme}" onclick="selectTheme('${t.theme}', this)">
      <span class="spread-icon">${symbolToSVG(t.icon)}</span>
      <span class="spread-name">${t.name_zh}</span>
      <span class="spread-count">${t.spreads.length}种牌阵</span>
    </div>
  `).join('');
}

function selectTheme(themeId, el) {
  if (window.__oracleDemoLock) return;
  document.querySelectorAll('.spread-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedTheme = themeId;
  state.selectedCards = [];
  state.divinationResult = null;

  // Render sub-spread options
  const theme = getTheme(themeId);
  if (!theme) return;

  const subContainer = document.getElementById('spread-sub-selector');
  subContainer.innerHTML = theme.spreads.map(s => `
    <div class="spread-sub-option glass-card" data-spread-id="${s.id}" onclick="selectSubSpread('${s.id}', this)">
      <span>${s.name_zh}</span>
      <span class="sub-count">${s.card_count}张牌 · ${s.description}</span>
    </div>
  `).join('');

  document.getElementById('spread-sub-section').classList.add('visible');
  document.getElementById('shuffle-area').style.display = 'none';
  document.getElementById('card-grid-container').style.display = 'none';
  document.getElementById('result-section').classList.add('hidden');
  document.getElementById('song-recommendation').classList.add('hidden');
  document.getElementById('mood-section').classList.add('hidden');

  // Auto-select first spread
  const firstSub = subContainer.querySelector('.spread-sub-option');
  if (firstSub) {
    firstSub.classList.add('selected');
    const { spread } = getSpreadById(theme.spreads[0].id);
    state.selectedSpread = spread;
    showShuffleReady();
  }
}

function selectSubSpread(spreadId, el) {
  if (window.__oracleDemoLock) return;
  document.querySelectorAll('.spread-sub-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');

  const { spread } = getSpreadById(spreadId);
  if (spread) {
    state.selectedSpread = spread;
    showShuffleReady();
  }
}

function toggleMinorArcana() {
  if (window.__oracleDemoLock) return;
  state.includeMinorArcana = !state.includeMinorArcana;
  const sw = document.getElementById('toggle-minor-arcana');
  if (sw) sw.classList.toggle('on', state.includeMinorArcana);
}

// ── AI Toggle ──
function toggleAI() {
  if (window.__oracleDemoLock) return;
  state.aiEnabled = !state.aiEnabled;
  const sw = document.getElementById('toggle-ai-switch');
  const questionBox = document.getElementById('user-question');
  const voiceBtn = document.getElementById('btn-voice-input');

  if (sw) sw.classList.toggle('on', state.aiEnabled);
  if (questionBox) questionBox.style.display = state.aiEnabled ? 'block' : 'none';
  if (voiceBtn) voiceBtn.style.display = state.aiEnabled ? 'inline-block' : 'none';

  updateAIStatusUI();
}

// ── 更新 AI 状态 UI ──
function updateAIStatusUI() {
  const status = document.getElementById('ai-status-text');
  if (!status) return;

  if (!state.aiEnabled) {
    status.textContent = '[AI.OFF] 使用本地解读模式';
    status.style.color = 'var(--text-muted)';
    return;
  }

  status.textContent = '[AI.ON] 智能解读已激活 · 真实 AI 模式';
  status.style.color = 'var(--amber-400)';
}

// ── AI 问题输入 ──
function handleQuestionInput(el) {
  state.userQuestion = el.value.trim();
}

// ── 语音输入桥接 ──
function triggerVoiceInput() {
  if (typeof startVoiceInput !== 'function') {
    const status = document.getElementById('ai-status-text');
    if (status) {
      status.textContent = '[WARN] 语音模块未加载，请使用文本输入';
      status.style.color = 'var(--crimson-400)';
    }
    return;
  }

  const textarea = document.getElementById('user-question');
  const btn = document.getElementById('btn-voice-input');

  startVoiceInput({
    onResult: (text, isFinal) => {
      if (textarea) {
        textarea.value = text;
        state.userQuestion = text;
      }
      if (isFinal && btn) {
        btn.textContent = '🎙️ 语音输入';
        btn.classList.remove('listening');
      }
    },
    onError: (msg) => {
      const status = document.getElementById('ai-status-text');
      if (status) {
        status.textContent = `[ERR] ${msg}`;
        status.style.color = 'var(--crimson-400)';
      }
    },
    onStateChange: (listening) => {
      if (btn) {
        btn.textContent = listening ? '⏹ 停止录音' : '🎙️ 语音输入';
        btn.classList.toggle('listening', listening);
      }
    },
  });
}

function showShuffleReady() {
  if (!state.selectedSpread) return;
  document.getElementById('card-count-display').textContent = state.selectedSpread.card_count;
  document.getElementById('required-count').textContent = state.selectedSpread.card_count;
  document.getElementById('selected-count').textContent = '0';
  document.getElementById('shuffle-area').style.display = 'block';
}

// ── Fan hover delegation (preserves rotation) ──
function setupFanHover() {
  const container = document.getElementById('card-fan-container');
  if (!container) return;

  const LIFT_Y = -25;
  const LIFT_SCALE = 1.08;

  function applyLift(cell) {
    if (cell.classList.contains('selected')) return;
    const x = parseFloat(cell.dataset.x) || 0;
    const y = (parseFloat(cell.dataset.y) || 0) + LIFT_Y;
    const rot = parseFloat(cell.dataset.rot) || 0;
    cell.style.transform = `translateX(${x}px) translateY(${y}px) rotate(${rot}deg) scale(${LIFT_SCALE})`;
    cell.classList.add('lifted');
  }

  function removeLift(cell) {
    if (cell.classList.contains('selected')) return;
    const x = parseFloat(cell.dataset.x) || 0;
    const y = parseFloat(cell.dataset.y) || 0;
    const rot = parseFloat(cell.dataset.rot) || 0;
    cell.style.transform = `translateX(${x}px) translateY(${y}px) rotate(${rot}deg) scale(1)`;
    cell.classList.remove('lifted');
  }

  // Mouse hover
  container.addEventListener('mouseover', e => {
    const cell = e.target.closest('.card-cell');
    if (cell && !state.isShuffling) applyLift(cell);
  });
  container.addEventListener('mouseout', e => {
    const cell = e.target.closest('.card-cell');
    if (cell) removeLift(cell);
  });

  // Touch for mobile
  container.addEventListener('touchstart', e => {
    const cell = e.target.closest('.card-cell');
    if (cell && !state.isShuffling) applyLift(cell);
  }, { passive: true });
  container.addEventListener('touchend', e => {
    // Find all lifted non-selected cards and restore them
    container.querySelectorAll('.card-cell.lifted:not(.selected)').forEach(c => removeLift(c));
  });
}

// ── Apply selected lift (called by selectCard) ──
function applySelectedLift(cell) {
  const x = parseFloat(cell.dataset.x) || 0;
  const y = (parseFloat(cell.dataset.y) || 0) - 30;
  const rot = parseFloat(cell.dataset.rot) || 0;
  cell.style.transform = `translateX(${x}px) translateY(${y}px) rotate(${rot}deg) scale(1.12)`;
}

// ── Restore fan position (called by cancelSelection) ──
function restoreFanPosition(cell) {
  const x = parseFloat(cell.dataset.x) || 0;
  const y = parseFloat(cell.dataset.y) || 0;
  const rot = parseFloat(cell.dataset.rot) || 0;
  cell.style.transform = `translateX(${x}px) translateY(${y}px) rotate(${rot}deg) scale(1)`;
  cell.classList.remove('lifted');
}

// ---------- Fan Position Calculator ----------
function calculateFanPositions(count) {
  const isMobile = window.innerWidth <= 480;
  const isTablet = window.innerWidth <= 768;
  const totalAngle = count > 30 ? 75 : 55;
  const radius = isMobile ? 240 : (isTablet ? 300 : 360);
  const positions = [];
  for (let i = 0; i < count; i++) {
    const angle = -totalAngle / 2 + (totalAngle / Math.max(count - 1, 1)) * i;
    const rad = (angle * Math.PI) / 180;
    const x = Math.sin(rad) * radius;
    const y = -Math.cos(rad) * radius;
    const rotation = angle * 0.85;
    const zIdx = i + 1; // Rightmost card on top
    positions.push({ x, y, rotation, zIdx });
  }
  return positions;
}

// ---------- Shuffle & Fan Display ----------
async function startShuffle() {
  if (window.__oracleDemoLock) return;
  if (state.isShuffling) return;
  if (!state.selectedSpread) {
    alert('[ERROR] 请先选择协议类型');
    return;
  }

  state.isShuffling = true;
  state.selectedCards = [];
  document.getElementById('btn-shuffle').disabled = true;
  document.getElementById('btn-shuffle').textContent = 'SHUFFLING...';

  state.gridCards = getShuffledGrid(state.includeMinorArcana);
  const container = document.getElementById('card-fan-container');
  const positions = calculateFanPositions(state.gridCards.length);

  // Render cards at fan positions with initial "pile" state (center, tiny, hidden)
  container.innerHTML = state.gridCards.map((card, i) => {
    const pos = positions[i];
    return `
    <div class="card-cell" data-index="${i}" data-x="${pos.x}" data-y="${pos.y}" data-rot="${pos.rotation}"
         style="transform: translateX(0px) translateY(0px) rotate(0deg) scale(0.3); opacity: 0; z-index: ${pos.zIdx};"
         onclick="selectCard(${i}, this)">
      <div class="card-face">
        <div class="card-back">${getIconSVG('diamond', 'svg-icon')}</div>
        <div class="card-front">
          <span class="card-emoji">${symbolToSVG(card.emoji, 'svg-icon card-mini-svg')}</span>
          <span class="card-mini-name">${card.name_zh}</span>
        </div>
      </div>
    </div>
  `;}).join('');

  const gridContainer = document.getElementById('card-grid-container');
  gridContainer.style.display = 'block';
  document.getElementById('selection-counter').style.display = 'inline-flex';
  updateSelectionCounter();
  gridContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Animate: cards bloom to fan positions
  await fanSpreadAnimation(700);

  state.isShuffling = false;
  document.getElementById('btn-shuffle').disabled = false;
  document.getElementById('btn-shuffle').textContent = '⟲ 重新洗牌';
}

// Fan spread animation: cards bloom outward from center with smooth ease-out
function fanSpreadAnimation(duration) {
  return new Promise(resolve => {
    const cells = document.querySelectorAll('.card-cell');
    const startTime = performance.now();

    function animate(now) {
      const elapsed = now - startTime;
      const p = Math.min(1, elapsed / duration);
      // Clean cubic ease-out — no bounce, no delay, just smooth
      const eased = 1 - Math.pow(1 - p, 3);

      cells.forEach(cell => {
        const tx = parseFloat(cell.dataset.x) || 0;
        const ty = parseFloat(cell.dataset.y) || 0;
        const rot = parseFloat(cell.dataset.rot) || 0;

        cell.style.transform =
          `translateX(${tx * eased}px) translateY(${ty * eased}px) rotate(${rot * eased}deg) scale(${0.3 + 0.7 * eased})`;
        cell.style.opacity = Math.min(1, 0.3 + 0.7 * eased);
      });

      if (elapsed < duration) {
        requestAnimationFrame(animate);
      } else {
        // Final settle
        cells.forEach(cell => {
          const tx = parseFloat(cell.dataset.x) || 0;
          const ty = parseFloat(cell.dataset.y) || 0;
          const rot = parseFloat(cell.dataset.rot) || 0;
          cell.style.transform = `translateX(${tx}px) translateY(${ty}px) rotate(${rot}deg) scale(1)`;
          cell.style.opacity = '1';
        });
        resolve();
      }
    }

    requestAnimationFrame(animate);
  });
}

// ---------- Card Selection ----------
function selectCard(index, el) {
  if (window.__oracleDemoLock) return;
  if (state.isShuffling) return;
  if (!state.selectedSpread) return;

  const alreadySelected = state.selectedCards.find(s => s.index === index);
  if (alreadySelected) {
    // Deselect
    state.selectedCards = state.selectedCards.filter(s => s.index !== index);
    el.classList.remove('selected');
    restoreFanPosition(el);
  } else {
    if (state.selectedCards.length >= state.selectedSpread.card_count) {
      return; // Already full
    }
    state.selectedCards.push({ index, card: state.gridCards[index] });
    el.classList.add('selected');
    applySelectedLift(el);
  }

  updateSelectionCounter();

  // Check if reached required count
  if (state.selectedCards.length >= state.selectedSpread.card_count) {
    setTimeout(showConfirmation, 400);
  }
}

function updateSelectionCounter() {
  document.getElementById('selected-count').textContent = state.selectedCards.length;
  const remaining = state.selectedSpread
    ? state.selectedSpread.card_count - state.selectedCards.length
    : 0;
  if (remaining <= 0 && state.selectedSpread) {
    document.getElementById('selection-counter').style.background = 'rgba(180,231,206,0.3)';
  } else {
    document.getElementById('selection-counter').style.background = '';
  }
}

// ---------- Confirmation Popup ----------
function showConfirmation() {
  const popup = document.getElementById('confirm-popup');
  const preview = document.getElementById('popup-preview');

  preview.innerHTML = state.selectedCards.map(s => `
    <div class="popup-mini-card glass">
      ${getIconSVG('diamond', 'svg-icon')}
    </div>
  `).join('');

  popup.classList.remove('hidden');
}

function cancelSelection() {
  if (window.__oracleDemoLock) return;
  document.getElementById('confirm-popup').classList.add('hidden');
  // Deselect all and restore fan positions
  state.selectedCards.forEach(s => {
    const el = document.querySelector(`.card-cell[data-index="${s.index}"]`);
    if (el) {
      el.classList.remove('selected');
      restoreFanPosition(el);
    }
  });
  state.selectedCards = [];
  updateSelectionCounter();
}

// ---------- Confirm Reading & Curtain ----------
async function confirmReading() {
  if (window.__oracleDemoLock) return;
  document.getElementById('confirm-popup').classList.add('hidden');

  const user = getCurrentUser();

  // If not logged in and not dismissed today → show auth, wait, then proceed
  if (!user && !authDismissedToday()) {
    // Set callback: after auth resolved (login/dismiss), do the actual divination
    window._pendingDivination = () => {
      window._pendingDivination = null;
      doPerformDivination();
    };
    window._authSource = 'divination';
    showAuthModal();
    // Oracle phase2 demo for auth system
    setTimeout(() => guidePhase('phase2'), 500);
    return;
  }

  // No auth needed → proceed directly
  doPerformDivination();
}

async function doPerformDivination() {
  // Hide the overlay DOM directly — don't call hideAuthModal()
  // because that writes dismissAuthToday() and blocks future prompts
  document.getElementById('auth-overlay').classList.add('hidden');

  const user = getCurrentUser();

  // Track first divination of the day
  const isFirstToday = user ? isFirstActionToday(user) : !divinationDoneToday();
  if (user && isFirstToday) {
    setLastActionDate(user, 'divination');
  }
  if (!user) {
    markDivinationDoneToday();
  }

  // Draw cards with reversal chance
  const drawnCards = state.selectedCards.map(s => {
    const isReversed = Math.random() < 0.35;
    return { ...s.card, isReversed };
  });

  // Build AI options
  const aiOpts = {
    useAI: state.aiEnabled,
    userQuestion: state.userQuestion || '',
    userMood: state.selectedMood || '',
    history: [],
  };

  // Fetch history for AI context (only when AI enabled and user logged in)
  if (state.aiEnabled && user && typeof getRecentHistorySummary === 'function') {
    aiOpts.history = getRecentHistorySummary(user, 5);
  }

  // Show loading overlay while AI generates interpretation
  showDivinationLoading();

  // Generate interpretation (may be async when AI mode is on)
  const result = await generateInterpretation(drawnCards, state.selectedSpread, aiOpts);

  // Hide loading overlay
  hideDivinationLoading();
  state.divinationResult = result;

  // Save fortune only if logged in
  if (user) {
    const fortuneData = {
      date: new Date().toISOString().split('T')[0],
      timestamp: Date.now(),
      spreadType: state.selectedSpread.id,
      spreadName: state.selectedSpread.name_zh,
      cards: result.cards,
      overallMood: result.overallMood,
      summary: result.summary
    };
    saveFortune(user, fortuneData);
  }

  // Fade out unselected cards
  const allCells = document.querySelectorAll('.card-cell');
  const selectedIndices = state.selectedCards.map(s => s.index);
  allCells.forEach(cell => {
    const idx = parseInt(cell.dataset.index);
    if (!selectedIndices.includes(idx)) {
      cell.classList.add('fading');
    }
  });

  await sleep(500);

  // Curtain animation
  await animateCurtain();

  // Show results
  renderResults(result);

  // Show song recommendation if first daily
  if (isFirstToday) {
    showSongRecommendation(result.overallMood);
  }

  // Trigger white noise based on result mood
  setNoiseByMood(result.overallMood);

  // Spawn floating emojis
  spawnFloatingEmojis(result.overallMood);
}

function animateCurtain() {
  return new Promise(resolve => {
    const curtain = document.getElementById('curtain-overlay');
    curtain.classList.remove('hidden');

    // Render results behind curtain first
    document.getElementById('card-grid-container').style.display = 'none';
    document.getElementById('result-section').classList.remove('hidden');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        curtain.classList.add('opening');
        setTimeout(() => {
          curtain.classList.add('hidden');
          curtain.classList.remove('opening');
          resolve();
        }, 850);
      });
    });
  });
}

// ---------- Answer Mode Toggle ----------
function setAnswerMode(mode) {
  state.answerMode = mode;
  // Update segmented button states
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  // Show/hide appropriate containers
  const oneliner = document.getElementById('result-oneliner');
  const detailed = document.getElementById('result-detailed');
  if (oneliner) oneliner.style.display = mode === 'simple' ? '' : 'none';
  if (detailed) detailed.style.display = mode === 'detailed' ? '' : 'none';
}

// ---------- Result Display ----------
function renderResults(result) {
  // Store result for mode switching
  state.divinationResult = result;

  document.getElementById('result-date').textContent =
    `[DATE] ${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}`;
  document.getElementById('result-spread-name').textContent = result.spreadName;

  // ── Simple mode: one-liner + card names ──
  const oneLiner = result.oneLiner || result._aiOverview || '牌面已展开，详情请查看完整解读。';
  document.getElementById('oneliner-text').textContent = oneLiner;

  const onelinerCardsContainer = document.getElementById('oneliner-cards');
  onelinerCardsContainer.innerHTML = result.cards.map((c) => `
    <div class="oneliner-card">
      <span class="oc-emoji">${symbolToSVG(c.emoji)}</span>
      <span class="oc-name">${c.name_zh}</span>
      <span class="oc-status ${c.isReversed ? 'reversed' : 'upright'}">${c.isReversed ? '逆位' : '正位'}</span>
    </div>
  `).join('');

  // ── Detailed mode: full card-by-card breakdown ──
  const cardsContainer = document.getElementById('result-cards');
  cardsContainer.innerHTML = result.cards.map((c, i) => `
    <div class="result-card glass-card" style="animation-delay:${0.1 + i * 0.15}s;">
      <div class="result-card-emoji">${symbolToSVG(c.emoji)}</div>
      <div class="result-card-name">${c.name_zh}</div>
      <div class="result-card-position">${c.positionName}</div>
      <span class="result-card-reversal ${c.isReversed ? 'reversed' : 'upright'}">
        ${c.isReversed ? 'REVERSED' : 'UPRIGHT'}
      </span>
      <p class="result-card-text">${c.interpretation}</p>
    </div>
  `).join('');

  // 结果标题
  const isAI = result._aiGenerated;
  const summaryTitle = isAI ? '◆ 智能深度解读' : '◆ 塔罗解读';
  document.getElementById('result-summary').innerHTML = `
    <h3>${summaryTitle}</h3>
    <div class="result-summary-text">${result.summary.replace(/\n/g, '<br>')}</div>
  `;

  // 预算耗尽提示
  if (result._budgetExceeded) {
    const hint = document.createElement('p');
    hint.style.cssText = 'color:var(--crimson-400);font-size:0.8rem;margin-top:12px;font-family:var(--font-mono);text-align:center;';
    hint.textContent = '⚠ 系统繁忙，请稍后重试 · 已切换增强本地模式';
    document.getElementById('result-summary').appendChild(hint);
  }

  // AI 错误提示
  if (result._isFallback && result._aiError) {
    const hint = document.createElement('p');
    hint.style.cssText = 'color:var(--text-muted);font-size:0.75rem;margin-top:8px;font-family:var(--font-mono);';
    hint.textContent = `[FALLBACK] AI 暂时不可用，已使用本地模板引擎。`;
    document.getElementById('result-summary').appendChild(hint);
  }

  // ── Apply current answer mode ──
  setAnswerMode(state.answerMode);

  document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Adjust background based on mood
  updateBackgroundByMood(result.overallMood);

  // Oracle phase3 demo for result browsing
  setTimeout(() => guidePhase('phase3'), 1500);
}

// ---------- Copy Result ----------
async function copyDivinationResult() {
  if (!state.divinationResult) return;
  const r = state.divinationResult;

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });

  let text = '';

  // 优先使用新格式 full_text
  if (r._aiFullText) {
    text += `${r.spreadName} · ${today}\n`;
    if (state.userQuestion) {
      text += `问题：${state.userQuestion}\n`;
    }
    text += `${'─'.repeat(30)}\n\n`;
    text += r._aiFullText;
    text += `\n\n${'─'.repeat(30)}\n`;
    text += `命运终端 · TAROT TERMINAL`;
  } else {
    // 向后兼容：旧格式
    text += `${r.spreadName} · ${today}\n`;
    text += `${'─'.repeat(30)}\n\n`;
    r.cards.forEach((c, i) => {
      text += `${c.positionName}｜${c.name_zh}（${c.isReversed ? '逆位' : '正位'}）\n`;
      text += `${c.interpretation}\n\n`;
    });
    text += `${'─'.repeat(30)}\n`;
    text += r.summary.replace(/<br>/g, '\n').replace(/\n\n/g, '\n');
    text += `\n\n${'─'.repeat(30)}\n`;
    text += `命运终端 · TAROT TERMINAL`;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('[OK] DATA.EXPORTED · 协议文本已复制');
  } catch (e) {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('[OK] DATA.EXPORTED · 协议文本已复制');
  }
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function showSongRecommendation(mood) {
  const song = getSongRecommendation(mood);
  const div = document.getElementById('song-recommendation');
  document.getElementById('song-emoji').textContent = song.emoji;
  document.getElementById('song-title').textContent = song.title;
  document.getElementById('song-artist').textContent = `♪ ${song.artist}`;
  document.getElementById('song-reason').textContent = song.reason;
  div.classList.remove('hidden');
}

// ---------- Divination Loading Overlay ----------
function showDivinationLoading() {
  const grid = document.getElementById('card-grid-container');
  if (!grid) return;
  const loader = document.createElement('div');
  loader.id = 'divination-loader';
  loader.innerHTML = `
    <div class="divination-spinner">
      <svg class="svg-icon svg-glow" viewBox="0 0 24 24" width="48" height="48">
        <rect x="12" y="2" width="14" height="14" transform="rotate(45 12 2)"/>
      </svg>
    </div>
    <p class="divination-loading-text">正在解读...</p>
  `;
  loader.style.cssText = `
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: rgba(10,10,15,0.7);
    z-index: 10;
    border-radius: 8px;
  `;
  grid.style.position = 'relative';
  grid.appendChild(loader);
}

function hideDivinationLoading() {
  const loader = document.getElementById('divination-loader');
  if (loader) loader.remove();
}

// ---------- Reset ----------
function resetDivination() {
  state.selectedTheme = null;
  state.selectedSpread = null;
  state.selectedCards = [];
  state.gridCards = [];
  state.divinationResult = null;
  state.answerMode = 'simple';
  state.includeMinorArcana = false;
  state.aiEnabled = false;

  // Hide all dynamic sections
  document.getElementById('card-grid-container').style.display = 'none';
  document.getElementById('card-fan-container').innerHTML = '';
  document.getElementById('shuffle-area').style.display = 'none';
  document.getElementById('spread-sub-section').classList.remove('visible');
  document.getElementById('result-section').classList.add('hidden');
  document.getElementById('song-recommendation').classList.add('hidden');
  document.getElementById('mood-section').classList.add('hidden');
  document.getElementById('confirm-popup').classList.add('hidden');

  // Deselect spread options
  document.querySelectorAll('.spread-option').forEach(o => o.classList.remove('selected'));

  // Reset toggle switches
  const maSw = document.getElementById('toggle-minor-arcana');
  if (maSw) maSw.classList.remove('on');
  const aiSw = document.getElementById('toggle-ai-switch');
  if (aiSw) aiSw.classList.remove('on');

  // Reset AI UI
  if (typeof updateAIStatusUI === 'function') updateAIStatusUI();
  const questionInput = document.getElementById('user-question');
  if (questionInput) questionInput.style.display = 'none';
  const voiceBtn = document.getElementById('btn-voice-input');
  if (voiceBtn) voiceBtn.style.display = 'none';

  // Reset shuffle button
  const shuffleBtn = document.getElementById('btn-shuffle');
  if (shuffleBtn) {
    shuffleBtn.textContent = '◆ 启动洗牌协议';
    shuffleBtn.disabled = false;
  }

  document.body.style.background = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Mood Panel ----------
function showHomePage() {
  // Already on index page, scroll to top and show spread section
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.getElementById('spread-section').scrollIntoView({ behavior: 'smooth' });
}

function openMoodPanel() {
  const user = getCurrentUser();

  // Only show auth reminder once per day
  if (!user && !authDismissedToday()) {
    window._pendingAuthAction = null;
    window._authSource = 'mood';
    showAuthModal();
  }
  // Allow mood panel without login

  const section = document.getElementById('mood-section');
  section.classList.remove('hidden');

  const grid = document.getElementById('mood-grid');
  if (!grid.children.length) {
    const options = getMoodOptions();
    grid.innerHTML = options.map(o => `
      <div class="mood-option glass-card" data-mood="${o.id}" onclick="selectMood('${o.id}', this)" title="${o.label}">
        ${symbolToSVG(o.emoji, 'svg-icon svg-glow')}
      </div>
    `).join('');

    // Check if already have mood today
    const todayMood = getTodayMood(user);
    if (todayMood) {
      const el = grid.querySelector(`[data-mood="${todayMood.mood}"]`);
      if (el) el.classList.add('selected');
      document.getElementById('mood-note').value = todayMood.note || '';
    }
  }

  section.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Adjust noise based on last fortune mood if available
  const fortunes = getFortunes(user);
  if (fortunes.length > 0) {
    const lastFortune = fortunes[fortunes.length - 1];
    setNoiseByMood(lastFortune.overallMood || 'calm');
  }
}

let selectedMoodValue = null;
function selectMood(moodId, el) {
  document.querySelectorAll('.mood-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedMoodValue = moodId;
  state.selectedMood = moodId;  // 同步到全局 state 供 AI 上下文使用
}

async function submitMood() {
  const user = getCurrentUser();
  // Allow mood recording without login — just don't save
  if (!user) {
    if (!authDismissedToday()) {
      window._authSource = 'mood';
      showAuthModal();
    }
    document.getElementById('mood-msg').textContent = '[INFO] 登录后可保存心情记录';
    setTimeout(() => { document.getElementById('mood-msg').textContent = ''; }, 3000);
    return;
  }

  if (!selectedMoodValue) {
    const todayMood = getTodayMood(user);
    if (!todayMood) {
      document.getElementById('mood-msg').textContent = '[WARN] 请先选择一个心情状态';
      return;
    }
    selectedMoodValue = todayMood.mood;
  }

  const note = document.getElementById('mood-note').value.trim();
  saveMood(user, { mood: selectedMoodValue, note });

  document.getElementById('mood-msg').textContent = '[OK] STATE.SAVED · 状态已写入日志';
  setTimeout(() => {
    document.getElementById('mood-msg').textContent = '';
  }, 3000);

  // Update white noise based on mood
  setNoiseByMood(selectedMoodValue);
}

// ---------- Sidebar ----------
function setupSidebar() {
  const sidebar = document.getElementById('sidebar');
  let hideTimeout;

  sidebar.addEventListener('mouseenter', () => {
    clearTimeout(hideTimeout);
  });

  sidebar.addEventListener('mouseleave', () => {
    if (!sidebar.classList.contains('pinned')) {
      hideTimeout = setTimeout(() => {
        // CSS handles collapse
      }, 300);
    }
  });

  document.getElementById('sidebar-pin').addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.toggle('pinned');
    const btn = document.getElementById('sidebar-pin');
    btn.textContent = sidebar.classList.contains('pinned') ? '[·]' : '[.]';
  });
}

function updateSidebarUser() {
  const user = getCurrentUser();
  const usernameEl = document.getElementById('sidebar-username');
  const authLabel = document.getElementById('sidebar-auth-label');
  const avatar = document.querySelector('.sidebar-user-avatar');
  const exportBtn = document.getElementById('sidebar-export-btn');

  if (user) {
    usernameEl.textContent = user;
    authLabel.textContent = '退出登录';
    avatar.textContent = user.charAt(0).toUpperCase();
    if (exportBtn) exportBtn.style.display = '';
  } else {
    usernameEl.textContent = '未登录';
    authLabel.textContent = '登录 / 注册';
    avatar.textContent = '?';
    if (exportBtn) exportBtn.style.display = 'none';
  }
}

// ---------- Account Import/Export Handlers ----------
async function handleImportFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const result = await handleAccountImport(file);
  if (result.success) {
    showToastMsg('[OK] IMPORT.SUCCESS · 账号 "' + result.username + '" 导入完成');
    updateSidebarUser();
  } else {
    showToastMsg(result.error || '[ERROR] 导入失败');
  }
  input.value = '';
}

function handleSidebarExport() {
  const user = getCurrentUser();
  if (!user) {
    window._authSource = 'export';
    window._pendingAuthAction = 'export';
    showAuthModal();
    return;
  }
  const result = exportFullAccount(user);
  if (result.success) {
    showToastMsg('[OK] EXPORT.COMPLETE · 账号数据已导出');
  }
}

// ---------- Auth Modal ----------
function showAuthModal() {
  document.getElementById('auth-overlay').classList.remove('hidden');
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';
}

function hideAuthModal() {
  document.getElementById('auth-overlay').classList.add('hidden');
  // Only set daily dismiss for divination-triggered auth.
  // Dismissing from mood/export/sidebar should NOT block future divination prompts.
  if (!window._authSource || window._authSource === 'divination') {
    dismissAuthToday();
  }
  window._authSource = null;
  // If there's a pending divination, trigger it after modal closes
  if (window._pendingDivination) {
    const fn = window._pendingDivination;
    window._pendingDivination = null;
    setTimeout(fn, 300); // Small delay for modal close animation
  }
  // Handle retry-after-login for export
  if (window._pendingAuthAction === 'export') {
    window._pendingAuthAction = null;
    setTimeout(() => handleSidebarExport(), 300);
  }
}

function triggerPendingAction() {
  if (window._pendingDivination) {
    const fn = window._pendingDivination;
    window._pendingDivination = null;
    setTimeout(fn, 300);
  }
  if (window._pendingAuthAction === 'export') {
    window._pendingAuthAction = null;
    setTimeout(() => handleSidebarExport(), 300);
  }
}

function setupAuthForms() {
  // Tab switching
  document.getElementById('tab-login-btn').addEventListener('click', function () {
    this.classList.add('active');
    document.getElementById('tab-register-btn').classList.remove('active');
    document.getElementById('login-form').classList.add('active');
    document.getElementById('register-form').classList.remove('active');
  });

  document.getElementById('tab-register-btn').addEventListener('click', function () {
    this.classList.add('active');
    document.getElementById('tab-login-btn').classList.remove('active');
    document.getElementById('register-form').classList.add('active');
    document.getElementById('login-form').classList.remove('active');
  });

  // Login form
  document.getElementById('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    const result = await loginUser(username, password);
    if (result.success) {
      hideAuthModal();
      updateSidebarUser();
      this.reset();
      // Trigger pending divination or mood action
      triggerPendingAction();
    } else {
      errorEl.textContent = result.error;
    }
  });

  // Register form
  document.getElementById('register-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-password-confirm').value;
    const errorEl = document.getElementById('register-error');

    if (password !== confirm) {
      errorEl.textContent = '两次密码不一致';
      return;
    }

    const result = await registerUser(username, password);
    if (result.success) {
      // Auto login after register
      await loginUser(username, password);
      hideAuthModal();
      updateSidebarUser();
      this.reset();
      document.getElementById('tab-login-btn').click();
      triggerPendingAction();
    } else {
      errorEl.textContent = result.error;
    }
  });

  // Auth button in sidebar
  document.getElementById('sidebar-auth-btn').addEventListener('click', () => {
    const user = getCurrentUser();
    if (user) {
      if (confirm(`[LOGOUT] 确定要退出登录吗？${user}`)) {
        logoutUser();
        updateSidebarUser();
      }
    } else {
      window._authSource = 'sidebar';
      showAuthModal();
    }
  });

  // Close overlay on background click
  document.getElementById('auth-overlay').addEventListener('click', function (e) {
    if (e.target === this) hideAuthModal();
  });

  // Auth required callback
  onAuthRequired(() => {
    showAuthModal();
  });
}

// ---------- Background Update ----------
function updateBackgroundByMood(mood) {
  const gradients = {
    excited: 'radial-gradient(ellipse at center, rgba(212,168,67,0.06) 0%, var(--terminal-bg) 70%)',
    happy: 'radial-gradient(ellipse at center, rgba(0,229,255,0.04) 0%, var(--terminal-bg) 70%)',
    calm: 'var(--terminal-bg)',
    neutral: 'var(--terminal-bg)',
    anxious: 'radial-gradient(ellipse at center, rgba(255,71,87,0.04) 0%, var(--terminal-bg) 70%)',
    sad: 'radial-gradient(ellipse at center, rgba(100,150,200,0.04) 0%, var(--terminal-bg) 70%)'
  };
  document.body.style.background = gradients[mood] || gradients.neutral;
}

// ---------- Floating Emojis ----------
function spawnFloatingEmojis(mood) {
  const container = document.getElementById('emoji-container');
  container.innerHTML = '';

  const moodEmojis = {
    excited: ['◆', '◇', '◈', '⟡', '⬥', '◉', '◎'],
    happy: ['◆', '◇', '◈', '⟡', '⬥', '◉', '◎'],
    calm: ['○', '◌', '◎', '◇', '◈', '⟡', '⬥'],
    neutral: ['○', '◌', '◎', '◇', '◈', '⟡', '⬥'],
    anxious: ['◈', '◆', '◇', '⟡', '⬥', '◉', '◎'],
    sad: ['○', '◌', '◎', '◇', '◈', '⟡', '⬥']
  };

  const emojis = moodEmojis[mood] || moodEmojis.neutral;

  for (let i = 0; i < 15; i++) {
    const el = document.createElement('span');
    el.className = 'floating-emoji';
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    el.style.cssText = `
      left: ${5 + Math.random() * 90}%;
      animation-duration: ${8 + Math.random() * 12}s;
      animation-delay: ${Math.random() * 8}s;
      font-size: ${1 + Math.random() * 2}rem;
      opacity: ${0.2 + Math.random() * 0.3};
    `;
    container.appendChild(el);
  }

  // Auto-cleanup after longest animation
  setTimeout(() => {
    if (container.children.length <= 15) {
      container.innerHTML = '';
    }
  }, 25000);
}

// ---------- White Noise Integration ----------
function setNoiseByMood(mood) {
  const soundMap = {
    excited: 'forest',
    happy: 'ocean',
    calm: 'ocean',
    neutral: 'wind',
    anxious: 'rain',
    sad: 'rain',
    tired: 'ocean'
  };
  const sound = soundMap[mood] || 'rain';
  selectNoiseSound(sound);

  // Update background colors via emoji container parent
  updateBackgroundByMood(mood);
}

// ---------- Utility ----------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------- Keyboard Shortcuts ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // During demo, Escape cancels the demo
    if (window.__oracleDemoLock && typeof cancelDemo === 'function') {
      cancelDemo();
      return;
    }
    hideAuthModal();
    document.getElementById('confirm-popup').classList.add('hidden');
  }
});
