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
function generateInterpretation(drawnCards, spreadDef) {
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

  return {
    cards: result,
    overallMood,
    dominantElement: dominantEl,
    reversalCount,
    majorCount,
    summary,
    spreadName: spreadDef.name_zh,
    spreadId: spreadDef.id
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
  const cardNames = result.map(r => (r.isReversed ? '逆位' : '正位') + r.name_zh).join('、');
  const spreadName = spreadDef ? spreadDef.name_zh : '';

  // ---- Opening (multiple variants) ----
  const openings = [
    `✨ 本次${spreadName}占卜为你抽到了${cardNames}。让我们一起来看看宇宙通过这些牌想对你说什么——`,
    `🔮 ${spreadName}的牌面已经揭晓：${cardNames}。每一张牌都是一面镜子，照见你当下的处境与可能的前路。`,
    `🌟 命运之轮转动，${spreadName}占卜抽出了${cardNames}。这些牌汇聚成一份独特的讯息，只为你而来。`,
    `💫 在${spreadName}的指引下，${cardNames}来到了你的面前。牌已展开，答案就藏在每一张牌的细节之中——`
  ];
  parts.push(pick(openings));

  // ---- Card-by-card position analysis (varied phrasing) ----
  const revLabels_u = ['正位指引', '光明面的提示', '牌面在说', '这份能量告诉你'];
  const revLabels_r = ['逆位提醒', '阴影面的低语', '牌面在警示', '这份能量提醒你'];
  result.forEach((c, i) => {
    const revLabel = c.isReversed ? pick(revLabels_r) : pick(revLabels_u);
    const emoji = c.isReversed ? '🔄' : '✨';
    const txt = c.interpretation.length > 90 ? c.interpretation.slice(0, 90) + '…' : c.interpretation;
    parts.push(`${emoji}【${c.positionName}】${c.name_zh} —— ${revLabel}：${txt}`);
  });

  // ---- Major Arcana insight (varied) ----
  const majorCards = result.filter(r => r.arcana === 'major');
  if (majorCards.length >= 2) {
    const majorMsgs = [
      `🌟 ${majorCards.length}张大阿卡纳齐聚，这不是偶然。这些牌触及了你灵魂深处的重要课题，请认真品味它们在各自位置上的含义——它们之间的联系或许比你想的更深。`,
      `🔮 大阿卡纳的力量在本次占卜中格外凸显——${majorCards.length}张大牌同时出现，意味着你正站在一个重要的人生路口。每一个位置都是拼图的一块，合起来才能看到完整的画面。`
    ];
    parts.push(pick(majorMsgs));
  } else if (majorCards.length === 1) {
    const singleMsgs = [
      `🌟 大阿卡纳「${majorCards[0].name_zh}」的出现尤为关键。请把最多的注意力放在它在「${majorCards[0].positionName}」位置上的信息——那是整场占卜的核心。`,
      `💡 一张大牌「${majorCards[0].name_zh}」照亮了本次占卜。它在「${majorCards[0].positionName}」的位置上告诉你的事，可能是你今天最需要听见的声音。`
    ];
    parts.push(pick(singleMsgs));
  }

  // ---- Reversal insight (varied) ----
  const revCount = result.filter(r => r.isReversed).length;
  if (revCount === 0) {
    const allUpMsgs = [
      '✨ 所有牌都以正位敞开——这是宇宙给你的绿灯。当前的道路阻力最小，顺其自然地走下去，你会看到想要的结果。',
      '🌞 正位全开的牌面非常难得。你的能量场此刻清澈明亮，所做的选择与你内在的方向高度一致。相信这份顺畅，也珍惜这段好时光。'
    ];
    parts.push(pick(allUpMsgs));
  } else if (revCount === 1) {
    const oneRevMsgs = [
      '🔄 只有一张逆位牌——它像一个小小的路标，提醒你在某个方向多看一眼。不用过度解读，把它当作善意的提醒就好。',
      '⚡ 一张逆位牌藏在正位的光芒中。它不代表阻碍，而是一个温柔的「慢一点」的信号——在对应的领域多一分辨察，你就能绕开不必要的坑。'
    ];
    parts.push(pick(oneRevMsgs));
  } else {
    const multiRevMsgs = [
      `🔄 ${revCount}张逆位牌在提醒你——当下的节奏可能需要调整。逆位并非厄运，而是邀请你换个姿势看问题。有时候，最大的智慧是知道什么时候该转弯。`,
      `🌙 ${revCount}张牌以逆位出现，像月光下的影子——它们不是来吓你的，而是来让你看见那些平时被忽略的角落。慢下来，向内看，你会发现答案一直在那里。`
    ];
    parts.push(pick(multiRevMsgs));
  }

  // ---- Theme-specific actionable guidance ----
  const ups = result.filter(r => !r.isReversed).length;
  const revs = result.filter(r => r.isReversed).length;
  const total = result.length;

  if (spreadId.startsWith('love')) {
    if (revs === 0) {
      parts.push('💕 【恋爱综合判断】牌面能量非常积极！如果你正在一段关系中，这是感情升温的好时期，适合主动表达爱意、规划共同的未来。如果目前单身，近期有很大机会遇到心动的人——多参加社交活动，缘分就在不远处。整体建议：大胆向前，不必犹豫。');
    } else if (revs <= total / 2) {
      parts.push('💕 【恋爱综合判断】感情运势总体向好，但有一些小波折需要留意。如果你在纠结「该继续还是该放下」——牌面提示这段关系仍有价值，但需要双方坦诚沟通来化解当前的障碍。如果单身，近期桃花运势不错，但初次接触时多观察，别急着投入。整体建议：坚持但别盲目，沟通是解药。');
    } else {
      parts.push('💕 【恋爱综合判断】逆位牌偏多，提醒你在这段关系中需要冷静审视。如果你已经在感情中感到疲惫或被消耗，牌面建议你给自己一些空间——有时候暂时的退后比一味坚持更明智。如果对方不值得，放手也是一种勇敢。单身的朋友近期桃花运平平，不如先专注于提升自己，更好的缘分会在你准备好时出现。整体建议：先爱自己，再谈爱人。');
    }
  } else if (spreadId.startsWith('study')) {
    if (revs === 0) {
      parts.push('📚 【学业综合判断】学业运势相当不错！这段时间你的理解力和记忆力都处于高峰期，非常适合冲刺考试或攻克难题。如果正在备考，保持当前的节奏不要松懈，最终成绩会超出预期。如果是日常学习，这是一个效率极高的阶段，多利用这段时间深入钻研。整体建议：乘胜追击，现在的努力回报率最高。');
    } else if (revs <= total / 2) {
      parts.push('📚 【学业综合判断】学业运势平稳，但也存在一些短板需要关注。你可能在某些科目或知识点上有漏洞，现在是查漏补缺的好时机。考试方面需要更加踏实，不要依赖运气或押题——稳扎稳打比临时抱佛脚更有效。可以找同学一起学习，互相督促效率更高。整体建议：找到薄弱点专项突破，别让短板拖后腿。');
    } else {
      parts.push('📚 【学业综合判断】逆位牌较多，可能你在学习上正面临一些困难或瓶颈期。如果感到迷茫或提不起劲，先别急着自责——这可能是学习方法需要调整的信号。试着切换一下学习方式（比如从看书转为看视频讲解），或者给自己安排适当的休息。考试方面不建议裸考或临时突击，从现在开始制定计划慢慢来。整体建议：换种方式重新开始，慢一点也没关系。');
    }
  } else if (spreadId.startsWith('work')) {
    if (revs === 0) {
      parts.push('💼 【事业综合判断】事业运势强劲！如果你在考虑跳槽、转行或争取晋升，现在是非常有利的时机——大胆地去面试、去谈判、去展示你的价值。创业的朋友也可能迎来重要突破。即使暂时没有大动作，这段时间你的工作效率和成果也会格外突出，容易被领导和同事看到。整体建议：抓住风口，该出手时就出手。');
    } else if (revs <= total / 2) {
      parts.push('💼 【事业综合判断】事业运势稳中有变。建议你近期以稳固现有位置为主，重大决策（如跳槽、裸辞）不妨再观察一段时间。职场中的人际关系需要多加留意，可能会有一些隐性的竞争或误会，保持专业和低调是明智之举。如果有项目在推进中，多预留一些缓冲时间应对突发状况。整体建议：稳字当头，以退为进。');
    } else {
      parts.push('💼 【事业综合判断】逆位牌较多，提示你近期在事业上可能会遇到一些阻力或瓶颈。如果正在考虑跳槽——建议先按兵不动，现在不是最佳时机。如果工作让你感到疲惫或厌倦，试着找找问题的根源：是工作本身不适合，还是只是暂时的倦怠？不要在这个时候冲动裸辞。利用这段时间去提升技能或积累资源，等运势回升时再出发。整体建议：韬光养晦，积蓄力量等风来。');
    }
  } else if (spreadId.startsWith('travel')) {
    if (revs === 0) {
      parts.push('✈️ 【旅行综合判断】出行运势极佳！如果正在计划旅行——放心去吧！旅途会很顺利，而且可能会遇到超出预期的惊喜。无论是短途周末游还是长途旅行，都会收获满满的美好回忆。独自旅行或与朋友同行都很适合，沿途的风景和遇到的人都会让你感到不虚此行。整体建议：收拾行李出发吧，好运气在路上等你。');
    } else if (revs <= total / 2) {
      parts.push('✈️ 【旅行综合判断】旅行运势总体不错，但有一些小细节需要注意。建议出行前多做功课——提前确认交通、住宿和天气，避免临时手忙脚乱。旅途中可能会有一些小插曲（比如迷路或延时），但不会影响整体的旅行体验。如果犹豫「去不去」——答案是去，只是需要多做一点准备。整体建议：可以出发，但Plan B要备好。');
    } else {
      parts.push('✈️ 【旅行综合判断】近期出行运势偏低，建议谨慎安排旅行计划。如果有非去不可的行程，一定要做好万全准备——证件、保险、备用方案一个都不能少。如果只是想放松一下，不妨选择近一点的目的地或干脆推迟出行计划。这段时间更适合规划未来旅行而非立即出发——把期待攒到运势更好的时候。整体建议：暂缓出行，现在不是最佳出发时机。');
    }
  } else if (spreadId.startsWith('social')) {
    if (revs === 0) {
      parts.push('🎭 【社交综合判断】社交运势旺盛！这段时间是拓展人脉、结交新朋友的黄金期。如果有聚会或社交活动——放心参加，你会成为受欢迎的人。想修复某段关系的话，现在是主动迈出第一步的好时机。在工作中也可能遇到能帮助你的贵人。整体建议：多出门多交流，好人缘会带来好机会。');
    } else if (revs <= total / 2) {
      parts.push('🎭 【社交综合判断】社交运势总体平稳，但在人际关系中需要多一些判断力。对于那些让你感到消耗或不舒服的关系——可以适当保持距离。近期可能会有人向你求助或借钱，建议量力而行，不要勉强自己。真正值得深交的朋友经得起时间的考验，不必急于给所有人贴上「好朋友」的标签。整体建议：有选择地社交，质量比数量重要。');
    } else {
      parts.push('🎭 【社交综合判断】逆位牌偏多，提醒你在人际交往中需要更加谨慎。近期可能遇到表面友善但背后另有目的的人——相信你的直觉，如果你感觉不对劲，那很可能就是有问题。避免卷入他人的八卦或是非之中，保持中立会帮你避开很多不必要的麻烦。这段时间也适合清理一下社交圈，远离那些消耗你能量的关系。整体建议：谨言慎行，宁缺毋滥。');
    }
  } else if (spreadId.startsWith('gaming')) {
    if (revs === 0) {
      parts.push('🎮 【游戏综合判断】今日游戏运势上佳！抽卡/开箱运气不错，如果在犹豫要不要来一发十连——牌面给出了绿灯信号。竞技类游戏中你的状态和反应都在峰值，适合冲分或打排位。你的判断力和操作手感都比平时更好，队友配合也会比较顺畅。整体建议：今天适合放手一搏，无论是抽卡还是冲分都值得一试。');
    } else if (revs <= total / 2) {
      parts.push('🎮 【游戏综合判断】游戏运势中等偏上。抽卡方面——小氪怡情，但不建议大量投入，出金概率一般但也不会太非。竞技类游戏中你的状态不错，但可能会遇到一些不那么靠谱的队友，保持好心态很重要。如果今天打排位连输两把，建议先停下来缓一缓再继续，不要硬怼。整体建议：适度娱乐，理性消费，心态别崩。');
    } else {
      parts.push('🎮 【游戏综合判断】今日游戏运势偏低。抽卡/开箱方面——牌面明确建议今天管住手！出金概率不太乐观，如果实在想抽不如等下次UP池。竞技游戏中可能会遇到连败或队友不给力的情况，建议今天以娱乐放松为主，别太在意输赢。如果控制不住想氪金——先去做点别的转移注意力，明天再考虑。整体建议：今天宜养生游戏，忌上头氪金和排位硬刚。');
    }
  }

  // ---- Element guidance (varied) ----
  const elMessages = {
    fire: [
      '🔥 火元素在牌面中跃动——你的热情和行动力是当下最宝贵的燃料。勇往直前，但别忘了偶尔看看地图。',
      '🔥 火能量满满！这意味着现在不是犹豫的时候——想到了就去做。只是记得，烈火需要风来助燃，也需要水来调温。'
    ],
    water: [
      '💧 水元素流淌在牌面之间——情绪和直觉是你此刻最可靠的导航。有些事不用想太明白，感觉对了就对了。',
      '💧 水能量浸润着你的牌阵。倾听内心的潮汐——它比头脑更知道答案在哪里。柔软，但并不脆弱。'
    ],
    air: [
      '🌬️ 风元素吹过你的牌面——思想和沟通的力量被唤醒了。适合做计划、做决定、做交流。但别让思绪飘得太远，忘了脚下的路。',
      '🌬️ 风能量在牌阵中穿梭——你的头脑此刻格外清晰。善用这份清明去理清那些纠缠已久的问题。一句话：想清楚，然后说清楚。'
    ],
    earth: [
      '🌍 土元素稳稳地托着你的牌阵——现在不需要急。一步一个脚印，你种下的因，会在对的季节结成果。',
      '🌍 土能量是牌面的底色——务实、耐心、积累。你正在打造的根基，未来会成为最坚实的依靠。慢，但扎实。'
    ]
  };
  if (elMessages[element]) {
    parts.push(pick(elMessages[element]));
  }

  // ---- Closing (varied) ----
  const closings = [
    '🌅 每一天都是崭新的画布。塔罗为你描了第一笔轮廓，而接下来的色彩——由你来决定。',
    '💫 牌已阅，心已安。记住：塔罗是灯火，照亮眼前几步路；而走向远方的双脚，永远属于你自己。',
    '🕊️ 解读到此为止，但你的故事还在继续。带着这些启示去生活吧——最好的占卜，是你过好当下的每一天。',
    '🌿 无论牌面说了什么，请记得：你是自己命运的作者。塔罗只是递了一支笔，怎么写——全在你。'
  ];
  parts.push(pick(closings));

  return parts.join('\n\n');
}

// ---------- Song Recommendations ----------
const SONG_RECOMMENDATIONS = {
  excited: [
    { title: '晴天', artist: '周杰伦', emoji: '☀️', reason: '阳光般温暖的旋律，如同你今天明媚的运势。愿这首歌陪伴你度过活力满满的一天，每一刻都闪耀着光芒。' },
    { title: '稻香', artist: '周杰伦', emoji: '🌾', reason: '清新的田园气息，配合你今天的好运。闭上眼睛，感受微风拂过麦浪的惬意，生活如此美好。' }
  ],
  happy: [
    { title: '小幸运', artist: '田馥甄', emoji: '🍀', reason: '甜美的歌声轻轻告诉你——原来你是我最想留住的幸运。今天的小确幸，值得被温柔地记住。' },
    { title: '起风了', artist: '买辣椒也用券', emoji: '🍃', reason: '轻快的旋律里有风的自由。今天的你就像这首歌一样，轻盈、自在，带着一点点潇洒。' }
  ],
  calm: [
    { title: '追光者', artist: '岑宁儿', emoji: '🌌', reason: '安静的歌声里有温柔的力量。今天的你不需要太用力，像星光一样静静地发光就好。' },
    { title: '平凡之路', artist: '朴树', emoji: '🛤️', reason: '在宁静中找到力量。走过平凡的路，也能遇见不平凡的风景。今天适合静下心来，感受生活的节奏。' }
  ],
  neutral: [
    { title: '后来', artist: '刘若英', emoji: '🌸', reason: '温暖的歌声带着淡淡的感悟。生活的滋味在于品味当下，不急不躁，一切刚刚好。' },
    { title: '童话', artist: '光良', emoji: '📖', reason: '相信美好，就像相信童话。今天的运势告诉你——保持期待，好事正在路上。' }
  ],
  anxious: [
    { title: '隐形的翅膀', artist: '张韶涵', emoji: '🕊️', reason: '每一次跌倒都是为了更好地飞翔。你拥有一双隐形的翅膀，带着你飞过所有不安，抵达平静的港湾。' },
    { title: '夜空中最亮的星', artist: '逃跑计划', emoji: '⭐', reason: '在不安的时候，抬头看看星空。你是夜空中那颗最亮的星，不需要畏惧黑暗，因为你本身就是光。' }
  ]
};

function getSongRecommendation(mood) {
  const songs = SONG_RECOMMENDATIONS[mood] || SONG_RECOMMENDATIONS.neutral;
  return songs[Math.floor(Math.random() * songs.length)];
}

// ---------- Mood Emoji Mapping ----------
const MOOD_OPTIONS = [
  { id: 'happy', emoji: '😊', label: '开心' },
  { id: 'calm', emoji: '😌', label: '平静' },
  { id: 'neutral', emoji: '😐', label: '一般' },
  { id: 'excited', emoji: '🤩', label: '兴奋' },
  { id: 'anxious', emoji: '😰', label: '焦虑' },
  { id: 'sad', emoji: '😢', label: '难过' },
  { id: 'tired', emoji: '😴', label: '疲惫' }
];

function getMoodOptions() {
  return MOOD_OPTIONS;
}
