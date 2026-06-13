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

// ---------- Get Spread Definition ----------
function getSpread(spreadId) {
  return spreads.find(s => s.id === spreadId) || spreads[0];
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

  const summary = generateSummary(result, overallMood, dominantEl);

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

function generateSummary(result, mood, element) {
  const parts = [];
  const cardNames = result.map(r => (r.isReversed ? '逆位' : '正位') + r.name_zh).join('、');

  parts.push(`本次占卜抽到了${cardNames}。`);

  if (result.filter(r => r.arcana === 'major').length > 1) {
    parts.push('大阿卡纳的出现说明你正处在一个重要的人生转折点上，这些能量将对你的生活产生深远影响。');
  }

  if (result.filter(r => r.isReversed).length === 0) {
    parts.push('所有牌均以正位呈现，这是一个能量顺畅、积极向上的时期。保持当下的状态，让事情自然发展。');
  } else if (result.filter(r => r.isReversed).length >= 2) {
    parts.push('部分牌以逆位出现，提示你在这些领域可能需要放慢节奏、反思或调整方向。逆位并非坏事，而是一个重新审视的机会。');
  }

  const elMessages = {
    fire: '火元素的能量提醒你保持热情和行动力，但也要注意不要过于冲动。找到激情与耐心的平衡点，你会走得更远。',
    water: '水元素的影响让你更加敏感和富有直觉。在这个时期，情绪和感受是重要的指引，学会倾听内心的声音。',
    air: '风元素的能量带来清晰的思维和沟通能力。善用你的理性和逻辑，但也别忘了给心灵留一些空间。',
    earth: '土元素的务实能量帮助你脚踏实地。持续的耐心和努力会带来稳固的收获，一步一个脚印地前进。'
  };

  if (elMessages[element]) {
    parts.push(elMessages[element]);
  }

  parts.push('每一天都是新的开始，塔罗的指引帮助你看见当下，而未来的笔掌握在你自己的手中。');

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
