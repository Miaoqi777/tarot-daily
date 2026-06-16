/* ============================================================
   ai-api.js — AI 解读引擎 · LLM 调用 · Prompt 工程 · 降级策略
   依赖: cards.js (loadCardData, allCards), auth.js (getRecentHistorySummary)
   ============================================================ */

// ── AI 配置 ──
const AI_CONFIG = {
  // 代理 API 端点（Vercel Edge Function），隐藏真实 API Key
  proxyEndpoint: '/api/interpret',

  // 模型选择
  models: {
    premium: 'claude-opus-4-8',     // 付费用户 · 深度推理
    free: 'claude-haiku-4-5',       // 免费层级 · 快速低成本
    fallback: 'deepseek-v3',        // 国内备用
  },

  // 速率限制
  rateLimit: {
    freePerHour: 3,
    premiumPerHour: 50,
  },

  // 超时
  timeout: 30000,  // 30s
};

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

// ═══════════════════════════════════════════════════════
// Prompt 构建
// ═══════════════════════════════════════════════════════

function buildSystemPrompt() {
  // 动态注入 78 张牌知识库摘要（从已加载的 allCards 中提取）
  const cards = (typeof allCards !== 'undefined' && allCards.length) ? allCards : [];
  const majorCards = cards.filter(c => c.arcana === 'major');
  const minorCards = cards.filter(c => c.arcana === 'minor');

  // 大阿卡纳摘要
  const majorSummary = majorCards.slice(0, 22).map(c =>
    `${c.name_zh}(${c.name_en})：${c.keywords_zh ? c.keywords_zh.join('、') : ''}。${(c.description || '').slice(0, 80)}`
  ).join('\n');

  // 小阿卡纳按花色分组摘要
  const suits = ['wands', 'cups', 'swords', 'pentacles'];
  const suitNames = { wands: '权杖', cups: '圣杯', swords: '宝剑', pentacles: '星币' };
  const suitElements = { wands: '火', cups: '水', swords: '风', pentacles: '土' };
  const minorSummary = suits.map(s => {
    const suitCards = minorCards.filter(c => c.suit === s).slice(0, 4);
    return `${suitNames[s]}(${suitElements[s]}元素)：` + suitCards.map(c => c.name_zh).join('、');
  }).join('\n');

  return `你是一位资深的塔罗解读师，精通韦特塔罗 78 张牌体系。你的解读风格兼具洞察力与温度——既不回避牌面的警示，也不渲染恐惧；用平实而富有智慧的语言帮助用户理解当下处境。

## 你的知识库

### 22 张大阿卡纳
${majorSummary}

### 56 张小阿卡纳（按花色）
${minorSummary}

## 解读原则

1. **以用户的具体问题为核心**：不要泛泛而谈，紧扣用户提出的困惑和选择的领域。
2. **结合牌阵位置**：每张牌在不同位置（过去/现在/未来/阻碍/建议等）有不同含义。
3. **正逆位区分**：正位代表顺势能量，逆位代表需要关注的阴影面或内在课题。
4. **综合叙事**：不要孤立解读每张牌，要找到牌与牌之间的关联，给出一个连贯的故事。
5. **建设性导向**：即使牌面显示挑战，也要给出可行动的建议，帮助用户找到方向。
6. **避免玄学术语**：用现代人能理解的语言表达，不使用"业力""因果"等宗教化表述。
7. **控制长度**：每张牌解读 80-150 字，总结 150-250 字，总输出不超过 1500 字。

## 输出格式

你必须严格返回以下 JSON 格式（不要包含 markdown 代码块标记）：

{
  "overview": "整体解读，结合所有牌给出一个连贯的叙事（150-250字）",
  "cards": [
    {
      "name": "牌名",
      "position": "牌阵位置名",
      "isReversed": true或false,
      "reading": "针对该位置+用户问题的具体解读（80-150字）"
    }
  ],
  "advice": "给用户的具体行动建议（50-100字）",
  "theme_insight": "结合用户所选领域（爱情/学业/事业/旅行/社交/游戏）的针对性洞察（50-100字）"
}`;
}

