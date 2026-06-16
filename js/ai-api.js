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
// 词汇库 & 结构变体池（增强本地模式共享）
// ═══════════════════════════════════════════════════════

const ELEMENT_VOCAB = {
  fire: {
    nouns: ['火焰', '火星', '热力', '燃料', '冲劲'],
    verbs: ['点燃', '破局', '驰骋', '突围', '推进', '冲刺', '迸发', '燎原'],
    adjectives: ['炙热', '果决', '生猛', '滚烫', '利落', '痛快', '势不可挡'],
    traits: ['行动力', '胆魄', '直觉式的冲劲', '不管不顾的勇气', '说干就干的果断'],
    uprightDesc: '火元素的能量在你这边烧得正旺——不是燥热的虚火，而是能照亮前路的篝火。',
    reversedDesc: '火苗没有灭，只是暂时被压住了。你心里那股"想做点什么"的劲儿还在，别让它憋成焦躁。',
  },
  water: {
    nouns: ['水波', '暗流', '潮汐', '雨露', '涟漪'],
    verbs: ['浸润', '流淌', '滋养', '释然', '化开', '沉淀', '涤荡', '映照'],
    adjectives: ['温润', '柔软', '清澈', '深邃', '细腻', '通透如镜', '暗涌不息'],
    traits: ['感受力', '直觉', '共情的天赋', '以柔克刚的智慧', '润物细无声的耐心'],
    uprightDesc: '水元素温柔地浸润着这个位置——你的感受力正在最好的状态，直觉比理性更知道答案。',
    reversedDesc: '水面起了波澜，暂时看不清底。情绪不是敌人，它只是在提醒你：有些东西需要被正视。',
  },
  air: {
    nouns: ['风向', '气流', '天光', '讯号', '脉络'],
    verbs: ['梳理', '穿透', '思辨', '澄明', '豁然开朗', '拨云见日', '理清', '放飞'],
    adjectives: ['通透', '明晰', '敏锐', '清醒', '开阔', '游刃有余', '条分缕析'],
    traits: ['清晰的思维', '沟通的才华', '一眼看穿本质的眼力', '举重若轻的智慧', '灵活应变的身段'],
    uprightDesc: '风元素让这个位置的视野格外通透——你想得很清楚，只是需要勇气把想的说出来。',
    reversedDesc: '风大了会迷眼。信息太多、念头太杂的时候，反而看不清重点。不是想得不够，是想得太多。',
  },
  earth: {
    nouns: ['大地', '根系', '基石', '土壤', '山脉'],
    verbs: ['扎根', '耕耘', '积淀', '垒实', '守望', '灌溉', '筑底', '收成'],
    adjectives: ['厚重', '踏实', '沉稳', '靠谱', '经得起推敲', '慢慢来比较快', '一步一印'],
    traits: ['定力', '耐力', '把事情做扎实的本事', '不被外界带跑的稳定', '在时间里累积的底气'],
    uprightDesc: '土元素稳稳地托住了这个位置——不急不躁，厚积薄发，每一步都算数。',
    reversedDesc: '土太重的时候就变成了"困"。你给自己垒了一道很结实的墙——安全是安全，但外面的风吹不进来。',
  },
};

function elVocab(card) {
  const el = card.element || 'water';
  return ELEMENT_VOCAB[el] || ELEMENT_VOCAB.water;
}

function elWord(card, category) {
  const pool = elVocab(card)[category];
  if (!pool || !pool.length) return '';
  return pool[Math.floor(Math.random() * pool.length)];
}

// ═══════════════════════════════════════════════════════
// 结构变体定义 —— 8种不同的段落组织方式
// 每个变体有 5-8 种具体写法（模板字符串，用 {key} 占位）
// ═══════════════════════════════════════════════════════

// ── 变体A：描述叙事式（画面→共情→前瞻）──
const VARIANT_A_UPRIGHT = [
  '正位的{cardName}在"{posName}"位置，像一盏刚好亮起的灯——不刺眼，但足够让你看清眼前的路。{elDesc}{keywordsClause}，这些词不是随便说说的，它们就是你当下在"{posName}"这个层面最真实的写照。{templateRef}不必急着追问结果——此刻你踩在地上的每一步，都已经在回答你的问题了。',
  '{cardName}以正位进入"{posName}"，感觉像推开一扇窗，外面恰好是晴天。{elDesc}你在这个层面其实比你以为的更有把握——{traitClause}让你在别人还在犹豫的时候，已经迈出了半步。{keywordsClause}——这几个字，是你当下最该相信的东西。继续走下去，不需要回头看。',
  '当正位的{cardName}落在"{posName}"，画面感很强：像是你在一条路上走了一阵子，忽然发现路标是对的。{elDesc}这张牌在告诉你：你之前那些不确定的、反复掂量的决定，方向没有错。{templateRef}别让"万一"和"会不会"消耗你——此刻要做的不是重新想一遍，而是接着往前走。',
  '"{posName}"亮起正位{cardName}，是一张很"合拍"的牌。{elDesc}{traitClause}在你身上不是抽象的概念——你最近在"{posName}"这件事上的某个直觉选择，恰好踩在了对的节奏上。{keywordsClause}，这是牌面对你最简洁的概括。不需要额外的证明，时间会帮你确认。',
  '{cardName}正位出现在"{posName}"——如果你能看见牌面，你会发现画中人的神态和你最近的状态有几分神似。{elDesc}这张牌不是一个"预言"，而是一面镜子——照出了你在这个层面已经有但可能还没意识到的力量。{keywordsClause}，记住这几个字。接下来每次犹豫的时候，想想它们。',
  '正位{cardName}进"{posName}"的时机很对。像是你正准备出门，发现外面刚好顺风。{elDesc}{traitClause}——你知道吗，很多人花了很长时间才学会的事，你在这个位置上已经在做了。{templateRef}你比自己想象的更靠近答案。',
];

const VARIANT_A_REVERSED = [
  '逆位的{cardName}出现在"{posName}"位置，像手机信号微弱时断时续的通话——不是没有连接，而是需要你换个位置、调整一下角度。{elDesc}{keywordsClause}的力量还在，只是暂时被你内心的拉扯压住了。{templateRef}这不是坏事，而是一个善意的暂停：让你在继续之前，先确认自己真正想要的方向。',
  '{cardName}以逆位落进"{posName}"，画面感是：一盏灯还亮着，但灯罩上蒙了一层灰。{elDesc}光没有灭——你的判断力、你的感受力都在，只是眼前这些让你分心的事太多了。{templateRef}先把灰擦掉。答案一直在灯下，不需要换一盏新的。',
  '逆位{cardName}在"{posName}"，像一面有点起雾的镜子。{elDesc}你在这个层面不是看不清——是不太敢看清。{keywordsClause}变成了"{keywordsClause}但不太确定"，这种犹豫本身就是一个信号。{templateRef}允许自己停一下，但不要停太久。雾会散的。',
  '当{cardName}逆位出现在"{posName}"，感觉像开车一直轻轻踩着刹车——你在往前走，但总觉得哪里卡卡的。{elDesc}{traitClause}没有消失，只是暂时找不到出口。{templateRef}试试把脚从刹车上挪开——哪怕只松一点点，车就会顺很多。',
  '"{posName}"位置上的逆位{cardName}，像一首歌放到一半突然卡住了。{elDesc}不是歌不好，是网络不太好。你在这个层面正经历一段"缓冲期"——{keywordsClause}的种子已经埋下去了，只是还没到破土的时间。{templateRef}等待不是放弃，等待也是往前走的一种方式。',
  '逆位的{cardName}落在"{posName}"，像一封写好了但迟迟没发出去的消息。{elDesc}你心里其实有很多话、很多想法，但在"要不要说""要不要做"的反复掂量中卡住了。{templateRef}不是所有犹豫都需要被克服——有些犹豫是在保护你。但有些犹豫，只是习惯性地往后退了一步。这一次，试试往前。',
];

// ── 变体B：设问式（反问→牌意连接→落地建议）──
const VARIANT_B_UPRIGHT = [
  '你有没有发现——最近在"{posName}"这件事上，你做决定比之前干脆了很多？正位{cardName}刚好解释了这种变化。{elDesc}{traitClause}在你身上正在"上线"，你不再反复权衡每一个选项，而是开始相信自己的第一反应。{keywordsClause}——这份直觉不是凭空来的，是你攒了足够多的经验之后，大脑自动在帮你做筛选。继续相信它。',
  '你是不是偶尔会在心里问自己：我这么做对不对？正位的{cardName}在"{posName}"给你的回答是：对的。{elDesc}对的路不一定是最轻松的路，但它走起来有一种"不费劲的对劲"——你懂我在说什么。{keywordsClause}是你当下的指南针。不用每隔五分钟就掏出来确认一次方向——相信它就够了。',
  '你有没有这种感觉——在别人看来一切照旧，但你自己知道，有什么东西正在悄悄地变？{cardName}正位出现在"{posName}"，捕捉到的就是这个"悄悄变"的瞬间。{elDesc}{traitClause}——它不是突然从天上掉下来的，而是你之前那些不起眼的积累终于开始说话了。{templateRef}好的变化不需要敲锣打鼓地来，安静的改变往往更持久。',
  '如果让你用三个字来形容"你现在在{posName}上最想要的状态"，你会选什么？{cardName}正位替你挑了三个：{keywordsClause}。{elDesc}也许你自己都还没意识到，但你最近在这个层面上的言行，已经越来越接近你想要成为的样子。{templateRef}不需要大张旗鼓地宣布"我要改变"——你已经在变了。',
  '什么时候你觉得自己最"在状态"？正位{cardName}亮在"{posName}"，说的就是这种感觉。{elDesc}那种思路清晰、手脚利落、说话有底的节奏——不是天天有，但最近正在高频出现。{keywordsClause}是你当下的"出厂设置"。别去调它，让它跑。',
];

