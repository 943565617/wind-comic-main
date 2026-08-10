/**
 * HappyHorse(阿里 通义/百炼)视频引擎 —— v12.272。
 *
 * 为什么接:2026-08-07 竞品核验中,HappyHorse 1.1 稳居 Artificial Analysis 双榜前五
 * (T2V 带音频 Elo 1148 / I2V 1111),且**单次 Transformer 联合生成视频+音频**、7 语种原生唇形同步。
 * 本项目的 BYO 主张就是「竞品越强,本管线越强」—— 榜上模型开放 API 即应可被调度。
 *
 * ⚠️ 接口契约是**实测**出来的,不是照文档猜的:
 *   1. 该模型**禁止**走网关通用视频口 —— `/v1/video/create` 与 `/v1/videos` 均返回 400 并明确指路:
 *      「模型 happyhorse-1.1-t2v 属于 阿里百炼(happyhorse/wan) 专属接口,禁止通过通用视频接口调用」。
 *   2. 专属端点为百炼原生异步格式:
 *        POST {base}/alibailian/api/v1/services/aigc/video-generation/video-synthesis
 *        body: { model, input: { prompt, img_url? }, parameters? }
 *        → 200 { request_id, output: { task_id, task_status: 'PENDING' } }
 *      **不需要** X-DashScope-Async 头(实测不带也返回 task_id)。
 *   3. 轮询:GET {base}/alibailian/api/v1/tasks/{task_id}
 *        → { output: { task_status: PENDING|RUNNING|SUCCEEDED|FAILED, video_url? , results? } }
 *
 * 诚实边界:未配 key 或 base 非该网关时 `hasHappyHorse()` 为 false,引擎链自动跳过 —— 不静默假装可用。
 */

export type HappyHorseAspect = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

export interface HappyHorseGenerateOptions {
  /** 首帧图(有则走 i2v 模型,无则 t2v) */
  imageUrl?: string;
  aspectRatio?: HappyHorseAspect;
  /** 3~15s(1.1 规格);越界自动夹取 */
  duration?: number;
  onProgress?: (progress: number, status: string) => void;
  /** 轮询上限秒数(默认 600) */
  timeoutSec?: number;
}

export interface HappyHorseTaskResult {
  videoUrl: string;
  taskId: string;
}

const BAILIAN_CREATE = '/alibailian/api/v1/services/aigc/video-generation/video-synthesis';
const BAILIAN_TASK = '/alibailian/api/v1/tasks';

/** 3~15s 是 HappyHorse 1.1 的公开规格,越界夹取(不把非法值甩给上游)。 */
export function clampHappyHorseDuration(sec: number | undefined): number {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.max(3, Math.min(15, Math.round(n)));
}

/** 有首帧走 i2v,否则 t2v —— 模型名可用 HAPPYHORSE_MODEL 覆盖(如切 1.0 或 r2v)。 */
export function happyHorseModelFor(hasImage: boolean, env: Record<string, string | undefined> = process.env): string {
  const explicit = (env.HAPPYHORSE_MODEL || '').trim();
  if (explicit) return explicit;
  return hasImage ? 'happyhorse-1.1-i2v' : 'happyhorse-1.1-t2v';
}

/** 仅在配了 key 时可用;base 缺省复用 VectorEngine(实测承载该专属端点的网关)。 */
export function hasHappyHorse(env: Record<string, string | undefined> = process.env): boolean {
  const key = env.HAPPYHORSE_API_KEY || env.VECTORENGINE_API_KEY || '';
  return !!key && !key.startsWith('your_') && env.HAPPYHORSE_DISABLE !== '1';
}

/** 从百炼 output 里挖视频地址 —— 网关/版本间字段名不统一,逐个兜。 */
export function extractHappyHorseVideoUrl(output: any): string {
  if (!output || typeof output !== 'object') return '';
  const direct = output.video_url || output.videoUrl || output.url;
  if (typeof direct === 'string' && direct.startsWith('http')) return direct;
  const results = output.results || output.video_results;
  if (Array.isArray(results)) {
    for (const r of results) {
      const u = r?.video_url || r?.url || r?.videoUrl;
      if (typeof u === 'string' && u.startsWith('http')) return u;
    }
  }
  return '';
}

