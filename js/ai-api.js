/* ============================================================
   ai-api.js — AI 解读引擎 · 每日预算管控 · 增强本地模式
   依赖: cards.js (allCards), auth.js (getRecentHistorySummary)

   模式（自动降级）:
   1. 真实 API（DeepSeek）→ 每日 ¥1.00 预算内
   2. 预算耗尽 → 显示"系统繁忙"，自动切换增强本地模式
   3. 无 Key / 出错 → 增强本地模式
   4. 全部失败 → 回退原始模板
   ============================================================ */

// ── 配置 ──
const AI_CONFIG = {
  apiEndpoint: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-chat',

  // 每日预算（元）
  dailyBudget: 1.00,

  // DeepSeek 官方定价（元/1M tokens）
  pricing: {
    input: 1.0,   // ¥1 / 1M input tokens
    output: 2.0,  // ¥2 / 1M output tokens
  },

  timeout: 30000,
};

// ── 默认 API Key（空 = 首次使用需输入）──
const DEFAULT_API_KEY = '';
const AI_KEY_STORAGE = 'tarot-ai-api-key';

function getAPIKey() {
  // localStorage 优先（用户可覆盖），否则用默认 Key
  const stored = localStorage.getItem(AI_KEY_STORAGE);
  if (stored !== null) return stored.trim();
  return DEFAULT_API_KEY;
}

function setAPIKey(key) {
  if (key) localStorage.setItem(AI_KEY_STORAGE, key.trim());
  else localStorage.removeItem(AI_KEY_STORAGE);
}

function hasAPIKey() {
  return !!getAPIKey();
}

// ═══════════════════════════════════════════════════════
// 每日预算追踪（用户不可见）
// ═══════════════════════════════════════════════════════

const BUDGET_STORAGE_KEY = 'tarot-ai-budget';

function getDailyBudget() {
  try {
    const raw = localStorage.getItem(BUDGET_STORAGE_KEY);
    if (!raw) return { date: today(), cost: 0, count: 0 };
    const data = JSON.parse(raw);
    // 新的一天 → 重置
    if (data.date !== today()) return { date: today(), cost: 0, count: 0 };
    return data;
  } catch (e) {
    return { date: today(), cost: 0, count: 0 };
  }
}

function saveDailyBudget(data) {
  localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify({
    date: today(),
    cost: data.cost,
    count: data.count,
  }));
}

function today() {
  return new Date().toISOString().split('T')[0];
}

/**
 * 检查预算是否超限
 * @returns {{ ok: boolean, remaining: number }}
 */
function checkBudget() {
  const budget = getDailyBudget();
  const remaining = AI_CONFIG.dailyBudget - budget.cost;
  return {
    ok: remaining > 0,
    remaining: Math.max(0, remaining),
    spent: budget.cost,
    count: budget.count,
  };
}

/**
 * 记录一次 API 调用的费用
 */
function recordCost(inputTokens, outputTokens) {
  const budget = getDailyBudget();
  const inputCost = (inputTokens / 1_000_000) * AI_CONFIG.pricing.input;
  const outputCost = (outputTokens / 1_000_000) * AI_CONFIG.pricing.output;
  const totalCost = inputCost + outputCost;

  budget.cost += totalCost;
  budget.count += 1;
  saveDailyBudget(budget);

  console.log(`[AI][预算] 本次: ¥${totalCost.toFixed(6)} (in:${inputTokens} out:${outputTokens}) | 今日累计: ¥${budget.cost.toFixed(4)} / ¥${AI_CONFIG.dailyBudget.toFixed(2)} | 剩余约 ¥${(AI_CONFIG.dailyBudget - budget.cost).toFixed(2)}`);
}

// ═══════════════════════════════════════════════════════
// Prompt 构建
// ═══════════════════════════════════════════════════════

function buildSystemPrompt() {
  return `你是一位资深塔罗解读师。你的解读平实、有洞察力、贴近现代生活，不使用"业力""因果"等玄学术语。

解读原则：
1. 以用户的具体问题为核心
2. 结合牌阵位置理解每张牌的含义
3. 正位代表顺势能量，逆位代表需要关注的课题
4. 找到牌与牌之间的关联，给出连贯叙事
5. 即使牌面有挑战，也要给出建设性的行动建议

必须返回 JSON 格式（不含 markdown 代码块标记）：
{
  "overview": "整体解读，150-250字",
  "cards": [{"name":"牌名","position":"位置","isReversed":true或false,"reading":"80-150字解读"}],
  "advice": "具体行动建议，50-100字"
}`;
}