const VARIANT_B_REVERSED = [
  '你是不是觉得自己最近在"{posName}"这件事上特别拧巴——想往前又往后退，想开口又咽回去？逆位的{cardName}读懂了你的纠结。{elDesc}不是你的能力不够，是你心里同时住了两个人：一个想冲，一个想守。{templateRef}这种拉扯不会永远持续——但在它结束之前，你需要先搞清楚：那两个声音，到底哪一个在说真话？',
  '有没有那么几个瞬间，你觉得自己好像突然不会做决定了？逆位{cardName}在"{posName}"位置，说明这不是你的问题——是你正处在一个"旧模式不适用、新模式还没成型"的过渡期。{elDesc}换季的时候人容易感冒，换节奏的时候人也容易犹豫。{templateRef}给自己一个过渡的时间，别用"应该"来逼自己。',
  '你最近是不是经常在心里问"为什么"——为什么卡住了，为什么不顺利，为什么别人可以我不可以？逆位{cardName}在"{posName}"告诉你：这个"为什么"本身不重要。{elDesc}纠结原因不如调整角度。{templateRef}与其追问"为什么卡"，不如试试"换条路走走看"。',
  '如果让你给自己的"{posName}"状态打个分，你会打几分？逆位的{cardName}提示的是：你可能打低了。{elDesc}你在这个层面不是不及格——你只是把自己的评分标准调得太苛刻了。{keywordsClause}还在，只是被你的自我怀疑暂时盖住了。{templateRef}今天晚上睡觉前，试着找一个今天做得还不错的小事——就一个，就够了。',
  '当你在"{posName}"上反复得到同一个信号但就是不想面对的时候——逆位的{cardName}就是那个信号。{elDesc}牌面在问：你已经感觉到了，为什么还在等一个"对的时机"？{templateRef}不舒适的真相往往比舒服的幻觉更有用。你已经有足够的勇气去面对了——就差一个决定。',
];

// ── 变体C：直接对话式（"你"开头→连接牌意→落地）──
const VARIANT_C_UPRIGHT = [
  '你可能已经察觉到了——在"{posName}"这件事上，你最近的状态确实在往上走。正位{cardName}的出现不是意外，而是你这段日子所有选择的自然结果。{elDesc}{traitClause}，你不需要再问"我行不行"——牌面已经替你回答了。{templateRef}接下来，信自己多过信运气。',
  '你心里其实已经有答案了，对不对？{cardName}正位落在"{posName}"，就是来帮你确认这个答案的。{elDesc}有些事你想得很明白，只是需要一个"第三方"来帮你肯定一下——这张牌就是那个第三方。{keywordsClause}。好，现在你有了牌面的确认，不用再等了。',
  '你最近在"{posName}"上做的那个决定，方向是对的。正位{cardName}给它盖了一个"准"字。{elDesc}{traitClause}一直在你身上，只是最近被一些外部噪音遮住了。{templateRef}噪音会过去的，你的判断力不会。继续相信那个"第一反应"。',
  '你可能没注意到，但你在"{posName}"这件事上的直觉最近准得惊人。{cardName}正位来的正是时候——它在说：别想太多，你一开始想到的那个方向就是对的。{elDesc}{templateRef}有时候最简单的答案就是最对的答案。你的直觉没有骗你。',
  '你要相信——不是盲目相信，是你有资格相信。正位{cardName}在"{posName}"亮起，说明你在这个层面已经攒够了资本。{elDesc}{traitClause}不是天赋，是你之前磕磕绊绊攒下来的功力。{keywordsClause}——从现在开始，把你的判断力当回事。',
];

const VARIANT_C_REVERSED = [
  '你可能正在经历一段"说不清哪里不对但就是不太对"的时期。逆位{cardName}在"{posName}"位置，想说一句你可能不太爱听的话：不是外界的问题，是你自己给自己加了很多戏。{elDesc}{templateRef}先把脑子里的那些"万一"暂停一下——你会发现，大部分让你焦虑的事，根本还没发生。',
  '你现在需要的不是一个答案，而是一点空间。逆位的{cardName}在"{posName}"——它在提醒你：你在用力去够一个还没准备好的东西。{elDesc}不是你不配，是时机还需要再酿一酿。{templateRef}把手松开一点，不是放弃——是给这件事多一点发酵的时间。',
  '你可能觉得自己的状态有点"掉线"——没关系的。逆位{cardName}在"{posName}"告诉你的不是"你不够好"，而是"你太累了"。{elDesc}{templateRef}休息不是退步。等你的节奏回来以后，之前的卡顿会自然化开。',
  '你最近是不是经常在心里反驳自己——刚想好一个方案，下一秒又觉得不行？逆位{cardName}在"{posName}"看到了你的内耗。{elDesc}你是一个习惯性"想太多"的人，这本身不是缺点——但当你想得停不下来的时候，就成了问题。{templateRef}找一个能让你从脑子里走出来、回到身体里的事做做。',
  '你在"{posName}"这件事上对自己有点太狠了。逆位{cardName}给的建议很简单：先对自己好一点。{elDesc}{traitClause}不是消失了，是被你的自我要求压得太紧。{templateRef}松一松。今天可以不那么努力，明天的事交给明天。',
  '你可能觉得全世界都在推着你往前走，但你自己的脚步是沉的。逆位{cardName}在"{posName}"——它想说：走不动的时候不需要硬走。{elDesc}停下来不是为了永远休息，是为了换双鞋、喝口水，然后再出发。{templateRef}给自己一个"允许慢下来"的许可。',
];

// ── 变体D：意象比喻式（比喻→解喻→具体含义→落地）──
const VARIANT_D_UPRIGHT = [
  '把正位的{cardName}在"{posName}"位置，想象成你手机导航上那个蓝色的定位点——稳稳地、准确地标出了你现在的坐标。{elDesc}这个"定位"不是别人给的，是你自己一步一步走出来的。{keywordsClause}——你就在这条路上，不需要重新导航。{templateRef}目的地没变，你也没偏。继续走。',
  '{cardName}正位出现在"{posName}"，像你在厨房炖一锅汤——火候刚好，食材都在，盖子也不需要掀开来看，香味已经在往外飘了。{elDesc}这个阶段不需要大动作——保持现在的火候，味道自然会越来越浓。{templateRef}好汤不怕慢，好事不怕等。',
  '正位{cardName}落在"{posName}"，像一本你已经翻了三分之二的书——故事情节已经展开了，人物关系也清楚了，后面的走向你大概能猜到了。{elDesc}{traitClause}是你这本书的主角光环——凭借它，你能把剩下的三分之一写得更精彩。{templateRef}翻到最后一页的时候，你会感谢现在的自己。',
  '如果"{posName}"是一片海，正位的{cardName}就是那个准时升起的潮汐——可靠、有规律、让人安心。{elDesc}有些力量不是轰轰烈烈的，而是像潮汐一样一天天稳定地推着你向前。{keywordsClause}——这种润物无声的推进比任何突飞猛进都更长久。{templateRef}不用急着看见岸，游着游着就到了。',
  '正位{cardName}在"{posName}"，像春天第一批开的花——不张扬，但路过的人都知道季节变了。{elDesc}你正处在一个"转暖"的节点上——不是突然入夏的暴热，而是乍暖还寒中越来越稳定的回暖。{templateRef}花已经开了，春天还会远吗。',
];

const VARIANT_D_REVERSED = [
  '逆位的{cardName}在"{posName}"，像你手机开了省电模式——功能都在，电量也有，但有些后台进程被暂停了，屏幕亮度被调低了。{elDesc}不是设备坏了，是你需要省着点用自己了。{templateRef}"省电模式"不会永远开着——等你充够电了，一切自然恢复到全亮。',
  '把逆位{cardName}在"{posName}"的状态，想象成一个在加载中的网页——转圈圈的那个图标你已经盯了很久了。问题不是网页不存在，是网速暂时慢了。{elDesc}{templateRef}这个时候不停地刷新反而更慢——放下鼠标，喝口水，页面会自己跳出来的。',
  '逆位{cardName}落在"{posName}"，像你穿了一件反的衣服——不是衣服不好，是穿反了。{elDesc}有些事情的顺序可能需要调整：不是先想明白再做，而是先做起来再慢慢想明白。{templateRef}把衣服正过来穿，你会发现它其实特别合身。',
  '如果"{posName}"是一个房间，逆位的{cardName}就像一盏忽明忽暗的灯。{elDesc}不是灯泡坏了，是线路接触不太好。{templateRef}与其在忽明忽暗的光里猜房间里有什么，不如拉开窗帘——自然光不会骗人，你也不需要灯泡来告诉你真相。',
  '逆位{cardName}出现在"{posName}"，像你站在十字路口但手机没电了——没有导航，不知道该往哪边走。{elDesc}但其实四个方向你都认识，只是少了那个"确认"的声音让你不太敢走。{templateRef}导航是辅助，不是必需。你认识的这条路，比你以为的多。',
  '这张逆位的{cardName}在"{posName}"——把它想象成一块被翻过来的拼图。背面什么都没有，所以你暂时看不到它在整幅画面中的位置。{elDesc}但拼图没有丢——它只是需要被翻回来。{templateRef}有些答案需要一点时间才能露出正面。你不是迷路了，你只是还在翻那块拼图。',
];

// ── 变体E：一针见血式（判断先行→简短展开→收束）──
const VARIANT_E_UPRIGHT = [
  '直接说：正位{cardName}在"{posName}"，这是一个"对"的信号。{elDesc}不需要再多问"行不行""对不对"——牌面已经给了明确的绿灯。{keywordsClause}是你现在的底牌。接下来要做的事不是分析，是行动。把想好的事做出来。',
  '简单明了——{cardName}正位入"{posName}"，方向正确，时机正好。{elDesc}{traitClause}。现在的你不缺能力、不缺判断、不缺资源——你唯一需要的是：不再等那个"完美的时机"。完美的时机就是现在，就是你已经准备好的这一刻。',
  '答案就是"可以"。正位{cardName}在"{posName}"——三个字就够回答你最关心的那个问题了。{elDesc}{templateRef}那些你花了很多时间琢磨的"可能""万一""会不会"，在牌面看来都是多余的。路是通的，往前走就行。',
  '长话短说：{cardName}正位，"{posName}"——好消息。{elDesc}{keywordsClause}这三个关键词比任何长篇大论都有用。你在这个层面正在对的方向上，不需要拐弯，不需要回头。保持现在这个节奏，不出格，不犹豫。好运气喜欢不纠结的人。',
];

