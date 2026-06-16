/* ============================================================
   cards.js — 塔罗牌数据加载、洗牌、抽牌逻辑
   ============================================================ */

let allCards = [];
let spreads = [];
let cardsLoaded = false;

// ---------- Data Loading ----------
async function loadCardData() {
  if (cardsLoaded) return { cards: allCards, spreads };
  try {
    const [cardsRes, spreadsRes] = await Promise.all([
      fetch('data/tarot-cards.json'),
      fetch('data/spreads.json')
    ]);
    allCards = await cardsRes.json();
    spreads = await spreadsRes.json();
    cardsLoaded = true;
    return { cards: allCards, spreads };
  } catch (e) {
    console.error('Failed to load card data:', e);
    return { cards: [], spreads: [] };
  }
}

// ---------- Fisher-Yates Shuffle ----------
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ---------- Random Card Draw ----------
function drawRandomCards(count, excludedIds = []) {
  const available = allCards.filter(c => !excludedIds.includes(c.id));
  const shuffled = shuffleArray(available);
  const drawn = shuffled.slice(0, count).map(card => ({
    ...card,
    isReversed: Math.random() < 0.35,
    drawnAt: Date.now()
  }));
  return drawn;
}

// ---------- Get Spread / Theme ----------
function getTheme(themeId) {
  return spreads.find(t => t.theme === themeId) || null;
}

function getSpread(themeId, spreadId) {
  const theme = getTheme(themeId);
  if (!theme) return spreads[0]?.spreads?.[0] || null;
  return theme.spreads.find(s => s.id === spreadId) || theme.spreads[0];
}

function getSpreadById(spreadId) {
  for (const t of spreads) {
    const s = t.spreads.find(sp => sp.id === spreadId);
    if (s) return { theme: t, spread: s };
  }
  return { theme: spreads[0], spread: spreads[0]?.spreads?.[0] };
}

// ---------- Shuffle Cards for Grid Display ----------
function getShuffledGrid(includeMinor = true) {
  const pool = includeMinor ? [...allCards] : allCards.filter(c => c.arcana === 'major');
  return shuffleArray(pool);
}

// ---------- Get Card By ID ----------
function getCardById(id) {
  return allCards.find(c => c.id === id) || null;
}

// ---------- Search Cards ----------
function searchCards(query) {
  const q = query.toLowerCase();
  return allCards.filter(c =>
    c.name_zh.includes(q) ||
    c.name_en.toLowerCase().includes(q) ||
    (c.keywords_zh || []).some(k => k.includes(q)) ||
    (c.description || '').includes(q)
  );
}

// ---------- Filter Cards ----------
function filterCards({ arcana, suit, element } = {}) {
  let filtered = [...allCards];
  if (arcana) filtered = filtered.filter(c => c.arcana === arcana);
  if (suit) filtered = filtered.filter(c => c.suit === suit);
  if (element) filtered = filtered.filter(c => c.element === element);
  return filtered;
}

// ---------- Generate Result Interpretation ----------
/**
 * 生成解读结果
 * @param {Array} drawnCards - 抽到的牌
 * @param {Object} spreadDef - 牌阵定义
 * @param {Object} opts - 可选参数 { useAI, userQuestion, userMood, history }
 * @returns {Object|Promise<Object>} AI 模式返回 Promise，模板模式返回 Object
 */
function generateInterpretation(drawnCards, spreadDef, opts = {}) {
  const { useAI = false, userQuestion = '', userMood = '', history = [] } = opts;

  // AI 模式：异步调用
  if (useAI && typeof callAIInterpretation === 'function') {
    return generateAIResult(drawnCards, spreadDef, { userQuestion, userMood, history });
  }

  // 模板模式：同步（原逻辑）
  return generateInterpretationTemplate(drawnCards, spreadDef);
}

// ── 原模板引擎（提取为独立函数，供 AI 降级时复用）──
function generateInterpretationTemplate(drawnCards, spreadDef) {
  // Assign positions
  const result = drawnCards.map((card, i) => {
    const posName = spreadDef.positions[i] || `位置${i + 1}`;
    // Use isReversed (boolean) to avoid conflict with card.reversed (object)
    const isRev = card.isReversed || card._reversed || false;
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
      suit: card.suit
    };
  });

  // Generate overall summary based on card elements
  const elements = result.map(r => r.element).filter(Boolean);
  const dominantEl = mostFrequent(elements);
  const reversalCount = result.filter(r => r.isReversed).length;
  const majorCount = result.filter(r => r.arcana === 'major').length;

  let overallMood = 'neutral';
  if (reversalCount === 0 && majorCount >= 2) overallMood = 'excited';
  else if (reversalCount === 0) overallMood = 'happy';
  else if (reversalCount <= 1) overallMood = 'calm';
  else if (reversalCount >= result.length / 2) overallMood = 'anxious';

  const summary = generateSummary(result, overallMood, dominantEl, spreadDef);

  // Simple one-liner for template fallback
  const majorCards = result.filter(r => r.arcana === 'major');
  const sampleCard = majorCards[0] || result[0];
  const cardName = sampleCard ? sampleCard.name_zh : '牌面';
  let oneLiner;
  if (reversalCount === 0) {
    oneLiner = `牌面全部正位——${cardName}的能量清澈顺畅，你所关注的方向是对的。`;
  } else if (reversalCount <= result.length / 2) {
    oneLiner = `整体向好——${cardName}稳稳托住了大局，有几处需要多看一步，但方向没问题。`;
  } else {
    oneLiner = `需要耐心——牌面逆位偏多，当前处于调整期，慢下来比冲上去更明智。`;
  }

  return {
    cards: result,
    overallMood,
    dominantElement: dominantEl,
    reversalCount,
    majorCount,
    summary,
    oneLiner,
    spreadName: spreadDef.name_zh,
    spreadId: spreadDef.id
  };
}

