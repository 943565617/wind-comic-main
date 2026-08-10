/**
 * 分镜表回灌(v12.154.0)—— 导出 CSV → Excel 改 → 上传 merge 回剧本。
 *
 * 纯函数三件套(全可单测,IO 在路由层):
 *   parseCsv          —— 状态机 CSV 解析(BOM/引号转义/引号内逗号与换行)
 *   parsePullSheetRows —— 表头(中文标签,兼容「组 · 标签」前缀)→ 行对象
 *   mergePullSheetIntoScript —— 按镜号白名单 merge,只写有变化的字段,返回变更摘要
 *
 * 原则:镜号是键不可改;startSec/endSec 是派生列不回灌;运镜/景别原文透传
 * (渲染时走 v12.142 归一,与既有哲学一致);未知镜号/坏行跳过并如实报告。
 */

/** 状态机 CSV 解析:支持引号字段内的逗号/换行/连续双引号转义;剥 BOM。 */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

/** 可回灌字段:CSV 中文标签 → script.shots 字段名(镜号是键;时间派生列不收)。 */
export const IMPORTABLE_FIELDS: Array<{ label: string; scriptKey: string; kind: 'string' | 'number' | 'list' }> = [
  { label: '画面内容', scriptKey: 'sceneDescription', kind: 'string' },
  { label: '场景', scriptKey: 'scene', kind: 'string' },
  { label: '角色', scriptKey: 'characters', kind: 'list' },
  { label: '台词对白', scriptKey: 'dialogue', kind: 'string' },
  { label: '时长(s)', scriptKey: 'duration', kind: 'number' },
  { label: '景别', scriptKey: 'shotSize', kind: 'string' },
  { label: '构图', scriptKey: 'composition', kind: 'string' },
  { label: '机位角度', scriptKey: 'cameraAngle', kind: 'string' },
  { label: '运镜方法', scriptKey: 'cameraMovement', kind: 'string' },
  { label: '焦距与景深', scriptKey: 'lens', kind: 'string' },
  { label: '光影与色调', scriptKey: 'lightingIntent', kind: 'string' },
  { label: '剪辑', scriptKey: 'editPattern', kind: 'string' },
  { label: '音乐情绪', scriptKey: 'scoreMood', kind: 'string' },
  { label: '音效设计', scriptKey: 'soundDesign', kind: 'string' },
  { label: '环境声', scriptKey: 'diegeticSound', kind: 'string' },
  { label: '分镜功能', scriptKey: 'storyBeat', kind: 'string' },
  { label: '镜头叙事功能', scriptKey: 'whyThisChoice', kind: 'string' },
];

export interface ImportRow { shotNumber: number; fields: Record<string, string> }

/** 表头行 → 列索引映射(剥「组 · 」前缀);解析出逐行 {shotNumber, 标签→原文}。 */
export function parsePullSheetRows(csvText: string): { rows: ImportRow[]; badLines: number } {
  const table = parseCsv(csvText);
  if (table.length < 2) return { rows: [], badLines: 0 };
  const header = table[0].map((h) => h.replace(/^.*·\s*/, '').trim());
  const shotCol = header.findIndex((h) => h === '镜头' || h === '镜号');
  if (shotCol === -1) return { rows: [], badLines: table.length - 1 };
  const colOf = new Map<string, number>();
  for (const f of IMPORTABLE_FIELDS) {
    const idx = header.findIndex((h) => h === f.label);
    if (idx !== -1) colOf.set(f.label, idx);
  }
  const rows: ImportRow[] = [];
  let badLines = 0;
  for (const line of table.slice(1)) {
    const sn = parseInt(String(line[shotCol] || '').replace(/^S/i, ''), 10);
    if (!Number.isFinite(sn) || sn <= 0) { badLines++; continue; }
    const fields: Record<string, string> = {};
    for (const [label, idx] of colOf) fields[label] = String(line[idx] ?? '').trim();
    rows.push({ shotNumber: sn, fields });
  }
  return { rows, badLines };
}

export interface MergeResult {
  script: any;
  changes: Array<{ shotNumber: number; field: string; from: string; to: string }>;
  unknownShots: number[];
}

/** 按镜号 merge:只写有变化的白名单字段;'—' 与空串视为「未填」不覆盖。 */
export function mergePullSheetIntoScript(script: any, rows: ImportRow[]): MergeResult {
  const shots: any[] = Array.isArray(script?.shots) ? script.shots : [];
  const byNum = new Map(shots.map((s) => [s.shotNumber, s]));
  const changes: MergeResult['changes'] = [];
  const unknownShots: number[] = [];

  for (const row of rows) {
    const shot = byNum.get(row.shotNumber);
    if (!shot) { unknownShots.push(row.shotNumber); continue; }
    for (const f of IMPORTABLE_FIELDS) {
      const raw = row.fields[f.label];
      if (raw === undefined || raw === '' || raw === '—') continue; // 未填不覆盖
      let next: any = raw;
      if (f.kind === 'number') {
        next = Number(raw);
        if (!Number.isFinite(next) || next <= 0) continue;
      } else if (f.kind === 'list') {
        next = raw.split(/[、,;,;\/]+/).map((x) => x.trim()).filter(Boolean);
      }
      const cur = shot[f.scriptKey];
      const curStr = Array.isArray(cur) ? cur.join('、') : String(cur ?? '');
      const nextStr = Array.isArray(next) ? next.join('、') : String(next);
      if (curStr === nextStr) continue;
      changes.push({ shotNumber: row.shotNumber, field: f.label, from: curStr.slice(0, 60), to: nextStr.slice(0, 60) });
      shot[f.scriptKey] = next;
    }
  }
  return { script, changes, unknownShots };
}
