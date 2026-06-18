# 命运终端 · TAROT TERMINAL

> **「将日常选择仪式化为神圣算法」** — A decision terminal that aestheticizes indecision.

赛博终端风格的塔罗牌占卜 Web 应用。纯原生技术栈（无框架、无构建工具），支持 GitHub Pages / Vercel / Netlify 三平台部署。

---

## 目录

- [项目概述](#项目概述)
- [文件目录](#文件目录)
  - [📄 页面](#-页面)
  - [🎨 样式](#-样式)
  - [🧩 JavaScript 模块](#-javascript-模块)
  - [📊 数据文件](#-数据文件)
  - [⚙️ API / 服务端](#️-api--服务端)
  - [🚀 部署配置](#-部署配置)
  - [🔧 工具脚本](#-工具脚本)
  - [📊 PPT 路演材料](#-ppt-路演材料)
- [架构速览](#架构速览)
- [数据流](#数据流)
- [快速开始](#快速开始)
- [关键设计决策](#关键设计决策)

---

## 项目概述

这是一个全功能的 SPA 风格塔罗占卜应用，包含三个页面：

| 页面 | 路由 | 功能 |
|------|------|------|
| **占卜终端** | `index.html` | 主流程：选题 → 选牌阵 → 洗牌 → 抽牌 → AI/本地解读 → 结果展示 |
| **卡牌百科** | `encyclopedia.html` | 78 张韦特塔罗索引，搜索 + 7 种分类筛选 + 多场景解读 |
| **分析仪表盘** | `history.html` | 周/月/季/年数据分析 + 心情日历 + 占卜历史 |

**核心亮点**：
- **三层 AI 解读引擎**：真实 API（DeepSeek）→ 增强本地（8 种结构变体 × 数百条文案）→ 模板回退
- **沉浸式体验**：扇形卡牌动画、幕布过渡、白噪音环境（Web Audio API 合成）、天气定位
- **双轨认证**：Supabase 云端优先 + localStorage 离线兜底，支持跨设备 JSON 导出/导入
- **语音交互**：Web Speech API 语音输入 + TTS 播报

---

## 文件目录

### 📄 页面

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.html` | ~400 | 主占卜页面。天气栏、浮动侧边栏、intro 遮罩、主题/牌阵选择器、小阿卡纳开关、AI 控制区、洗牌按钮、扇形卡牌容器、确认弹窗、幕布动画、结果展示（简洁/详细双模式）、歌单推荐、心情面板、认证模态框、白噪音面板 |
| `encyclopedia.html` | ~250 | 卡牌百科页面。搜索框、7 种分类筛选、卡牌网格、详情模态框（6 场景 × 正逆位） |
| `history.html` | ~250 | 数据分析页面。统计卡片、心情日历、占卜历史列表、数据导出 |

### 🎨 样式

| 文件 | 行数 | 职责 |
|------|------|------|
| `css/style.css` | ~2720 | 全局样式表。赛博终端暗黑主题（`#0a0a0f` 底色 + 琥珀 `#e8b84b` 高亮）、CSS 变量体系、玻璃态组件、扇形卡牌布局、扫描线叠加、幕布过渡动画、30+ SVG 图标、响应式三档断点 |

**设计系统关键词**：CSS 自定义属性 | `backdrop-filter` 毛玻璃 | `repeating-linear-gradient` 扫描线 | `@keyframes` 动画（introPulse / shuffleSwap / amberPulse / cardReveal / curtain / floatUp / voicePulse）

### 🧩 JavaScript 模块

| 文件 | 行数 | 职责 | 关键技术 |
|------|------|------|----------|
| `js/main.js` | ~1120 | **核心编排器**。启动初始化、intro 遮罩、主题/牌阵选择、AI 开关、洗牌动画、选牌/确认、幕布过渡、结果渲染（简洁/详细双模式）、复制结果、重置、心情面板、侧边栏、认证模态框、浮动 emoji、键盘快捷键 | 中央 `state` 对象、事件委托、扇形位置计算 |
| `js/cards.js` | ~770 | **牌数据引擎**。JSON 加载、Fisher-Yates 洗牌、扇形布局计算、模板解读生成（600+ 行中文文案）、歌单推荐、情绪选项、SVG 图标系统（30+ 图标） | `fetch()`、Fisher-Yates 算法、三角函数扇形定位 |
| `js/ai-api.js` | ~1110 | **AI 解读引擎**。三层降级：代理 API → 增强本地（8 种结构变体 A-H，每变体 5-8 条文案，按元素/问题类型匹配）→ 原始模板 | DeepSeek Chat API、Prompt 工程、正则问题分类 |
| `js/auth.js` | ~670 | **认证系统**。Supabase 优先 + localStorage 兜底、SHA-256 密码哈希、7 天会话、占卜/心情记录 CRUD、数据分析（牌频/花色/逆位率/情绪关联）、账号 JSON 导出/导入 | Supabase JS SDK、Web Crypto API、localStorage |
| `js/voice.js` | ~210 | **语音模块**。Web Speech API 语音识别（中文）+ TTS 播报、能力检测、错误码映射（含 Chrome 大陆网络提示） | SpeechRecognition、SpeechSynthesisUtterance |
| `js/weather.js` | ~260 | **天气服务**。三层回退：浏览器定位 + Open-Meteo → wttr.in IP 定位 → 缓存坐标、WMO 4680 天气码中文映射（~30 种）、30 分钟缓存 | Geolocation API、Open-Meteo API、wttr.in |
| `js/white-noise.js` | ~370 | **白噪音系统**。Web Audio API 合成 4 种音效：雨（3 层噪声 + 雨滴脉冲）、风（LFO 调制粉红噪声 + 口哨）、海洋（节奏性波浪 LFO）、森林（沙沙声 + 程序化鸟鸣） | AudioContext、BiquadFilter、粉红噪声算法、LFO |
| `js/encyclopedia.js` | ~300 | **百科页面逻辑**。搜索/过滤渲染、卡牌详情模态框、6 场景正逆位切换 | |
| `js/history.js` | ~350 | **分析页面逻辑**。统计数据可视化、跨标签页同步（Storage 事件 + 2s 轮询）、导出 | |

### 📊 数据文件

| 文件 | 大小 | 内容 |
|------|------|------|
| `data/tarot-cards.json` | ~150 KB | 78 张韦特塔罗完整数据（22 大阿卡纳 + 56 小阿卡纳）。每张含 id / 中英文名 / 花色 / 元素 / 关键词 / emoji / 描述 / 6 场景正逆位解读。由 `scripts/generate-cards.mjs` 生成 |
| `data/spreads.json` | ~5 KB | 6 类主题 × 15 种牌阵配置（恋爱 3 种 / 学业 2 种 / 事业 3 种 / 旅行 2 种 / 社交 2 种 / 游戏 2 种），每牌阵含牌位名称和描述 |

### ⚙️ API / 服务端

| 文件 | 运行时 | 职责 |
|------|--------|------|
| `api/interpret.js` | Vercel Edge | DeepSeek API 代理。隐藏 API Key，每日 1 元预算管控（内存计数器），返回 CORS 安全 JSON。4 种回退状态码：200 / 400 / 503（预算耗尽/认证错误/上游错误） |
| `netlify/functions/interpret.js` | Netlify Function | 功能同上，作为备选代理方案 |

**API 端点**：`POST /api/interpret`
```json
// Request
{ "system": "<系统提示词>", "user": "<用户问题 + 抽牌详情>" }

// Success (200)
{ "content": "<AI 解读文本>", "usage": { "inputTokens": 123, "outputTokens": 456 } }

// Degraded (503)
{ "error": "BUDGET_EXCEEDED", "message": "系统繁忙，请稍后重试" }
```

**环境变量**（部署平台配置）：
- `DEEPSEEK_API_KEY` — DeepSeek Chat API 认证密钥

### 🚀 部署配置

| 文件 | 用途 |
|------|------|
| `.github/workflows/deploy.yml` | GitHub Actions：push main/master → 自动部署 GitHub Pages |
| `vercel.json` | Vercel 部署：声明 `api/interpret.js` 为 Edge Runtime |
| `netlify.toml` | Netlify 部署：Functions 目录 + `/api/interpret` → `/.netlify/functions/interpret` 重定向 |

**三平台部署优先级**：GitHub Pages（静态文件）→ Vercel Edge Function（主 API）→ Netlify Function（备选 API）

### 🔧 工具脚本

| 文件 | 用途 |
|------|------|
| `scripts/generate-cards.mjs` | Node.js ESM 脚本。补全 56 张小阿卡纳数据 → 输出完整 78 张牌 JSON |

### 📊 PPT 路演材料

| 文件 | 用途 |
|------|------|
| `ppt/index.html` | 瑞士国际主义风格路演网页 PPT（横向翻页单 HTML） |
| `ppt/generate_pptx_v4.py` | 最新版 python-pptx 生成脚本（12 页产品路演） |
| `ppt/generate_pptx.py` ~ `v3.py` | 历史迭代版本 |
| `ppt/make_editable.py` | EasyOCR 识别幻灯片图片文字 → 覆盖可编辑文本框 |
| `ppt/*.pptx` | 各版本路演 PPT 成品 |
| `ppt/_extract_ref/` | AI 路演 PPT 解压素材（11 张幻灯片 PNG + XML） |

---

## 架构速览

```
┌─────────────────────────────────────────────────────────┐
│                     浏览器 (Client)                       │
│                                                         │
│  index.html  ───  encyclopedia.html  ───  history.html   │
│       │                                                 │
│       ├── css/style.css    (全局样式)                     │
│       │                                                 │
│       ├── js/main.js       (核心编排)                     │
│       ├── js/cards.js      (牌数据 + 模板解读)             │
│       ├── js/ai-api.js     (AI 引擎)                     │
│       ├── js/auth.js       (认证 + 持久化)                │
│       ├── js/voice.js      (语音)                        │
│       ├── js/weather.js    (天气)                        │
│       ├── js/white-noise.js(白噪音)                      │
│       ├── js/encyclopedia.js / js/history.js             │
│       │                                                 │
│       ├── data/tarot-cards.json  (78 张牌静态数据)        │
│       └── data/spreads.json      (15 种牌阵配置)          │
└──────────────┬──────────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌───────────┐    ┌───────────────┐
│  Supabase  │    │  Edge Function │
│  (认证)    │    │  /api/interpret │
│  PostgreSQL│    │  → DeepSeek API │
└───────────┘    └───────────────┘
```

## 数据流

```
用户选题 → 选牌阵 → [开 AI? → 输入问题/语音] → 洗牌(扇形展开)
  → 点击选牌 → 确认 → 幕布过渡
  → 解读生成:
     ├─ AI 模式: POST /api/interpret → DeepSeek → 流式返回
     │   └─ 失败? → 增强本地模式
     └─ 本地模式: 模板引擎 → 按牌位/正逆位/元素匹配文案
  → 结果展示 (简洁/详细双模式) → [歌单推荐] → [心情记录]
  → 数据持久化: localStorage (始终) + Supabase (登录后)
```

---

## 快速开始

### 本地运行

```bash
# 方式 1：直接打开（部分功能需 HTTP 服务）
open index.html

# 方式 2：简单 HTTP 服务器（推荐）
npx serve .
# 或
python -m http.server 8080
```

### 环境变量

在 Vercel / Netlify 平台设置环境变量：

```
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
```

### 部署

```bash
# GitHub Pages — 推送即部署
git push origin main

# Vercel — 关联仓库后自动部署，需在 Dashboard 设置环境变量
vercel --prod

# Netlify — 关联仓库后自动部署，需在 Dashboard 设置环境变量
netlify deploy --prod
```

---

## 关键设计决策

| 决策 | 原因 |
|------|------|
| **纯原生技术栈**（无框架/无构建） | 零依赖、零构建步骤、极简部署。三个页面的复杂度用原生 JS 完全可控 |
| **三层 AI 降级** | DeepSeek API 每日预算仅 1 元，降级时用增强本地模式（8 种结构变体轮换）保证每次解读文案不重复 |
| **双轨认证** | Supabase 提供跨设备云同步，localStorage 保证离线可用和无账号也能用 |
| **程序化白噪音** | 零音频文件，Web Audio API 合成雨/风/海洋/森林，体积为 0 |
| **三平台部署** | GitHub Pages（静态）+ Vercel（Edge Function）+ Netlify（备选），避免单点故障 |
| **单 CSS 文件** | 项目规模适合单文件管理，CSS 变量 + 组件类名保证一致性 |
| **静态 JSON 数据** | 78 张牌数据不常变，静态 JSON 比数据库更快更简单 |
