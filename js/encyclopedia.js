/* ============================================================
   encyclopedia.js — 塔罗百科浏览/搜索/过滤
   ============================================================ */

let currentFilter = 'all';
let currentSearch = '';

// ---------- Initialization ----------
document.addEventListener('DOMContentLoaded', async () => {
  await loadCardData();
  initWeather();
  filterAndRender();
});

// ---------- Filter ----------
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('#encyclo-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterAndRender();
}

function filterAndRender() {
  currentSearch = document.getElementById('encyclo-search').value.trim().toLowerCase();

  let filtered = [...allCards];

  // Apply category filter
  if (currentFilter === 'major') {
    filtered = filtered.filter(c => c.arcana === 'major');
  } else if (currentFilter === 'minor') {
    filtered = filtered.filter(c => c.arcana === 'minor');
  } else if (['wands', 'cups', 'swords', 'pentacles'].includes(currentFilter)) {
    filtered = filtered.filter(c => c.suit === currentFilter);
  }

  // Apply search
  if (currentSearch) {
    filtered = filtered.filter(c =>
      c.name_zh.includes(currentSearch) ||
      c.name_en.toLowerCase().includes(currentSearch) ||
      (c.keywords_zh || []).some(k => k.includes(currentSearch)) ||
      (c.description || '').includes(currentSearch)
    );
  }

  renderGrid(filtered);
}

function renderGrid(cards) {
  const grid = document.getElementById('encyclo-grid');

  if (!cards.length) {
    grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);grid-column:1/-1;">未找到匹配的牌 🃏</p>';
    return;
  }

  grid.innerHTML = cards.map(card => {
    let badgeClass = 'badge-major';
    if (card.arcana === 'minor') {
      badgeClass = `badge-${card.suit}`;
    }
    return `
      <div class="encyclopedia-card glass-card" onclick="showCardDetail('${card.id}')">
        <div class="card-emoji-big">${card.emoji}</div>
        <div class="card-name">${card.name_zh}</div>
        <span class="card-badge ${badgeClass}">
          ${card.arcana === 'major' ? '大阿卡纳' : (card.suit === 'wands' ? '权杖' : card.suit === 'cups' ? '圣杯' : card.suit === 'swords' ? '宝剑' : '星币')}
        </span>
      </div>
    `;
  }).join('');
}

// ---------- Card Detail Modal ----------
function showCardDetail(cardId) {
  const card = getCardById(cardId);
  if (!card) return;

  const overlay = document.getElementById('card-detail-overlay');
  const detail = document.getElementById('card-detail');

  const arcanaBadge = card.arcana === 'major'
    ? `<span class="card-badge badge-major">大阿卡纳 · 第${card.number}号</span>`
    : `<span class="card-badge badge-${card.suit}">小阿卡纳 · ${card.suit === 'wands' ? '权杖' : card.suit === 'cups' ? '圣杯' : card.suit === 'swords' ? '宝剑' : '星币'} · 第${card.number}张</span>`;

  const scenarios = [
    { key: 'general', label: '📜 总体' },
    { key: 'love', label: '💕 恋爱' },
    { key: 'study', label: '📚 学习' },
    { key: 'work', label: '💼 工作' },
    { key: 'travel', label: '✈️ 旅行' },
    { key: 'social', label: '🎭 社交' }
  ];

  const elementLabel = card.element
    ? { fire: '🔥 火', water: '💧 水', air: '🌬️ 风', earth: '🌍 土', spirit: '✨ 灵' }[card.element]
    : '';

  detail.innerHTML = `
    <button class="card-detail-close" onclick="hideCardDetail()">✕</button>
    <div class="card-detail-emoji">${card.emoji}</div>
    <div class="card-detail-name">${card.name_zh} <small style="color:var(--text-muted);">${card.name_en}</small></div>
    <div style="text-align:center;margin-bottom:12px;display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
      ${arcanaBadge}
      ${elementLabel ? `<span class="card-badge" style="background:rgba(255,255,255,0.3);">${elementLabel}</span>` : ''}
    </div>
    <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:16px;line-height:1.7;">${card.description}</p>

    <div class="card-detail-tabs" id="detail-tabs">
      ${scenarios.map((s, i) => `
        <button class="detail-tab ${i === 0 ? 'active' : ''}" onclick="switchDetailTab('${s.key}', this)">${s.label}</button>
      `).join('')}
    </div>

    <div class="card-detail-interp" id="detail-interp-content">
      <h4>✨ 正位解读</h4>
      <p>${card.upright.general}</p>
      <h4 style="margin-top:16px;">🔄 逆位解读</h4>
      <p>${card.reversed.general}</p>
    </div>
  `;

  overlay.classList.remove('hidden');

  // Click outside to close
  overlay.onclick = function(e) {
    if (e.target === overlay) hideCardDetail();
  };
}

