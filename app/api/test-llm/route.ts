import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { API_CONFIG } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // v12.232(对抗复检补漏):此前**零鉴权**,匿名 GET 即用生产密钥打 OpenAI,循环即烧额度。
  // 这是纯手工调试端点(全仓无任何调用方),所以:
  //   · 生产环境直接 404 —— 调试端点本就不该在生产可达;
  //   · 非生产要求登录 —— 挡住同网段的随手探测。
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  const _u = requireUser(request);
  if (!_u.ok) return NextResponse.json({ message: _u.message }, { status: _u.status });

  const model = API_CONFIG.openai.model;
  const start = Date.now();

  console.log(`[TEST-LLM] 开始测试 model=${model}`);

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 120000);

    const resp = await fetch(`${API_CONFIG.openai.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_CONFIG.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是AI导演。输出纯JSON。' },
          { role: 'user', content: '输出 {"hello":"world","model":"' + model + '"}' },
        ],
        max_tokens: 100,
      }),
      signal: controller.signal,
    });

    const data = await resp.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (data.choices) {
      const content = data.choices[0].message.content;
      console.log(`[TEST-LLM] ✅ 完成 ${elapsed}s: ${content.slice(0, 100)}`);
      return Response.json({ ok: true, elapsed: `${elapsed}s`, model, content });
    } else {
      console.log(`[TEST-LLM] ❌ API错误: ${JSON.stringify(data.error || data).slice(0, 200)}`);
      return Response.json({ ok: false, error: data.error?.message || 'unknown', elapsed: `${elapsed}s` });
    }
  } catch (e: any) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[TEST-LLM] ❌ 异常 ${elapsed}s: ${e.message}`);
    return Response.json({ ok: false, error: e.message, elapsed: `${elapsed}s` });
  }
}
