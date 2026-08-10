/**
 * lib/comic-panels — 漫转视频模式的「漫画自动分格」(v12.247)。
 *
 * ## 为什么单独一个模式
 *
 * 现有模式都从**文字/剧本**起步。漫转是从**已有的漫画图**起步:一张多格漫画(尤其竖向条漫 webtoon)
 * → 每格加运镜动效 → 拼成动态漫剧。它的独特第一步是「把整页切成一格一格」——
 * 这一步做对了,后面每格喂 u2v 加动效、按序拼接都复用既有能力。
 *
 * ## 用投影法,不用 ML
 *
 * 漫画格子之间有留白(gutter)。把图投影成「每行/每列的内容密度」,密度接近 0 的连续行/列就是 gutter,
 * gutter 之间就是格子。这是经典的漫画分格算法:纯像素级、零模型依赖、确定性、可测。
 * 像素→密度数组这一步由外层用 sharp 提取(薄 I/O 层);本模块只做**密度数组 → 格子边界框**的纯计算。
 *
 * ## 诚实的适用边界
 *
 * 投影法对**条漫(竖向单列多格)**和**规则网格(四格/六格)**很准 —— 这正是漫转最常见的两类输入。
 * 对**不规则跨栏布局**(斜切格、大格叠小格)会切不准,那需要 CV/ML 版面分析(重),本版不做、如实标注。
 */

export interface Panel {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;  // 第几行带(从 0)
  col: number;  // 行带内第几列(从 0)
}

export interface PanelOptions {
  /** 内容密度低于此值的行/列算作「留白」(0~1),默认 0.02。 */
  contentThreshold?: number;
  /** gutter 至少占该方向总长的比例才算有效分隔(过滤格内小空白),默认 0.02。 */
  minGutterRatio?: number;
  /** 内容段至少占该方向总长的比例才算一格(过滤噪点条),默认 0.05。 */
  minBandRatio?: number;
}

const DEF = { contentThreshold: 0.02, minGutterRatio: 0.02, minBandRatio: 0.05 };

/**
 * 从一维密度数组里找出「内容段」(gutter 之间的连续高密度区间)。
 *
 * @param density 每个位置(行或列)的内容密度 0~1;
 * @param total 该方向的总像素长度(用于把比例阈值换算成像素);
 * @returns 内容段的 [start, end)(含 start、不含 end,像素索引);按顺序,无重叠。
 */
export function findContentBands(density: number[], total: number, opts: PanelOptions = {}): Array<[number, number]> {
  const contentTh = opts.contentThreshold ?? DEF.contentThreshold;
  const minGutter = Math.max(1, Math.floor((opts.minGutterRatio ?? DEF.minGutterRatio) * total));
  const minBand = Math.max(1, Math.floor((opts.minBandRatio ?? DEF.minBandRatio) * total));
  const n = density.length;
  if (n === 0) return [];

  const bands: Array<[number, number]> = [];
  let bandStart = -1;
  let gutterRun = 0;

  for (let i = 0; i < n; i++) {
    const isContent = density[i] > contentTh;
    if (isContent) {
      if (bandStart === -1) bandStart = i;
      gutterRun = 0;
    } else {
      if (bandStart !== -1) {
        gutterRun++;
        // 连续留白够长 → 当前内容段在 gutter 起点处收尾
        if (gutterRun >= minGutter) {
          const end = i - gutterRun + 1;
          if (end - bandStart >= minBand) bands.push([bandStart, end]);
          bandStart = -1;
          gutterRun = 0;
        }
      }
    }
  }
  // 收尾:最后一段没遇到足够 gutter 就到末尾
  if (bandStart !== -1 && n - bandStart >= minBand) bands.push([bandStart, n]);
  return bands;
}

/**
 * 二维分格:先按行密度切「行带」,每个行带内再按列密度切格。
 *
 * @param rowDensity 每行内容密度(长度 = height);
 * @param colDensityForBand (band)=>该行带内每列的密度(长度 = width)—— 因为不同行带的列分布不同,
 *        列密度必须**在行带内重算**(整页列投影会把上下格的内容叠在一起,切不准)。
 *        外层用 sharp 时:先整页行投影切行带,再对每个行带的子图做列投影。
 * @returns 所有格子的边界框,按行优先(先上到下、每行内左到右)。
 */
export function splitIntoPanels(
  rowDensity: number[],
  colDensityForBand: (band: [number, number]) => number[],
  width: number,
  height: number,
  opts: PanelOptions = {},
): Panel[] {
  const rowBands = findContentBands(rowDensity, height, opts);
  const panels: Panel[] = [];
  rowBands.forEach(([y0, y1], rowIdx) => {
    const colDensity = colDensityForBand([y0, y1]);
    const colBands = findContentBands(colDensity, width, opts);
    // 该行带内没有明显列分隔 → 整条就是一格(条漫的典型情况)
    const cols: Array<[number, number]> = colBands.length ? colBands : [[0, width]];
    cols.forEach(([x0, x1], colIdx) => {
      panels.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, row: rowIdx, col: colIdx });
    });
  });
  return panels;
}

/** 给 UI/日志的一句话摘要。 */
export function summarizePanels(panels: Panel[]): string {
  if (!panels.length) return '未检出格子(可能是纯色/空白图,或需要 CV 版面分析的不规则布局)';
  const rows = new Set(panels.map((p) => p.row)).size;
  return `${panels.length} 格 / ${rows} 行带`;
}
