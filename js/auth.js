/* ============================================================
   auth.js — localStorage 登录/注册系统
   ============================================================ */

const AUTH_KEYS = {
  USERS: 'tarot-users',
  SESSION: 'tarot-session',
  FORTUNES: 'tarot-fortunes',
  MOODS: 'tarot-moods',
  LAST_ACTION: 'tarot-last-action'
};

// ---------- Crypto Utilities ----------
function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- User Management ----------
function getUsers() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEYS.USERS) || '[]');
  } catch (e) {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(AUTH_KEYS.USERS, JSON.stringify(users));
}

// ---------- Registration ----------
async function registerUser(username, password) {
  // Validate
  if (!username || username.length < 2 || username.length > 20) {
    return { success: false, error: '用户名需2-20个字符' };
  }
  if (!/^[\w一-鿿_-]+$/.test(username)) {
    return { success: false, error: '用户名只能包含中文、英文、数字、下划线和连字符' };
  }
  if (!password || password.length < 6) {
    return { success: false, error: '密码至少6位' };
  }

  const users = getUsers();
  if (users.find(u => u.username === username)) {
    return { success: false, error: '用户名已存在' };
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  users.push({
    username,
    passwordHash,
    salt,
    createdAt: Date.now()
  });

  saveUsers(users);
  return { success: true };
}

// ---------- Login ----------
async function loginUser(username, password) {
  const users = getUsers();
  const user = users.find(u => u.username === username);
  if (!user) {
    return { success: false, error: '用户名或密码错误' };
  }

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) {
    return { success: false, error: '用户名或密码错误' };
  }

  // Set session (7 days)
  const session = {
    username,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
  };
  localStorage.setItem(AUTH_KEYS.SESSION, JSON.stringify(session));

  return { success: true, username };
}

// ---------- Session ----------
function getCurrentUser() {
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_KEYS.SESSION));
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      localStorage.removeItem(AUTH_KEYS.SESSION);
      return null;
    }
    return session.username;
  } catch (e) {
    return null;
  }
}

function logoutUser() {
  localStorage.removeItem(AUTH_KEYS.SESSION);
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

// ---------- Export ----------
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
  a.click();
  URL.revokeObjectURL(url);
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
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
  }
}
