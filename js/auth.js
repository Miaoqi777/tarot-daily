/* ============================================================
   auth.js — Supabase 云数据库认证（跨设备同步）
   基于 nijisanji-ponto-nei 同一 Supabase 实例
   Supabase 优先 → localStorage 兜底
   ============================================================ */

const AUTH_KEYS = {
  USERS: 'tarot-users',
  SESSION: 'tarot-session',
  FORTUNES: 'tarot-fortunes',
  MOODS: 'tarot-moods',
  LAST_ACTION: 'tarot-last-action'
};

// ── Supabase 初始化（与 nijisanji-ponto-nei 共用实例）──
var supabase = (function() {
  if (typeof window.supabase === 'undefined') return null;
  return window.supabase.createClient(
    'https://wsqihhpyxgcbtjfhhrvk.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzcWloaHB5eGdjYnRqZmhocnZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTM4NzYsImV4cCI6MjA5NjQ4OTg3Nn0.rh1RBih_BiraPLhUpWaXjcCcmDXRnS7kGHBBofiSBhk'
  );
})();

// ── 密码学工具 ─────────────────────────────────────

function generateSalt() {
  const arr = new Uint8Array(16);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, b => ('0' + b.toString(16)).slice(-2)).join('');
}

function sha256(message) {
  if (window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    return window.crypto.subtle.digest('SHA-256', encoder.encode(message)).then(hashBuffer => {
      return Array.from(new Uint8Array(hashBuffer), b => ('0' + b.toString(16)).slice(-2)).join('');
    });
  }
  // Fallback: simple hash
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const chr = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  let h = Math.abs(hash).toString(16);
  while (h.length < 16) h = '0' + h;
  return Promise.resolve('s' + h);
}

async function hashPassword(password, salt) {
  return await sha256(salt + password);
}

// ── 本地用户管理（localStorage 兜底）───────────────

function getUsers() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEYS.USERS) || '[]'); }
  catch (e) { return []; }
}

function saveUsers(users) {
  try { localStorage.setItem(AUTH_KEYS.USERS, JSON.stringify(users)); }
  catch (e) { console.warn('saveUsers failed:', e); }
}

// ── 会话管理 ──────────────────────────────────────

function saveSession(username) {
  localStorage.setItem(AUTH_KEYS.SESSION, JSON.stringify({
    username: username,
    expiresAt: Date.now() + 7 * 24 * 3600 * 1000  // 7天
  }));
}

function getCurrentUser() {
  try {
    const s = JSON.parse(localStorage.getItem(AUTH_KEYS.SESSION));
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      localStorage.removeItem(AUTH_KEYS.SESSION);
      return null;
    }
    return s.username;
  } catch (e) { return null; }
}

function logoutUser() {
  localStorage.removeItem(AUTH_KEYS.SESSION);
}

// ── 注册 — Supabase 优先，失败则 localStorage 兜底 ─

async function registerUser(username, password) {
  username = (username || '').trim();
  if (!username || username.length < 2 || username.length > 20) {
    return { success: false, error: '用户名需2-20个字符' };
  }
  if (!/^[\w一-鿿_-]+$/.test(username)) {
    return { success: false, error: '用户名只能包含中文、英文、数字、下划线和连字符' };
  }
  if (!password || password.length < 6) {
    return { success: false, error: '密码至少6位' };
  }

  const lower = username.toLowerCase();
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);

  // 尝试 Supabase
  if (supabase) {
    try {
      const { data: existing } = await supabase.from('users').select('username').eq('username', username).maybeSingle();
      if (existing) {
        return { success: false, error: '用户名已存在' };
      }

      const { error } = await supabase.from('users').insert({
        username: username,
        password_hash: hash,
        salt: salt,
        is_admin: false
      });

      if (!error) {
        saveSession(username);
        return { success: true, username };
      }
      console.warn('Supabase insert failed, falling back to localStorage:', error.message);
    } catch (e) {
      console.warn('Supabase unavailable, falling back to localStorage:', e.message);
    }
  }

  // localStorage 兜底
  const users = getUsers();
  for (let i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === lower) {
      return { success: false, error: '用户名已存在' };
    }
  }
  users.push({
    username: username,
    passwordHash: hash,
    salt: salt,
    createdAt: Date.now()
  });
  saveUsers(users);
  saveSession(username);
  return { success: true, username };
}

// ── 登录 — Supabase 优先，失败则 localStorage 兜底 ─

