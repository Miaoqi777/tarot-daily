/* ============================================================
   ai-api.js — AI 解读引擎 · LLM 调用 · 增强本地模式 · 降级策略
   依赖: cards.js (allCards), auth.js (getRecentHistorySummary)

   三种工作模式（自动降级）：
   1. API Key 已配置 → 调用 DeepSeek / OpenAI 兼容 API（真实 AI）
   2. 无 API Key → 增强本地模式（智能拼装，输出自然语言风格）
   3. 出错 → 回退原始模板引擎
   ============================================================ */

// ── 配置 ──
const AI_CONFIG = {
  // API 端点（OpenAI 兼容格式，DeepSeek 支持浏览器 CORS）
  apiEndpoint: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-chat',

  // 速率限制
  rateLimit: { freePerHour: 5, premiumPerHour: 50 },
  timeout: 30000,
};

// ── API Key 管理（localStorage）──
const AI_KEY_STORAGE = 'tarot-ai-api-key';

function getAPIKey() {
  return localStorage.getItem(AI_KEY_STORAGE) || '';
}

function setAPIKey(key) {
  if (key) localStorage.setItem(AI_KEY_STORAGE, key.trim());
  else localStorage.removeItem(AI_KEY_STORAGE);
}

function hasAPIKey() {
  return !!getAPIKey();
}

// ── 运行时状态 ──
let aiCallCount = 0;
let aiCallResetTime = Date.now() + 3600000;

function getHourlyLimit() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  return user ? AI_CONFIG.rateLimit.premiumPerHour : AI_CONFIG.rateLimit.freePerHour;
}

function checkRateLimit() {
  if (Date.now() > aiCallResetTime) {
    aiCallCount = 0;
    aiCallResetTime = Date.now() + 3600000;
  }
  return aiCallCount < getHourlyLimit();
}

