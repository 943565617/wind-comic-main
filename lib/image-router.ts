/**
 * v2.20 P0.3 — Image generation routing decision.
 *
 * 问题: 之前 generateImage 不管几张 refs 都走 MJ 优先, 但 MJ 只能吃 --cref + --sref
 * = 2 张. 当我们有 4-5 张 refs (Style Bible + 主角 + 配角 + 场景 + 历史镜头) 时,
 * MJ 强行只用 2 张, 其他被丢. 结果: 看似有多图参考, 实际只锁了角色 + 风格 2 个维度.
 *
 * 解法: 按 refs 数量 + 用例分路:
 *   - 0 refs → MJ (画质最佳, 无 ref 也没浪费)
 *   - 1-2 refs → MJ (cref/sref 足够)
 *   - 3+ refs → Minimax image-01 multi-ref (subject_reference[]) — 真正用上多图
 *     - 如果 Minimax 失败, fallback 回 MJ (只用前 2 张)
 *   - 总是兜底 → flux.1-kontext-pro (refs 都作 prompt text hint)
 *
 * 这个 lib 只负责"决定走哪个", 实际调用在 orchestrator.generateImage 里.
 * 决策纯函数, 好测.
 */

export type ImageEngine = 'mj' | 'minimax-multi' | 'minimax-single' | 'kontext' | 'seedream' | 'falflux'; // v12.109 seedream / v12.133 falflux(参考图原生)

export interface ImageRouteDecision {
  primary: ImageEngine;
  fallbacks: ImageEngine[];
  reason: string;
}

export interface ImageRouteInput {
  /** cref + sref + referenceImages 拼成的去重 http URL 数组 */
  validRefs: string[];
  /** MJ 是否可用 (有 key + service) */
  mjAvailable: boolean;
  /** Minimax image-01 是否可用 */
  minimaxAvailable: boolean;
  /** kontext 是否可用 (vectorengine 或 qingyuntop) */
  kontextAvailable: boolean;
}

/**
 * 决定 image 生成走哪条路.
 *
 * 优先级矩阵:
 *
 * | refs | MJ | Minimax | kontext | 决策                                            |
 * |------|----|---------|---------|------------------------------------------------|
 * | 0    | ✓  | -       | -       | mj → minimax-single → kontext                   |
 * | 1-2  | ✓  | -       | -       | mj (cref+sref 够) → minimax-single → kontext    |
 * | ≥3   | ✓  | ✓       | -       | minimax-multi → mj (degrade) → kontext          |
 * | ≥3   | ✓  | ✗       | -       | mj (退化到 2 ref) → kontext                     |
 * | ≥3   | ✗  | ✓       | -       | minimax-multi → kontext                         |
 */
/**
 * v12.133(issue #2 Bug A):把 fal.ai FLUX Kontext(falFluxService)提升为**一等参考图引擎**。
 *
 * 病根:此前 falFlux 只在整条 engineChain 全炸后才作深兜底,于是有参考图的镜**总是先撞**
 * 不认参考图的路径 —— minimax-single(丢 refs)、网关 kontext(把参考图当 prompt 文本,模型看不到图)。
 * falFlux 原生用 image_url/image_urls 传真图,是最该优先的参考图引擎。本函数(纯,像 appendSeedreamTier)
 * 在有参考图 + falFlux 可用时,把 falflux 插到 kontext/minimax-single 之前;MJ(原生 cref/sref)/
 * minimax-multi(原生多参)保留主位,falflux 紧随其后。0 参考图不插(那时 mj/seedream 画质更优)。
 */
export function preferFalFluxForRefs(
  route: { primary: ImageEngine; fallbacks: ImageEngine[]; reason: string },
  refCount: number,
  falAvailable: boolean,
): { primary: ImageEngine; fallbacks: ImageEngine[]; reason: string } {
  if (!falAvailable || refCount < 1) return route;
  const chain = [route.primary, ...route.fallbacks].filter((e) => e !== 'falflux');
  const nativeRefPrimary = new Set<ImageEngine>(['mj', 'minimax-multi']);
  const merged: ImageEngine[] = nativeRefPrimary.has(chain[0])
    ? [chain[0], 'falflux', ...chain.slice(1)]                 // 原生多参主位保留,falflux 紧随
    : ['falflux', ...chain];                                   // 主位本是丢/文本 refs 的引擎 → falflux 上位
  const seen = new Set<ImageEngine>();
  const dedup = merged.filter((e) => (seen.has(e) ? false : (seen.add(e), true)));
  return { primary: dedup[0], fallbacks: dedup.slice(1), reason: `${route.reason} +falflux(参考图原生)` };
}