async function loginUser(username, password) {
  username = (username || '').trim();
  if (!username || !password) {
    return { success: false, error: '请输入用户名和密码' };
  }

  const lower = username.toLowerCase();

  // 尝试 Supabase
  if (supabase) {
    try {
      const { data: user, error } = await supabase.from('users').select('*').eq('username', username).maybeSingle();
      if (!error && user) {
        const hash = await hashPassword(password, user.salt);
        if (hash === user.password_hash) {
          saveSession(user.username);
          return { success: true, username: user.username };
        }
        return { success: false, error: '密码错误' };
      }
      // Supabase 里没找到 → 继续查 localStorage
    } catch (e) {
      console.warn('Supabase unavailable, falling back to localStorage:', e.message);
    }
  }

  // localStorage 兜底
  const users = getUsers();
  let localUser = null;
  for (let i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === lower) {
      localUser = users[i];
      break;
    }
  }

  if (!localUser) {
    return { success: false, error: '用户名不存在' };
  }

  const localHash = await hashPassword(password, localUser.salt);
  if (localHash !== localUser.passwordHash) {
    return { success: false, error: '密码错误' };
  }

  saveSession(localUser.username);

  // 自动同步到 Supabase（静默迁移旧用户）
  if (supabase) {
    try {
      const { data: supabaseUser } = await supabase.from('users').select('username').eq('username', localUser.username).maybeSingle();
      if (!supabaseUser) {
        await supabase.from('users').insert({
          username: localUser.username,
          password_hash: localUser.passwordHash,
          salt: localUser.salt,
          is_admin: false
        });
      }
    } catch (e) {
      // 静默失败 — 下次登录时重试
    }
  }

  return { success: true, username: localUser.username };
}

// ---------- Auth Guard ----------
let authCallback = null;

function onAuthRequired(callback) {
  authCallback = callback;
}

function requireAuth() {
  const user = getCurrentUser();
  if (!user && authCallback) {
    authCallback();
    return false;
  }
  return !!user;
}

// ---------- Daily Action Check ----------
function getLastActionDate(username) {
  try {
    const key = AUTH_KEYS.LAST_ACTION + '-' + username;
    const data = JSON.parse(localStorage.getItem(key));
    return data ? data.date : null;
  } catch (e) {
    return null;
  }
}

function setLastActionDate(username, action) {
  const key = AUTH_KEYS.LAST_ACTION + '-' + username;
  const today = new Date().toISOString().split('T')[0];
  localStorage.setItem(key, JSON.stringify({ date: today, action }));
}

function isFirstActionToday(username) {
  const lastDate = getLastActionDate(username);
  const today = new Date().toISOString().split('T')[0];
  return lastDate !== today;
}

// ---------- Fortune History ----------
function getFortuneKey(username) {
  return AUTH_KEYS.FORTUNES + '-' + username;
}

function saveFortune(username, fortuneData) {
  const key = getFortuneKey(username);
  const fortunes = getFortunes(username);
  fortunes.push({
    ...fortuneData,
    id: 'fort_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    savedAt: Date.now()
  });
  // Keep only last 365 records
  if (fortunes.length > 365) {
    fortunes.splice(0, fortunes.length - 365);
  }
  localStorage.setItem(key, JSON.stringify(fortunes));
  return fortunes;
}

function getFortunes(username) {
  try {
    return JSON.parse(localStorage.getItem(getFortuneKey(username)) || '[]');
  } catch (e) {
    return [];
  }
}

// ---------- Mood Recording ----------
function getMoodKey(username) {
  return AUTH_KEYS.MOODS + '-' + username;
}

function saveMood(username, moodData) {
  const key = getMoodKey(username);
  const moods = getMoods(username);
  const today = new Date().toISOString().split('T')[0];
  const existing = moods.findIndex(m => m.date === today);
  const entry = { ...moodData, date: today, savedAt: Date.now() };
  if (existing >= 0) {
    moods[existing] = entry;
  } else {
    moods.push(entry);
  }
  localStorage.setItem(key, JSON.stringify(moods));
  return moods;
}

function getMoods(username) {
  try {
    return JSON.parse(localStorage.getItem(getMoodKey(username)) || '[]');
  } catch (e) {
    return [];
  }
}

function getTodayMood(username) {
  const moods = getMoods(username);
  const today = new Date().toISOString().split('T')[0];
  return moods.find(m => m.date === today) || null;
}

// ---------- AI Context: Recent History Summary ----------
/**
 * 提取用户近期占卜历史摘要，供 AI Prompt 使用
 * @param {string} username
 * @param {number} n - 最近 n 条记录 (默认 5)
 * @returns {Array} 摘要数组
 */
