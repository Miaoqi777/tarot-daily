/**
 * Netlify Function — AI 解读代理
 * 部署到 Netlify 后自动生效，端点: /.netlify/functions/interpret
 *
 * 功能:
 * - 服务端隐藏 DeepSeek API Key
 * - 每日 ¥1.00 总预算（所有访客共享）
 * - 预算耗尽 → 返回 503 → 前端显示"系统繁忙"
 */

// ═══════════════════════════════════════
// 配置
// ═══════════════════════════════════════

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';
const DAILY_BUDGET = 1.00;
const PRICE_INPUT = 1.0;   // ¥/1M tokens
const PRICE_OUTPUT = 2.0;  // ¥/1M tokens

// ═══════════════════════════════════════
// 每日预算追踪
// ═══════════════════════════════════════

let budgetToday = '';
let budgetCost = 0;
let budgetCount = 0;

function today() {
  return new Date().toISOString().split('T')[0];
}

function resetIfNewDay() {
  const d = today();
  if (budgetToday !== d) {
    budgetToday = d;
    budgetCost = 0;
    budgetCount = 0;
  }
}

// ═══════════════════════════════════════
// 主处理函数
// ═══════════════════════════════════════

exports.handler = async (event) => {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // 解析请求
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_JSON' }) };
  }

  const { system, user } = body;
  if (!user) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '缺少 user prompt' }) };
  }

  // 检查 Key
  if (!DEEPSEEK_API_KEY) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'BUDGET_EXCEEDED', message: '系统繁忙，请稍后重试' }) };
  }

  // 预算检查
  resetIfNewDay();
  if (budgetCost >= DAILY_BUDGET) {
    console.log(`[预算] 已耗尽: ¥${budgetCost.toFixed(4)} / ¥${DAILY_BUDGET.toFixed(2)} (${budgetCount}次)`);
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'BUDGET_EXCEEDED', message: '系统繁忙，请稍后重试' }) };
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
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.8, max_tokens: 2048 }),
    });

    if (!response.ok) {
      const errText = await response.text().slice(0, 200);
      console.error('[DeepSeek] Error:', response.status, errText);

      if (response.status === 401 || response.status === 403) {
        return { statusCode: 503, headers, body: JSON.stringify({ error: 'AUTH_ERROR', message: '系统繁忙，请稍后重试' }) };
      }
      if (response.status === 402 || errText.includes('Insufficient Balance')) {
        return { statusCode: 503, headers, body: JSON.stringify({ error: 'BUDGET_EXCEEDED', message: '系统繁忙，请稍后重试' }) };
      }
      return { statusCode: 503, headers, body: JSON.stringify({ error: 'UPSTREAM_ERROR', message: '系统繁忙，请稍后重试' }) };
    }

    const data = await response.json();

    // 记录费用
    const usage = data.usage || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    if (inputTokens > 0 || outputTokens > 0) {
      const cost = (inputTokens / 1_000_000) * PRICE_INPUT + (outputTokens / 1_000_000) * PRICE_OUTPUT;
      budgetCost += cost;
      budgetCount += 1;
      console.log(`[预算] 本次 ¥${cost.toFixed(6)} | 累计 ¥${budgetCost.toFixed(4)}/¥${DAILY_BUDGET.toFixed(2)} | ${budgetCount}次`);
    }

    const content = data.choices?.[0]?.message?.content || '';
    return { statusCode: 200, headers, body: JSON.stringify({ content }) };

  } catch (err) {
    console.error('[interpret] Error:', err.message);
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'UPSTREAM_ERROR', message: '系统繁忙，请稍后重试' }) };
  }
};
