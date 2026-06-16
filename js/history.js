/* ============================================================
   history.js — 运势历史与分析仪表盘
   ============================================================ */

let currentPeriod = 'monthly';
let currentUser = null;

// ---------- Initialization ----------
document.addEventListener('DOMContentLoaded', async () => {
  await loadCardData();
  initWeather();
  currentUser = getCurrentUser();
  updateUI();
});

function updateUI() {
  currentUser = getCurrentUser();
  const prompt = document.getElementById('login-prompt');
  const content = document.getElementById('analysis-stats');
  const exportBtn = document.getElementById('export-btn');
  const usernameEl = document.getElementById('sidebar-username');
  const subtitle = document.getElementById('history-subtitle');

  if (currentUser) {
    if (prompt) prompt.style.display = 'none';
    if (exportBtn) exportBtn.style.display = 'block';
    if (usernameEl) usernameEl.textContent = currentUser;
    if (subtitle) subtitle.textContent = `USER: ${currentUser} · 运势回顾`;
    renderAnalysis();
  } else {
    if (prompt) prompt.style.display = 'block';
    if (exportBtn) exportBtn.style.display = 'none';
    if (usernameEl) usernameEl.textContent = 'GUEST';
    if (subtitle) subtitle.textContent = '登录后可查看运势分析数据';
    document.getElementById('analysis-stats').innerHTML = '';
    document.getElementById('history-records').innerHTML = '';
    document.getElementById('mood-calendar').innerHTML = '';
  }
}

// ---------- Period Switching ----------
function switchPeriod(period, btn) {
  currentPeriod = period;
  document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  if (currentUser) renderAnalysis();
}

// ---------- Render Analysis ----------
function renderAnalysis() {
  if (!currentUser) return;

  const analysis = analyzeFortunes(currentUser, currentPeriod);

  if (analysis.totalReadings === 0) {
    document.getElementById('analysis-stats').innerHTML = `
      <div style="text-align:center;padding:40px;grid-column:1/-1;">
        <p style="font-size:3rem;">◆</p>
        <p style="color:var(--text-muted);">${analysis.message}</p>
      </div>
    `;
    document.getElementById('history-records').innerHTML = '';
    document.getElementById('mood-calendar').innerHTML = '';
    return;
  }

  // Stats cards
  document.getElementById('analysis-stats').innerHTML = `
    <div class="analysis-stat glass-card">
      <div class="stat-value">${analysis.totalReadings}</div>
      <div class="stat-label">TOTAL READINGS</div>
    </div>
    <div class="analysis-stat glass-card">
      <div class="stat-value">${analysis.reversalRate}%</div>
      <div class="stat-label">REVERSAL RATE</div>
    </div>
    <div class="analysis-stat glass-card">
      <div class="stat-value">${analysis.arcanaDist.major} : ${analysis.arcanaDist.minor}</div>
      <div class="stat-label">MAJOR : MINOR</div>
    </div>
    <div class="analysis-stat glass-card">
      <div class="stat-value">${analysis.topMood ? getMoodOptions().find(m => m.id === analysis.topMood[0])?.emoji || '😊' : '—'}</div>
      <div class="stat-label">TOP MOOD</div>
    </div>
    ${analysis.totalMoods > 0 ? `
    <div class="analysis-stat glass-card">
      <div class="stat-value">${analysis.totalMoods}</div>
      <div class="stat-label">MOOD DAYS</div>
    </div>
    ` : ''}
    <div class="analysis-stat glass-card" style="grid-column:1/-1;">
      <div style="display:flex;justify-content:center;gap:20px;flex-wrap:wrap;">
        <span>🪄 权杖: ${analysis.suitDist.wands || 0}</span>
        <span>🏆 圣杯: ${analysis.suitDist.cups || 0}</span>
        <span>⚔️ 宝剑: ${analysis.suitDist.swords || 0}</span>
        <span>🪙 星币: ${analysis.suitDist.pentacles || 0}</span>
      </div>
      <div class="stat-label">SUIT DISTRIBUTION</div>
    </div>
    ${analysis.topCards.length > 0 ? `
    <div class="analysis-stat glass-card" style="grid-column:1/-1;">
      <div style="display:flex;justify-content:center;gap:16px;flex-wrap:wrap;">
        ${analysis.topCards.map(c => `
          <span style="text-align:center;">
            <span style="font-size:1.5rem;">${allCards.find(ac => ac.id === c.id)?.emoji || '🃏'}</span><br>
            <span style="font-size:0.75rem;">${c.name}</span><br>
            <span style="font-size:0.7rem;color:var(--text-muted);">${c.count}次</span>
          </span>
        `).join('')}
      </div>
      <div class="stat-label">MOST FREQUENT CARD</div>
    </div>
    ` : ''}
  `;

  // Mood calendar
  renderMoodCalendar(analysis);

  // Fortune history
  renderHistoryRecords(analysis.fortuneHistory);
}

