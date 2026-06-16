/**
 * Vercel Edge Function — AI 解读代理
 * 部署到 Vercel 后自动生效，处理所有 /api/interpret 请求
 *
 * 功能:
 * - 服务端隐藏 API Key（访客不可见）
 * - 每日 ¥1.00 总预算（所有访客共享）
 * - 预算耗尽 → 返回 503 → 前端显示"系统繁忙"
 * - 转发请求到 DeepSeek API，回传 token 用量
 */

// ═══════════════════════════════════════
// 配置（服务端，不会暴露给访客）
// ═══════════════════════════════════════

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';

// 每日预算（元）
const DAILY_BUDGET = 1.00;

// DeepSeek 定价（元/1M tokens）
const PRICE_INPUT = 1.0;
const PRICE_OUTPUT = 2.0;

// ═══════════════════════════════════════
// 内存中每日预算追踪
// Vercel Edge Function 实例间不共享内存，
// 但对个人项目足够——预算接近 ¥1.00 时自然限流
// ═══════════════════════════════════════

let budgetToday = '';
let budgetCost = 0;
let budgetCount = 0;

function today() {
  return new Date().toISOString().split('T')[0];
}

function resetBudgetIfNewDay() {
  const d = today();
  if (budgetToday !== d) {
    budgetToday = d;
    budgetCost = 0;
    budgetCount = 0;
  }
}

function addCost(inputTokens, outputTokens) {
  const cost = (inputTokens / 1_000_000) * PRICE_INPUT
             + (outputTokens / 1_000_000) * PRICE_OUTPUT;
  budgetCost += cost;
  budgetCount += 1;
  console.log(`[预算] 本次 ¥${cost.toFixed(6)} | 今日累计 ¥${budgetCost.toFixed(4)} / ¥${DAILY_BUDGET.toFixed(2)} | 调用 ${budgetCount} 次`);
}

// ═══════════════════════════════════════
// CORS
// ═══════════════════════════════════════

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'https://miaoqi777.github.io',
  'https://tarot-daily.vercel.app',
];

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

// ═══════════════════════════════════════
// 主处理函数
// ═══════════════════════════════════════

export default async function handler(request) {
  const origin = request.headers.get('origin') || '';
  const headers = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // 解析请求
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'INVALID_JSON' }), {
      status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const { system, user } = body;
  if (!user) {
    return new Response(JSON.stringify({ error: '缺少 user prompt' }), {
      status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // 预算检查
  resetBudgetIfNewDay();
  if (budgetCost >= DAILY_BUDGET) {
    return new Response(JSON.stringify({
      error: 'BUDGET_EXCEEDED',
      message: '系统繁忙，请稍后重试',
    }), {
      status: 503,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // 调用 DeepSeek
  try {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });

    const response = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.8,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().slice(0, 200);

      // API Key 问题
      if (response.status === 401 || response.status === 403) {
        return new Response(JSON.stringify({
          error: 'AUTH_ERROR',
          message: '系统繁忙，请稍后重试',
        }), {
          status: 503,
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      // DeepSeek 余额不足
      if (response.status === 402 || errText.includes('Insufficient Balance')) {
        return new Response(JSON.stringify({
          error: 'BUDGET_EXCEEDED',
          message: '系统繁忙，请稍后重试',
        }), {
          status: 503,
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`DeepSeek ${response.status}: ${errText}`);
    }

    const data = await response.json();

    // 记录费用
    const usage = data.usage || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    if (inputTokens > 0 || outputTokens > 0) {
      addCost(inputTokens, outputTokens);
    }

    // 返回内容给前端
    const content = data.choices?.[0]?.message?.content || '';
    return new Response(JSON.stringify({ content, usage: { inputTokens, outputTokens } }), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[interpret] Error:', err.message);
    return new Response(JSON.stringify({
      error: 'UPSTREAM_ERROR',
      message: '系统繁忙，请稍后重试',
    }), {
      status: 503,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}