function getRecentHistorySummary(username, n = 5) {
  const fortunes = getFortunes(username);
  if (!fortunes.length) return [];

  const recent = fortunes.slice(-n);
  return recent.map(f => ({
    date: f.date,
    spreadName: f.spreadName || '未知牌阵',
    spreadId: f.spreadType || '',
    overallMood: f.overallMood || 'neutral',
    cardCount: (f.cards || []).length,
    cardsSummary: (f.cards || []).map(c =>
      `${c.isReversed ? '逆' : '正'}${c.name_zh}`
    ).join('、'),
    snippet: (f.summary || '').split('\n')[0].slice(0, 100),
  }));
}

// ---------- Analysis ----------
function analyzeFortunes(username, period) {
  const fortunes = getFortunes(username);
  const now = new Date();
  let startDate;

  switch (period) {
    case 'weekly':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'monthly':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'quarterly':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case 'yearly':
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const periodFortunes = fortunes.filter(f => new Date(f.date) >= startDate);

  if (periodFortunes.length === 0) {
    return {
      totalReadings: 0,
      message: '暂无该时段的占卜记录，开始你的第一次占卜吧！'
    };
  }

  // Card frequency
  const cardFreq = {};
  periodFortunes.forEach(f => {
    (f.cards || []).forEach(c => {
      const key = c.cardId;
      if (!cardFreq[key]) cardFreq[key] = { count: 0, name: c.name_zh, reversed: 0, upright: 0 };
      cardFreq[key].count++;
      if (c.isReversed) cardFreq[key].reversed++;
      else cardFreq[key].upright++;
    });
  });

  const topCards = Object.entries(cardFreq)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([id, data]) => ({ id, ...data }));

  // Arcana distribution
  const arcanaDist = { major: 0, minor: 0 };
  const suitDist = { wands: 0, cups: 0, swords: 0, pentacles: 0 };
  periodFortunes.forEach(f => {
    (f.cards || []).forEach(c => {
      if (c.cardId && c.cardId.startsWith('major')) arcanaDist.major++;
      else arcanaDist.minor++;
      const suit = c.cardId ? c.cardId.split('-')[0] : '';
      if (suitDist[suit] !== undefined) suitDist[suit]++;
    });
  });

  // Reversal rate
  let totalCards = 0, reversedCards = 0;
  periodFortunes.forEach(f => {
    (f.cards || []).forEach(c => {
      totalCards++;
      if (c.isReversed) reversedCards++;
    });
  });
  const reversalRate = totalCards > 0 ? Math.round((reversedCards / totalCards) * 100) : 0;

  // Mood correlation
  const moods = getMoods(username).filter(m => new Date(m.date) >= startDate);
  const moodCounts = {};
  moods.forEach(m => {
    moodCounts[m.mood] = (moodCounts[m.mood] || 0) + 1;
  });
  const topMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0];

  // Spread type distribution
  const spreadDist = {};
  periodFortunes.forEach(f => {
    spreadDist[f.spreadType] = (spreadDist[f.spreadType] || 0) + 1;
  });

  return {
    totalReadings: periodFortunes.length,
    totalMoods: moods.length,
    topCards,
    arcanaDist,
    suitDist,
    reversalRate,
    moodCounts,
    topMood: topMood || null,
    spreadDist,
    period,
    fortuneHistory: periodFortunes
  };
}

// ---------- Export / Import (Cross-Device Sync) ----------

