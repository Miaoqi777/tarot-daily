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
  includeMinorArcana: false
};

// ---------- Initialization ----------
document.addEventListener('DOMContentLoaded', async () => {
  await loadCardData();
  setupIntro();
  renderSpreadOptions();
  setupSidebar();
  setupAuthForms();
  updateSidebarUser();
  initWeather();
  initWhiteNoise();
  spawnIntroEmojis();
});

// ---------- Intro Overlay ----------
function setupIntro() {
  const shown = sessionStorage.getItem('tarot-intro-shown');
  const overlay = document.getElementById('intro-overlay');
  if (shown) {
    overlay.classList.add('dismissed');
    setTimeout(() => overlay.remove(), 600);
    return;
  }
  overlay.addEventListener('click', () => {
    overlay.classList.add('dismissed');
    sessionStorage.setItem('tarot-intro-shown', '1');
    setTimeout(() => overlay.remove(), 600);
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
  document.querySelectorAll('.spread-sub-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');

  const { spread } = getSpreadById(spreadId);
  if (spread) {
    state.selectedSpread = spread;
    showShuffleReady();
  }
}

function toggleMinorArcana() {
  state.includeMinorArcana = !state.includeMinorArcana;
  const sw = document.getElementById('toggle-minor-arcana');
  if (sw) sw.classList.toggle('on', state.includeMinorArcana);
}

function showShuffleReady() {
  if (!state.selectedSpread) return;
  document.getElementById('card-count-display').textContent = state.selectedSpread.card_count;
  document.getElementById('required-count').textContent = state.selectedSpread.card_count;
  document.getElementById('selected-count').textContent = '0';
  document.getElementById('shuffle-area').style.display = 'block';
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
    const zIdx = i < count / 2 ? i + 1 : count - i;
    positions.push({ x, y, rotation, zIdx });
  }
  return positions;
}

// ---------- Shuffle & Fan Display ----------
async function startShuffle() {
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

  // Animate: pile → fan spread
  await fanSpreadAnimation(1000);

  state.isShuffling = false;
  document.getElementById('btn-shuffle').disabled = false;
  document.getElementById('btn-shuffle').textContent = '⟲ 重新洗牌';
}

// Fan spread animation: cards fly from center to fan positions
function fanSpreadAnimation(duration) {
  return new Promise(resolve => {
    const cells = document.querySelectorAll('.card-cell');
    const startTime = performance.now();
    const spreadDelay = duration * 0.15; // Short pile phase

    function animate(now) {
      const elapsed = now - startTime;

      cells.forEach((cell, i) => {
        const targetX = parseFloat(cell.dataset.x) || 0;
        const targetY = parseFloat(cell.dataset.y) || 0;
        const targetRot = parseFloat(cell.dataset.rot) || 0;
        const zIdx = parseInt(cell.style.zIndex) || 1;

        if (elapsed < spreadDelay) {
          // Brief pile phase
          cell.style.transform = 'translateX(0px) translateY(0px) rotate(0deg) scale(0.3)';
          cell.style.opacity = '0.3';
        } else {
          const spreadElapsed = elapsed - spreadDelay;
          const spreadDuration = duration - spreadDelay;
          const p = Math.min(1, spreadElapsed / spreadDuration);
          // Ease-out back for satisfying snap
          const eased = 1 - Math.pow(1 - p, 3);
          const bounce = p < 1 ? Math.sin(p * Math.PI * 2) * (1 - p) * 0.3 : 0;

          const x = targetX * (eased + bounce);
          const y = targetY * (eased + bounce);
          const rot = targetRot * (eased + bounce);
          const scale = 0.3 + 0.7 * eased;

          cell.style.transform = `translateX(${x}px) translateY(${y}px) rotate(${rot}deg) scale(${scale})`;
          cell.style.opacity = Math.min(1, 0.3 + 0.7 * eased);
          cell.style.zIndex = zIdx;
        }
      });

      if (elapsed < duration) {
        requestAnimationFrame(animate);
      } else {
        // Final settle — set exact fan positions
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
  if (state.isShuffling) return;
  if (!state.selectedSpread) return;

  const alreadySelected = state.selectedCards.find(s => s.index === index);
  if (alreadySelected) {
    // Deselect
    state.selectedCards = state.selectedCards.filter(s => s.index !== index);
    el.classList.remove('selected');
  } else {
    if (state.selectedCards.length >= state.selectedSpread.card_count) {
      return; // Already full
    }
    state.selectedCards.push({ index, card: state.gridCards[index] });
    el.classList.add('selected');
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
  document.getElementById('confirm-popup').classList.add('hidden');
  // Deselect all
  state.selectedCards.forEach(s => {
    const el = document.querySelector(`.card-cell[data-index="${s.index}"]`);
    if (el) {
      el.classList.remove('selected');
    }
  });
  state.selectedCards = [];
  updateSelectionCounter();
}

// ---------- Confirm Reading & Curtain ----------
async function confirmReading() {
  document.getElementById('confirm-popup').classList.add('hidden');

  const user = getCurrentUser();

  // If not logged in and not dismissed today → show auth, wait, then proceed
  if (!user && !authDismissedToday()) {
    // Set callback: after auth resolved (login/dismiss), do the actual divination
    window._pendingDivination = () => {
      window._pendingDivination = null;
      doPerformDivination();
    };
    showAuthModal();
    return;
  }

  // No auth needed → proceed directly
  doPerformDivination();
}

async function doPerformDivination() {
  hideAuthModal(); // Ensure modal is hidden

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

  // Generate interpretation
  const result = generateInterpretation(drawnCards, state.selectedSpread);
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

// ---------- Result Display ----------
function renderResults(result) {
  document.getElementById('result-date').textContent =
    `[DATE] ${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}`;
  document.getElementById('result-spread-name').textContent = result.spreadName;

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

  document.getElementById('result-summary').innerHTML = `
    <h3>ORACLE OUTPUT</h3>
    <p>${result.summary.replace(/\n/g, '<br>')}</p>
  `;

  document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Adjust background based on mood
  updateBackgroundByMood(result.overallMood);
}

// ---------- Copy Result ----------
async function copyDivinationResult() {
  if (!state.divinationResult) return;
  const r = state.divinationResult;

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });

  let text = `◆ TAROT TERMINAL · 占卜结果\n`;
  text += `[DATE] ${today}\n`;
  text += `[PROTOCOL] ${r.spreadName}\n`;
  text += `${'─'.repeat(30)}\n\n`;

  // Cards
  r.cards.forEach((c, i) => {
    text += `[${c.isReversed ? 'REV' : 'UPR'}] ${c.positionName} · ${c.emoji} ${c.name_zh}\n`;
    text += `${c.interpretation}\n\n`;
  });

  // Summary
  text += `${'─'.repeat(30)}\n`;
  text += `[ORACLE OUTPUT]：\n`;
  text += r.summary.replace(/<br>/g, '\n').replace(/\n\n/g, '\n');
  text += `\n\n${'─'.repeat(30)}\n`;
  text += `◆ TAROT TERMINAL · 命运终端`;

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

// ---------- Reset ----------
function resetDivination() {
  state.selectedTheme = null;
  state.selectedSpread = null;
  state.selectedCards = [];
  state.gridCards = [];
  state.divinationResult = null;

  document.getElementById('card-grid-container').style.display = 'none';
  document.getElementById('card-fan-container').innerHTML = '';
  document.getElementById('shuffle-area').style.display = 'none';
  document.getElementById('spread-sub-section').classList.remove('visible');
  document.getElementById('result-section').classList.add('hidden');
  document.getElementById('song-recommendation').classList.add('hidden');
  document.getElementById('mood-section').classList.add('hidden');

  document.querySelectorAll('.spread-option').forEach(o => o.classList.remove('selected'));
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
}

async function submitMood() {
  const user = getCurrentUser();
  // Allow mood recording without login — just don't save
  if (!user) {
    if (!authDismissedToday()) {
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
    showToastMsg('[WARN] 请先登录后再导出账号');
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
  dismissAuthToday();
  // If there's a pending divination, trigger it after modal closes
  if (window._pendingDivination) {
    const fn = window._pendingDivination;
    window._pendingDivination = null;
    setTimeout(fn, 300); // Small delay for modal close animation
  }
}

function triggerPendingAction() {
  if (window._pendingDivination) {
    const fn = window._pendingDivination;
    window._pendingDivination = null;
    setTimeout(fn, 300);
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
    hideAuthModal();
    document.getElementById('confirm-popup').classList.add('hidden');
  }
});