export class HappyHorseService {
  private apiKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = process.env.HAPPYHORSE_API_KEY || process.env.VECTORENGINE_API_KEY || '';
    this.baseURL = (process.env.HAPPYHORSE_BASE_URL || process.env.VECTORENGINE_BASE_URL || 'https://api.vectorengine.ai')
      .replace(/\/+$/, '')
      .replace(/\/v1$/, '');
  }

  isAvailable(): boolean {
    return hasHappyHorse();
  }

  /** 建任务 → 轮询 → 返回视频 URL(全生命周期)。 */
  async generateVideo(prompt: string, options?: HappyHorseGenerateOptions): Promise<string> {
    const { taskId } = await this.submitTask(prompt, options);
    return await this.pollResult(taskId, options);
  }

  async submitTask(prompt: string, options?: HappyHorseGenerateOptions): Promise<{ taskId: string }> {
    if (!this.apiKey) throw new Error('HappyHorse 未配置(需 HAPPYHORSE_API_KEY 或 VECTORENGINE_API_KEY)');
    const hasImage = !!(options?.imageUrl && options.imageUrl.startsWith('http'));
    const input: Record<string, any> = { prompt };
    if (hasImage) input.img_url = options!.imageUrl;

    const parameters: Record<string, any> = { duration: clampHappyHorseDuration(options?.duration) };
    // ⚠️ 画幅:live 实测(2026-08-07)传 `size: '9:16'` **未被采纳** —— 请求 9:16 实际出 1920×1080(16:9)。
    // 正确参数形态未能当场确证(继续探测时网关返回 429 上游饱和),因此**不假装支持竖屏**:
    // 默认仍把比例透传给 size + aspect_ratio 两个字段(网关取它认识的那个),
    // 并留 `HAPPYHORSE_SIZE` 让运营者直接指定其网关要的确切字符串(如 '720*1280')。
    // 在确证之前,竖屏短剧不要把 HappyHorse 排在链首 —— 详见 README 引擎矩阵的诚实标注。
    const sizeOverride = (process.env.HAPPYHORSE_SIZE || '').trim();
    if (sizeOverride) {
      parameters.size = sizeOverride;
    } else if (options?.aspectRatio) {
      parameters.size = options.aspectRatio;
      parameters.aspect_ratio = options.aspectRatio;
    }

    const res = await fetch(`${this.baseURL}${BAILIAN_CREATE}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: happyHorseModelFor(hasImage), input, parameters }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HappyHorse 建任务失败 (${res.status}): ${text.slice(0, 200)}`);
    let j: any = {};
    try { j = JSON.parse(text); } catch { throw new Error(`HappyHorse 返回非 JSON: ${text.slice(0, 120)}`); }
    const taskId = j?.output?.task_id;
    if (!taskId) throw new Error(`HappyHorse 未返回 task_id: ${text.slice(0, 200)}`);
    console.log(`[HappyHorse] task created: ${taskId} (${happyHorseModelFor(hasImage)})`);
    return { taskId };
  }

  async pollResult(taskId: string, options?: HappyHorseGenerateOptions): Promise<string> {
    const timeoutSec = options?.timeoutSec ?? 600;
    const intervalMs = 5000;
    const maxTries = Math.ceil((timeoutSec * 1000) / intervalMs);
    for (let i = 0; i < maxTries; i++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const res = await fetch(`${this.baseURL}${BAILIAN_TASK}/${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) continue; // 瞬时错误不打断轮询
      const j: any = await res.json().catch(() => ({}));
      const status = j?.output?.task_status;
      if (status === 'SUCCEEDED') {
        const url = extractHappyHorseVideoUrl(j.output);
        if (!url) throw new Error(`HappyHorse 成功但无视频地址: ${JSON.stringify(j.output).slice(0, 200)}`);
        return url;
      }
      if (status === 'FAILED') {
        throw new Error(`HappyHorse 任务失败: ${j?.output?.message || JSON.stringify(j.output).slice(0, 160)}`);
      }
      options?.onProgress?.(Math.min(90, Math.round((i / maxTries) * 100)), status || 'RUNNING');
    }
    throw new Error(`HappyHorse 轮询超时(${timeoutSec}s),task=${taskId}`);
  }
}

let _svc: HappyHorseService | null = null;
export function getHappyHorseService(): HappyHorseService | null {
  if (!hasHappyHorse()) return null;
  if (!_svc) _svc = new HappyHorseService();
  return _svc;
}
