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
  return `你是一位温暖、有洞察力的塔罗解读师。你的风格像一位懂对方的朋友在聊天——平实、真诚、贴近现代生活。
你用"你"来称呼询问者，语气温暖自然，不使用"业力""因果""能量场"等玄学术语。

解读原则：
1. 以用户的具体问题为核心，给出直接、真诚的回应
2. 结合牌阵位置理解每张牌的含义，解读要贴合该位置的意义
3. 正位代表顺势能量，逆位代表需要关注的课题
4. 找到牌与牌之间的关联，给出连贯叙事
5. 即使牌面有挑战，也要给出建设性的行动建议
6. 不使用任何方括号标记（如[某某]）、不使用英文标签或协议语言
7. 每张牌的解读要具体、个性化，结合牌的关键词和位置含义展开，写出有温度的文字

必须返回严格的 JSON 格式（不含 markdown 代码块标记）：
{
  "cards": [
    {
      "name": "牌名",
      "position": "位置名称",
      "isReversed": true或false,
      "reading": "对该牌在当前位置的深度解读，150-300字。要具体、个人化，融入牌的关键词含义和位置意义。使用温暖的中文，从该位置的角度去感受和表达。"
    }
  ],
  "full_text": "完整的格式化解读全文。严格按照以下格式输出：\\n\\n{牌阵名}完整深度解读（问题：{用户问题}）\\n\\n一、分牌拆解：核心心意&现状\\n\\n1. {位置名}｜{牌名} {正位/逆位}\\n{该牌的完整解读，即上面cards中对应的reading内容}\\n\\n2. ...（每张牌都如此列出，序号从1递增）\\n\\n二、综合回答核心问题：{用户问题}\\n{直接、温暖、真诚的回答，100-200字。不要绕圈子，正面回应用户最关心的问题。}\\n\\n三、整体牌面总结&行动建议\\n1. 全局基调：{牌面整体氛围和能量走向的一句话总结，点出关键趋势}\\n2. 针对性建议：\\n   • {具体可操作的建议1}\\n   • {具体可操作的建议2}\\n   • ...（3-5条具体建议）\\n\\n注意：full_text 中绝对不要使用方括号、英文标签、或任何协议语言。全文使用温暖自然的中文。章节标题用中文数字（一、二、三）。每张牌的解读直接跟在牌名后面，不要加额外的标签或标记。"
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
  p += `\n请为以上${cards.length}张牌分别撰写深度解读，并整合为完整的解读报告。`;
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

  // ── Generate per-card deep readings ──
  const enhancedCards = cards.map((c, i) => {
    const reading = buildEnhancedCardReading(c, cards, userQuestion);
    return {
      cardId: c.id,
      name_zh: c.name_zh,
      name_en: c.name_en,
      emoji: c.emoji,
      position: i,
      positionName: c._posName,
      isReversed: c._isRev,
      interpretation: reading,
      keywords: c.keywords_zh,
      element: c.element,
      arcana: c.arcana,
      suit: c.suit,
    };
  });

  // ── Build full_text ──
  const spreadName = spreadDef ? spreadDef.name_zh : '通用牌阵';
  const questionText = userQuestion || '你心中的困惑';

  // Section header
  const sectionSubtitle = buildSectionSubtitle(spreadDef, cards);
  let fullText = `${spreadName}完整深度解读`;
  if (userQuestion) {
    fullText += `（问题：${userQuestion}）`;
  }
  fullText += `\n\n一、分牌拆解：${sectionSubtitle}\n\n`;

  // Card-by-card
  enhancedCards.forEach((c, i) => {
    fullText += `${i + 1}. ${c.positionName}｜${c.name_zh} ${c.isReversed ? '逆位' : '正位'}\n`;
    fullText += `${c.interpretation}\n\n`;
  });

  // Direct answer
  fullText += `二、综合回答核心问题：${questionText}\n`;
  fullText += buildEnhancedDirectAnswer(cards, userQuestion);
  fullText += `\n\n三、整体牌面总结&行动建议\n`;
  fullText += `1. 全局基调：${buildEnhancedToneSummary(cards)}\n`;
  fullText += `2. 针对性建议：\n`;
  buildEnhancedAdviceBullets(cards, userQuestion).forEach(a => {
    fullText += `   • ${a}\n`;
  });

  // ── Mood detection ──
  let overallMood = 'neutral';
  if (revCount === 0 && majorCount >= 2) overallMood = 'excited';
  else if (revCount === 0) overallMood = 'happy';
  else if (revCount <= 1) overallMood = 'calm';
  else if (revCount >= cards.length / 2) overallMood = 'anxious';

  // ── Element detection ──
  const elements = cards.map(c => c.element).filter(Boolean);
  const dominantEl = mostFrequent(elements);

  return {
    cards: enhancedCards,
    overallMood,
    dominantElement: dominantEl,
    reversalCount: revCount,
    majorCount,
    summary: fullText,
    spreadName: spreadDef ? spreadDef.name_zh : '',
    spreadId: spreadDef ? spreadDef.id : '',
    _aiGenerated: true,
    _enhancedLocal: true,
    _aiFullText: fullText,
    _aiAdvice: '',
  };
}

// ═══════════════════════════════════════════════════════
// 增强本地模式 — 辅助函数
// ═══════════════════════════════════════════════════════

function buildSectionSubtitle(spreadDef, cards) {
  const spreadName = (spreadDef && spreadDef.name_zh) || '';
  // Detect if relationship-focused
  if (spreadName.includes('关系') || spreadName.includes('爱情') || spreadName.includes('感情')) {
    return '核心心意&现状';
  }
  return '逐牌深度分析';
}

function buildEnhancedCardReading(card, allCards, userQuestion) {
  const elNames = { fire: '火', water: '水', air: '风', earth: '土' };
  const el = elNames[card.element] || '';
  const keywords = (card.keywords_zh || []).slice(0, 3).join('、');
  const posName = card._posName;
  const cardName = card.name_zh;
  const isRev = card._isRev;

  // Get the card's template reading for reference content
  const templateText = isRev
    ? ((card.reversed && card.reversed.general) || '')
    : ((card.upright && card.upright.general) || '');

  // Build a rich, personalized reading
  let reading = '';

  if (isRev) {
    // ── Reversed card reading ──
    const revOpenings = [
      `逆位的${cardName}出现在"${posName}"位置，显示你在这方面正经历一段内心的拉扯。`,
      `${cardName}在此处以逆位呈现，说明"${posName}"这个层面存在一些需要你正视的卡点。`,
      `当${cardName}逆位落在"${posName}"，它像一面镜子，照出了你内心那些不太愿意面对的部分。`,
    ];
    const revMiddles = [
      `你明明很在意，却总是不由自主地往最坏的方向想，把自己困在反复揣测的循环里。${el ? el + '元素在此处的能量有些凝滞' : ''}——不是没有力量，而是力量暂时找不到出口。`,
      `表面上看起来是被外界困住了，但其实是你自己在给自己设限。${el ? el + '元素的流动被你的顾虑打断' : ''}，让你在"${posName}"这件事上迟迟迈不出那一步。`,
      `这份纠结不是无缘无故的。${templateText ? templateText.slice(0, 40) + '……' : ''}关键在于，你越是用力去抓紧，反而越容易失去平衡。`,
    ];
    const revClosings = [
      `这不是坏事，而是一个提醒——提醒你先停下来，听听自己真正想要的是什么，而不是被焦虑推着走。`,
      `逆位不是否定，而是邀请你换个方向看看。当你不再死盯着一个答案，往往反而能看见更开阔的路。`,
      `给自己一点空间，允许此刻的不确定存在。有些答案，需要时间才能浮出水面。`,
    ];
    reading = pick(revOpenings) + ' ' + pick(revMiddles) + ' ' + pick(revClosings);
  } else {
    // ── Upright card reading ──
    const uprOpenings = [
      `正位的${cardName}在"${posName}"位置亮起，这是一个清晰而积极的信号。`,
      `${cardName}以正位姿态来到"${posName}"，能量顺畅而直接。`,
      `"${posName}"位置上出现了正位${cardName}——这绝非偶然，它呼应着你内心某个真实的声音。`,
    ];
    const uprMiddles = [
      `${el ? el + '元素的能量在此处流动顺畅' : ''}，关键词${keywords ? '「' + keywords + '」' : ''}正是你当下的写照。${templateText ? templateText.slice(0, 40) + '……' : ''}`,
      `你在这个层面拥有清晰的感知力，心里其实知道该往哪个方向走。${el ? el + '元素赋予你' + (el === '火' ? '行动的热情' : el === '水' ? '细腻的感受力' : el === '风' ? '清晰的思维' : '踏实的定力') : ''}，让你在"${posName}"上能够稳住自己。`,
      `这张牌的出现像是在告诉你：你正在对的方向上。${el ? el + '元素带来的能量' : '这份能量'}值得你信任，你不需要过度用力，顺势而为就好。`,
    ];
    const uprClosings = [
      `保持这份清醒和笃定，它会带你穿过眼前的迷雾，抵达你想去的地方。`,
      `不必急着追问结果，此刻的状态本身就是最好的答案。`,
      `相信你的直觉。有些事不需要想得太复杂，简单直接地相信自己的判断，就是最聪明的做法。`,
    ];
    reading = pick(uprOpenings) + ' ' + pick(uprMiddles) + ' ' + pick(uprClosings);
  }

  return reading;
}

function buildEnhancedDirectAnswer(cards, userQuestion) {
  const revCount = cards.filter(c => c._isRev).length;
  const totalCards = cards.length;
  const majorCards = cards.filter(c => c.arcana === 'major');
  const question = userQuestion || '你的问题';

  // Detect question type
  const isMissingYou = /想|想念|惦记|思念|牵挂/.test(question);
  const isLove = /喜欢|爱|感情|关系|在一起|复合/.test(question);
  const isFuture = /未来|发展|怎么样|会|能|是否/.test(question);

  let answer = '';

  if (revCount === 0) {
    if (isMissingYou) {
      answer = `有。今天的牌面全部正位，能量非常直接——对方确实有想到你，而且不止是随便闪过一个念头，是带着温度和具体画面感的那种想起。只是这份心意目前还停留在内心层面，不一定会立刻转化成主动联系。他会在空闲时下意识地想起和你的相处片段，心里有你，只是不一定说出来。`;
    } else if (isLove) {
      answer = `牌面给出了积极的回应。正位的能量流动顺畅，说明你们之间的连接是真实存在的。对方心里有你的位置，只是表达方式可能比你期待的更内敛。你不必反复揣测对方的心意——把注意力收回到自己身上，你的状态越松弛，关系反而越容易自然流动。`;
    } else {
      answer = `牌面整体非常正面，说明你对"${question}"这件事的在意是有回应的。当前的牌面能量顺畅，你所关注的方向是对的。不需要过度焦虑，保持现在的节奏，答案会在合适的时机自然显现。`;
    }
  } else if (revCount <= totalCards / 2) {
    if (isMissingYou) {
      answer = `有，只是程度和方式可能和你期待的不太一样。对方今天确实想起过你，但他目前的整体状态偏向观望和克制——心里有惦念，行动上却慢了半拍。你这边情绪热烈、期待明确的回应，而他那边的节奏偏慢偏冷静，这中间的落差让你容易觉得失落。但请相信：被想起这件事本身是真实的，只是对方表达在意的方式比较内敛。`;
    } else if (isLove) {
      answer = `牌面显示这段关系中确实有双向的心意，但目前存在一些节奏上的错位。对方可能在用自己的方式默默关注你，却不太擅长直白地表达。你越是渴望热烈的回应，越容易因为他的沉默而感到不安。试着把心态放平——有些感情需要一点时间才能找到更舒适的相处频率。`;
    } else {
      answer = `牌面给出的信号是有回应的，但当前确实处于一个需要耐心等待的阶段。有几张牌提示你内心存在一些拉扯和不确定——这些情绪是正常的，但不要让它们主导你的判断。你关注的方向是有意义的，只是时机还没完全成熟，保持耐心。`;
    }
  } else {
    if (isMissingYou) {
      answer = `坦白说，今天的牌面显示对方目前更多沉浸在自己的世界里，对你的想念可能没有你期待的那么浓烈。但这不代表你在他心里没有位置——只是他现阶段的状态偏内收，不太会把心思外露。与其把精力花在猜他有没有想你，不如把注意力收回自己身上。当你不再紧盯着一个答案的时候，反而更容易看清这段关系真正的位置。`;
    } else {
      answer = `牌面显示当前确实不是一个特别顺畅的阶段，逆位偏多的能量提示你：有些东西暂时卡住了。但这只是阶段性的低谷，不是永久的结局。在等待的过程中，先把注意力放在自己身上——照顾好自己的情绪，做好眼前的事。周期会流转，此刻的阻滞不代表永远。`;
    }
  }

  // Add major arcana insight if relevant
  if (majorCards.length >= 2) {
    answer += `\n\n${majorCards.length}张大阿卡纳同时出现在这次解读中，说明"${question}"这件事对你来说不是随随便便的一个念头——它触及了你人生中比较深层的主题。这些大牌在提醒你：这段经历无论结果如何，都会带你更靠近真正的自己。`;
  }

  return answer;
}

function buildEnhancedToneSummary(cards) {
  const revCount = cards.filter(c => c._isRev).length;
  const totalCards = cards.length;
  const majorCards = cards.filter(c => c.arcana === 'major');
  const elements = cards.map(c => c.element).filter(Boolean);
  const dominantEl = mostFrequent(elements);
  const elNames = { fire: '火', water: '水', air: '风', earth: '土' };

  const tonePool = [];
  if (revCount === 0) {
    tonePool.push(`牌面全部正位，能量清澈顺畅，${elNames[dominantEl] || ''}元素在牌阵中稳定流动。你正处在一个同频共振的阶段，心中所想与外在走向高度一致。`);
    tonePool.push(`没有任何逆位的牌面，说明你当下走在一条相对顺畅的路径上。${elNames[dominantEl] || ''}元素的力量在背后托着你，顺势而为就是最好的策略。`);
  } else if (revCount <= totalCards / 2) {
    tonePool.push(`牌面整体趋势向好，虽然${revCount}张逆位牌提示了一些需要留意的课题，但正位的能量仍然是主旋律。这是一个"向前走、多一分觉察"的阶段。`);
    tonePool.push(`${elNames[dominantEl] || ''}元素主导的牌面，带着几分清醒的乐观。你能感受到事情在往对的方向发展，只是需要一点耐心让节奏自然展开。`);
  } else {
    tonePool.push(`牌面逆位偏多，当前确实处于一个需要"向内看"的阶段。${elNames[dominantEl] || ''}元素的能量提示你：慢下来不是退步，而是为了更好地校准方向。`);
    tonePool.push(`虽然逆位牌居多，但这只是阶段性的低谷，不是永久的困局。${elNames[dominantEl] || ''}元素提醒你——此刻最需要的不是冲刺，而是稳住自己。`);
  }

  if (majorCards.length >= 2) {
    tonePool.push(`${majorCards.length}张大阿卡纳汇聚——这不是一次普通的占卜。这些大牌在告诉你：你正在经历的这个阶段，对你的成长来说意义深远。`);
  }

  return pick(tonePool);
}

function buildEnhancedAdviceBullets(cards, userQuestion) {
  const revCount = cards.filter(c => c._isRev).length;
  const totalCards = cards.length;
  const elements = cards.map(c => c.element).filter(Boolean);
  const dominantEl = mostFrequent(elements);
  const advices = [];

  // Core advice based on reversal pattern
  if (revCount === 0) {
    advices.push('当前是你顺势而为的好时机，既然牌面全部正位，不妨大胆一些——想做的事情，现在就是开始的最佳时机');
  } else if (revCount <= 2) {
    advices.push(`不必困在反复揣测的内耗里——${revCount}张逆位牌只是善意的"慢一点"提示，不是否定`);
    advices.push('与其紧盯着对方有没有主动，不如把这份精力用来滋养自己的情绪');
  } else {
    advices.push('这段时间更适合"向内看"而非"向外冲"——利用这个阶段重新审视自己的方向，给自己一些空间');
    advices.push('降低当下对"热烈回应"的期待，放平心态反而更容易看清事情本来的样子');
  }

  // Element-specific advice
  const elAdvice = {
    fire: '火元素赋予你行动力——想到了就去做，不要犹豫。但偶尔也看看路，别光顾着冲',
    water: '水元素提醒你相信直觉——有些答案不在头脑里，而在心里。柔软一点也没关系',
    air: '风元素给你的礼物是清晰的思维——善用这段时间理清思路，想清楚之后，说清楚也很重要',
    earth: '土元素告诉你稳扎稳打就是最好的策略——不需要急，一步一个脚印，你正在打造的是长久的根基',
  };
  if (elAdvice[dominantEl]) {
    advices.push(elAdvice[dominantEl]);
  }

  // Question-specific advice
  if (/想|想念|惦记|思念/.test(userQuestion || '')) {
    advices.push('如果实在忍不住想确认对方的心意，可以适度主动抛出一个轻松的话题，不用沉重地质问"想我了没"');
  }
  if (/喜欢|爱|感情|关系|在一起/.test(userQuestion || '')) {
    advices.push('多专注自身情绪的稳定，保持温柔松弛的状态——当你不再被对方的态度牵动全部心神，关系反而会慢慢回暖');
  }

  // Universal closing advice
  advices.push('牌是灯火，照亮眼前几步路；走向远方的双脚，永远属于你自己');

  return advices;
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
    // New format
    full_text: parsed.full_text || '',
    cards: (parsed.cards || []).map(c => ({
      name: c.name || c.name_zh || '',
      position: c.position || c.positionName || '',
      isReversed: !!c.isReversed,
      reading: c.reading || c.interpretation || '',
    })),
    // Old format (backward compat)
    overview: parsed.overview || parsed.summary || '',
    advice: parsed.advice || '',
    theme_insight: parsed.theme_insight || '',
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