function renderMoodCalendar(analysis) {
  const calendar = document.getElementById('mood-calendar');
  if (!calendar) return;

  // Get moods for this period
  const moods = currentUser ? getMoods(currentUser) : [];
  const daysInPeriod = currentPeriod === 'weekly' ? 7 : currentPeriod === 'monthly' ? 30 : currentPeriod === 'quarterly' ? 90 : 365;

  const today = new Date();
  const days = [];
  for (let i = daysInPeriod - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const mood = moods.find(m => m.date === dateStr);
    days.push({
      date: dateStr,
      day: d.getDate(),
      mood: mood ? mood.mood : null
    });
  }

  // Show last 35 days max in calendar grid
  const displayDays = days.slice(-35);

  calendar.innerHTML = displayDays.map(d => {
    const moodClass = d.mood ? `mood-${d.mood}` : 'empty';
    const emoji = d.mood ? getMoodOptions().find(m => m.id === d.mood)?.emoji || '' : '';
    return `
      <div class="mood-day ${moodClass}" title="${d.date}: ${d.mood || '无记录'}">
        ${emoji || d.day}
      </div>
    `;
  }).join('');
}

function renderHistoryRecords(fortunes) {
  const container = document.getElementById('history-records');
  if (!fortunes.length) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;font-family:var(--font-mono);">[EMPTY] 暂无占卜记录</p>';
    return;
  }

  // Sort by date descending
  const sorted = [...fortunes].sort((a, b) => new Date(b.date) - new Date(a.date));

  container.innerHTML = sorted.map(f => `
    <div class="history-record glass-card">
      <div class="record-header">
        <span class="record-date">[DATE] ${f.date}</span>
        <span class="record-spread">${f.spreadName || f.spreadType}</span>
      </div>
      <div class="record-cards-mini">
        ${(f.cards || []).map(c => `
          <span title="${c.positionName}: ${c.isReversed ? 'REV' : 'UPR'} · ${c.name_zh}" style="cursor:default;">
            <span style="font-size:1.5rem;">${c.emoji || '🃏'}</span>
            <span style="font-size:0.7rem;color:${c.isReversed ? 'var(--macaron-pink)' : 'var(--macaron-mint)'}">${c.isReversed ? '逆' : '正'}</span>
          </span>
        `).join('')}
      </div>
      ${f.summary ? `
        <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px;line-height:1.5;">
          ${f.summary.split('\n')[0].slice(0, 100)}...
        </p>
      ` : ''}
    </div>
  `).join('');
}

// ---------- Export ----------
function handleExport() {
  if (!currentUser) {
    alert('[AUTH] 请先登录');
    return;
  }
  exportData(currentUser);
  alert('✅ 数据已导出！');
}