function buildUserPrompt(opts) {
  const { userQuestion, spreadName, themeName, cards, userMood, historySummary } = opts;
  const moodLabels = { happy:'开心', calm:'平静', neutral:'一般', excited:'兴奋', anxious:'焦虑', sad:'难过', tired:'疲惫' };
  let p = '';
  p += `【用户问题】${userQuestion || '请给我一个综合解读'}\n`;
  if (themeName) p += `【关注领域】${themeName}\n`;
  p += `【牌阵】${spreadName || '通用'}\n`;
  if (userMood) p += `【心情】${moodLabels[userMood] || userMood}\n`;
  if (historySummary) p += `【近期占卜趋势】\n${historySummary}\n`;
  p += `\n【抽牌结果】\n`;
  cards.forEach((c, i) => {
    p += `${i+1}. [${c.isReversed?'逆位':'正位'}] ${c.name_zh}(${c.name_en||''}) — ${c.positionName}\n`;
    p += `   元素:${c.element||'未知'} | ${c.arcana==='major'?'大阿卡纳':'小阿卡纳'} | 关键词:${(c.keywords_zh||[]).join('、')}\n`;
  });
  return p;
}

// ═══════════════════════════════════════════════════════
// 增强本地模式
// ═══════════════════════════════════════════════════════

function generateEnhancedLocal(drawnCards, spreadDef, ctx) {
  const { userQuestion } = ctx;
  const cards = drawnCards.map((card, i) => {
    const posName = (spreadDef && spreadDef.positions && spreadDef.positions[i]) || `位置${i+1}`;
    const isRev = card.isReversed || card._reversed || false;
    return { ...card, _posName: posName, _isRev: isRev };
  });

  const revCount = cards.filter(c => c._isRev).length;
  const majorCount = cards.filter(c => c.arcana === 'major').length;

  let overview = '';
  const questionText = userQuestion || '你心中的困惑';
  if (revCount === 0) {
    overview = `针对"${questionText}"，牌面显示了一个相当积极的画面。${cards.length}张牌全部以正位出现——这说明你当前的能量状态和你的问题是同频的，你所思考的方向与内在的真实需求是一致的。\n\n`;
  } else if (revCount <= cards.length / 2) {
    overview = `关于"${questionText}"，牌面给出了一个既有肯定也有提醒的回应。整体趋势向好，但${revCount}张逆位牌提示你在某些方面可能需要多一些觉察。\n\n`;
  } else {
    overview = `"${questionText}"——牌面显示当前可能不是最顺畅的时期。${revCount}张逆位牌表明有些内在的课题正在浮现。这并不意味着事情会变糟，而是邀请你用不同的视角重新审视这个局面。\n\n`;
  }

  if (majorCount >= 2) {
    overview += `${majorCount}张大阿卡纳同时出现，这不是偶然。它们触及的是你人生中较为深层的主题。`;
  } else if (majorCount === 1) {
    const m = cards.find(c => c.arcana === 'major');
    overview += `大阿卡纳「${m.name_zh}」是这次解读的核心线索。它在"${m._posName}"位置亮起，你可以将注意力更多地放在这个位置上。`;
  }

  const enhancedCards = cards.map(c => {
    const elNames = { fire:'火', water:'水', air:'风', earth:'土' };
    const el = elNames[c.element] || '';
    const keywords = (c.keywords_zh || []).slice(0, 3).join('、');
    let reading = '';

    if (c._isRev) {
      const tmpl = (c.reversed && c.reversed.general) || '';
      const core = tmpl.length > 30 ? tmpl.slice(0, 60) : '需要关注的课题';
      reading = `逆位的${c.name_zh}出现在"${c._posName}"位置，提醒你注意：${core.replace(/。$/, '')}。${el ? el + '元素的能量在此处可能有所阻滞' : ''}——这并非坏事，而是邀请你在${c._posName}方面多一些向内看的勇气。`;
    } else {
      const tmpl = (c.upright && c.upright.general) || '';
      const core = tmpl.length > 30 ? tmpl.slice(0, 60) : '积极的能量';
      reading = `正位的${c.name_zh}在"${c._posName}"位置为你带来：${core.replace(/。$/, '')}。${el ? el + '元素在此处流动顺畅' : ''}，表明你在${c._posName}方面正处在顺势而为的阶段。`;
    }

    return {
      ...c,
      interpretation: reading,
      positionName: c._posName,
      isReversed: c._isRev,
      position: cards.indexOf(c),
      cardId: c.id,
    };
  });

  const advices = [];
  if (revCount === 0) {
    advices.push('当前是你顺势而为的好时机。既然牌面全部正位，不妨大胆一些——想做的事情，现在就是开始的最佳时机。');
  } else if (revCount <= 2) {
    advices.push(`牌面整体向好，${revCount}张逆位牌是善意的"慢一点"提示。建议你在行动的同时多留一分觉察。`);
  } else {
    advices.push('牌面逆位偏多，这段时间适合"向内看"而非"向外冲"。利用这个阶段重新审视你的方向，积累能量。');
  }

  const elements = cards.map(c => c.element).filter(Boolean);
  const dominantEl = mostFrequent(elements);
  const elAdvice = {
    fire: '火元素主导——行动力是你的关键词。想到了就去做。',
    water: '水元素主导——相信你的直觉和感受。有些答案不在头脑里，而在心里。',
    air: '风元素主导——清晰的思考是你的武器。善用这段时间理清思路。',
    earth: '土元素主导——稳扎稳打就是最好的策略。你正在打造的是长久的根基。',
  };
  if (elAdvice[dominantEl]) advices.push(elAdvice[dominantEl]);

  const summary = overview + '\n' +
    cards.map((c, i) =>
      `▸ ${c._posName}：「${c.name_zh}」（${c._isRev ? '逆位' : '正位'}）\n${enhancedCards[i].interpretation}`
    ).join('\n\n') +
    '\n\n◆ 给你的建议\n' + advices.map(a => `· ${a}`).join('\n\n');

  let overallMood = 'neutral';
  if (revCount === 0 && majorCount >= 2) overallMood = 'excited';
  else if (revCount === 0) overallMood = 'happy';
  else if (revCount <= 1) overallMood = 'calm';
  else if (revCount >= cards.length / 2) overallMood = 'anxious';

  return {
    cards: enhancedCards.map(c => ({
      cardId: c.cardId || c.id, name_zh: c.name_zh, name_en: c.name_en, emoji: c.emoji,
      position: c.position, positionName: c.positionName, isReversed: c.isReversed,
      interpretation: c.interpretation, keywords: c.keywords_zh,
      element: c.element, arcana: c.arcana, suit: c.suit,
    })),
    overallMood, dominantElement: dominantEl, reversalCount: revCount, majorCount,
    summary, spreadName: spreadDef ? spreadDef.name_zh : '', spreadId: spreadDef ? spreadDef.id : '',
    _aiGenerated: true, _enhancedLocal: true, _aiAdvice: advices.join('\n'),
  };
}

