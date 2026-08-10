/**
 * lib/series-recap — 多集连续生成的「前情提要」(v12.244)。
 *
 * ## 为什么要它
 *
 * 竞品对比矩阵里「多集连续生成」我方长期标 ❌:series 虽能批量出片,但
 * `series generate` 给每集喂的 idea 只有**该集自己**的 description ——
 * 第 5 集的 Writer 根本不知道第 1~4 集演了什么。结果就是各集独立成篇:
 * 伏笔不回收、角色状态不延续、甚至剧情自相矛盾或重复。红果/OiiOii 能做 60~100 集连续,
 * 差的正是这一层「剧情记忆」。
 *
 * ## 为什么用「大纲描述」而非「已生成的实际剧本」
 *
 * series 建立时 `series-ai` 已把整体设定拆成各集连贯梗概(存在每集 description)——
 * 这些在建系列时就定稿,**无先后依赖**。而「已生成的实际剧本」有依赖问题:
 * 批量生成是并发/乱序的,第 5 集入队时第 4 集可能还没跑完,拿不到它的真剧本。
 * 所以前情用**前序各集的 description**:可靠、即时、且已经是连贯大纲的一部分。
 *
 * 纯函数,零 I/O,好测。
 */

export interface EpisodeLike {
  episode_number: number | null;
  title?: string | null;
  description?: string | null;
}

/** 单集在前情里占的最大字数 —— 防止长系列把前情堆爆 Writer 的上下文预算。 */
const PER_EP_CAP = 220;
/** 前情总字数上限;超了就只保留**最近的**几集(近因对承接更重要)。 */
const TOTAL_CAP = 1600;

function clean(s: string | null | undefined): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/**
 * 为「第 currentEpisodeNumber 集」构造前情提要文本。
 *
 * @param all 该系列**全部**集(顺序不限,内部按 episode_number 排);
 * @param currentEpisodeNumber 正在生成的集号 —— 只取严格早于它的集。
 * @returns 前情文本;没有前序集(如第 1 集)或前序集都没梗概 → 空串。
 */
export function buildSeriesRecap(all: EpisodeLike[], currentEpisodeNumber: number | null): string {
  if (typeof currentEpisodeNumber !== 'number') return ''; // 集号缺失 → 无从判定前序,安全返空
  const priors = (all.filter(
    (e) => typeof e.episode_number === 'number' && e.episode_number < currentEpisodeNumber,
  ) as Array<EpisodeLike & { episode_number: number }>).sort((a, b) => a.episode_number - b.episode_number);

  const lines: string[] = [];
  for (const ep of priors) {
    const body = clean(ep.description) || clean(ep.title);
    if (!body) continue; // 没梗概的集跳过,不占前情篇幅
    lines.push(`第${ep.episode_number}集:${body.slice(0, PER_EP_CAP)}`);
  }
  if (lines.length === 0) return '';

  // 总量超限 → 从**最近的**集往前保留(近因优先),而不是从第 1 集截断。
  let text = lines.join('\n');
  if (text.length > TOTAL_CAP) {
    const kept: string[] = [];
    let used = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (used + lines[i].length > TOTAL_CAP) break;
      kept.unshift(lines[i]);
      used += lines[i].length + 1;
    }
    // 至少保留最近一集,哪怕它自己就超限(截断到上限)
    text = kept.length ? kept.join('\n') : lines[lines.length - 1].slice(0, TOTAL_CAP);
  }
  return text;
}

/**
 * 把前情提要包装成注入 Writer 的指令块。空前情 → 空串(第 1 集零影响)。
 * Writer 收到的最终 idea = 本块 + 原 idea。
 */
export function buildRecapDirective(recap: string): string {
  if (!recap) return '';
  return (
    `【前情提要(本剧前几集已发生,本集必须承接)】\n${recap}\n\n` +
    `【承接纪律】\n` +
    `· 延续前情里的人物关系与状态,不要当作全新故事从头介绍;\n` +
    `· 不重复已经发生过的情节;可回收前面埋下的伏笔;\n` +
    `· 与前情保持事实一致(人物、地点、已定结局不得矛盾)。\n\n` +
    `【本集内容】\n`
  );
}
