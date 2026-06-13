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

// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideCardDetail();
});