// ═══════════════════════════════════════════════════════
// 真实 API 调用
// ═══════════════════════════════════════════════════════

async function callRealAPI(opts) {
  // 先检查预算
  const budget = checkBudget();
  if (!budget.ok) {
    throw new Error('BUDGET_EXCEEDED');
  }

  const apiKey = getAPIKey();
  if (!apiKey) throw new Error('NO_KEY');

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(opts);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.timeout);

  try {
    const response = await fetch(AI_CONFIG.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().slice(0, 200);
      if (response.status === 401 || response.status === 403) {
        throw new Error('AUTH_ERROR');
      }
      if (response.status === 402 || errText.includes('Insufficient Balance')) {
        throw new Error('INSUFFICIENT_BALANCE');
      }
      throw new Error(`API_${response.status}`);
    }

    const data = await response.json();

    // 记录费用
    const usage = data.usage || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    if (inputTokens > 0 || outputTokens > 0) {
      recordCost(inputTokens, outputTokens);
    }

    const content = data.choices?.[0]?.message?.content || '';
    return parseAIResponse({ content });

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.message === 'BUDGET_EXCEEDED' || err.message === 'INSUFFICIENT_BALANCE') throw err;
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════

async function callAIInterpretation(opts) {
  if (hasAPIKey()) {
    try {
      console.log('[AI] 真实 API 模式');
      return await callRealAPI(opts);
    } catch (err) {
      console.warn('[AI] API 调用失败:', err.message);
      if (err.message === 'BUDGET_EXCEEDED') {
        console.log('[AI] 今日预算已用完，切换增强本地模式');
        return { _budgetExceeded: true };
      }
      if (err.message === 'AUTH_ERROR') {
        console.log('[AI] Key 无效，切换增强本地模式');
        return { _authError: true };
      }
      return { _fallbackFromAPI: true, _apiError: err.message };
    }
  }
  console.log('[AI] 增强本地模式');
  return { _enhancedLocal: true };
}

