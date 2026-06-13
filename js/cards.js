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
function getShuffledGrid() {
  return shuffleArray([...allCards]);
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

function generateSummary(result, mood, element, spreadDef) {
  const parts = [];
  const spreadId = (spreadDef && spreadDef.id) || '';
  const cardNames = result.map(r => (r.isReversed ? '逆位' : '正位') + r.name_zh).join('、');

  // ---- Opening ----
  parts.push(`本次${spreadDef ? spreadDef.name_zh : ''}占卜抽到了${cardNames}。`);

  // ---- Card-by-card position analysis ----
  result.forEach((c, i) => {
    const revLabel = c.isReversed ? '逆位提醒' : '正位指引';
    parts.push(`【${c.positionName}】${c.emoji} ${c.name_zh}（${c.isReversed ? '逆位' : '正位'}）——${revLabel}：${c.interpretation.slice(0, 80)}…`);
  });

  // ---- Major Arcana insight ----
  const majorCards = result.filter(r => r.arcana === 'major');
  if (majorCards.length >= 2) {
    parts.push(`🌟 ${majorCards.length}张大阿卡纳同时出现，说明本次占卜触及了你人生中较为深层的议题。这些牌的能量影响深远，值得你花时间细细体会。`);
  } else if (majorCards.length === 1) {
    parts.push(`🌟 大阿卡纳「${majorCards[0].name_zh}」的出现，为本次占卜注入了重要的灵性指引。请特别关注它在「${majorCards[0].positionName}」位置上的启示。`);
  }

  // ---- Reversal insight ----
  const revCount = result.filter(r => r.isReversed).length;
  if (revCount === 0) {
    parts.push('✨ 所有牌均以正位呈现，能量流通顺畅。在当前的议题上，你正走在一条积极的道路上。');
  } else if (revCount === 1) {
    parts.push('🔄 有一张牌以逆位出现，提示你在对应领域需要多一分觉察。逆位不是坏事，而是一个温柔的提醒。');
  } else {
    parts.push(`🔄 ${revCount}张牌以逆位呈现，建议你在近期放慢节奏，多一些反思和内省。逆位牌是邀请你从不同角度审视当下的处境。`);
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

  // ---- Element guidance ----
  const elMessages = {
    fire: '🔥 火元素主导：行动力和热情是你的优势，但也注意别让冲动主导了判断。在激情与耐心之间找到平衡。',
    water: '💧 水元素主导：直觉和情感是这个时期的指南针。相信内心的感受，它们往往比理性思考更早知道答案。',
    air: '🌬️ 风元素主导：清晰的思维是你的利器。善用分析和沟通能力，但别让过度思考阻碍了行动。想到和做到之间，只差一步。',
    earth: '🌍 土元素主导：稳扎稳打是当下的关键词。耐心耕耘，不急于求成。你种下的每一颗种子都会在合适的季节发芽。'
  };
  if (elMessages[element]) {
    parts.push(elMessages[element]);
  }

  // ---- Closing ----
  parts.push('每一天都是新的开始。塔罗是镜子，照见当下的你；而未来的笔，始终握在你自己手中。');

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