function buildUserPrompt(opts) {
  const {
    userQuestion = '未提供具体问题',
    spreadName = '',
    spreadDescription = '',
    themeName = '',
    cards = [],
    userMood = '',
    historySummary = '',
  } = opts;

  let prompt = '';

  // 用户问题
  prompt += `【用户的问题】${userQuestion}\n\n`;

  // 生活领域
  if (themeName) {
    prompt += `【关注领域】${themeName}\n\n`;
  }

  // 牌阵信息
  prompt += `【使用牌阵】${spreadName}`;
  if (spreadDescription) prompt += ` — ${spreadDescription}`;
  prompt += '\n\n';

  // 用户心情
  if (userMood) {
    const moodLabels = {
      happy: '开心', calm: '平静', neutral: '一般',
      excited: '兴奋', anxious: '焦虑', sad: '难过', tired: '疲惫'
    };
    prompt += `【用户当前心情】${moodLabels[userMood] || userMood}\n\n`;
  }

  // 历史摘要
  if (historySummary) {
    prompt += `【用户近期占卜趋势】\n${historySummary}\n\n`;
  }

  // 抽牌结果
  prompt += `【抽牌结果】\n`;
  cards.forEach((c, i) => {
    const status = c.isReversed ? '逆位' : '正位';
    prompt += `${i + 1}. [${status}] ${c.name_zh}(${c.name_en || ''}) — 位置: ${c.positionName}\n`;
    prompt += `   元素: ${c.element || '未知'} | 阿卡纳: ${c.arcana === 'major' ? '大' : '小'}\n`;
    if (c.keywords_zh && c.keywords_zh.length) {
      prompt += `   关键词: ${c.keywords_zh.join('、')}\n`;
    }
  });

  return prompt;
}

// ═══════════════════════════════════════════════════════
// API 调用
// ═══════════════════════════════════════════════════════

/**
 * 调用 AI 解读（非流式）
 * @param {Object} opts - 同 buildUserPrompt 的参数
 * @returns {Promise<Object>} 解析后的解读结果
 */
async function callAIInterpretation(opts) {
  if (!checkRateLimit()) {
    throw new Error('RATE_LIMIT: 每小时免费解读次数已用完，请稍后再试或登录获取更多次数。');
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(opts);

  const model = AI_CONFIG.models.free;  // 默认用免费模型
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.timeout);

  try {
    aiCallCount++;

    // 优先使用代理 API
    let response;
    if (AI_CONFIG.proxyEndpoint && typeof fetch !== 'undefined') {
      response = await fetch(AI_CONFIG.proxyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          system: systemPrompt,
          user: userPrompt,
          temperature: 0.8,
          max_tokens: 2048,
        }),
        signal: controller.signal,
      });
    } else {
      // 直接 API 调用（需暴露 Key，不推荐生产环境）
      throw new Error('NO_PROXY: 未配置 API 代理端点。请设置 AI_CONFIG.proxyEndpoint。');
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`API_ERROR(${response.status}): ${errText}`);
    }

    const data = await response.json();
    return parseAIResponse(data);

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('TIMEOUT: AI 解读超时，请稍后重试。');
    }
    throw err;
  }
}

/**
 * 调用 AI 解读（流式 SSE）
 * @param {Object} opts
 * @param {Function} onChunk - 每收到一段文本时回调 (partialText, isComplete)
 * @returns {Promise<Object>} 最终完整结果
 */