const VARIANT_E_REVERSED = [
  '直接说重点：逆位{cardName}在"{posName}"，现在是"等一等"的阶段，不是"冲一冲"的阶段。{elDesc}不是终点、不是判决、不是坏消息——只是一个信号：时机还没到最对的那个点。{templateRef}耐得住这一小段等待的人，后面会走得更顺。',
  '就一句话：逆位{cardName}在"{posName}"，你该给自己松松绑了。{elDesc}不是事情有多难，是你对自己的要求太紧了。{templateRef}今天不需要解决所有问题——今天只需要解决一个：对自己好一点。',
  '开门见山——逆位{cardName}在"{posName}"不是否定你，是在否定你目前的做法。{elDesc}同样的方向、同样的努力，换一种方式去做，效果会完全不同。{templateRef}不是换目标，是换策略。一个微调可能比十次冲锋更有效。',
  '要点就两个：第一，逆位{cardName}在"{posName}"说明当前有阻力，但不是死路。第二，{elDesc}{templateRef}不要被暂时的"不顺"吓到——牌面的逆位能量从来不是永久的，它只是提醒你先看清脚下的路再跑。',
];

// ── 变体F：画面展开式（描绘牌面→映射处境→启示）──
const VARIANT_F_UPRIGHT = [
  '闭上眼睛想象一下：正位{cardName}的画面在"{posName}"的位置上缓缓展开。{elDesc}画中的每一个细节都在呼应你的处境——特别是{keywordsClause}这个关键词，它几乎就是在说你这段时间以来一直想说但没说出口的那句话。{templateRef}这幅画面不是凭空画出来的，它是用你自己的经历做的底稿。',
  '如果把"{posName}"比作一个舞台，正位的{cardName}就是现在站在聚光灯中央的那一幕。{elDesc}{traitClause}是你这场戏的主题——不是别人的剧本，是你自己写的。{templateRef}帷幕已经拉开了，观众不多——其实也不需要观众，台下有你未来的自己就够了。',
  '正位{cardName}在"{posName}"的画面感是这样的：你在一条林荫道上走，前面有光，路面是干的，脚步声很稳。{elDesc}两边的树还在，但挡不住前面的路——它们只是风景，不是障碍。{keywordsClause}——每一步踩下去都是实的。{templateRef}多好的一段路。',
  '画面上：{cardName}正位，"{posName}"——像清晨六点，天刚亮，街上还没什么人，空气清冽。{elDesc}这是一天里最安静也最有可能性的时刻。{templateRef}没有噪音、没有催促，只有你和你想做的事。珍惜这份清明——不是每个阶段都这么通透的。',
  '想象{cardName}正位在"{posName}"，像一张拍得很好的照片——焦距对得准，光线刚好，构图你自己满意。{elDesc}你在按下快门的那一刻可能都没想太多，只是觉得"这个角度对了"。{templateRef}现在回头看，那个直觉太准了。继续凭这个感觉拍下去。',
];

const VARIANT_F_REVERSED = [
  '想象一下逆位{cardName}的画面在"{posName}"位置——像一幅画挂歪了，不是画不好，是没摆正。{elDesc}画里的内容还在——那些你想达成的、想表达的、想靠近的——都还在。只是你得先把它扶正。{templateRef}扶正了以后你会发现，这幅画其实是你最喜欢的那一幅。',
  '逆位{cardName}在"{posName}"的"画面": 你在一个回廊里，前后的路都是通的，但你停在中间，不知道该往哪边走。{elDesc}其实无论往哪边走都能走出去——这个回廊没有死胡同。{templateRef}卡住你的不是路，是"选错怎么办"的恐惧。就算选错了，回廊的设计就是让你随时可以转身——不是死路，怕什么。',
  '把"{posName}"上的逆位{cardName}想象成一个暂时逆风的航段。{elDesc}风是逆的——船没坏，帆没破，船长也没迷失方向，只是需要调整一下帆的角度。{templateRef}逆风航行的水手比顺风的学得更多。这段经历不是白费的，它在教你风从不同方向吹来时该怎么应对。',
  '逆位{cardName}在"{posName}"，画面像一个还没调好音的古琴——弦都在，木头也很好，但弹出来总觉得哪里不太对。{elDesc}不是琴不好，是调音的人还没找到那个准的音。{templateRef}调音需要时间和耐心——一根弦一根弦来，急什么。',
  '画面上逆位{cardName}在"{posName}"——黄昏，天色暗得很快，路灯还没亮。{elDesc}一天里面总有那么一小段时间是"看不清"的，这不等于夜盲——只是眼睛需要一点时间适应光线的变化。{templateRef}等路灯亮了，一切照旧。这段短暂的"看不清"没有你想象的那么重要。',
];

// ── 变体G：位置切入式（从位置含义出发→引出牌→融合）──
const VARIANT_G_UPRIGHT = [
  '"{posName}"——这个位置本身就在问问你：你准备好了吗？正位{cardName}的出现等同于一个响亮的"准备好了"。{elDesc}在这个特定的位置上，{cardName}的含义变得格外具体：{keywordsClause}不再只是一组词，而是你现在在这个层面最真实的动向。{templateRef}位置和牌形成了一种难得的默契——像是锁和钥匙刚好对上了。',
  '先说"{posName}"这个位置本身——它在整个牌阵中的角色，是你整个问题中最需要被看见的那一面。而正位{cardName}恰好把这一面照亮了。{elDesc}{traitClause}在这个位置上有一种"恰如其分"的舒适感——不是强求来的，是刚好对上了。{templateRef}这种"刚好"不是运气，是你之前的积累把路铺到了这里。',
  '"{posName}"这个位置问的是"什么在推动你"。正位{cardName}的回答很干脆：{keywordsClause}。{elDesc}推动你的不是焦虑、不是压力、不是别人在看着——是你自己心里那团还没灭掉的小火苗。{templateRef}它是你的燃料。别让任何人（包括你自己）告诉你这团火不重要。',
  '很多人在看"{posName}"这个位置的时候会忽略一件事：它关心的不是你"应该"怎么样，而是你"真正"怎么样了。正位{cardName}在这里，说明你真实的状态比你表现出来的要好。{elDesc}{templateRef}你不需要向任何人证明——你只需要对自己承认：我比看起来更准备好。',
  '"{posName}"——把它想象成这次解读的"枢纽位"。正位{cardName}选了这个位置不是随机的，它要告诉你的是：{keywordsClause}这几个字，是你解开整个局面的钥匙。{elDesc}别的牌提供线索，这张牌提供方向。{templateRef}把注意力放在这个位置上——它是今天整副牌里最值得用心听的声音。',
];

const VARIANT_G_REVERSED = [
  '"{posName}"这个位置常常被误解——它要展现的不是"你做到了什么"，而是"你在经历什么"。逆位{cardName}在这里，经历的是一个"过渡期"。{elDesc}过渡期最磨人的一点是：你觉得自己应该已经在下一站了，但车还没到。{templateRef}不是车的问题——是时刻表本来就和你想的不一样。你不需要道歉，不需要解释，只需要等那班属于你的车。',
  '"{posName}"在问你一个很具体的问题：在这个层面，是什么在挡着你？逆位{cardName}的回答同样具体：是你自己给自己的那些"等我准备好了再说""再做充分一点""万一不行呢"。{elDesc}{templateRef}这些想法出发点是好意，但它们把你困在一个"一直在准备但从未开始"的循环里。打破它，不需要完美的准备——只需要一个不太完美的开始。',
  '"{posName}"——这个位置关心的是你不想让别人看见的部分。逆位{cardName}把它翻了出来，不是要让你难堪，是要让你看到：那些你以为"拿不出手"的东西，其实没那么可怕。{elDesc}{templateRef}把灯打开——你会发现，角落里的"怪物"只是堆起来的衣服。',
  '来看"{posName}"这个位置——它在整个牌阵里扮演的是"镜子"的角色。逆位{cardName}照出来的，是一个最近有点累、有点怀疑、有点想躲起来但又知道自己不能躲的你。{elDesc}累了是真的累了，但不是永远。{templateRef}这面镜子不完美，但它是诚实的。诚实比完美重要。',
  '"{posName}"位置的核心问题是："你在这个层面最真实的感受是什么？"逆位{cardName}说出了你不太想承认的答案：有一点点搁浅的感觉。{elDesc}搁浅不是沉船，只是暂时被潮水搁在了沙滩上。{templateRef}等潮水涨回来，自然就浮起来了。不用把自己撬起来，省省力气。',
];

// ── 变体H：故事叙述式（微故事→类比牌意→点题）──
const VARIANT_H_UPRIGHT = [
  '讲个真实的事：有个朋友去年在类似的情境下抽到了{cardName}正位——也是在"{posName}"这个位置。她当时也半信半疑，觉得"一张牌能说明什么"。半年后她跟我说：那张牌说的每一个字都中了。{elDesc}不是塔罗有多神，是当人真的准备好往前走的时候，连抽到的牌都会指向对的方向。{traitClause}——她靠的就是这个。{templateRef}你现在也一样。',
  '之前在咖啡馆看到一个女孩在翻塔罗书，翻到{cardName}正位那页，她小声说了句"这张怎么这么好"。我当时没告诉她：这张牌确实好，但"好"不是因为它画得漂亮——是它刚好对上了那些已经准备好的人。{elDesc}"{posName}"位置上的这张牌，说明你就是那个"已经准备好的人"。{keywordsClause}——不是牌给你的，是你自己攒的。{templateRef}翻到哪一页不重要，重要的是你已经在故事里面了。',
  '想起一句话："最舒服的状态不是一切顺利，而是你知道自己在轨道上。"正位{cardName}在"{posName}"，说的就是这个。{elDesc}{traitClause}就是你的轨道——不是别人给你铺的，是你自己轧出来的。{templateRef}在轨道上的感觉不是每天都激动人心，但它有一种踏实的笃定。你需要好好体会这种笃定——它比短暂的开心更珍贵。',
  '认识一个特别喜欢在重要决定前抽塔罗的朋友——她说不是为了求答案，而是为了确认自己心里那个声音是对的。正位{cardName}在"{posName}"，就是她说的那种"确认"。{elDesc}{templateRef}那个你说不出口但一直能感觉到的小声音——对，就是它。你心里其实一直有个导航在轻声说话，最近这段日子尤其准。别把它当错觉。',
];