/** v12.109:seedream 档(qingyuntop images/generations 实测 14s 出图,竖屏直出)追加到链尾。 */
export function appendSeedreamTier(route: { primary: ImageEngine; fallbacks: ImageEngine[]; reason: string }): typeof route {
  if (process.env.IMAGE_SEEDREAM_DISABLE === '1') return route;
  if (route.primary !== 'seedream' && !route.fallbacks.includes('seedream')) route.fallbacks = [...route.fallbacks, 'seedream'];
  return route;
}

export function decideImageRoute(input: ImageRouteInput): ImageRouteDecision {
  const refCount = input.validRefs.length;

  const allEngines = (): ImageEngine[] => {
    const out: ImageEngine[] = [];
    if (input.mjAvailable) out.push('mj');
    if (input.minimaxAvailable) out.push('minimax-single');
    if (input.kontextAvailable) out.push('kontext');
    return out;
  };

  // 0 refs — MJ 画质优势最大, 直接走
  if (refCount === 0) {
    const order = allEngines();
    if (order.length === 0) {
      return { primary: 'kontext', fallbacks: [], reason: 'no engine available, last-resort kontext' };
    }
    return { primary: order[0], fallbacks: order.slice(1), reason: `0 refs, prefer ${order[0]} for quality` };
  }

  // 1-2 refs — MJ cref+sref 设计就吃 2 张, 完全够
  if (refCount <= 2) {
    if (input.mjAvailable) {
      const fallbacks: ImageEngine[] = [];
      if (input.minimaxAvailable) fallbacks.push('minimax-single');
      if (input.kontextAvailable) fallbacks.push('kontext');
      return { primary: 'mj', fallbacks, reason: `${refCount} ref(s), MJ cref/sref native fit` };
    }
    if (input.minimaxAvailable) {
      return {
        primary: 'minimax-single',
        fallbacks: input.kontextAvailable ? ['kontext'] : [],
        reason: `${refCount} ref(s), MJ unavailable, fallback minimax`,
      };
    }
    return { primary: 'kontext', fallbacks: [], reason: 'only kontext available' };
  }

  // ≥3 refs — 关键改进点: 走 Minimax multi-ref 才能真正用上所有图
  if (input.minimaxAvailable) {
    const fallbacks: ImageEngine[] = [];
    if (input.mjAvailable) fallbacks.push('mj'); // MJ 退化到 2 ref 仍然能跑
    if (input.kontextAvailable) fallbacks.push('kontext');
    return {
      primary: 'minimax-multi',
      fallbacks,
      reason: `${refCount} refs, minimax-multi can use all (MJ would drop ${refCount - 2})`,
    };
  }

  // Minimax 不可用时, 接受 MJ 的退化 — 总比放弃 refs 强
  if (input.mjAvailable) {
    return {
      primary: 'mj',
      fallbacks: input.kontextAvailable ? ['kontext'] : [],
      reason: `${refCount} refs, minimax unavailable, MJ will use first 2`,
    };
  }

  return { primary: 'kontext', fallbacks: [], reason: 'fallback to kontext' };
}

/**
 * 从 cref / sref / referenceImages 三个入口拼成去重 + 仅 http(s) 的 refs 数组.
 * 保留顺序: cref → sref → referenceImages (但同 URL 已在前面就跳后面).
 */
export function collectValidRefs(opts: {
  cref?: string;
  sref?: string;
  referenceImages?: string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u?: string) => {
    if (typeof u !== 'string' || !u.startsWith('http') || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  push(opts.cref);
  push(opts.sref);
  if (Array.isArray(opts.referenceImages)) {
    for (const u of opts.referenceImages) push(u);
  }
  return out;
}
