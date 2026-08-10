/**
 * 剧本/分镜表离线导出(v12.152.0,零生图 API)。
 *
 * 纯函数产出两种载体,供 pull-sheet 路由的 ?format=md|pdf 消费:
 *   - pullSheetToMarkdown:剧本册 Markdown(标题/梗概/逐镜卡 + 分镜表格)
 *   - buildScriptBookHtml:打印友好 A4 HTML(内联 CSS,puppeteer 渲成 PDF;
 *     分镜图缩略容错 —— 加载失败整格隐藏,不阻塞出册)
 * CSV 走既有 toPullSheetCsv,不重复。
 */
import type { PullSheet, PullSheetShot } from './pull-sheet';

export interface ScriptMeta {
  title?: string;
  logline?: string;
  synopsis?: string;
  style?: string;
  /** v12.160:角色表附页(名/定位/缩略) */
  characters?: Array<{ name: string; role?: string; imageUrl?: string }>;
  /** v12.160:体检附页(红黄绿逐维) */
  health?: Array<{ label: string; status: string; detail: string }>;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtTime = (sec: number): string => {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** 单镜的镜头语言一行摘要(有什么拼什么)。 */
export function shotCinemaLine(s: PullSheetShot): string {
  return [s.shotSize, s.cameraAngle, s.cameraMovement, s.lens, s.lightingIntent]
    .map((v) => (v || '').trim()).filter(Boolean).join(' · ');
}

/** 剧本册 Markdown:标题/梗概 → 逐镜卡 → 附录分镜表格。 */
export function pullSheetToMarkdown(sheet: PullSheet, meta?: ScriptMeta): string {
  const L: string[] = [];
  L.push(`# ${meta?.title || sheet.title}`);
  L.push('');
  L.push(`> ${sheet.shotCount} 镜 · 总时长 ${fmtTime(sheet.totalDurationSec)}${meta?.style ? ` · 画风:${meta.style}` : ''}`);
  if (meta?.logline) { L.push(''); L.push(`**Logline**:${meta.logline}`); }
  if (meta?.synopsis) { L.push(''); L.push(`**梗概**:${meta.synopsis}`); }
  L.push('');
  L.push('---');
  for (const s of sheet.shots) {
    L.push('');
    L.push(`## S${s.shotNumber}(${fmtTime(s.startSec)}–${fmtTime(s.endSec)},${s.durationSec}s)`);
    const cine = shotCinemaLine(s);
    if (cine) L.push(`*${cine}*`);
    if (s.description) { L.push(''); L.push(s.description); }
    if (s.characters.length) L.push(`- 角色:${s.characters.join('、')}`);
    if (s.dialogue) L.push(`- 台词:「${s.dialogue}」`);
    if (s.storyBeat) L.push(`- 叙事拍:${s.storyBeat}`);
    if (s.soundDesign || s.scoreMood) L.push(`- 声音:${[s.soundDesign, s.scoreMood].filter(Boolean).join(' / ')}`);
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('## 附录 · 分镜表');
  L.push('');
  L.push('| 镜号 | 时码 | 景别 | 运镜 | 镜头 | 台词 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  const cell = (v: string) => (v || '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const s of sheet.shots) {
    L.push(`| S${s.shotNumber} | ${fmtTime(s.startSec)} | ${cell(s.shotSize)} | ${cell(s.cameraMovement)} | ${cell(s.lens)} | ${cell(s.dialogue)} |`);
  }
  L.push('');
  return L.join('\n');
}

/** 打印友好 A4 剧本册 HTML(内联 CSS;分镜图 onerror 自隐藏)。 */
export function buildScriptBookHtml(sheet: PullSheet, meta?: ScriptMeta): string {
  const shotCards = sheet.shots.map((s) => `
    <div class="shot">
      <div class="shot-head">
        <span class="sn">S${s.shotNumber}</span>
        <span class="tc">${fmtTime(s.startSec)}–${fmtTime(s.endSec)} · ${s.durationSec}s</span>
      </div>
      ${shotCinemaLine(s) ? `<div class="cine">${esc(shotCinemaLine(s))}</div>` : ''}
      <div class="body">
        ${s.thumbnail ? `<img class="thumb" src="${esc(s.thumbnail)}" onerror="this.style.display='none'" />` : ''}
        <div class="txt">
          ${s.description ? `<p>${esc(s.description)}</p>` : ''}
          ${s.characters.length ? `<p class="kv"><b>角色</b>${esc(s.characters.join('、'))}</p>` : ''}
          ${s.dialogue ? `<p class="kv"><b>台词</b>「${esc(s.dialogue)}」</p>` : ''}
          ${s.storyBeat ? `<p class="kv"><b>叙事拍</b>${esc(s.storyBeat)}</p>` : ''}
        </div>
      </div>
    </div>`).join('\n');

  const tableRows = sheet.shots.map((s) => `
    <tr><td>S${s.shotNumber}</td><td>${fmtTime(s.startSec)}</td><td>${esc(s.shotSize || '—')}</td>
    <td>${esc(s.cameraMovement || '—')}</td><td>${esc(s.lens || '—')}</td><td>${esc(s.dialogue || '—')}</td></tr>`).join('\n');

  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${esc(meta?.title || sheet.title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  /* v12.241(清门禁存量债):本 HTML 由 puppeteer 渲成 PDF,而 **PDF 会把用到的字形嵌进文件**
     —— 那就等于随文档分发字体,与成片烧字幕是同一类 EULA 问题。所以把开源可商用字体
     (思源黑体 / Noto,均 SIL OFL)放在前面,系统专有字体只作末位回退。
     对照:lib/polish-docx.ts 导出的是 Word HTML,字体名由 Word 在本机查找、不嵌入,故不受此限。 */
  body { font-family: "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; color: #1a1a1a; padding: 28px 34px; font-size: 12px; line-height: 1.55; }
  h1 { font-size: 22px; margin-bottom: 6px; }
  .meta { color: #666; margin-bottom: 4px; }
  .block { margin: 10px 0; padding: 10px 12px; background: #f6f6f4; border-radius: 6px; }
  .shot { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; margin: 10px 0; page-break-inside: avoid; }
  .shot-head { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .sn { font-weight: 700; color: #8a6d1d; }
  .tc { color: #888; font-variant-numeric: tabular-nums; }
  .cine { color: #555; font-style: italic; margin-bottom: 6px; }
  .body { display: flex; gap: 10px; }
  .thumb { width: 130px; max-height: 180px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
  .txt { min-width: 0; }
  .kv { margin-top: 3px; } .kv b { color: #8a6d1d; margin-right: 6px; font-weight: 600; }
  h2 { font-size: 15px; margin: 18px 0 8px; page-break-before: always; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #efede8; }
</style></head><body>
  <h1>${esc(meta?.title || sheet.title)}</h1>
  <div class="meta">${sheet.shotCount} 镜 · 总时长 ${fmtTime(sheet.totalDurationSec)}${meta?.style ? ` · 画风:${esc(meta.style)}` : ''} · 青枫漫剧导出</div>
  ${meta?.logline ? `<div class="block"><b>Logline</b> ${esc(meta.logline)}</div>` : ''}
  ${meta?.synopsis ? `<div class="block"><b>梗概</b> ${esc(meta.synopsis)}</div>` : ''}
  ${shotCards}
  ${meta?.characters?.length ? `
  <h2>附录 · 角色表</h2>
  <div style="display:flex;flex-wrap:wrap;gap:12px">
    ${meta.characters.map((c) => `
    <div style="width:150px;border:1px solid #ddd;border-radius:8px;padding:8px;text-align:center;page-break-inside:avoid">
      ${c.imageUrl ? `<img src="${esc(c.imageUrl)}" onerror="this.style.display='none'" style="width:100%;height:150px;object-fit:cover;border-radius:4px" />` : ''}
      <div style="font-weight:600;margin-top:4px">${esc(c.name)}</div>
      ${c.role ? `<div style="color:#888;font-size:10px">${esc(c.role)}</div>` : ''}
    </div>`).join('')}
  </div>` : ''}
  ${meta?.health?.length ? `
  <h2>附录 · 成片体检</h2>
  <table><thead><tr><th style="width:36px"></th><th style="width:90px">维度</th><th>结论</th></tr></thead><tbody>
    ${meta.health.map((h) => `<tr><td>${h.status === 'ok' ? '🟢' : h.status === 'warn' ? '🟡' : h.status === 'fail' ? '🔴' : '⚪'}</td><td>${esc(h.label)}</td><td>${esc(h.detail)}</td></tr>`).join('')}
  </tbody></table>` : ''}
  <h2>附录 · 分镜表</h2>
  <table><thead><tr><th>镜号</th><th>时码</th><th>景别</th><th>运镜</th><th>镜头</th><th>台词</th></tr></thead>
  <tbody>${tableRows}</tbody></table>
</body></html>`;
}