// Export full account: credentials + fortunes + moods → downloadable JSON
function exportFullAccount(username) {
  const users = getUsers();
  const user = users.find(u => u.username === username);
  if (!user) {
    showToastMsg('[!] 用户数据异常，请重新登录');
    return { success: false, error: '用户不存在' };
  }

  const data = {
    version: 1,
    type: 'tarot-account-export',
    exportedAt: new Date().toISOString(),
    exportedFrom: navigator.userAgent.slice(0, 100),
    account: {
      username: user.username,
      passwordHash: user.passwordHash,
      salt: user.salt,
      createdAt: user.createdAt
    },
    fortunes: getFortunes(username),
    moods: getMoods(username)
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tarot-account-${username}-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { success: true };
}

// Import full account from parsed JSON object
function importFullAccount(jsonData) {
  try {
    // Validate structure
    if (!jsonData || jsonData.type !== 'tarot-account-export') {
      return { success: false, error: '[X] 无效的账号数据文件（类型不匹配）' };
    }
    if (jsonData.version !== 1) {
      return { success: false, error: '[X] 数据文件版本不兼容，请从最新版应用导出' };
    }
    const acct = jsonData.account;
    if (!acct || !acct.username || !acct.passwordHash || !acct.salt) {
      return { success: false, error: '[X] 账号数据不完整，请重新导出' };
    }

    const users = getUsers();
    const existingIdx = users.findIndex(u => u.username === acct.username);

    if (existingIdx >= 0) {
      // Update existing user credentials (keep newest)
      if ((acct.createdAt || 0) > (users[existingIdx].createdAt || 0)) {
        users[existingIdx] = {
          ...users[existingIdx],
          passwordHash: acct.passwordHash,
          salt: acct.salt,
          createdAt: acct.createdAt
        };
      }
    } else {
      users.push({
        username: acct.username,
        passwordHash: acct.passwordHash,
        salt: acct.salt,
        createdAt: acct.createdAt || Date.now()
      });
    }
    saveUsers(users);

    // Merge fortunes (deduplicate by id)
    if (jsonData.fortunes && Array.isArray(jsonData.fortunes)) {
      const existingFortunes = getFortunes(acct.username);
      const existingIds = new Set(existingFortunes.map(f => f.id));
      let newCount = 0;
      jsonData.fortunes.forEach(f => {
        if (!existingIds.has(f.id)) {
          existingFortunes.push(f);
          existingIds.add(f.id);
          newCount++;
        }
      });
      existingFortunes.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      // Keep only last 365 records
      const trimmed = existingFortunes.slice(0, 365);
      localStorage.setItem(getFortuneKey(acct.username), JSON.stringify(trimmed));
    }

    // Merge moods (import overwrites same-date entries)
    if (jsonData.moods && Array.isArray(jsonData.moods)) {
      const existingMoods = getMoods(acct.username);
      const moodMap = {};
      existingMoods.forEach(m => { moodMap[m.date] = m; });
      jsonData.moods.forEach(m => {
        // Imported mood takes precedence if newer or not existing
        if (!moodMap[m.date] || (m.savedAt || 0) > (moodMap[m.date].savedAt || 0)) {
          moodMap[m.date] = m;
        }
      });
      const merged = Object.values(moodMap).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      localStorage.setItem(getMoodKey(acct.username), JSON.stringify(merged));
    }

    return { success: true, username: acct.username };
  } catch (e) {
    return { success: false, error: '[X] 文件解析失败：' + e.message };
  }
}

// Handle file input → parse → import
function handleAccountImport(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({ success: false, error: '[X] 未选择文件' });
      return;
    }
    if (!file.name.endsWith('.json')) {
      resolve({ success: false, error: '[X] 请选择 .json 格式的账号文件' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const result = importFullAccount(data);
        resolve(result);
      } catch (err) {
        resolve({ success: false, error: '[X] 文件格式错误，无法解析JSON' });
      }
    };
    reader.onerror = () => resolve({ success: false, error: '[X] 文件读取失败，请重试' });
    reader.readAsText(file);
  });
}

// Trigger file picker for account import
function triggerAccountImport() {
  const input = document.getElementById('account-import-file');
  if (input) {
    input.value = ''; // Reset so same file can be re-selected
    input.click();
  }
}

// Global toast helper (shared across pages)
function showToastMsg(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Legacy export (data only, no credentials) — kept for compatibility
function exportData(username) {
  const data = {
    username,
    exportedAt: new Date().toISOString(),
    fortunes: getFortunes(username),
    moods: getMoods(username)
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tarot-data-${username}-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Daily Auth Dismiss ----------
const AUTH_DISMISS_KEY = 'tarot-auth-dismiss-date';

function authDismissedToday() {
  const today = new Date().toISOString().split('T')[0];
  return localStorage.getItem(AUTH_DISMISS_KEY) === today;
}

function dismissAuthToday() {
  const today = new Date().toISOString().split('T')[0];
  localStorage.setItem(AUTH_DISMISS_KEY, today);
}

// ---------- Anonymous Divination Track ----------
const ANON_DIVINATION_KEY = 'tarot-anon-divination-date';

function divinationDoneToday() {
  const today = new Date().toISOString().split('T')[0];
  return localStorage.getItem(ANON_DIVINATION_KEY) === today;
}

function markDivinationDoneToday() {
  const today = new Date().toISOString().split('T')[0];
  localStorage.setItem(ANON_DIVINATION_KEY, today);
}

// ---------- Password Visibility Toggle ----------
function togglePw(btn) {
  const wrapper = btn.parentElement;
  const input = wrapper.querySelector('input');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '⊗';
  } else {
    input.type = 'password';
    btn.textContent = '⊙';
  }
}
