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

  // ---- Theme-specific guidance ----
  if (spreadId.startsWith('love')) {
    parts.push('💕 恋爱方面：感情的道路上，最重要的是真诚地对待自己和对方。无论牌面显示什么，记住——真正的爱情始于自爱。保持开放的心，也守护好自己的边界。');
  } else if (spreadId.startsWith('study')) {
    parts.push('📚 学业方面：学习是一场与自己的长跑。找到适合自己的节奏比追求速度更重要。遇到困难时不要气馁，每一次挫折都是成长的养分。相信自己积累的力量。');
  } else if (spreadId.startsWith('work')) {
    parts.push('💼 事业方面：职业发展如同下棋，需要策略也需要耐心。关注当下的位置，也别忘了抬头看路。你的专业能力和独特价值终将被看见，时机比速度更重要。');
  } else if (spreadId.startsWith('travel')) {
    parts.push('✈️ 旅行方面：每一段旅途都是心灵的延伸。无论是计划已久的远行还是临时起意的短途，重要的是带着好奇心出发。旅途中的意外往往会成为最珍贵的回忆。');
  } else if (spreadId.startsWith('social')) {
    parts.push('🎭 社交方面：人际关系如同镜子，照见我们自己的样子。选择与什么样的人同行，就是选择成为什么样的自己。珍惜那些让你感到自在和成长的关系。');
  } else if (spreadId.startsWith('gaming')) {
    parts.push('🎮 游戏方面：享受游戏的乐趣是最重要的。运势有好有坏，但真正的高手懂得在顺境中保持冷静、在逆境中寻找机会。记住——心态永远是你最强的装备。');
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