function getRemainingQuota() {
  if (Date.now() > aiCallResetTime) {
    aiCallCount = 0;
    aiCallResetTime = Date.now() + 3600000;
  }
  return Math.max(0, getHourlyLimit() - aiCallCount);
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
// 增强本地模式（无 API Key 时使用）
// 生成自然语言风格的解读，明显区别于模板引擎的协议语言
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

  // ── 构建自然语言 overview ──
  let overview = '';

  // 开场：根据用户问题 + 牌面情绪
  const questionText = userQuestion || '你心中的困惑';
  if (revCount === 0) {
    overview = `针对"${questionText}"，牌面显示了一个相当积极的画面。${cards.length}张牌全部以正位出现——这说明你当前的能量状态和你的问题是同频的，你所思考的方向与内在的真实需求是一致的。\n\n`;
  } else if (revCount <= cards.length / 2) {
    overview = `关于"${questionText}"，牌面给出了一个既有肯定也有提醒的回应。整体趋势向好，但${revCount}张逆位牌提示你在某些方面可能需要多一些觉察。\n\n`;
  } else {
    overview = `"${questionText}"——牌面显示当前可能不是最顺畅的时期。${revCount}张逆位牌表明有些内在的课题正在浮现。这并不意味着事情会变糟，而是邀请你用不同的视角重新审视这个局面。\n\n`;
  }

  // 大阿卡纳提示
  if (majorCount >= 2) {
    overview += `${majorCount}张大阿卡纳同时出现，这不是偶然。它们触及的是你人生中较为深层的主题。这些牌之间有一条看不见的线，将你当下的困惑和更长远的人生课题连接在一起。`;
  } else if (majorCount === 1) {
    const m = cards.find(c => c.arcana === 'major');
    overview += `大阿卡纳「${m.name_zh}」是这次解读的核心线索。它在"${m._posName}"位置亮起，你可以将注意力更多地放在这个位置上。`;
  }

  // ── 每张牌的增强解读 ──
  const enhancedCards = cards.map(c => {
    const elNames = { fire:'火', water:'水', air:'风', earth:'土' };
    const el = elNames[c.element] || c.element || '';
    const keywords = (c.keywords_zh || []).slice(0, 3).join('、');
    let reading = '';

    if (c._isRev) {
      // 逆位：从模板中提取核心含义，改写为自然语言
      const tmpl = (c.reversed && c.reversed.general) || '';
      const core = tmpl.length > 30 ? tmpl.slice(0, 60) : '需要关注的课题';
      reading = `逆位的${c.name_zh}出现在"${c._posName}"位置，提醒你注意：${core.replace(/。$/, '')}。${el ? el + '元素的能量在此处可能有所阻滞' : ''}——这并非坏事，而是邀请你在${c._posName}方面多一些向内看的勇气。关键词「${keywords}」的阴影面正在浮现。`;
    } else {
      const tmpl = (c.upright && c.upright.general) || '';
      const core = tmpl.length > 30 ? tmpl.slice(0, 60) : '积极的能量';
      reading = `正位的${c.name_zh}在"${c._posName}"位置为你带来：${core.replace(/。$/, '')}。${el ? el + '元素在此处流动顺畅' : ''}，表明你在${c._posName}方面正处在顺势而为的阶段。关键词「${keywords}」代表了你此刻的优势。`;
    }

    return {
      ...c,
      interpretation: reading,
      positionName: c._posName,
      isReversed: c._isRev,
      position: c._position !== undefined ? c._position : cards.indexOf(c),
      cardId: c.id,
    };
  });

  // ── 建设性建议 ──
  const advices = [];
  if (revCount === 0) {
    advices.push('当前是你顺势而为的好时机。既然牌面全部正位，不妨大胆一些——想做的事情，现在就是开始的最佳时机。');
  } else if (revCount <= 2) {
    advices.push(`牌面整体向好，${revCount}张逆位牌是善意的"慢一点"提示。建议你在行动的同时多留一分觉察，尤其是在逆位牌对应的生活领域。`);
  } else {
    advices.push('牌面逆位偏多，这段时间适合"向内看"而非"向外冲"。利用这个阶段重新审视你的方向，积累能量，等待风重新吹起来的时候。');
  }

  // 元素建议
  const elements = cards.map(c => c.element).filter(Boolean);
  const dominantEl = mostFrequent(elements);
  const elAdvice = {
    fire: '火元素主导——行动力是你的关键词。想到了就去做，但偶尔也记得看看地图，别冲太快。',
    water: '水元素主导——相信你的直觉和感受。有些答案不在头脑里，而在心里。柔软并非脆弱。',
    air: '风元素主导——清晰的思考是你的武器。善用这段时间理清思路、做好计划、沟通表达。',
    earth: '土元素主导——稳扎稳打就是最好的策略。不急于求成，你正在打造的是长久的根基。',
  };
  if (elAdvice[dominantEl]) advices.push(elAdvice[dominantEl]);

  // ── 组装 summary（自然语言风格，无协议标签）──
  const summary = overview + '\n\n' +
    cards.map((c, i) =>
      `▸ ${c._posName}：「${c.name_zh}」（${c._isRev ? '逆位' : '正位'}）\n${enhancedCards[i].interpretation}`
    ).join('\n\n') +
    '\n\n◆ 给你的建议\n' + advices.map(a => `· ${a}`).join('\n\n');

  // ── 计算整体情绪 ──
  let overallMood = 'neutral';
  if (revCount === 0 && majorCount >= 2) overallMood = 'excited';
  else if (revCount === 0) overallMood = 'happy';
  else if (revCount <= 1) overallMood = 'calm';
  else if (revCount >= cards.length / 2) overallMood = 'anxious';

  return {
    cards: enhancedCards.map(c => ({
      cardId: c.cardId || c.id,
      name_zh: c.name_zh,
      name_en: c.name_en,
      emoji: c.emoji,
      position: c.position,
      positionName: c.positionName,
      isReversed: c.isReversed,
      interpretation: c.interpretation,
      keywords: c.keywords_zh,
      element: c.element,
      arcana: c.arcana,
      suit: c.suit,
    })),
    overallMood,
    dominantElement: dominantEl,
    reversalCount: revCount,
    majorCount,
    summary,
    spreadName: spreadDef ? spreadDef.name_zh : '',
    spreadId: spreadDef ? spreadDef.id : '',
    _aiGenerated: true,
    _enhancedLocal: true,
    _aiAdvice: advices.join('\n'),
  };
}

// ═══════════════════════════════════════════════════════
// API 调用（有 Key 时）
// ═══════════════════════════════════════════════════════

