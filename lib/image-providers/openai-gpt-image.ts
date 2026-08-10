/**
 * GPT Image(OpenAI `gpt-image-1`)图像 provider。
 *
 * **来源:@flobo3 在 issue #11 提出并设计**
 * (https://github.com/ChrisChen667788/wind-comic/issues/11)。
 * 他不仅指出缺口,还给出了端点、模型名、env 变量命名(OPENAI_IMAGE_MODEL 等)和
 * 「复用已配的 OPENAI_API_KEY 以降低接入门槛」的核心思路 —— 本文件基本按其方案落地。
 *
 * 为什么按 plugin registry 写、而不是像 issue 建议的那样改 `hybrid-orchestrator`:
 * 项目在 v3.2 就落了插件化地基(`lib/image-providers/registry.ts`),`withImagePlugin` 让
 * 注册进来的 provider **先于**内置引擎链跑、失败自动 fallback 回内置。走这条路的好处是
 * 零侵入 orchestrator、可单测、用户也能用同样方式接自己的模型 —— 正是 issue 想要的 plugin-driven。
 *
 * 复用既有 LLM 层配置:`OPENAI_BASE_URL` / `OPENAI_API_KEY`(多数用户为文本层早就配好了),
 * 所以**不需要额外申请 key** 就能出图,这正是 issue 提的「降低门槛」。
 *
 * 端点:`POST {OPENAI_BASE_URL}/images/generations`
 *   - 请求:{ model, prompt, size, n:1 }
 *   - 响应:`data[0].b64_json`(gpt-image-1 固定返 base64)或 `data[0].url`(部分兼容网关)
 *
 * 参考图(i2i):OpenAI 的图生图走的是**另一个端点** `/images/edits` 且要求 multipart 上传
 * 真实图片字节,与本 provider 的 JSON 形态不同。当前实现**只做文生图**并如实声明
 * `supportsRefs:false` —— 于是 registry 的 selectProviders 在有参考图时会自动跳过它,
 * 交给 MJ/Kontext/falFlux 那些真支持 i2i 的档。宁可少声明能力,也不要在有参考图时静默丢掉参考
 * (那是 v12.133 已经踩过的坑:minimax-single 静默丢 refs 导致角色一致性全崩)。
 */
import { registerImageProvider } from './registry';
import type { ImageGenerateInput, AspectRatio } from './types';

/** 画幅 → gpt-image-1 支持的 size(它只认这三种;其余按最接近的取)。 */
export function gptImageSize(aspect?: AspectRatio): string {
  switch (aspect) {
    case '9:16':
    case '3:4':
      return '1024x1536';
    case '1:1':
      return '1024x1024';
    default:
      return '1536x1024'; // 16:9 / 2.35:1 / 4:3 → 横构图
  }
}

/** 纯函数:构造请求体,便于单测(不打网络)。 */
export function buildGptImageRequest(
  input: ImageGenerateInput,
  env: NodeJS.ProcessEnv = process.env,
): { model: string; prompt: string; size: string; n: number } {
  return {
    model: env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    prompt: input.prompt,
    size: gptImageSize(input.aspectRatio),
    n: 1,
  };
}

/** 从响应里取图:优先 b64_json(gpt-image-1 默认),兼容返 url 的网关。 */
export function extractGptImageUrl(data: unknown): string {
  const d = data as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = d?.data?.[0];
  if (!first) return '';
  if (first.b64_json) return `data:image/png;base64,${first.b64_json}`;
  if (first.url && /^https?:\/\//.test(first.url)) return first.url;
  return '';
}

export function hasGptImage(env: NodeJS.ProcessEnv = process.env): boolean {
  // 显式开关优先:很多用户的 OPENAI_BASE_URL 指向只做文本的聚合网关,贸然把图像请求打过去
  // 会白白 404/400 拖慢整条链。所以默认关,设 OPENAI_IMAGE_ENABLED=1 才入链。
  if (env.OPENAI_IMAGE_ENABLED !== '1') return false;
  // v12.239(第五轮复检 · 我自己 v12.238 写的凭据错投):此处原为
  // `!!(env.OPENAI_API_KEY || env.CREATIVE_API_KEY)`,而 generate() 里的 base 只认
  // OPENAI_IMAGE_BASE_URL/OPENAI_BASE_URL、**不认 CREATIVE_BASE_URL** ——
  // 于是只配了 CREATIVE_API_KEY(DeepSeek 等第二 LLM 的 key)的用户,
  // 会把那把密钥当 Bearer 发到 api.openai.com。**密钥必须和它配套的 host 一起用**,
  // 不能只借 key 不借 base。现在只认 OPENAI_API_KEY。
  return !!env.OPENAI_API_KEY;
}

registerImageProvider({
  id: 'openai-gpt-image',
  name: 'GPT Image (gpt-image-1)',
  supportsRefs: false, // 见文件头:i2i 需 /images/edits multipart,当前不做 → 有参考图时自动跳过
  maxRefImages: 0,
  priority: 60, // 内置默认 100;设 60 = 用户显式开启时优先于内置链,但让位于更专精的自定义档
  available: () => hasGptImage(),
  async generate(input: ImageGenerateInput) {
    const env = process.env;
    const base = (env.OPENAI_IMAGE_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const key = env.OPENAI_API_KEY || ''; // v12.239:不再回落 CREATIVE_API_KEY(见 hasGptImage 注释)
    const body = buildGptImageRequest(input, env);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const r = await fetch(`${base}/images/generations`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`gpt-image ${r.status}: ${txt.slice(0, 160)}`);
      }
      const imageUrl = extractGptImageUrl(await r.json());
      if (!imageUrl) throw new Error('gpt-image 返回里没有可用图像(既无 b64_json 也无 url)');
      return { imageUrl, provider: 'openai-gpt-image' };
    } finally {
      clearTimeout(timer);
    }
  },
});