// ── AI 解读结果生成 ──
async function generateAIResult(drawnCards, spreadDef, ctx) {
  const { userQuestion, userMood, history } = ctx;

  // 构建卡片上下文
  const cardContext = buildCardContextForAI(drawnCards, spreadDef);

  // 构建历史上下文
  const historySummary = typeof buildHistoryContext === 'function'
    ? buildHistoryContext(history)
    : '';

  // 获取主题名
  const themeName = spreadDef && spreadDef.theme ? spreadDef.theme : '';

  try {
    // 先确定模式
    const modeResult = await callAIInterpretation({
      userQuestion: userQuestion || '请给我一个综合解读',
      spreadName: (spreadDef && spreadDef.name_zh) || '通用牌阵',
      spreadDescription: (spreadDef && spreadDef.description) || '',
      themeName: themeName,
      cards: cardContext,
      userMood: userMood || '',
      historySummary: historySummary,
    });

    let aiResponse;

    if (modeResult._enhancedLocal) {
      console.log('[cards.js] 增强本地模式');
      aiResponse = generateEnhancedLocal(drawnCards, spreadDef, {
        userQuestion: userQuestion || '',
        userMood: userMood || '',
      });
      return aiResponse;
    }

    if (modeResult._budgetExceeded) {
      // ── 今日预算耗尽 ──
      console.log('[cards.js] 今日预算已用完');
      aiResponse = generateEnhancedLocal(drawnCards, spreadDef, {
        userQuestion: userQuestion || '',
        userMood: userMood || '',
      });
      aiResponse._budgetExceeded = true;
      return aiResponse;
    }

    if (modeResult._authError) {
      console.log('[cards.js] API Key 无效');
      aiResponse = generateEnhancedLocal(drawnCards, spreadDef, {
        userQuestion: userQuestion || '',
        userMood: userMood || '',
      });
      return aiResponse;
    }

    if (modeResult._fallbackFromAPI) {
      console.log('[cards.js] API 失败，使用增强本地');
      aiResponse = generateEnhancedLocal(drawnCards, spreadDef, {
        userQuestion: userQuestion || '',
        userMood: userMood || '',
      });
      aiResponse._apiError = modeResult._apiError;
      return aiResponse;
    }

    // ── 真实 API 模式 ──
    // modeResult 就是 API 返回的解析结果
    return convertAIResponseToResult(modeResult, drawnCards, spreadDef);

  } catch (err) {
    console.error('[AI] 所有 AI 模式失败，降级模板引擎:', err.message);

    // 再尝试增强本地（如果还没试过）
    try {
      if (typeof generateEnhancedLocal === 'function') {
        const enhanced = generateEnhancedLocal(drawnCards, spreadDef, {
          userQuestion: userQuestion || '',
          userMood: userMood || '',
        });
        enhanced._aiError = err.message;
        return enhanced;
      }
    } catch (e2) { /* ignore */ }

    // 最后回退原始模板
    const fallback = fallbackToTemplate(drawnCards, spreadDef);
    if (fallback) {
      fallback._aiError = err.message;
      return fallback;
    }
    throw err;
  }
}

// ── AI 响应 → 标准 result 格式转换 ──
function convertAIResponseToResult(aiResponse, drawnCards, spreadDef) {
  const cards = drawnCards.map((card, i) => {
    const posName = (spreadDef && spreadDef.positions && spreadDef.positions[i]) || `位置${i + 1}`;
    const isRev = card.isReversed || card._reversed || false;

    // 尝试从 AI 响应中找到对应牌的解释
    const aiCard = (aiResponse.cards || []).find(c =>
      c.name === card.name_zh || c.position === posName
    );

    const interpretation = aiCard && aiCard.reading
      ? aiCard.reading
      : (isRev
          ? (card.reversed ? card.reversed.general : '逆位解读暂无')
          : (card.upright ? card.upright.general : '正位解读暂无'));

    return {
      cardId: card.id,
      name_zh: card.name_zh,
      name_en: card.name_en,
      emoji: card.emoji,
      position: i,
      positionName: posName,
      isReversed: isRev,
      interpretation,
      keywords: card.keywords_zh,
      element: card.element,
      arcana: card.arcana,
      suit: card.suit,
    };
  });

  const elements = cards.map(r => r.element).filter(Boolean);
  const dominantEl = mostFrequent(elements);
  const reversalCount = cards.filter(r => r.isReversed).length;
  const majorCount = cards.filter(r => r.arcana === 'major').length;

  let overallMood = 'neutral';
  if (reversalCount === 0 && majorCount >= 2) overallMood = 'excited';
  else if (reversalCount === 0) overallMood = 'happy';
  else if (reversalCount <= 1) overallMood = 'calm';
  else if (reversalCount >= cards.length / 2) overallMood = 'anxious';

  // 组装 summary（新格式优先，旧格式向后兼容）
  let summary = '';
  if (aiResponse.full_text) {
    // 新格式：直接使用 AI 生成的完整解读文本
    summary = aiResponse.full_text;
  } else if (aiResponse.overview) {
    // 旧格式向后兼容：去掉赛博终端标记，干净输出
    summary = aiResponse.overview;
    if (aiResponse.advice) {
      summary += '\n\n给你的建议：\n' + aiResponse.advice;
    }
  }

  return {
    cards,
    overallMood,
    dominantElement: dominantEl,
    reversalCount,
    majorCount,
    summary,
    oneLiner: aiResponse.one_liner || '',
    spreadName: spreadDef ? spreadDef.name_zh : '',
    spreadId: spreadDef ? spreadDef.id : '',
    _aiGenerated: true,
    _aiFullText: aiResponse.full_text || summary,
    _aiOverview: aiResponse.overview || '',
    _aiAdvice: aiResponse.advice || '',
    _aiThemeInsight: aiResponse.theme_insight || '',
  };
}

