/* ============================================================
   ai-api.js — AI 解读引擎
   通过 Vercel Edge Function 代理调用 DeepSeek（Key 服务端隐藏）

   模式（自动降级）:
   1. 代理可用 → 真实 AI（DeepSeek），服务端控制 ¥1.00/天总预算
   2. 代理返回 503（预算耗尽/繁忙）→ 增强本地模式 + "系统繁忙"提示
   3. 代理不可用 → 增强本地模式
   4. 全部失败 → 回退原始模板
   ============================================================ */

const AI_CONFIG = {
  // Vercel Edge Function 代理地址（部署后改为实际 URL）
  proxyEndpoint: '/api/interpret',
  timeout: 35000,
};

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
    overview = `针对"${questionText}"，牌面显示了一个相当积极的画面。${cards.length}张牌全部以正位出现——这说明你当前的能量状态和你的问题是同频的。\n\n`;
  } else if (revCount <= cards.length / 2) {
    overview = `关于"${questionText}"，牌面给出了一个既有肯定也有提醒的回应。整体趋势向好，但${revCount}张逆位牌提示你在某些方面可能需要多一些觉察。\n\n`;
  } else {
    overview = `"${questionText}"——牌面显示当前可能不是最顺畅的时期。${revCount}张逆位牌表明有些内在的课题正在浮现。这并不意味着事情会变糟，而是邀请你用不同的视角重新审视。\n\n`;
  }

  if (majorCount >= 2) {
    overview += `${majorCount}张大阿卡纳同时出现，这不是偶然。它们触及的是你人生中较为深层的主题。`;
  } else if (majorCount === 1) {
    const m = cards.find(c => c.arcana === 'major');
    overview += `大阿卡纳「${m.name_zh}」是这次解读的核心线索，在"${m._posName}"位置亮起。`;
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
// 代理 API 调用
// ═══════════════════════════════════════════════════════

async function callProxyAPI(opts) {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(opts);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.timeout);

  try {
    const response = await fetch(AI_CONFIG.proxyEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: systemPrompt, user: userPrompt }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // 503 → 预算耗尽 / 系统繁忙
      if (response.status === 503) {
        return { _budgetExceeded: true };
      }
      throw new Error(`PROXY_${response.status}`);
    }

    const data = await response.json();
    return parseAIResponse(data);

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════

async function callAIInterpretation(opts) {
  try {
    console.log('[AI] 调用代理 API...');
    return await callProxyAPI(opts);
  } catch (err) {
    console.warn('[AI] 代理不可用:', err.message);
    // 代理不可用 → 增强本地模式
    return { _enhancedLocal: true };
  }
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
// 卡片上下文
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
// 工具
// ═══════════════════════════════════════════════════════

function mostFrequent(arr) {
  if (!arr.length) return 'water';
  const counts = {};
  arr.forEach(a => { counts[a] = (counts[a] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function getAIStatus() {
  return { proxyEnabled: true, proxyEndpoint: AI_CONFIG.proxyEndpoint };
}

// 兼容旧 API
function hasAPIKey() { return true; }

console.log('[AI] 引擎就绪 · 代理模式 · 端点:', AI_CONFIG.proxyEndpoint);