// ---------- Sidebar & Auth ----------
function updateSidebarUser() {
  const user = getCurrentUser();
  const usernameEl = document.getElementById('sidebar-username');
  const authLabel = document.getElementById('sidebar-auth-label');
  const exportBtn = document.getElementById('sidebar-export-btn');
  if (user) {
    if (usernameEl) usernameEl.textContent = user;
    if (authLabel) authLabel.textContent = 'LOGOUT';
    if (exportBtn) exportBtn.style.display = '';
  } else {
    if (usernameEl) usernameEl.textContent = 'GUEST';
    if (authLabel) authLabel.textContent = 'AUTH';
    if (exportBtn) exportBtn.style.display = 'none';
  }
}

function handleSidebarAuth() {
  const user = getCurrentUser();
  if (user) {
    if (confirm(`[LOGOUT] 确定要退出登录吗？${user}`)) {
      logoutUser();
      updateSidebarUser();
      updateUI();
    }
  } else {
    showAuthModal();
  }
}

// Account Import/Export Handlers
async function handleImportFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const result = await handleAccountImport(file);
  if (result.success) {
    showToastMsg('[OK] IMPORT.SUCCESS · 账号 "' + result.username + '" 导入完成');
    updateSidebarUser();
  } else {
    showToastMsg(result.error || '❌ 导入失败');
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
    showToastMsg('✅ 账号数据已导出，可导入到其他设备使用');
  }
}

function showAuthModal() {
  document.getElementById('auth-overlay').classList.remove('hidden');
}

function hideAuthModal() {
  document.getElementById('auth-overlay').classList.add('hidden');
  dismissAuthToday();
}

function openMoodFromSidebar() {
  if (!getCurrentUser()) {
    showAuthModal();
    return;
  }
  alert('请前往"每日占卜"页面记录心情哦~');
  window.location.href = 'index.html';
}

function setupSidebar() {
  const sidebar = document.getElementById('sidebar');
  const pinBtn = document.getElementById('sidebar-pin');
  if (pinBtn) {
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('pinned');
      pinBtn.textContent = sidebar.classList.contains('pinned') ? '[·]' : '[.]';
    });
  }
}

function setupAuthForms() {
  document.getElementById('tab-login-btn').addEventListener('click', function() {
    this.classList.add('active');
    document.getElementById('tab-register-btn').classList.remove('active');
    document.getElementById('login-form').classList.add('active');
    document.getElementById('register-form').classList.remove('active');
  });
  document.getElementById('tab-register-btn').addEventListener('click', function() {
    this.classList.add('active');
    document.getElementById('tab-login-btn').classList.remove('active');
    document.getElementById('register-form').classList.add('active');
    document.getElementById('login-form').classList.remove('active');
  });
  document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const u = document.getElementById('login-username').value.trim();
    const p = document.getElementById('login-password').value;
    const r = await loginUser(u, p);
    if (r.success) { hideAuthModal(); updateSidebarUser(); updateUI(); this.reset(); }
    else document.getElementById('login-error').textContent = r.error;
  });
  document.getElementById('register-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const u = document.getElementById('register-username').value.trim();
    const p = document.getElementById('register-password').value;
    const pc = document.getElementById('register-password-confirm').value;
    if (p !== pc) { document.getElementById('register-error').textContent = '[ERROR] 两次密码不一致'; return; }
    const r = await registerUser(u, p);
    if (r.success) { await loginUser(u, p); hideAuthModal(); updateSidebarUser(); updateUI(); this.reset(); document.getElementById('tab-login-btn').click(); }
    else document.getElementById('register-error').textContent = r.error;
  });
  document.getElementById('auth-overlay').addEventListener('click', function(e) {
    if (e.target === this) hideAuthModal();
  });
}

// Init sidebar
document.addEventListener('DOMContentLoaded', () => {
  updateSidebarUser();
  setupSidebar();
  setupAuthForms();
  initWhiteNoise();
});

// ---------- Check for auth on load ----------
window.addEventListener('storage', () => {
  updateUI();
  updateSidebarUser();
});

// Periodically check (in case login happened in another tab)
setInterval(() => {
  const newUser = getCurrentUser();
  if (newUser !== currentUser) {
    currentUser = newUser;
    updateUI();
    updateSidebarUser();
  }
}, 2000);