const VARIANT_H_REVERSED = [
  '想起一个朋友跟我说的：她之前也觉得一切都卡住了，几乎每天都在跟自己说"我不行了"——直到有一天她意识到，自己不是"不行了"，而是"太行了"——行到什么都想同时做好，结果每件事都只做了一半。逆位{cardName}在"{posName}"很像这个状态。{elDesc}{templateRef}与其同时推三扇门，不如选一扇全力推开。卡住你的不是能力——是分散了太多注意力。',
  '我认识一个人，她曾经花了好几年对同一件事反复纠结——不是没办法行动，是每次想行动的时候，逆位的能量就让她往回缩。直到有一天她跟我说：我终于明白，我缺的不是勇气，是"允许自己搞砸"的底气。逆位{cardName}在"{posName}"——这句话也送给你。{elDesc}{templateRef}先允许自己不那么完美，然后你会发现：完美的标准本来就不存在，是你自己一直拿它来为难自己。',
  '讲个比喻：有个木匠做了一张桌子，做到一半的时候怎么看怎么丑，想拆了重来。他师傅说"你先做完"。他忍着把桌子做完了——结果发现，成品的桌子不但不丑，还特别稳当。逆位{cardName}在"{posName}"——你就是那个做到一半想拆桌子的木匠。{elDesc}{templateRef}先做完。做完之前不要评价。',
  '有个人在旅途中迷路了，在原地转了二十分钟，后来干脆坐下来吃了个三明治。吃完之后抬头一看，发现路标就在他刚才站的位置后面——因为一直低着头看手机地图，根本没抬头看过。逆位{cardName}在"{posName}"——你可能也是那个一直看手机的人。{elDesc}{templateRef}抬头。路标就在你来的那个方向。你一直有方向感——只是忘了看路标。',
  '曾经听过一句话说得特别对："困住我们的往往不是墙，而是我们自己以为墙在那里。"逆位{cardName}在"{posName}"就是在让你重新检查一下那堵"墙"：它是真的，还是你大脑里的一个假设？{elDesc}{templateRef}有时候，退后两步再跑，不是为了撞穿那堵墙——是为了发现旁边一直有一扇门。',
];

// ── 所有直立/逆位变体汇总 ──
const ALL_VARIANTS_UPRIGHT = {
  A: VARIANT_A_UPRIGHT, B: VARIANT_B_UPRIGHT, C: VARIANT_C_UPRIGHT,
  D: VARIANT_D_UPRIGHT, E: VARIANT_E_UPRIGHT, F: VARIANT_F_UPRIGHT,
  G: VARIANT_G_UPRIGHT, H: VARIANT_H_UPRIGHT,
};
const ALL_VARIANTS_REVERSED = {
  A: VARIANT_A_REVERSED, B: VARIANT_B_REVERSED, C: VARIANT_C_REVERSED,
  D: VARIANT_D_REVERSED, E: VARIANT_E_REVERSED, F: VARIANT_F_REVERSED,
  G: VARIANT_G_REVERSED, H: VARIANT_H_REVERSED,
};
const VARIANT_IDS = ['A','B','C','D','E','F','G','H'];

// ═══════════════════════════════════════════════════════
// Prompt 构建
// ═══════════════════════════════════════════════════════