async function streamAIInterpretation(opts, onChunk) {
  if (!checkRateLimit()) {
    throw new Error('RATE_LIMIT: 每小时免费解读次数已用完。');
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(opts);
  const model = AI_CONFIG.models.free;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.timeout);

  try {
    aiCallCount++;

    const response = await fetch(AI_CONFIG.proxyEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        user: userPrompt,
        temperature: 0.8,
        max_tokens: 2048,
        stream: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API_ERROR(${response.status})`);
    }

    // 读取 SSE 流
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';  // 保留不完整的行

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.content || parsed.text || parsed.delta || '';
            fullText += content;
            if (onChunk) onChunk(fullText, false);
          } catch (e) {
            // 非 JSON 行，当作纯文本追加
            fullText += data;
            if (onChunk) onChunk(fullText, false);
          }
        }
      }
    }

    // 流结束，解析完整 JSON
    if (onChunk) onChunk(fullText, true);
    return parseAIResponse({ content: fullText });

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('TIMEOUT: AI 解读超时。');
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// 响应解析
// ═══════════════════════════════════════════════════════

function parseAIResponse(data) {
  let content = data.content || data.text || data.message || '';

  // 如果 content 是对象（某些代理直接返回 JSON），直接使用
  if (typeof content === 'object' && content !== null) {
    if (content.overview || content.cards) {
      return content;
    }
    content = JSON.stringify(content);
  }

  // 尝试从文本中提取 JSON
  let parsed = null;

  // 策略1: 直接解析（如果整个 content 就是 JSON）
  try {
    parsed = JSON.parse(content);
    if (parsed.overview) return normalizeAIResponse(parsed);
  } catch (e) { /* continue */ }

  // 策略2: 查找 JSON 块（```json ... ``` 或 { ... }）
  const jsonBlock = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (jsonBlock) {
    try {
      parsed = JSON.parse(jsonBlock[1].trim());
      if (parsed.overview) return normalizeAIResponse(parsed);
    } catch (e) { /* continue */ }
  }

  // 策略3: 查找第一个 { 到最后一个 }
  const braceMatch = content.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      parsed = JSON.parse(braceMatch[0]);
      if (parsed.overview) return normalizeAIResponse(parsed);
    } catch (e) { /* continue */ }
  }

  // 策略4: 无法解析，将原始文本作为 overview 返回
  return {
    overview: content.slice(0, 500),
    cards: [],
    advice: '',
    theme_insight: '',
    _parseError: true,
  };
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
// 降级策略
// ═══════════════════════════════════════════════════════

/**
 * API 不可用时回退到模板引擎
 */
function fallbackToTemplate(drawnCards, spreadDef) {
  console.warn('[AI] API 不可用，回退到模板引擎');
  // 直接调用 cards.js 中的原始模板函数
  if (typeof generateInterpretationTemplate === 'function') {
    return generateInterpretationTemplate(drawnCards, spreadDef);
  }
  // 如果模板函数不可用，构建基本结果
  return buildFallbackResult(drawnCards, spreadDef);
}

function buildFallbackResult(drawnCards, spreadDef) {
  const result = drawnCards.map((card, i) => {
    const posName = (spreadDef && spreadDef.positions && spreadDef.positions[i]) || `位置${i + 1}`;
    const isRev = card.isReversed || false;
    const interp = isRev
      ? (card.reversed ? card.reversed.general : '逆位解读暂无')
      : (card.upright ? card.upright.general : '正位解读暂无');
    return {
      cardId: card.id,
      name_zh: card.name_zh,
      name_en: card.name_en,
      emoji: card.emoji,
      position: i,
      positionName: posName,
      isReversed: isRev,
      interpretation: interp,
      keywords: card.keywords_zh,
      element: card.element,
      arcana: card.arcana,
      suit: card.suit,
    };
  });

  const elements = result.map(r => r.element).filter(Boolean);
  const dominantEl = mostFrequent(elements);
  const reversalCount = result.filter(r => r.isReversed).length;
  const majorCount = result.filter(r => r.arcana === 'major').length;

  let overallMood = 'neutral';
  if (reversalCount === 0 && majorCount >= 2) overallMood = 'excited';
  else if (reversalCount === 0) overallMood = 'happy';
  else if (reversalCount <= 1) overallMood = 'calm';
  else if (reversalCount >= result.length / 2) overallMood = 'anxious';

  return {
    cards: result,
    overallMood,
    dominantElement: dominantEl,
    reversalCount,
    majorCount,
    summary: `[AI-OFFLINE] 智能解读服务暂时不可用，已切换至本地模板引擎。\n\n◆ SESSION.COMPLETE · 协议执行完成 · 以下为本地解读结果——\n\n系统检测到 ${majorCount} 张大阿卡纳，${reversalCount} 张逆位牌。建议稍后重试 AI 深度解读获得更个性化分析。`,
    spreadName: spreadDef ? spreadDef.name_zh : '',
    spreadId: spreadDef ? spreadDef.id : '',
    _isFallback: true,
  };
}

// ═══════════════════════════════════════════════════════
// 卡片上下文构建（供 cards.js 调用）
// ═══════════════════════════════════════════════════════

function buildCardContextForAI(drawnCards, spreadDef) {
  return drawnCards.map((card, i) => {
    const posName = (spreadDef && spreadDef.positions && spreadDef.positions[i]) || `位置${i + 1}`;
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
      // 附带 JSON 中的模板解读作为 AI 参考
      templateReading: isRev
        ? (card.reversed ? card.reversed.general : '')
        : (card.upright ? card.upright.general : ''),
    };
  });
}

function buildHistoryContext(historyData) {
  if (!historyData || !historyData.length) return '';
  const lines = historyData.map((h, i) => {
    const cards = (h.cards || []).map(c =>
      `${c.isReversed ? '逆' : '正'}${c.name_zh}`
    ).join('、');
    return `${i + 1}. [${h.date}] ${h.spreadName || '占卜'} · ${h.overallMood || '未知'} · ${cards}`;
  });
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════

function getRemainingQuota() {
  if (Date.now() > aiCallResetTime) {
    aiCallCount = 0;
    aiCallResetTime = Date.now() + 3600000;
  }
  return Math.max(0, getHourlyLimit() - aiCallCount);
}

function getAIStatus() {
  return {
    enabled: !!AI_CONFIG.proxyEndpoint,
    remainingQuota: getRemainingQuota(),
    hourlyLimit: getHourlyLimit(),
    model: AI_CONFIG.models.free,
    callsThisHour: aiCallCount,
  };
}

// 导出到全局
console.log('[AI] 命运终端 AI 解读引擎已加载');
console.log('[AI] 配置:', {
  endpoint: AI_CONFIG.proxyEndpoint,
  freeModel: AI_CONFIG.models.free,
  hourlyLimit: AI_CONFIG.rateLimit.freePerHour,
});