function switchDetailTab(key, btn) {
  const cardId = document.querySelector('.card-detail-name small')?.textContent;
  // Find card by English name
  const card = allCards.find(c => c.name_en === cardId) || allCards.find(c => {
    const nameEl = document.querySelector('.card-detail-name');
    return nameEl && nameEl.textContent.includes(c.name_zh);
  });

  // Alternative: get card from current detail
  const nameZh = document.querySelector('.card-detail-name')?.childNodes[0]?.textContent?.trim();
  const foundCard = allCards.find(c => c.name_zh === nameZh);

  if (!foundCard) return;

  document.querySelectorAll('#detail-tabs .detail-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const content = document.getElementById('detail-interp-content');
  content.innerHTML = `
    <h4>✨ 正位解读</h4>
    <p>${foundCard.upright[key] || foundCard.upright.general}</p>
    <h4 style="margin-top:16px;">🔄 逆位解读</h4>
    <p>${foundCard.reversed[key] || foundCard.reversed.general}</p>
  `;
}

function hideCardDetail() {
  document.getElementById('card-detail-overlay').classList.add('hidden');
}

// ---------- Sidebar & Auth ----------
function updateSidebarUser() {
  const user = getCurrentUser();
  const usernameEl = document.getElementById('sidebar-username');
  const authLabel = document.getElementById('sidebar-auth-label');
  const exportBtn = document.getElementById('sidebar-export-btn');
  if (user) {
    if (usernameEl) usernameEl.textContent = user;
    if (authLabel) authLabel.textContent = '退出登录';
    if (exportBtn) exportBtn.style.display = '';
  } else {
    if (usernameEl) usernameEl.textContent = '未登录';
    if (authLabel) authLabel.textContent = '登录 / 注册';
    if (exportBtn) exportBtn.style.display = 'none';
  }
}

function handleSidebarAuth() {
  const user = getCurrentUser();
  if (user) {
    if (confirm(`确定要退出登录吗？${user}`)) {
      logoutUser();
      updateSidebarUser();
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
    showToastMsg('✅ 账号 "' + result.username + '" 导入成功！请使用原密码登录');
    updateSidebarUser();
  } else {
    showToastMsg(result.error || '❌ 导入失败');
  }
  input.value = '';
}

function handleSidebarExport() {
  const user = getCurrentUser();
  if (!user) {
    showToastMsg('⚠️ 请先登录后再导出账号');
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

// Sidebar pin
function setupSidebar() {
  const sidebar = document.getElementById('sidebar');
  const pinBtn = document.getElementById('sidebar-pin');
  if (pinBtn) {
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('pinned');
      pinBtn.textContent = sidebar.classList.contains('pinned') ? '📌' : '📍';
    });
  }
}

// Auth forms
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
    if (r.success) { hideAuthModal(); updateSidebarUser(); this.reset(); }
    else document.getElementById('login-error').textContent = r.error;
  });
  document.getElementById('register-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const u = document.getElementById('register-username').value.trim();
    const p = document.getElementById('register-password').value;
    const pc = document.getElementById('register-password-confirm').value;
    if (p !== pc) { document.getElementById('register-error').textContent = '两次密码不一致'; return; }
    const r = await registerUser(u, p);
    if (r.success) { await loginUser(u, p); hideAuthModal(); updateSidebarUser(); this.reset(); document.getElementById('tab-login-btn').click(); }
    else document.getElementById('register-error').textContent = r.error;
  });
  document.getElementById('auth-overlay').addEventListener('click', function(e) {
    if (e.target === this) hideAuthModal();
  });
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  updateSidebarUser();
  setupSidebar();
  setupAuthForms();
  initWhiteNoise();
});

// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideCardDetail();
    hideAuthModal();
  }
});