function buildSystemPrompt() {
  return `你是一位温暖、有洞察力的塔罗解读师。你的语言风格像深夜两个朋友在阳台聊天——口语化但不随便，深刻但不故作高深，平实、真诚、贴近现代生活。
你的语气应该像真人在微信上回复朋友——不加修饰、不端架子、不用"解读式"腔调。可以偶尔说"这么说吧……""其实就一句话……""你听我说……"这种随口聊天式的衔接。用最日常的方式说最准确的话。
你用"你"来称呼询问者，语气温暖自然，不使用"业力""因果""能量场"等玄学术语。
你可以偶尔说"其实说白了就是……""你可能会在心里犯嘀咕……""换个角度想想……"这种自然的口头衔接。允许自己用生动的比喻和生活的画面来翻译牌面——比如不说"能量受阻"，而说"像开车一直踩着刹车"。

解读原则：
1. 以用户的具体问题为核心，给出直接、真诚的回应。每张牌的 reading 必须回应用户的具体问题——如果用户问"他想我吗"，所有牌都要围绕"对方的真实心意和行动动向"来解读，而不是泛泛地讲牌面能量。用户问什么，牌就答什么，不要跑题。
1.5. 【封闭问题直接回答】对于可以用"是/否""会/不会""有/没有""该/不该"回答的问题（如"他想我吗""会复合吗""该放手吗""TA喜欢我吗"），必须先用一句话给出明确判断——直接说"会""不会""是的""不是的""有的""没有""该""不该"——然后再展开解读。不要用"可能""也许""要看情况""一方面……另一方面……"来回避直接回答。塔罗既是镜子也是路标——面对简单直接的问题，先给简单直接的回应，再讲为什么。
2. 结合牌阵位置理解每张牌的含义，解读要贴合该位置的意义
3. 正位代表顺势能量，逆位代表需要关注的课题
4. 找到牌与牌之间的关联，给出连贯叙事
5. 即使牌面有挑战，也要给出建设性的行动建议
6. 不使用任何方括号标记（如[某某]）、不使用英文标签或协议语言
7. 每张牌的解读要具体、个性化，结合牌的关键词和位置含义展开，写出有温度的文字
8. 【句式多样化】每张牌的 reading 必须使用不同的句式结构。如果第一张牌以"这张牌显示……"开头，第二张就不能用同样的开头方式。交替使用以下开头方式：描述性叙述、设问句式（"你有没有发现……""你是否感觉到……"）、隐喻表达（"这张牌像……"）、直接对话式（"你……"开头）、场景描写式开头、先点出位置再引牌意。禁止同一个解读中出现雷同的段落结构——每张牌的 reading 应该像不同视角的人在说话：有人娓娓道来，有人一针见血，有人先用一个意象开场，有人直接切入重点。
9. 【词汇丰富多变】同样的意思用不同的词表达。形容"好"可以用：温暖、明朗、通透、顺遂、流畅、欣慰、妥帖、踏实、敞亮、舒展；形容"难"可以用：吃力、卡顿、胶着、滞涩、沉重、拧巴、煎熬、徘徊。根据每张牌的牌性和位置挑选最贴切的词，不要反复使用同一套形容词。
10. 【禁止模板化】不要在每张牌的 reading 中使用相同的段落骨架（如每张牌都是"X牌出现在Y位置→说明Z→建议W"）。每张牌的组织逻辑应该有所不同：有的先讲牌面意象再联系处境，有的先描述你的心理再引入牌的含义，有的一开始就给判断再倒推原因，有的用一个生活场景类比来展开。
11. 【元素语言质感】根据牌的元素选择语言质感：火元素牌用有冲劲和行动感的语言（破局、点燃、驰骋、果断、一跃而起）；水元素牌用柔软流动的语言（浸润、预感、释然、暗涌、顺流而下）；风元素牌用清晰理性的语言（梳理、穿透、思辨、豁然开朗、拨云见日）；土元素牌用沉稳务实的语言（扎根、耕耘、积淀、厚实、一步一个脚印）。
12. 【大牌与小牌的语气区分】大阿卡纳的解读要有分量感和人生格局感——它们触及的是命运级别的主题，可以谈得深一些、远一些。小阿卡纳的解读要有生活感和具体感——它们关乎日常的细节和当下的选择，用更日常化的语气来写。

必须返回严格的 JSON 格式（不含 markdown 代码块标记）：
{
  "one_liner": "用一句话（50字以内）直接回答用户的问题。如果用户问的是封闭问题（会不会/有没有/该不该），给出明确的一字判断+简短理由，如"有的，他确实在想你——今天牌面全部正位"。如果是开放式问题，给出最核心的洞察，如"接下来的三个月是你的上升期，不要因为暂时的慢而怀疑方向"。语气像朋友随口说出的一句话——不端、不绕、不说教。",
  "cards": [
    {
      "name": "牌名",
      "position": "位置名称",
      "isReversed": true或false,
      "reading": "对该牌在当前位置的深度解读，150-300字。要具体、个人化，融入牌的关键词含义和位置意义。使用温暖的中文，从该位置的角度去感受和表达。注意：每张牌的 reading 句式结构必须与其他牌不同，不要套用相同模板。"
    }
  ],
  "full_text": "完整的格式化解读全文。严格按照以下格式输出：\\n\\n{牌阵名}完整深度解读（问题：{用户问题}）\\n\\n一、分牌拆解：核心心意&现状\\n\\n1. {位置名}｜{牌名} {正位/逆位}\\n{该牌的完整解读，即上面cards中对应的reading内容}\\n\\n2. ...（每张牌都如此列出，序号从1递增）\\n\\n二、综合回答核心问题：{用户问题}\\n{首先给出明确判断（对于封闭问题），然后展开100-200字的温暖真诚回答。不要绕圈子，正面回应用户最关心的问题。}\\n\\n三、整体牌面总结&行动建议\\n1. 全局基调：{牌面整体氛围和能量走向的一句话总结，点出关键趋势}\\n2. 针对性建议：\\n   • {具体可操作的建议1}\\n   • {具体可操作的建议2}\\n   • ...（3-5条具体建议）\\n\\n注意：full_text 中绝对不要使用方括号、英文标签、或任何协议语言。全文使用温暖自然的中文。章节标题用中文数字（一、二、三）。每张牌的解读直接跟在牌名后面，不要加额外的标签或标记。"
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
  // Track used structural variants to ensure each card uses a different structure
  const usedStructures = [];
  const enhancedCards = cards.map((c, i) => {
    const reading = buildEnhancedCardReading(c, cards, userQuestion, usedStructures, i);
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

  // ── Generate one-liner ──
  const oneLiner = buildOneLiner(cards, userQuestion);

  return {
    cards: enhancedCards,
    overallMood,
    dominantElement: dominantEl,
    reversalCount: revCount,
    majorCount,
    summary: fullText,
    oneLiner,
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

// ── Question context helper: ties generic card reading back to user's specific question ──
function buildQuestionContext(userQuestion, posName, isRev) {
  if (!userQuestion || userQuestion.length < 3) return '';
  const q = userQuestion;

  // Relationship / feelings questions
  if (/想|想念|惦记|思念|牵挂|想起/.test(q)) {
    const pool = [
      `所以回到你最关心的问题——TA有没有在想你：这个位置给出的线索值得你认真看看。`,
      `把这个位置的信号和你问的"想不想"联系起来——答案藏在这些细节里。`,
      `就"TA在想你吗"这个问题来说——${posName}这张牌说的其实很直接了。`,
    ];
    return pick(pool);
  }
  if (/复合|回来|回头|和好|挽回/.test(q)) {
    const pool = [
      `对于"能不能复合"这件事——${posName}这个位置的信息挺关键的。`,
      `把这张牌放在你问的复合问题上来看，线索比想象中清晰。`,
    ];
    return pick(pool);
  }
  if (/喜欢|爱|好感|心动|在意/.test(q)) {
    const pool = [
      `回到你问的"TA喜不喜欢我"——${posName}位置的信息，你好好感受一下。`,
      `这份解读套在你问的感情问题上，是不是有不少地方对得上？`,
    ];
    return pick(pool);
  }
  if (/工作|事业|跳槽|面试|升职|辞职/.test(q)) {
    const pool = [
      `把这张牌的提示放在你的事业问题上——${posName}这个角度值得多想一步。`,
      `工作上你问的事——这个位置给出的方向，可以参考。`,
    ];
    return pick(pool);
  }
  if (/学业|考试|学习|复习|考研/.test(q)) {
    const pool = [
      `对你问的学业问题来说——${posName}这张牌的提示挺实用的。`,
      `学习和考试的事——${posName}的线索你可以直接用到接下来的计划里。`,
    ];
    return pick(pool);
  }
  if (/放手|放弃|坚持|等|值得|该不该/.test(q)) {
    const pool = [
      `对于你心里纠结的那个"该不该"——${posName}的信息值得多琢磨一下。`,
      `把你犹豫的那个决定放在这个位置上看——牌面其实在给你方向。`,
    ];
    return pick(pool);
  }
  // Generic
  const pool = [
    `回到你最初的问题——${posName}这个位置的信息，就是牌面对你最直接的回应之一。`,
    `把你的问题和${posName}的这张牌放在一起看——线索自己会浮现。`,
  ];
  return pick(pool);
}

function buildEnhancedCardReading(card, allCards, userQuestion, usedStructures, cardIndex) {
  const posName = card._posName;
  const cardName = card.name_zh;
  const isRev = card._isRev;
  const keywords = (card.keywords_zh || []).slice(0, 3).join('、');
  const arcana = card.arcana; // 'major' or 'minor'

  // Get the card's template reading for optional reference
  const templateText = isRev
    ? ((card.reversed && card.reversed.general) || '')
    : ((card.upright && card.upright.general) || '');
  const templateRef = templateText
    ? `牌面记载的含义提到「${templateText.slice(0, 50)}${templateText.length > 50 ? '…' : ''}」——这和你当下的处境有某种微妙的呼应。`
    : '';

  // Element description (upright vs reversed sense)
  const vocab = elVocab(card);
  const elDesc = isRev ? vocab.reversedDesc : vocab.uprightDesc;
  const traitClause = (isRev ? '你骨子里的' : '') + pick(vocab.traits);

  // Keywords clause — vary formatting
  const kwFormats = [
    `"${keywords}"——这几个词`,
    `牌面的关键词「${keywords}」`,
    `你的核心词——${keywords}——`,
    `${keywords}`,
    `关键词${keywords}`,
  ];
  const keywordsClause = pick(kwFormats);

  // Pick a structural variant NOT already used in this reading
  const availableIds = VARIANT_IDS.filter(id => !usedStructures.includes(id));
  const variantId = availableIds.length > 0
    ? availableIds[Math.floor(Math.random() * availableIds.length)]
    : VARIANT_IDS[Math.floor(Math.random() * VARIANT_IDS.length)]; // fallback: reuse if exhausted

  usedStructures.push(variantId);

  // Select template pool
  const pool = isRev
    ? (ALL_VARIANTS_REVERSED[variantId] || VARIANT_A_REVERSED)
    : (ALL_VARIANTS_UPRIGHT[variantId] || VARIANT_A_UPRIGHT);

  // Pick a random template
  const template = pool[Math.floor(Math.random() * pool.length)];

  // Fill in the template
  let reading = template
    .replace(/\{cardName\}/g, cardName)
    .replace(/\{posName\}/g, posName)
    .replace(/\{elDesc\}/g, elDesc)
    .replace(/\{keywordsClause\}/g, keywordsClause)
    .replace(/\{templateRef\}/g, templateRef)
    .replace(/\{traitClause\}/g, traitClause)
    .replace(/\{keywords\}/g, keywords);

  // Add major arcana weight note occasionally (not always, to avoid repetition)
  if (arcana === 'major' && cardIndex !== undefined && cardIndex % 3 === 0) {
    reading += ' 这张大阿卡纳的出现提醒你：这件事在你的生命里，分量比你意识到的要重。';
  }

  // ── Question-specific context (tie reading back to user's question) ──
  if (userQuestion && userQuestion.length > 2 && cardIndex !== undefined && cardIndex % 2 === 0) {
    const qCtx = buildQuestionContext(userQuestion, posName, isRev);
    if (qCtx) reading += ' ' + qCtx;
  }

  return reading;
}

function buildEnhancedDirectAnswer(cards, userQuestion) {
  const revCount = cards.filter(c => c._isRev).length;
  const totalCards = cards.length;
  const majorCards = cards.filter(c => c.arcana === 'major');
  const question = userQuestion || '你的问题';

  // ── Expanded question type detection ──
  const isMissingYou = /想|想念|惦记|思念|牵挂|想起|在心里|想我|想他|想她/.test(question);
  const isReconciliation = /复合|回来|回头|和好|挽回|重新开始|回到一起/.test(question);
  const isShouldGiveUp = /放手|放弃|继续|坚持|等|值得|该不该|要不要等/.test(question);
  const isHasFeelings = /喜欢|爱|好感|心动|在意|有感觉|对我|对他|对她/.test(question);
  const isFuture = /未来|以后|会|能|可以|有没有机会|还有可能|会不会/.test(question);

  let answer = '';

  if (revCount === 0) {
    // ── All upright: strong positive signal ──
    if (isMissingYou) {
      const pool = [
        '有。而且不止是"顺便想起"，是带着温度和画面感的那种想。全部正位的牌面在这一点上非常一致——对方心里有你，想起你的频率可能比你猜测的还要高。只是他目前不太会把这种想念说出口，行动上看起来偏安静，但心里是热的。',
        '有的。今天的牌很清楚——他在想你。人在独处的时候最容易走神想到那些在意的人，你就是其中之一。但他的表达欲和想念并不成正比，心里有十分，嘴上可能只说三分。不用怀疑自己在他心里的分量，牌面已经给了明确的回答。',
        '会的，他有在想你。全正位的牌阵非常少见，它几乎就是在说：你惦记的这个人，也在用他的方式惦记你。方式可能不是你喜欢的那种——不是热烈的、直白的、冲动的——但想念本身是真实的。有时候想念不一定是马上要联系你，他可能只是在某个瞬间停下来，脑海里浮现了你的样子。',
        '说实话：是的。今天全部正位的牌阵本身就是少见的——它代表着一种清澈的、没有阻力的确认。在"他有没有想你"这个问题上，答案是肯定的。只是他心里想的和手上做的之间有距离——不是不想联系，是有他的顾虑和节奏。你不需要催，信号是好的。',
        '对，他想你。牌面很直接。今天没有任何一张牌是逆位的，这意味着在这个问题上几乎没有阻碍——他想起你的时候心里是舒服的、温暖的。你别看他不怎么主动——那只是他的习惯，不是心不在焉。',
      ];
      answer = pick(pool);
    } else if (isReconciliation) {
      const pool = [
        '有机会。全正位牌阵说明你们之间还有很深的连接，不是能轻易断掉的。但复合不是"回去"——是两个人都在往前走的时候，恰好又在同一条路上遇见了。现在需要做的不是去追问"能不能"——是各自先把自己照顾好，缘分还在。',
        '会的，牌面显示你们之间的线没有断。全部正位的能量非常顺畅——但顺畅不等于快。复合需要时间，需要两个人都在各自的生活里找到稳定的节奏。当你们都在对的状态里的时候，重逢是自然的。现在的重点是：先照顾好今天。',
      ];
      answer = pick(pool);
    } else if (isHasFeelings) {
      const pool = [
        '有的。牌面很直接——正位的能量流畅，说明这份喜欢不是单方面的。也许对方表达得不够明显，但心意是真实的。你不用反复猜——你的直觉没有骗你。',
        '是的，牌面全部正位——对方对你是有好感的。他的在意方式可能比较低调，不轰轰烈烈，但这不代表不在意。有些人的喜欢是深水缓流，表面平静，底下暗涌不断。',
        '有感觉。全正位的牌阵很少见，它给的正向确认是明确的。只是好感和他会不会主动是两回事——他心里有小火苗，但他可能还在观望、等一个"对的时机"。你不用替他点着火——保持你现在的样子就好。',
      ];
      answer = pick(pool);
    } else if (isFuture) {
      const pool = [
        '会的，牌面全部正位，信号非常清晰。你问的这件事，大方向是通的。当前的能量在推着你往前走，不需要额外的推力——你就顺着现在的感觉走下去就行。',
        '能的。今天全部正位——在你的牌面里"能不能"已经被回答了：能。不需要绕弯子。接下来的重点不是"能不能"，而是"怎么让这件事发生得更好"——你已经站在对的起点了。',
        '可以的。正位的牌阵像绿灯——不是在"考虑中"，不是在"还要再看看"——是明确的"可以走"。你不会错过这个机会的，保持现在的状态。',
      ];
      answer = pick(pool);
    } else {
      const pool = [
        `牌面全部正位，关于"${question}"，答案总体积极。你所关注的方向是对的，当前能量顺畅，不需要过度焦虑。保持现在的节奏，答案会在对的时机自然显现。`,
        `全正位牌面——对你问的这件事来说，是个好信号。牌面在说：在意的方向是对的，推动的力量也是够的。接下来是"做"的阶段，不是"想"的阶段。`,
        `今天的牌对"${question}"给出了正向回应。没有逆位意味着没有隐藏的阻力——事情的走向和你心里的期待大致同频。顺势而为，不要多想。`,
        `好消息：牌面全部正位。对你最关心的这件事来说，势头是对的。你不需要重新想一遍方向，也不需要推翻之前的判断——执行就好。`,
      ];
      answer = pick(pool);
    }
  } else if (revCount <= totalCards / 2) {
    // ── Mixed: positive with caveats ──
    if (isMissingYou) {
      const pool = [
        '有在想，只是没有你想要的那么浓烈和频繁。他目前的状态偏观望——心里有惦念，但行动力跟不上。你在热烈地感应，他在慢半拍地接收。这份想念本身是真的，但他的表达方式天然偏克制——不是不喜欢，是他的反应速度比你慢。',
        '有的——但方式和时机可能和你想的不一样。他在一天里会有那么几个瞬间忽然想到你：听到一首歌、路过一个地方、看到手机里的某张照片。只是这些瞬间他不太会告诉你，不是因为不看重，而是他觉得"特意说"有点别扭。',
        '在想，但这份想念目前还有点"沉"。他可能正经历自己的事情，有压力、有分心、有自己的节奏要调。他在想你——但还没到"因为想你所以要做点什么"的程度。这份想念需要一点时间才能浮到水面上来。',
        '是的，有。但牌面的提示是：别太纠结"有多少"和"多频繁"。他想你的方式和你想象的方式可能有错位——你是"想你了就想跟你说"，他是"想你了但先把手头的事做完"。这不是不在乎，是风格不同。',
        '有的，他确实会想起你。不过今天的牌面也提示：这份想念现在还在他心里的"后台"运行——不是前台最显眼的那个程序，但也没被关掉。等他的"前台"清静一些的时候，这份想念会自动弹出来。',
      ];
      answer = pick(pool);
    } else if (isReconciliation) {
      const pool = [
        '有可能，但需要耐心——牌面显示两人之间还有连接，只是目前双方的节奏不太一致。复合不是"回去"，是"重新走向彼此"。眼下比较关键的是：把"等对方"的注意力收一部分回来，先让自己稳下来。',
        '有机会，但不是在"立刻"的时间表上。牌面的正逆混合说明：缘分还在，但目前两个人都还有一些自己的课题要处理。等各自都稳了，重逢会是一个自然的事，不是强求来的。',
      ];
      answer = pick(pool);
    } else if (isShouldGiveUp) {
      const pool = [
        '不急着放弃，但需要重新审视。牌面提示：问题的关键不是"对方值不值"，而是"你自己在这段等待里舒不舒服"。如果等的过程已经严重消耗你了——那缓一缓是完全正当的选择。不用给自己贴"放弃"的标签，你只是在重新分配精力。',
        '牌面给出了混合信号——不建议现在做"彻底放弃"的决定。但可以做一个调整：把"等TA"的时间分一半出来，放在自己身上。等一个月，再看看自己的感受有没有变化。那时候做的决定，会比现在更准。',
        '该降低期待的等级，但不等于彻底关掉希望。牌面说：继续等可以，但不需要站在门口等——你可以回到屋子里做自己的事，让门开着就行。真有缘的人，会敲门。',
      ];
      answer = pick(pool);
    } else if (isHasFeelings) {
      const pool = [
        '有好感的，但他目前没有准备好要"做什么"。牌面的正逆混合暗示：他可能也在观察、在琢磨，只是表达欲还没跟上来。你不用急着索取一个"态度"——有些人的好感像小火慢炖，需要时间。',
        '有的，但程度可能还没到你期待的那种"明确到能让你放心"的地步。牌面提示：他的好感还在积累期，还没到"忍不住要表达"的沸点。你可以继续做自己，不需要因为他的"暂时不清不楚"而怀疑自己的判断。',
        '对，他对你有感觉。但这段感觉目前还被他自己的某些顾虑盖住了一部分——可能是工作、可能是过去的事、可能只是他本身就不是个善于表达的人。好感是真的，噪音也是真的。耐心一点，噪音会过去的。',
      ];
      answer = pick(pool);
    } else if (isFuture) {
      const pool = [
        '能，但节奏比你预期的要慢一些。牌面的正逆混合说明：方向没错，路上有几段需要减速。慢不是坏事——有些事太快了反而容易漏掉重要的步骤。该来的会来，在它来之前，先踏实走好脚下的路。',
        '会的——但不是"马上"，而是"需要一点时间"。牌面正位主导，大方向没问题。那些逆位的牌只是在提醒：有些细节还没到位，等它们到位了，事情会自然推进。',
        '可以的。正位的能量在牌阵里占多数，说明这件事的底盘是稳的、方向是对的。中间的逆位牌提示你在某些点上需要多一点耐心——但这不是拒绝，是"等一下"。',
      ];
      answer = pick(pool);
    } else {
      const pool = [
        `牌面整体向好，关于"${question}"，信号总体积极。只是有${revCount}张逆位牌提示：节奏上可能需要稍微等一等，有些细节会自己慢慢对齐。方向没问题——保持耐心就好。`,
        `正位的能量是主旋律，关于"${question}"的回答倾向于肯定。只是牌面也提醒：过程中还有一些需要调整的地方。一边走一边微调——不需要停下来，只需要慢一点。`,
        `好消息是牌面的正向信号很明确。关于"${question}"——牌面说：有回应的，只是还没有到"一切明朗"的阶段。别在这个半透明的阶段做太重大的判断。等雾再散一散。`,
        `牌面对"${question}"的判断是：总体看好，但有条件。条件就是——你需要在等待的过程中稳住自己的情绪节奏。不要在"应该快了"和"会不会没戏"之间反复横跳。信牌面，也信自己的定力。`,
      ];
      answer = pick(pool);
    }
  } else {
    // ── Mostly reversed: caution ──
    if (isMissingYou) {
      const pool = [
        '不太有，或者说程度比你期待的要低很多。今天的牌面逆位居多，信号是：对方目前更多沉浸在自己的世界里，不太有空间去频繁地想念另一个人。这不代表你在他心里不重要——只是他现阶段的状态偏内收，注意力都在自己身上。与其花时间猜测他的心意，不如把这份注意力收回你自己。',
        '坦白说，比较少。他现在的心思被其他事情占满了——工作、压力、自己的状态——这些让他暂时没有多余的心力去频繁地想念你。这不是你做错了什么，也不是你不够好——这是他的"现在"和你期待的"现在"不在同一个频道上。',
        '说实话：没有你想他那么多。逆位偏多的牌面往往在说：对方目前处于一个比较封闭的状态，自己的情绪还没理清楚，不太有余力向外传递想念。但这只是阶段性的——人不会永远待在自己的壳里。在等他走出来之前，先把自己的日子过好。',
        '信号偏弱。他可能偶尔会想起你——但那种"想"转瞬即逝，不够强烈，不够持久，不够让他采取行动。接受这个事实可能会有点不舒服，但越早接受，越早可以从"猜他在想什么"的消耗里走出来。你值得一个不需要猜的答案。',
        '不会像你期待的那样频繁和确定。今天的牌阵逆位偏多，说明在这个问题上阻力大于畅通。对方目前的状态不支持"深情想念"这件事——不是对你，是他对所有事情的投入度都在降低。把注意力放回自己身上。你需要的不是"他想不想我"的答案——你需要的是一份不依赖于他答案的安全感。',
      ];
      answer = pick(pool);
    } else if (isReconciliation) {
      const pool = [
        '不太乐观——短期内复合的可能性不高。逆位的牌面说明：两人之间有一些还没被正视的问题，或者有一方还没准备好重新开始。这不是永远的判决——但至少在现在这个时间点，"复合"不是最优解。先把精力放在自己身上。',
        '牌面说：目前不是复合的好时机。逆位偏多的信号很真实——旧的问题还没被消化完，这个时候复合只是换一种方式重复过去。你需要的不一定是"回去"——你需要的可能是一次真正的翻篇。翻过去之后，不管是新的开始还是新的故事，都比困在旧的一章里好。',
      ];
      answer = pick(pool);
    } else if (isShouldGiveUp) {
      const pool = [
        '该放手。牌面逆位偏多——这不是一个"再坚持一下就会好"的信号。继续留在这个状态里，你付出的已经超过了你能得到的。放手不是失败——是止损。你有权利停止等待一个不肯出现的人。',
        '该。牌面很少这么直接——但当大部分牌都是逆位的时候，它其实在帮你看清：你抓着不放的执念已经消耗你太久了。放手先痛苦三天，不放手会持续性地隐隐作痛。选那个短痛。',
        '牌面的回答是：该。但不等于"永远不会有结果"——等于"现在这样耗下去没有意义"。把"坚持"和"执着"分开：坚持是知道方向还在往前走；执着是明明路不通还在原地踩油门。你现在的状态更接近后者。松开刹车，先倒出来。',
      ];
      answer = pick(pool);
    } else if (isHasFeelings) {
      const pool = [
        '信号偏弱。牌面逆位偏多，对方的心思现在不在"喜欢"这件事上——不是对你不感兴趣，是对所有需要投入情感的事情都没有余力。这跟你够不够好无关——这是他的"现在"不给力。',
        '没有你期待的那种明确的、热烈的喜欢。可能有一些好感，但这点好感在他目前的优先级列表里排得很靠后。你值得一个更明确的回答——而不是在"好像有一点"和"好像又没有"之间反复猜。',
      ];
      answer = pick(pool);
    } else {
      const pool = [
        `牌面逆位偏多，说明"${question}"这件事当前处于一个需要调整的阶段。这不代表终点——只代表现在还不是最佳时机。把"冲"改成"等"，把"用力"改成"稳住"。周期会流转的。`,
        `对于"${question}"，牌面的信号偏保守。当前有${revCount}张逆位牌提示存在阻力——不是你的问题，而是整体时机还没到位。这会儿不适合硬推，适合退一步看看全局。`,
        `坦白说，"${question}"这件事最近的走势不会特别快。逆位牌多，意味着需要更多时间和耐心。不是否定——是"暂缓"。在暂缓期间，先照顾好自己的节奏。`,
        `关于"${question}"，牌面提示的是：慢下来比冲上去更明智。当前的阻力不是你能硬闯过去的——它需要时间自然化开。给自己一个"暂时不追求答案"的空档。`,
      ];
      answer = pick(pool);
    }
  }

  // ── Add major arcana insight if relevant ──
  if (majorCards.length >= 2) {
    const majorNotes = [
      `\n\n${majorCards.length}张大阿卡纳同时出现——这个问题的分量超出了你自己以为的程度。它触及的不只是"TA在不在乎你"这个表面，而是你更深层的安全感、自我价值和信任的能力。这次占卜的意义可能不在于告诉你一个答案——而在于让你看到：你在乎到了什么程度，而这份在乎本身已经告诉了你很多东西。`,
      `\n\n额外提一句：${majorCards.length}张大牌汇聚——这不是一次普通的占卜。它们提醒你："${question}"这件事对于此刻的你来说不是小事。不管牌面的直接回答是什么——这段经历本身，已经在帮你更靠近一个更清醒的自己。`,
      `\n\n有${majorCards.length}张大阿卡纳在这里——它们在说：别把这个问题看作简单的"是不是""有没有"。"${question}"触碰到了你人生里更深层的某个主题。答案重要，但你在寻找答案的过程中对自己的了解更重要。`,
    ];
    answer += pick(majorNotes);
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
  const elName = elNames[dominantEl] || '';
  const elVocabData = ELEMENT_VOCAB[dominantEl] || ELEMENT_VOCAB.water;

  const tonePool = [];
  if (revCount === 0) {
    tonePool.push(
      `牌面全部正位，能量清澈顺畅，${elName}元素在牌阵中稳定流动。你正处在一个"想做的事刚好和该做的事重叠"的阶段——心中所想与外在走向高度一致。`,
      `没有任何逆位的牌面，说明你当下走在一条相对顺畅的路径上。${elName}元素的力量在背后托着你，顺势而为就是最好的策略。不用力的时候，反而走得最快。`,
      `全正位——${elName}元素的气质是${pick(elVocabData.adjectives)}的。今天牌面的底色是清澈的、确定的。这种"一切都对得上"的感觉不会天天有，好好感受它。`,
      `一片正位，像一扇一扇打开的窗，风是对流的，光是充足的。${elName}元素在这里是顺风而非逆风——你选的方向没有偏航。对这个阶段的你来说，最大的挑战不是"怎么做"，而是"不再怀疑自己"。`,
      `${elName}元素全正位的牌阵——你的直觉和判断力正处在高点。你没看错：你感觉到的事情是真的，你想走的方向是通的。不要因为"太顺利了"而莫名担心——有时候好就是好。`,
      `牌面全正——${elName}元素的能量像一个校准好的指南针。这段时间你对"对错"的感应格外敏锐——相信它。你想做的、你说出口的、你计划的，都踩在一个好的频率上。`,
    );
  } else if (revCount <= totalCards / 2) {
    tonePool.push(
      `牌面整体趋势向好，虽然${revCount}张逆位牌提示了一些需要留意的课题，但正位的能量仍然是主旋律。${elName}元素主导的牌面，带着几分清醒的乐观——你能感受到事情在往对的方向走，只是速度比你预期的慢那么一点。`,
      `${elName}元素的能量在牌阵中占了上风。${revCount}张逆位牌不是在否定你——它们是在帮你标出"需要多看一步"的地方。整体方向没问题，细节上多一分觉察就好。`,
      `牌面正位占主导，${elName}元素的气质是${pick(elVocabData.adjectives)}的。${revCount}个逆位的提醒很小——不足以改变航向，只是让你在往前走的时候多留意一下脚下的石子。`,
      `总体向好——正位牌比逆位多，${elName}元素稳稳地托住了大局。你那${revCount}个"不太顺"的感应在牌面上有对应——但它们不是主角。这一段路，主要是上坡，偶尔有小石子。`,
      `牌面的底色是温的、亮的——${elName}元素让大部分牌保持在正向的区间。${revCount}张逆位牌是在几个特定的角落亮黄灯，不是红灯。前进可以，带着觉察前进就好。`,
      `${elName}元素的能量没有被打散——正位的力比逆位的力大。${revCount}张逆位只是在说：某几个具体的点需要你再想想，调整一下角度。不是停下来，是边走边校准。`,
    );
  } else {
    tonePool.push(
      `牌面逆位偏多，当前确实处于一个需要"向内看"的阶段。${elName}元素的能量提示你：慢下来不是退步，而是为了更好地校准方向。逆位不是锁，是门槛——迈过去需要一点力气，但迈过去之后就是另一个房间。`,
      `虽然逆位牌居多，但这只是阶段性的低谷，不是永久的困局。${elName}元素提醒你——此刻最需要的不是冲刺，而是稳住自己。等这阵风过去，你会发现方向比以前更清楚。`,
      `逆位偏多的牌面——${elName}元素暂时转入了"省电模式"。这不是没电了，是系统在自动优化。这段时间不适合做大动作、大决定、大转向。适合把事情一件一件理好，把节奏调匀。`,
      `${revCount}张牌逆位——${elName}元素此时的气质偏沉，但它沉得下来不代表它弱了。冬天不是"失败"的季节——它是在为春天蓄力。你现在的"慢"和"乱"都是有意义的过渡。`,
      `牌面逆位居多——${elName}元素能量像是在提醒你：有些事暂时没有答案，是因为它还不需要你现在就答。允许"不确定"待一段时间。水到渠成之前，渠还在挖。你已经在挖了。`,
      `今天的牌阵，${elName}元素在逆位区间——但逆位有时比正位更诚实。它不跟你说好听的话，而是把那些你一直忽略的东西摊在台面上。好好看看——这些东西不是你想象中那么可怕。`,
    );
  }

  if (majorCards.length >= 2) {
    tonePool.push(
      `${majorCards.length}张大阿卡纳汇聚——这不是一次普通的占卜。这些大牌在告诉你：你正在经历的这个阶段，在你的整个故事里不会是平淡的一页。不管现在多困惑——回头看的时候你会感谢自己走了这一程。`,
      `提一句：${majorCards.length}张大牌同时出现。它们不是来随便说两句的——它们是来提醒你，你现在面对的事情，比你日常生活中大多数的烦恼都更深、更值得认真对待。你认真了，牌才会认真回应。`,
      `${majorCards.length}张大阿卡纳——你问的这件事，对你来说不是"随便问问"。它蹭到的不是皮毛，是筋骨。这些大牌聚在一起，是想让你重视今天解读里的每一个字。`,
    );
  }

  return pick(tonePool);
}

function buildEnhancedAdviceBullets(cards, userQuestion) {
  const revCount = cards.filter(c => c._isRev).length;
  const totalCards = cards.length;
  const elements = cards.map(c => c.element).filter(Boolean);
  const dominantEl = mostFrequent(elements);
  const advices = [];
  const elName = { fire: '火', water: '水', air: '风', earth: '土' }[dominantEl] || '';

  // ── Core advice based on reversal pattern (richer pools) ──
  if (revCount === 0) {
    const pool = [
      `当前是你顺势而为的好时机——既然牌面全部正位，想做的事情，现在就是开始的最佳时机`,
      `全正位的牌面不多见——趁这股顺风还在，把你最想做但一直没启动的那件事，往前推一步`,
      `不要"再想一遍"——你已经想得够多了。全正位的信号就是告诉你：执行，不是复盘`,
      `如果最近在犹豫要不要迈出某一步——牌面的回答是：迈。现在是迈步的季节`,
      `保持当前的节奏，不要因为外界的声音而改变方向。你的判断力正处在高点`,
      `今天的牌面给你开了一张"通行证"。不是所有日子都像今天这么通——善用它`,
      `现在不适合过度谦虚和过度谨慎——牌面全正，能量在推你，别踩刹车`,
      `把你纠结最久的那件事写下来，今天给它一个答案。不用等到万事俱备`,
    ];
    advices.push(pick(pool));
  } else if (revCount <= 2) {
    const pool = [
      `不必困在反复揣测的内耗里——${revCount}张逆位牌只是善意的"慢一点"提示，不是否定`,
      `${revCount}张逆位牌是在标出"注意脚下"的地方——但路本身是通的，不需要换方向`,
      '与其紧盯着结果有没有到来，不如把这份精力用来滋养当下的自己',
      `正位的牌占了上风——相信大局，不要被${revCount}个逆位的小提示吓到`,
      '把焦虑的事情写下来，一条一条看：哪些是真的问题，哪些是你脑补出来的',
      '有些事需要时间自己发酵——不需要你去搅。暂时按住"马上要答案"的冲动',
      `牌面正位多于逆位——把注意力放在那些正的信号上，它们才是主旋律`,
      '如果你感到犹豫——那就在犹豫中做一件小事。不需要等犹豫消失才开始行动',
    ];
    advices.push(pick(pool));
  } else {
    const pool = [
      '这段时间更适合"向内看"而非"向外冲"——利用这个阶段重新审视自己的方向，给自己一些空间',
      '降低当下对"热烈回应"和"快速解决"的期待，放平心态反而更容易看清事情本来的样子',
      '逆位不是禁行——是"减速慢行"。别停，但也别冲。用平时一半的速度往前走',
      '暂停对外界的追逐，把精力集中在自己能控制的事情上。先稳住核心，周边的事会跟着稳',
      `${revCount}张逆位——这种阶段最怕的不是慢，是急。慢慢来比较快，这句话今天是对的`,
      '如果方向感暂时模糊——不用急着找方向。先站在原地环顾一圈，路标可能就在身后',
      '给自己一个"允许暂时不知道怎么办"的许可。不是所有问题都需要今天给出答案',
      '在逆位居多的阶段，最好的投资是投资自己：休息好、吃好、睡好、把小事做好',
      '找一个你信任的朋友聊聊——有些事说出来之后，你会发现它们没有你的脑子里看起来那么大',
    ];
    advices.push(pick(pool));
  }

  // ── Element-specific advice (richer pool per element) ──
  const elAdvicePools = {
    fire: [
      `${elName}元素赋予你行动力——想到了就去做，不要犹豫。但偶尔也看看地图，别光顾着冲`,
      `${elName}能量在你这边——果断一点，这个月最怕的不是做错，是什么都不做`,
      `${elName}元素说：你今天需要一个"不管了，先干"的瞬间。有些事想三次不如动一次`,
      `你的${elName}能量像一壶刚烧开的水——别让它烧干，也别放着等它凉。趁热做事`,
    ],
    water: [
      `${elName}元素提醒你相信直觉——有些答案不在头脑里，在心里。柔软一点也没关系`,
      `${elName}能量——你的感受力正在敏感模式。今天别人注意不到的事，你会注意到。善用这个天分`,
      `${elName}元素说：不必每一件事都"想清楚"。有些事"感觉到了"就够了`,
      `${elName}的流动感在提醒你——僵持的时候，不需要硬碰硬。迂回、绕开、顺流而下，都是聪明的走法`,
    ],
    air: [
      `${elName}元素给你的礼物是清晰的思维——善用这段时间理清思路，想清楚之后，说清楚也很重要`,
      `${elName}能量活跃——适合做计划、列清单、把脑子里的一团乱麻理成一条一条。理清了就不焦虑了`,
      `${elName}元素提醒：你今天可能想得比平时快，但别因为"想到了"就急着跳下一个念头。一个念头一个坑——挖深`,
      `${elName}的穿透力在帮你——那些之前看不清的事，今天会有一个"哦原来是这样"的瞬间`,
    ],
    earth: [
      `${elName}元素告诉你稳扎稳打就是最好的策略——不需要急，一步一个脚印，你正在打造的是长久的根基`,
      `${elName}的能量——不要被那些"好像别人都比我快"的错觉干扰。你的节奏是对的，快慢不由别人定义`,
      `${elName}元素说：今天适合做一些"不酷但管用"的事。整理、归档、清点、落实——这些小事在为你铺底`,
      `${elName}的稳健在你身上——最近的一个决定，不用急着反悔或推翻。你选的方向经得起时间检验`,
    ],
  };
  const selectedElAdvice = elAdvicePools[dominantEl] || elAdvicePools.water;
  advices.push(pick(selectedElAdvice));

  // ── Question-specific advice (expanded) ──
  if (/想|想念|惦记|思念|牵挂/.test(userQuestion || '')) {
    const pool = [
      '如果忍不住想确认——可以主动抛一个轻松的话题，不用问"想我了吗"。轻松比沉重更容易得到回应',
      '把"他到底在想什么"换成"我今天想做什么让自己开心"。注意力会决定你今天的心情底色',
      '不联系的时候你的想象会填满空白——但你想的往往比真实情况更糟。别让脑补代替事实',
    ];
    advices.push(pick(pool));
  }
  if (/喜欢|爱|感情|关系|在一起/.test(userQuestion || '')) {
    const pool = [
      '多专注自身情绪的稳定——当你不再被对方的态度牵动全部心神，你的状态反而更松弛、更吸引人',
      '关系里最怕的不是"他不主动"，是你把"他主不主动"变成衡量自己价值的标准。这个标准不成立',
      '试着把你的安全感从"他回不回消息"切换到"我今天做了哪些对自己好的事"。这个切换很关键',
    ];
    advices.push(pick(pool));
  }
  if (/复合|回来|回头|和好|挽回/.test(userQuestion || '')) {
    const pool = [
      '先想清楚：你是想回到过去的那个人身边，还是想回到过去那种被爱的感觉。这是两件完全不同的事',
      '如果复合是两个人的决定——那你现在该做的不是求，是让自己成为"值得被重新选择"的状态',
    ];
    advices.push(pick(pool));
  }
  if (/放手|放弃|坚持|等|值得/.test(userQuestion || '')) {
    const pool = [
      '如果一段关系让你持续地"不像自己"——那不是关系，是损耗。你不需要一个理由来离开消耗你的人',
      '坚持和执着之间的那条线——就是你是否还能在每一天里找到平静。如果平静比焦虑少，就该重新评估了',
    ];
    advices.push(pick(pool));
  }

  // ── Position-aware advice (include card names for personalization) ──
  const sampleCard = cards.find(c => c.arcana === 'major') || cards[0];
  if (sampleCard && cards.length <= 5) {
    advices.push(`"${sampleCard.name_zh}"是你今天的核心线索牌——之后一周每次犹豫的时候，闭上眼回想一下这张牌的画面，它会给你的直觉一个锚点`);
  }

  // ── Universal closing ──
  const closings = [
    '牌是灯火，照亮眼前几步路；走向远方的双脚，永远属于你自己',
    '塔罗给了你底稿，执笔的人还是你。不管牌面说了什么——你的选择永远是最后一行',
    '这一把牌看完了。关掉屏幕或放下手机，去过今天。最好的解读不在字里——在你今天做的第一个小决定里',
    '解读到此为止。但你的故事不在此为止。接下来的空白页——你来写',
    '无论正位逆位——它们都是来帮你的，不是来审判你的。信牌，但更信自己',
  ];
  advices.push(pick(closings));

  return advices;
}

// ═══════════════════════════════════════════════════════
// 一句话总结生成（增强本地模式）
// ═══════════════════════════════════════════════════════

function buildOneLiner(cards, userQuestion) {
  const revCount = cards.filter(c => c._isRev).length;
  const totalCards = cards.length;
  const majorCards = cards.filter(c => c.arcana === 'major');
  const sampleMajor = majorCards[0] || cards[0];
  const cardName = sampleMajor ? sampleMajor.name_zh : '牌面';
  const question = userQuestion || '';

  // Detect question type
  const isMissingYou = /想|想念|惦记|思念|牵挂|想起|在心里/.test(question);
  const isReconciliation = /复合|回来|回头|和好|挽回|重新开始/.test(question);
  const isShouldGiveUp = /放手|放弃|该不该|要不要等|值得等/.test(question);
  const isHasFeelings = /喜欢|爱|好感|心动|在意|有感觉/.test(question);
  const isYesNo = isMissingYou || isReconciliation || isShouldGiveUp || isHasFeelings;

  if (revCount === 0) {
    if (isMissingYou) {
      const pool = [
        `有的，他确实在想你——今天牌面全部正位，信号很直接。`,
        `在想。全部正位的牌面很少见，这份想念是真实的。`,
        `会想。牌面全正——你在他心里是有位置的，不用怀疑。`,
      ];
      return pick(pool);
    }
    if (isReconciliation) {
      const pool = [
        `有机会复合——牌面全正位，缘分还在，只是需要一点时间和耐心。`,
        `能。全部正位说明你们之间的连接没断，但现在先别急，让节奏自然展开。`,
      ];
      return pick(pool);
    }
    if (isShouldGiveUp) {
      const pool = [
        `不该放弃——全正位的牌面告诉你，这件事值得再坚持一下。`,
        `继续等。今天的牌面非常支持你的坚持，方向没问题。`,
      ];
      return pick(pool);
    }
    if (isHasFeelings) {
      const pool = [
        `有的，对方对你有好感——牌面全正位，这份感觉不是你在自作多情。`,
        `有感觉。全部正位的信号很明确——你的直觉没骗你。`,
      ];
      return pick(pool);
    }
    const pool = [
      `好消息——牌面全部正位，关于"${question || '你问的这件事'}"，答案是积极的。`,
      `全正位——${cardName}的能量清澈顺畅，你问的这件事方向是对的。`,
      `今天的牌面给了绿灯：${cardName}在关键位置亮起，顺势而为就好。`,
    ];
    return pick(pool);
  }

  if (revCount <= totalCards / 2) {
    if (isMissingYou) {
      const pool = [
        `有的，但没你期待的那么浓——他在想，只是表达得比较克制。`,
        `在想，不过方式比较安静。牌面正逆混合说明他心里有你，但行动上慢半拍。`,
      ];
      return pick(pool);
    }
    if (isReconciliation) {
      return `有可能，但不在"立刻"的时间表上。牌面正位占主导，缘分还在——需要耐心等节奏对齐。`;
    }
    if (isShouldGiveUp) {
      return `不急着放弃，但需要调整期待。牌面正逆混合——降低投入度，保持观察。`;
    }
    if (isHasFeelings) {
      return `有好感，但他目前还没准备好要表达。牌面正逆混合——感觉是真的，表达欲还没跟上。`;
    }
    const pool = [
      `总体向好——牌面正位占主导，关于"${question || '你的问题'}"，信号是积极的，只是节奏稍慢。`,
      `可以放心——${cardName}的能量稳稳托着大局，有几处需要多看一眼但整体方向没问题。`,
      `牌面说：方向对了，速度可以慢一点。${cardName}的提示是——边走边调，不用停。`,
    ];
    return pick(pool);
  }

  // Mostly reversed
  if (isMissingYou) {
    return `比较少——他目前沉浸在自己的世界里，对你的想念没有你期待的那么浓。`;
  }
  if (isReconciliation) {
    return `短期内不太乐观——牌面逆位偏多，旧问题还没消化完，现在不是复合的好时机。`;
  }
  if (isShouldGiveUp) {
    const pool = [
      `该放手——牌面逆位偏多，继续耗下去只会消耗你自己。止损是明智的。`,
      `该。不是永远没可能，是现在这样等下去没有意义。先把自己从执念里解出来。`,
    ];
    return pick(pool);
  }
  if (isHasFeelings) {
    return `信号偏弱——对方的心思目前不在"喜欢"这件事上，跟你够不够好无关。`;
  }
  const pool = [
    `需要耐心——牌面逆位偏多，"${question || '你问的这件事'}"目前处于调整期，不适合硬推。`,
    `暂时慢下来——${cardName}提示当前的阻力需要时间自然化开，先稳住自己。`,
    `牌面说：现在不是冲刺的时候。${cardName}的逆位能量在请你先向内看，再做打算。`,
  ];
  return pick(pool);
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
    one_liner: parsed.one_liner || '',
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