// ═══════════════════════════════════════════════════════
// 响应解析
// ═══════════════════════════════════════════════════════

function parseAIResponse(data) {
  let content = data.content || data.text || data.message || '';
  if (typeof content === 'object' && content !== null) {
    if (content.overview || content.cards) return normalizeAIResponse(content);
    content = JSON.stringify(content);
  }
  let parsed = null;
  try { parsed = JSON.parse(content); if (parsed.overview) return normalizeAIResponse(parsed); } catch(e) {}
  const jsonBlock = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (jsonBlock) { try { parsed = JSON.parse(jsonBlock[1].trim()); if (parsed.overview) return normalizeAIResponse(parsed); } catch(e) {} }
  const braceMatch = content.match(/\{[\s\S]*\}/);
  if (braceMatch) { try { parsed = JSON.parse(braceMatch[0]); if (parsed.overview) return normalizeAIResponse(parsed); } catch(e) {} }
  return { overview: content.slice(0, 500), cards: [], advice: '', theme_insight: '', _parseError: true };
}

function normalizeAIResponse(parsed) {
  return {
    overview: parsed.overview || parsed.summary || '',
    cards: (parsed.cards || []).map(c => ({
      name: c.name || c.name_zh || '', position: c.position || c.positionName || '',
      isReversed: !!c.isReversed, reading: c.reading || c.interpretation || '',
    })),
    advice: parsed.advice || '', theme_insight: parsed.theme_insight || '',
  };
}

// ═══════════════════════════════════════════════════════
// 降级
// ═══════════════════════════════════════════════════════

function fallbackToTemplate(drawnCards, spreadDef) {
  console.warn('[AI] 全部失败，回退原模板');
  if (typeof generateInterpretationTemplate === 'function') {
    return generateInterpretationTemplate(drawnCards, spreadDef);
  }
  return null;
}

// ═══════════════════════════════════════════════════════
// 卡片上下文构建
// ═══════════════════════════════════════════════════════

function buildCardContextForAI(drawnCards, spreadDef) {
  return drawnCards.map((card, i) => {
    const posName = (spreadDef && spreadDef.positions && spreadDef.positions[i]) || `位置${i+1}`;
    const isRev = card.isReversed || card._reversed || false;
    return {
      name_zh: card.name_zh, name_en: card.name_en, positionName: posName,
      isReversed: isRev, element: card.element, arcana: card.arcana, suit: card.suit,
      keywords_zh: card.keywords_zh,
      templateReading: isRev
        ? (card.reversed ? card.reversed.general : '')
        : (card.upright ? card.upright.general : ''),
    };
  });
}

function buildHistoryContext(historyData) {
  if (!historyData || !historyData.length) return '';
  return historyData.map((h, i) => {
    const cards = (h.cards || []).map(c => `${c.isReversed?'逆':'正'}${c.name_zh}`).join('、');
    return `${i+1}. [${h.date}] ${h.spreadName||'占卜'} · ${h.overallMood||'未知'} · ${cards}`;
  }).join('\n');
}

// ═══════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════

function mostFrequent(arr) {
  if (!arr.length) return 'water';
  const counts = {};
  arr.forEach(a => { counts[a] = (counts[a] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function getAIStatus() {
  const budget = checkBudget();
  return {
    hasKey: hasAPIKey(),
    budgetOK: budget.ok,
    callsToday: budget.count,
  };
}

// ═══════════════════════════════════════════════════════
// API Key 管理 UI（无余额显示）
// ═══════════════════════════════════════════════════════

function showAPIKeyPrompt() {
  const existing = getAPIKey();
  const msg = existing
    ? `当前 Key: ${existing.slice(0, 8)}...${existing.slice(-4)}\n\n输入新 Key 替换，留空清除：`
    : '请输入 DeepSeek API Key 以激活真实 AI 解读。\n\n获取方式：访问 platform.deepseek.com 注册，\n在「API Keys」页面创建 Key 并粘贴到下方。\n\n（Key 仅保存在你的浏览器中，不会上传）';

  const key = prompt(msg, '');
  if (key === null) return;
  if (key.trim()) {
    setAPIKey(key.trim());
    alert('API Key 已保存！真实 AI 解读已激活。');
  } else if (existing) {
    setAPIKey('');
    alert('API Key 已清除。');
  }
  if (typeof updateAIStatusUI === 'function') updateAIStatusUI();
}

console.log('[AI] 引擎就绪 · 每日预算 ¥' + AI_CONFIG.dailyBudget.toFixed(2));