function mostFrequent(arr) {
  if (!arr.length) return 'water';
  const counts = {};
  arr.forEach(a => { counts[a] = (counts[a] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateSummary(result, mood, element, spreadDef) {
  const parts = [];
  const spreadId = (spreadDef && spreadDef.id) || '';
  const spreadName = spreadDef ? spreadDef.name_zh : '';

  // ---- Opening (8 variants) ----
  const hour = new Date().getHours();
  const timeVariant = hour < 10 ? 'morning' : (hour < 18 ? 'day' : 'night');
  const openings = [
    `${spreadName}解读\n\n为你抽出的牌面已展开，以下是逐张牌的详细解析——`,
    `${spreadName}\n\n牌已就位。让我们一起来看看这些牌想对你说什么——`,
    `「${spreadName}」解读\n\n你面前的这几张牌，每一张都在回应你心里的问题。下面逐一展开——`,
    `${spreadName}\n\n这几张牌没有先商量过——但翻开之后，它们之间的故事线意外地清晰。一起看看——`,
    `「${spreadName}」\n\n其实每一张牌都是一个"答句"——连起来，就是给你的完整回答。`,
    `${spreadName}解读\n\n深呼吸。牌面已经展开了，你不用急着下判断。一张一张看——`,
    `${spreadName}\n\n牌不会替你做决定，但它们会帮你看清你现在站在哪里。这是今天的"位置图"——`,
    `${spreadName} · 完整解读\n\n为你的问题抽出的这几张牌，每一张都值得认真听。我们按顺序展开——`,
  ];
  parts.push(pick(openings));

  // ---- Card-by-card position analysis ----
  result.forEach((c, i) => {
    const status = c.isReversed ? '逆位' : '正位';
    const txt = c.interpretation.length > 120 ? c.interpretation.slice(0, 120) + '…' : c.interpretation;
    parts.push(`${c.positionName} · ${c.name_zh}（${status}）\n${txt}`);
  });

  // ---- Major Arcana insight (5 multi + 5 single) ----
  const majorCards = result.filter(r => r.arcana === 'major');
  if (majorCards.length >= 2) {
    const majorMsgs = [
      `${majorCards.length}张大阿卡纳同时出现在这次解读中——这不是偶然。这些大牌触及的是你人生中比较深层的主题，请把注意力放在它们各自的位置上，线索之间，有看不见的线相连。`,
      `${majorCards.length}张大牌汇聚在一起——你正站在一个重要的节点上。每一个位置都是拼图的一块，合拢之后，你会看见完整的画面。`,
      `${majorCards.length}张大阿卡纳——你问的这件事，分量比你意识到的要重。它们不是在说"小事"，是在说"值得你在意"。`,
      `出现了${majorCards.length}张大牌——这在一次占卜里不常见。它们在提醒你：今天的解读不是日常闲谈，是关于你人生里某个正在转弯的章节。`,
      `${majorCards.length}张大牌同框——这几张不止是在回答你的问题，它们还在透过问题看你的成长路径。仔细听。`,
    ];
    parts.push(pick(majorMsgs));
  } else if (majorCards.length === 1) {
    const singleMsgs = [
      `大阿卡纳「${majorCards[0].name_zh}」是这次解读的核心线索——请把注意力放在「${majorCards[0].positionName}」的位置上，那可能是你今天最需要听见的声音。`,
      `大牌「${majorCards[0].name_zh}」在「${majorCards[0].positionName}」处亮起——这不是随机的，它指向你当下最值得关注的面向。`,
      `唯一的大牌「${majorCards[0].name_zh}」就在「${majorCards[0].positionName}」——这一张牌的重量比其余所有小牌加起来都大。先看它，再看别的。`,
      `「${majorCards[0].name_zh}」是你今天解读的"定调牌"。它在「${majorCards[0].positionName}」位置，意思很清楚：这个位置的问题是你整局的关键。`,
      `大阿卡纳「${majorCards[0].name_zh}」亮了——在「${majorCards[0].positionName}」的位置上它不是来凑数的。它是来让你认真看一眼这个位置的。`,
    ];
    parts.push(pick(singleMsgs));
  }

  // ---- Reversal insight (expanded per bracket) ----
  const revCount = result.filter(r => r.isReversed).length;
  if (revCount === 0) {
    const allUpMsgs = [
      '全部正位——阻力最小的路径已经显现。顺着当前的流向走下去，你会抵达预期的坐标。',
      '正位全开，牌面清澈明亮。你的选择与内在方向高度一致，珍惜这份顺畅。',
      '没有任何逆位——今天的牌面通透得像晴天。不是在逗你开心，是真的没有阻力。放手去做。',
      '全正位——你想的方向、你做的准备、你的直觉，全部对齐了。这种"合拍"的时刻不多见，善用。',
      '一张逆位都没有——牌面在跟你说"路是通的"。别停在路口反复想——迈出去。',
    ];
    parts.push(pick(allUpMsgs));
  } else if (revCount === 1) {
    const oneRevMsgs = [
      '仅一张逆位——这是一个小小的路标，提醒你在某个方向多看一步。不必过度解读，当作善意的校准信号就好。',
      '唯一一张逆位——它不是在拉警报，是在说"这里可以慢一点"。整体方向没问题，就这一个点需要多看一眼。',
      '只一张逆位——它像是一段平坦路上的一块小石子。踢开就好，不用因为它而怀疑整条路。',
      '只有一张牌逆位——如果它恰好是你最在意的那个位置，那它只是在问：你在这个点上是不是用力过猛了？',
    ];
    parts.push(pick(oneRevMsgs));
  } else {
    const manyRevMsgs = [
      `${revCount}张逆位——当前节奏可能需要重新校准。逆位不是坏消息，而是邀请你换个角度重新审视。慢下来，向内看，答案一直在那里。`,
      `${revCount}张牌逆位——不必恐慌。逆位只是在告诉你：有些东西的"自然流向"暂时和你想的不一样。调整角度，不是推翻计划。`,
      `${revCount}张逆位——这不是"全盘否定"，而是"先减速再观察"。这段时间适合复盘、调整、沉淀——不是冲刺、决定、宣判。`,
      `${revCount}个逆位信号——它们聚在一起是想告诉你：在继续之前，有些东西需要被认真看见。看见了，力量就回来了。`,
      `${revCount}张逆位——在一段路上同时看到多个"慢行"标志的时候，最好的做法不是停车，是把脚从油门上挪开一点。`,
    ];
    parts.push(pick(manyRevMsgs));
  }

  // ---- Theme-specific guidance (3-4 variants per bracket) ----
  const ups = result.filter(r => !r.isReversed).length;
  const revs = result.filter(r => r.isReversed).length;
  const total = result.length;

  if (spreadId.startsWith('love')) {
    parts.push('针对你的感情领域：');
    if (revs === 0) {
      const pool = [
        '信号积极。若在关系中——感情升温期，适合主动表达、规划共同未来。若单身——近期遇到心动之人的概率很高，多参与社交，缘分正在靠近。大胆向前，不必犹豫。',
        '全正位，感情信号非常清晰。无论你现在的状态是什么——牌面都在说：打开自己，别设防。对的人或对的发展，已经在路上了。',
        '感情方面的牌面很暖——正位的能量说明你的心是敞开的、状态是在线的。这种时候最容易吸引到对的频率。保持现在的心境。',
      ];
      parts.push(pick(pool));
    } else if (revs <= total / 2) {
      const pool = [
        '信号总体向好，有小幅波动。若在纠结——关系仍有价值，但需要双方坦诚沟通来校准。若单身——桃花运不错，初次接触多观察，不必急着投入。坚持但不盲目，沟通是关键。',
        '感情牌面整体偏暖，逆位的小波动不是坏事——它们在提醒你注意那些之前可能忽略了的小信号。沟通，别猜。说出来的话比藏在心里的猜想有价值一百倍。',
        '正面信号占主导，虽然有一两张牌在提醒你某些地方需要留心。感情中不存在"完美顺利"——有波动是正常的，关键是你愿意为这份关系投入多少耐心和坦诚。',
      ];
      parts.push(pick(pool));
    } else {
      const pool = [
        '逆位偏多，需要冷静审视。若已感到疲惫或被消耗——给自己一些空间，暂时的退后比盲目坚持更明智。单身者先专注提升自己，更好的缘分会在合适的时机出现。先爱自己，再谈爱人。',
        '感情牌面偏沉——这不是说"没希望"，而是说"先别急着推进"。逆位偏多的时候，最该做的事是退回自己的空间，把呼吸调匀。爱别人是第二步，稳住自己是第一步。',
        '今天的感情牌需要你拿出勇气来看——不是冲的勇气，是"承认现在不太顺"的勇气。承认之后，你会发现压力小了一半。逆位会过去的，在这之前，别把自己耗干了。',
      ];
      parts.push(pick(pool));
    }
  } else if (spreadId.startsWith('study')) {
    parts.push('针对你的学业领域：');
    if (revs === 0) {
      const pool = [
        '学业信号强劲。理解力和记忆力处于峰值，适合冲刺考试或攻克难题。保持当前节奏，结果会超出预期。乘胜追击，投入回报比最高。',
        '全正位——学业方面的状态非常好。大脑是清的、意志是集中的。这种"学什么都能进"的阶段不多，好好利用。',
        '学业的牌面像一张绿灯——现在的你不是"要不要学"的问题，是"想学到什么程度"的问题。冲。',
      ];
      parts.push(pick(pool));
    } else if (revs <= total / 2) {
      const pool = [
        '信号平稳，存在短板需要关注。某些知识点可能有漏洞——查漏补缺的好时机。考试需要踏实准备，稳扎稳打比临时突击更有效。找到薄弱点，专项突破。',
        '学业的牌面总体不错，逆位的提示集中在具体的薄弱环节。与其全面铺开复习，不如先精准找到那两三个薄弱点——攻克之后整体信心会大幅提升。',
        '平稳中有小提醒——你可能有一个知识点一直在回避。那张逆位的牌就是在说：别绕了，今天花半小时正面解决它，你会发现它没你想象的那么难。',
      ];
      parts.push(pick(pool));
    } else {
      const pool = [
        '可能面临瓶颈期。若感到迷茫或提不起劲——这可能是学习方法需要调整的信号。切换学习方式，安排适当休息。从现在开始制定计划慢慢来，换种方式重启，慢一点也没关系。',
        '学业方面有点卡——不是能力问题，是方法和节奏需要调整。逆位偏多的时候不适合硬灌新东西，适合回头梳理已经学过但不太牢的部分。补底比盖顶重要。',
        '牌面显示学业进入了"高原期"——感觉不到进步，但其实你只是在消化之前的大量输入。给自己一点时间，别跟"退步"搞混。你只是在沉淀。',
      ];
      parts.push(pick(pool));
    }
  } else if (spreadId.startsWith('work')) {
    parts.push('针对你的事业领域：');
    if (revs === 0) {
      const pool = [
        '事业信号强劲。跳槽、转行、晋升——非常有利的窗口期。大胆面试、谈判、展示你的价值。创业者可能迎来重要突破。即使暂不动，效率产出也会格外突出，容易被看见。抓住风口，该出手时就出手。',
        '事业全正位——你最近的职场表现应该不错。不是"还行"，是"亮眼"。如果你有什么想尝试的机会，现在就是投简历或开口谈的最好时段。',
        '工作方面的牌面非常积极。你的判断力、表达力、执行力都在线——这种时候不需要低调，该展示就展示。好机会在找你，不是你在找机会。',
      ];
      parts.push(pick(pool));
    } else if (revs <= total / 2) {
      const pool = [
        '信号稳中有变。以稳固现有位置为主，重大决策不妨再观察一段。职场人际关系需要留意，保持专业和低调。项目推进中多预留缓冲时间。稳字当头，以退为进。',
        '事业牌面正位占主导——大局方向没问题。那几张逆位牌提示的是：近期不适合急着跳槽或做大动作。先稳住现有局面，积累筹码，等风来。',
        '工作方面整体向好，但逆位的信号让你对某些人际关系或项目节奏要多留个心。不是大问题——是多给一点时间、多做一个备选方案的小准备。',
      ];
      parts.push(pick(pool));
    } else {
      const pool = [
        '可能遇到阻力或瓶颈。若考虑跳槽——先按兵不动，现在不是最佳窗口。若对工作感到倦怠——找找根源：是工作不适合还是暂时的疲惫？不要冲动裸辞。利用这段时间积累技能和资源，积蓄力量等风来。',
        '事业牌面偏沉重——但这只是阶段性的。逆位多的时候最怕做冲动的决定。如果目前的工作让你筋疲力尽——先休整，再做判断。累的时候看什么都不顺眼，这不是看真相的状态。',
        '工作方面的牌逆位居多——这段时间适合"守"，不适合"攻"。守住现有位置、积累技能、理清自己想要什么——这些"守"的事做扎实了，下一阶段会轻松很多。',
      ];
      parts.push(pick(pool));
    }
  } else if (spreadId.startsWith('travel')) {
    parts.push('针对你的出行计划：');
    if (revs === 0) {
      const pool = [
        '出行信号极佳。计划中的旅行——放心出发，旅途顺利且可能有惊喜。短途或长途都适合，沿途风景和遇到的人会让你不虚此行。收拾行李出发，好运在路上等你。',
        '全正位——旅行运非常好。想了好久没去的地方，最近是出发的好时机。路上会有意外的小惊喜——不是麻烦，是好运。',
      ];
      parts.push(pick(pool));
    } else if (revs <= total / 2) {
      const pool = [
        '信号总体不错，有小细节需要注意。出行前多做功课——确认交通、住宿、天气。旅途可能有小插曲但不影响整体体验。可以出发，备用方案也准备好。',
        '旅行牌面总体看好，小逆位提醒的是"出发前的准备工作"。把攻略做细一点、时间留宽裕一点——其他的交给旅途中不期而遇的风景。',
      ];
      parts.push(pick(pool));
    } else {
      const pool = [
        '出行信号偏低，谨慎安排。非去不可的行程——做好万全准备，证件保险备用方案不能少。想放松的话，选择近一点的目的地或推迟计划。这段时间更适合规划而非立即出发。',
        '逆位偏多的牌面提示：不是最适合出发的时机。如果行程可以调——建议暂缓。如果一定要走——多做预案，多留弹性。',
      ];
      parts.push(pick(pool));
    }
  } else if (spreadId.startsWith('social')) {
    parts.push('针对你的社交领域：');
    if (revs === 0) {
      const pool = [
        '社交信号旺盛。拓展人脉、结交新朋友的黄金期。有聚会或活动——放心参加，你会是受欢迎的人。想修复某段关系——主动迈出第一步的好时机。多出门多交流，好人缘带来好机会。',
        '社交全正位——你最近身上有一种让人愿意靠近的气质。聚会、活动、哪怕是线上的交流——试试主动一点，会有让意外的好连接。',
        '人际关系方面的牌面很亮——多出门，多说话，多参与。最近认识的人里，可能有之后对你很重要的朋友。',
      ];
      parts.push(pick(pool));
    } else if (revs <= total / 2) {
      const pool = [
        '信号平稳，人际中需要多一分判断力。对消耗型关系——适当保持距离。有人求助或借钱——量力而行，不要勉强自己。有选择地社交，质量比数量重要。',
        '社交运整体平稳——合适的圈子让你充电，不合适的圈子让你耗电。最近可以多感受一下：哪些人让你见完之后觉得轻松，哪些人让你见完之后需要独处恢复。前者值得多联系。',
        '人际关系方面总体不错，小逆位在提醒你——不必对每个人都热络。把有限的热络留给那几个让你舒服的人，这已经很够了。',
      ];
      parts.push(pick(pool));
    } else {
      const pool = [
        '人际交往需要更谨慎。可能遇到表面友善背后另有目的的人——相信你的直觉。避免卷入他人八卦或是非，保持中立。适合清理社交圈，远离消耗你的关系。谨言慎行，宁缺毋滥。',
        '社交牌面偏谨慎——最近适合"收"而非"放"。不用勉强自己去热闹的场合，不用对不熟的人掏心掏肺。先把现有的重要关系维护好，其他的以后再说。',
      ];
      parts.push(pick(pool));
    }
  } else if (spreadId.startsWith('gaming')) {
    parts.push('针对你的游戏运势：');
    if (revs === 0) {
      const pool = [
        '游戏信号上佳。抽卡/开箱运气不错，十连值得一试。竞技游戏中状态和反应在峰值，适合冲分打排位。判断力和手感都比平时更好，放手一搏吧。',
        '游戏运全正——今天手感在线、判断在线、连运气都在线。想冲分就冲，想抽卡就抽——概率站在你这边。',
      ];
      parts.push(pick(pool));
    } else if (revs <= total / 2) {
      const pool = [
        '信号中等偏上。小氪怡情，不建议大量投入。竞技状态不错但可能遇到不太靠谱的队友，保持好心态。排位连输两把就先缓一缓，不要硬怼。适度娱乐，理性消费，心态稳住。',
        '游戏运势中上——能赢，但过程可能不太轻松。队友的水平和你的预期之间有差距的时候——深呼吸，这只是游戏。氪金前多看两眼，理性消费。',
      ];
      parts.push(pick(pool));
    } else {
      const pool = [
        '信号偏低。抽卡/开箱——建议管住手，出金概率不乐观，等下次UP池。竞技可能遇到连败，今天以娱乐放松为主。宜养生游戏，忌上头氪金和排位硬刚。',
        '今天的游戏运不太行——逆位牌提醒：省省钱、省省时间、省省心态。连输两把就关掉，别跟概率较劲。明天再战。',
      ];
      parts.push(pick(pool));
    }
  }

  // ---- Element guidance (5 per element) ----
  const elMessages = {
    fire: [
      '火元素在牌面中跃动——热情和行动力是你当下最宝贵的燃料。想到了就去做，但偶尔也看看地图，别光顾着冲。',
      '火能量满满——不是犹豫的时候。勇往直前，烈火烧得旺，但也需要风来助燃、水来调温，保持平衡。',
      '牌面里的火元素很活跃——你最近可能有很多"说干就干"的冲动。这是好事，但挑最重要的那件事先干——不用同时点燃三团火。',
      '火的力量已经在你这边了——热情是你的、冲劲是你的。唯一要提醒的是：冲的时候偶尔回头看看，队友跟上了没有。',
      '火元素是今天牌面的发动机——它不会让你停在原地。问题是：你想去哪里？想好了就出发，火不需要理由，它只需要方向。',
    ],
    water: [
      '水元素在牌面间流淌——情绪和直觉是你此刻最可靠的导航。有些事不用想太明白，感觉对了就对了。柔软，但并不脆弱。',
      '水能量浸润着牌阵——倾听内心的潮汐，它比头脑更知道答案在哪里。相信你的感受，它们不会骗你。',
      '水元素的牌在提醒你——最近你可能把太多事情"想清楚"了，但有些事情不是"想"明白的，是"感觉"明白的。相信身体的第一反应。',
      '水的智慧在于流动——不抗拒、不固守、不硬碰。遇到阻碍的时候，水会绕过石头。你也一样——有些路不需要直着走。',
      '水元素在牌阵里很温柔——它在说：不急着做决定。有些答案是沉淀出来的，不是分析出来的。给自己一点"不急着知道"的时间。',
    ],
    air: [
      '风元素穿过牌面——思想和沟通的力量被唤醒。适合做计划、做决定、做交流。头脑此刻格外清晰，善用这份清明。',
      '风能量在牌阵中穿梭——适合理清那些纠缠已久的问题。想清楚，然后说清楚，别让思绪飘太远。',
      '风元素的牌在今天占了上风——说明你需要的不是更多信息，是"停下来梳理已有的信息"。你已经知道够多了——现在是整理的时候。',
      '风的力量让思维变得敏捷——今天的你适合把那些"一直想说但没说出口"的话，用一种干净的方式说出来。不是发泄，是表达。',
      '风元素穿透牌阵——它在说：别被情绪裹着走，也别被别人的观点带着跑。今天你最需要的是自己的判断力，而它正在线。',
    ],
    earth: [
      '土元素稳稳托住牌阵——不需要急。一步一个脚印，你种下的因，会在对的季节结成果。慢，但扎实。',
      '土能量是牌面的底色——务实、耐心、积累。你正在打造的根基，未来会成为最坚实的依靠。',
      '土元素在牌阵中很厚实——它在告诉你：不要因为"进展慢"而否定"进展对"。有些事快不了，也不需要快。稳，才是这个阶段的关键词。',
      '土的能量是沉默的、持久的——不像火会冲，不像风会飘。但土最可靠。你现在的坚持，可能看不见每天的进步，但一年之后回头看——垒实的东西不会倒。',
      '土元素提醒你：有些答案需要时间来证明。你不需要等——你只需要在做的事情上不断叠加。积少成多的力量，今天看起来不起眼，但它从来不骗人。',
    ]
  };
  if (elMessages[element]) {
    parts.push(pick(elMessages[element]));
  }

  // ---- Closing (10 variants) ----
  const closings = [
    '每一天都是新的画布。塔罗为你描了第一笔轮廓，接下来的色彩——由你来决定。',
    '牌已阅，心已安。塔罗是灯火，照亮眼前几步路；走向远方的双脚，永远属于你自己。',
    '解读到此为止，但你的故事还在继续。最好的占卜，是你过好当下的每一天。',
    '无论牌面说了什么——你是自己命运的作者。塔罗只是递了一支笔，怎么写，全在你。',
    '这一把牌看完了。关掉屏幕或放下手机，去过今天。最好的答案不在解读里——在你今天做的第一个小决定里。',
    '正位逆位都是来帮你的。信牌，但更信你自己——牌只负责指方向，走路的是你。',
    '塔罗翻完了这一页。下一页是空白的——你不急着上去写。先感受一会儿，答案会自己冒出来。',
    '好，解读就到这里。剩下的——交给你了。你知道该怎么办的，你一直都知道。',
    '今天抽到的牌，也许会在三天后、一周后的某个瞬间忽然在你脑子里亮起来。那时候你会懂的。不用急着今天就想通所有。',
    '无论此刻你是释然还是忐忑——牌已经尽它所能了。接下来看你的。不用做得完美，做一点就行。一点就够了。',
  ];
  parts.push(pick(closings));

  return parts.join('\n\n');
}

// ---------- Song Recommendations ----------
const SONG_RECOMMENDATIONS = {
  excited: [
    { title: '晴天', artist: '周杰伦', emoji: '◆', reason: '阳光般温暖的旋律，如同你今天明媚的运势。愿这首歌陪伴你度过活力满满的一天，每一刻都闪耀着光芒。' },
    { title: '稻香', artist: '周杰伦', emoji: '≋', reason: '清新的田园气息，配合你今天的好运。闭上眼睛，感受微风拂过麦浪的惬意，生活如此美好。' }
  ],
  happy: [
    { title: '小幸运', artist: '田馥甄', emoji: '◈', reason: '甜美的歌声轻轻告诉你——原来你是我最想留住的幸运。今天的小确幸，值得被温柔地记住。' },
    { title: '起风了', artist: '买辣椒也用券', emoji: '≈', reason: '轻快的旋律里有风的自由。今天的你就像这首歌一样，轻盈、自在，带着一点点潇洒。' }
  ],
  calm: [
    { title: '追光者', artist: '岑宁儿', emoji: '⊚', reason: '安静的歌声里有温柔的力量。今天的你不需要太用力，像星光一样静静地发光就好。' },
    { title: '平凡之路', artist: '朴树', emoji: '≡', reason: '在宁静中找到力量。走过平凡的路，也能遇见不平凡的风景。今天适合静下心来，感受生活的节奏。' }
  ],
  neutral: [
    { title: '后来', artist: '刘若英', emoji: '◉', reason: '温暖的歌声带着淡淡的感悟。生活的滋味在于品味当下，不急不躁，一切刚刚好。' },
    { title: '童话', artist: '光良', emoji: '□', reason: '相信美好，就像相信童话。今天的运势告诉你——保持期待，好事正在路上。' }
  ],
  anxious: [
    { title: '隐形的翅膀', artist: '张韶涵', emoji: '△', reason: '每一次跌倒都是为了更好地飞翔。你拥有一双隐形的翅膀，带着你飞过所有不安，抵达平静的港湾。' },
    { title: '夜空中最亮的星', artist: '逃跑计划', emoji: '⭐', reason: '在不安的时候，抬头看看星空。你是夜空中那颗最亮的星，不需要畏惧黑暗，因为你本身就是光。' }
  ]
};

function getSongRecommendation(mood) {
  const songs = SONG_RECOMMENDATIONS[mood] || SONG_RECOMMENDATIONS.neutral;
  return songs[Math.floor(Math.random() * songs.length)];
}

// ---------- Mood Emoji Mapping ----------
const MOOD_OPTIONS = [
  { id: 'happy', emoji: '◆', label: '开心' },
  { id: 'calm', emoji: '◎', label: '平静' },
  { id: 'neutral', emoji: '◌', label: '一般' },
  { id: 'excited', emoji: '☆', label: '兴奋' },
  { id: 'anxious', emoji: '⊗', label: '焦虑' },
  { id: 'sad', emoji: '▽', label: '难过' },
  { id: 'tired', emoji: '□', label: '疲惫' }
];

function getMoodOptions() {
  return MOOD_OPTIONS;
}

// ── SVG Icon Generator ──
// Returns inline SVG HTML string. All icons: fill:none, stroke:currentColor, stroke-width:1.5
function getIconSVG(name, cls) {
  const c = cls || 'svg-icon svg-glow';
  const icons = {
    diamond: `<svg class="${c}" viewBox="0 0 24 24"><rect x="12" y="2" width="14" height="14" transform="rotate(45 12 2)"/></svg>`,
    question: `<svg class="${c}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a3.5 3.5 0 015.5 2.5c0 2-2 2.5-2 4"/><circle cx="12" cy="18" r="1" fill="currentColor" stroke="none"/></svg>`,
    bars: `<svg class="${c}" viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>`,
    heart: `<svg class="${c}" viewBox="0 0 24 24"><path d="M12 20S3 13.5 3 8a5 5 0 019-3 5 5 0 019 3c0 5.5-9 12-9 12z"/></svg>`,
    music: `<svg class="${c}" viewBox="0 0 24 24"><circle cx="7" cy="17" r="2.5"/><line x1="9.5" y1="17" x2="20" y2="8"/><line x1="9.5" y1="12" x2="20" y2="3"/><circle cx="17.5" cy="5.5" r="1.5"/></svg>`,
    user: `<svg class="${c}" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 3.5-8 8-8s8 3.5 8 8"/></svg>`,
    'arrow-up': `<svg class="${c}" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11, 12 5, 18 11"/></svg>`,
    pin: `<svg class="${c}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>`,
    close: `<svg class="${c}" viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`,
    // Weather
    sun: `<svg class="${c}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.5" y1="4.5" x2="6" y2="6"/><line x1="18" y1="18" x2="19.5" y2="19.5"/><line x1="4.5" y1="19.5" x2="6" y2="18"/><line x1="18" y1="6" x2="19.5" y2="4.5"/></svg>`,
    'cloud-sun': `<svg class="${c}" viewBox="0 0 24 24"><circle cx="10" cy="9" r="4"/><path d="M4 17a4 4 0 015-3.8 5.5 5.5 0 0110-1A4 4 0 0119 17H4z"/></svg>`,
    cloud: `<svg class="${c}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/></svg>`,
    overcast: `<svg class="${c}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" opacity="0.15"/><circle cx="12" cy="12" r="8"/></svg>`,
    fog: `<svg class="${c}" viewBox="0 0 24 24"><path d="M3 8h6c2 0 3-2 3-2s1 2 3 2h6"/><path d="M3 12h8c2 0 3-2 3-2s1 2 3 2h4"/><path d="M3 16h6c2 0 3-2 3-2s1 2 3 2h6"/></svg>`,
    rain: `<svg class="${c}" viewBox="0 0 24 24"><line x1="6" y1="5" x2="5" y2="10"/><line x1="12" y1="5" x2="11" y2="10"/><line x1="18" y1="5" x2="17" y2="10"/><line x1="5" y1="14" x2="4" y2="19"/><line x1="11" y1="14" x2="10" y2="19"/><line x1="17" y1="14" x2="16" y2="19"/></svg>`,
    snow: `<svg class="${c}" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="2" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="22" y2="12"/><line x1="4" y1="4" x2="8" y2="8"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="20" y1="4" x2="16" y2="8"/><line x1="8" y1="16" x2="4" y2="20"/></svg>`,
    lightning: `<svg class="${c}" viewBox="0 0 24 24"><polygon points="13 2 3 14 11 14 9 22 21 9 13 9 15 2"/></svg>`,
    // Mood
    star: `<svg class="${c}" viewBox="0 0 24 24"><polygon points="12 2 15 8.5 22 9.5 17 14.5 18 22 12 18.5 6 22 7 14.5 2 9.5 9 8.5"/></svg>`,
    circle: `<svg class="${c}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>`,
    'circle-dot': `<svg class="${c}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>`,
    'cross-circle': `<svg class="${c}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/></svg>`,
    'triangle-down': `<svg class="${c}" viewBox="0 0 24 24"><polygon points="12 20 2 4 22 4"/></svg>`,
    square: `<svg class="${c}" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="0.5"/></svg>`,
    triangle: `<svg class="${c}" viewBox="0 0 24 24"><polygon points="12 3 3 20 21 20"/></svg>`,
    'four-star': `<svg class="${c}" viewBox="0 0 24 24"><polygon points="12 2 14.5 9.5 22 9.5 16 14 18.5 22 12 17 5.5 22 8 14 2 9.5 9.5 9.5"/></svg>`,
    // Default fallback
    _default: `<svg class="${c}" viewBox="0 0 24 24"><rect x="12" y="2" width="14" height="14" transform="rotate(45 12 2)"/></svg>`
  };
  return icons[name] || icons._default;
}

// ── Icon symbol to SVG name mapping ──
// Weather
const WEATHER_SVG_MAP = {
  '⊙': 'sun', '◉': 'cloud-sun', '◌': 'cloud', '●': 'overcast',
  '≋': 'fog', '◌≈': 'rain', '≈': 'rain', '∗': 'snow', '⚡': 'lightning',
  '--': '__none'
};
// Mood
const MOOD_SVG_MAP = {
  '◆': 'diamond', '◎': 'circle-dot', '◌': 'cloud', '☆': 'star',
  '⊗': 'cross-circle', '▽': 'triangle-down', '□': 'square'
};
// Theme
const THEME_SVG_MAP = {
  '♥': 'heart', '◆': 'diamond', '□': 'square', '△': 'triangle',
  '◎': 'circle-dot', '◈': 'four-star'
};
// Card fallback
const CARD_FALLBACK_SVG = 'diamond';

// ── Universal Symbol-to-SVG converter ──
// Auto-detects card symbols (☆◎♁♥△◈★◑◉♡↑⊚ etc.) and converts to SVG
function symbolToSVG(symbol, cls) {
  if (!symbol || symbol.length > 2) return symbol; // Pass through non-symbols
  const c = cls || 'svg-icon svg-glow';

  // Major Arcana specific mappings
  const majorMap = {
    '⊚': 'circle-dot', '☆': 'star', '◎': 'circle-dot', '♁': 'circle',
    '■': 'square', '†': 'close', '⊕': 'circle-dot', '⊙': 'sun',
    '◈': 'four-star', '≡': 'bars', '∇': 'triangle-down', '※': 'star',
    '≈': 'rain', '⊗': 'cross-circle', '⬡': 'circle', '★': 'star',
    '◑': 'circle', '◉': 'cloud-sun', '⨁': 'circle-dot', '♥': 'heart',
    '△': 'triangle', '◆': 'diamond', '◇': 'diamond', '◎': 'circle-dot',
    '◌': 'cloud', '☆': 'star', '▽': 'triangle-down', '□': 'square',
    '♡': 'heart', '↑': 'arrow-up'
  };

  const name = majorMap[symbol] || CARD_FALLBACK_SVG;
  return getIconSVG(name, c);
}
