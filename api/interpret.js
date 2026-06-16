/**
 * Vercel Edge Function — AI 解读代理
 * POST /api/interpret
 *
 * 部署方式: 放入 Vercel 项目的 /api/ 目录，自动作为 Serverless Function 运行。
 * 也兼容 Netlify Functions (/netlify/functions/) 和其他 Edge Runtime。
 *
 * 功能:
 * - 隐藏 API Key，客户端不可见
 * - CORS 处理
 * - 速率限制（基于 IP）
 * - SSE 流式转发
 * - 错误处理和降级
 */

// ═════════════════════════════════════════════
// 配置（部署时修改这里）
// ═════════════════════════════════════════════

const CONFIG = {
  // Claude API 配置
  apiEndpoint: 'https://api.anthropic.com/v1/messages',
  apiKey: process.env.ANTHROPIC_API_KEY || '',

  // 备用: OpenAI 兼容 API（DeepSeek 等）
  fallbackEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  fallbackKey: process.env.DEEPSEEK_API_KEY || '',

  // CORS
  allowedOrigins: [
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://your-domain.vercel.app',
    'https://your-github-pages.domain',
  ],

  // 速率限制
  rateLimitWindow: 3600000,  // 1 小时窗口
  maxRequestsPerWindow: 100, // 每个 IP 每小时最多 100 次
};

// ═════════════════════════════════════════════
// 简易内存速率限制（生产环境建议用 Redis/Upstash）
// ═════════════════════════════════════════════

const ipRequestCounts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const record = ipRequestCounts.get(ip);

  if (!record || now - record.windowStart > CONFIG.rateLimitWindow) {
    ipRequestCounts.set(ip, { windowStart: now, count: 1 });
    return true;
  }

  if (record.count >= CONFIG.maxRequestsPerWindow) {
    return false;
  }

  record.count++;
  return true;
}

// ═════════════════════════════════════════════
// CORS 头
// ═════════════════════════════════════════════

function corsHeaders(origin) {
  const allowOrigin = CONFIG.allowedOrigins.includes(origin)
    ? origin
    : CONFIG.allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// ═════════════════════════════════════════════
// 主处理器
// ═════════════════════════════════════════════

export default async function handler(request) {
  const origin = request.headers.get('origin') || '';
  const headers = corsHeaders(origin);

  // OPTIONS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // 仅允许 POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // 速率限制
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({
      error: 'RATE_LIMITED',
      message: '请求过于频繁，请稍后再试。',
    }), {
      status: 429,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // 解析请求体
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({
      error: 'INVALID_JSON',
      message: '请求体不是有效的 JSON。',
    }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const {
    model = 'claude-haiku-4-5',
    system = '',
    user = '',
    temperature = 0.8,
    max_tokens = 2048,
    stream = false,
  } = body;

  if (!user) {
    return new Response(JSON.stringify({
      error: 'MISSING_PROMPT',
      message: '缺少 user prompt。',
    }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // 选择 API 后端
  const useClaude = model.startsWith('claude');
  const apiKey = useClaude ? CONFIG.apiKey : CONFIG.fallbackKey;

  if (!apiKey) {
    return new Response(JSON.stringify({
      error: 'NO_API_KEY',
      message: '服务端未配置 API Key。请联系管理员设置 ANTHROPIC_API_KEY 或 DEEPSEEK_API_KEY 环境变量。',
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  try {
    if (useClaude) {
      return await callClaudeAPI({ model, system, user, temperature, max_tokens, stream, headers });
    } else {
      return await callOpenAICompatibleAPI({ model, system, user, temperature, max_tokens, stream, headers });
    }
  } catch (err) {
    console.error('[interpret] API Error:', err.message);
    return new Response(JSON.stringify({
      error: 'UPSTREAM_ERROR',
      message: `AI 服务调用失败: ${err.message}`,
    }), {
      status: 502,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}

// ═════════════════════════════════════════════
// Claude API 调用
// ═════════════════════════════════════════════

async function callClaudeAPI({ model, system, user, temperature, max_tokens, stream, headers }) {
  const messages = [];
  if (system) {
    messages.push({ role: 'system', content: system });
  }
  messages.push({ role: 'user', content: user });

  const reqBody = {
    model,
    messages,
    max_tokens,
    temperature,
    ...(stream ? {} : {}),  // Claude 用 server-sent events header 控制流式
  };

  const response = await fetch(CONFIG.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CONFIG.apiKey,
      'anthropic-version': '2023-06-01',
      ...(stream ? { 'Accept': 'text/event-stream' } : {}),
    },
    body: JSON.stringify(reqBody),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Claude API ${response.status}: ${errText}`);
  }

  if (stream) {
    // 直接转发 SSE 流
    return new Response(response.body, {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || '';

  return new Response(JSON.stringify({ content }), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// ═════════════════════════════════════════════
// OpenAI 兼容 API 调用（DeepSeek 等）
// ═════════════════════════════════════════════

async function callOpenAICompatibleAPI({ model, system, user, temperature, max_tokens, stream, headers }) {
  const messages = [];
  if (system) {
    messages.push({ role: 'system', content: system });
  }
  messages.push({ role: 'user', content: user });

  const reqBody = {
    model,
    messages,
    max_tokens,
    temperature,
    stream,
  };

  const response = await fetch(CONFIG.fallbackEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.fallbackKey}`,
    },
    body: JSON.stringify(reqBody),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI Compatible API ${response.status}: ${errText}`);
  }

  if (stream) {
    return new Response(response.body, {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  return new Response(JSON.stringify({ content }), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