async function callRealAPI(opts) {
  const apiKey = getAPIKey();
  if (!apiKey) throw new Error('NO_KEY');

  if (!checkRateLimit()) {
    throw new Error('RATE_LIMIT: 每小时免费解读次数已用完。');
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(opts);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.timeout);

  try {
    aiCallCount++;
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
      const errText = await response.text().catch(() => '');
      if (response.status === 401) {
        setAPIKey(''); // 清除无效 key
        throw new Error('API Key 无效，已清除。请重新输入有效的 Key。');
      }
      throw new Error(`API 错误 (${response.status}): ${errText.slice(0, 100)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    return parseAIResponse({ content });

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('请求超时，请稍后重试。');
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// 主入口：自动选择模式
// ═══════════════════════════════════════════════════════

async function callAIInterpretation(opts) {
  // 有 API Key → 真实 API
  if (hasAPIKey()) {
    try {
      console.log('[AI] 使用真实 API 模式 (DeepSeek)');
      return await callRealAPI(opts);
    } catch (err) {
      console.warn('[AI] API 调用失败:', err.message);
      // API 失败 → 增强本地模式（不是原模板）
      console.log('[AI] 降级到增强本地模式');
      return { _fallbackFromAPI: true, _apiError: err.message };
    }
  }

  // 无 API Key → 直接增强本地模式
  console.log('[AI] 使用增强本地模式（无 API Key）');
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

  // 尝试提取 JSON
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
      name: c.name || c.name_zh || '',
      position: c.position || c.positionName || '',
      isReversed: !!c.isReversed,
      reading: c.reading || c.interpretation || '',
    })),
    advice: parsed.advice || '',
    theme_insight: parsed.theme_insight || '',
  };
}

// ═══════════════════════════════════════════════════════
// 降级（仅在增强模式也失败时回退原模板）
// ═══════════════════════════════════════════════════════

function fallbackToTemplate(drawnCards, spreadDef) {
  console.warn('[AI] 所有模式失败，回退原始模板引擎');
  if (typeof generateInterpretationTemplate === 'function') {
    return generateInterpretationTemplate(drawnCards, spreadDef);
  }
  return null;
}

// ═══════════════════════════════════════════════════════
// 卡片上下文构建（供 cards.js 调用）
// ═══════════════════════════════════════════════════════

function buildCardContextForAI(drawnCards, spreadDef) {
  return drawnCards.map((card, i) => {
    const posName = (spreadDef && spreadDef.positions && spreadDef.positions[i]) || `位置${i+1}`;
    const isRev = card.isReversed || card._reversed || false;
    return {
      name_zh: card.name_zh,
      name_en: card.name_en,
      positionName: posName,
      isReversed: isRev,
      element: card.element,
      arcana: card.arcana,
      suit: card.suit,
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
  return {
    hasKey: hasAPIKey(),
    mode: hasAPIKey() ? 'real-api' : 'enhanced-local',
    remainingQuota: getRemainingQuota(),
    hourlyLimit: getHourlyLimit(),
    model: AI_CONFIG.model,
    callsThisHour: aiCallCount,
  };
}

// ═══════════════════════════════════════════════════════
// API Key 管理 UI
// ═══════════════════════════════════════════════════════

function showAPIKeyPrompt() {
  const existing = getAPIKey();
  const masked = existing ? existing.slice(0, 6) + '...' + existing.slice(-4) : '';
  const msg = existing
    ? `当前 Key: ${masked}\n\n输入新的 Key 替换，或留空清除：`
    : '需要 DeepSeek API Key 才能使用真实 AI 解读。\n\n获取方式：访问 platform.deepseek.com 注册即可获得免费额度。\n\n请粘贴你的 API Key：';

  const key = prompt(msg, '');
  if (key === null) return; // 取消

  if (key.trim()) {
    setAPIKey(key.trim());
    alert('API Key 已保存！\n\n现在 AI 解读将使用真实的大模型。\n免费额度用完前无需付费。');
  } else if (existing) {
    if (confirm('确定要清除已保存的 API Key 吗？\n清除后将使用增强本地模式。')) {
      setAPIKey('');
      alert('API Key 已清除。将使用增强本地模式。');
    }
  }

  // 更新 UI
  if (typeof updateAIStatusUI === 'function') updateAIStatusUI();
}

// 导出到全局
console.log('[AI] 命运终端 AI 引擎已加载 · 模式:', hasAPIKey() ? '真实API' : '增强本地');
console.log('[AI] 配置:', { endpoint: AI_CONFIG.apiEndpoint, model: AI_CONFIG.model });
