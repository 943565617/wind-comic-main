/**
 * v12.154 — 分镜表回灌:CSV 状态机 + 行解析 + merge 纯函数 + 往返一致性 + 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { parseCsv, parsePullSheetRows, mergePullSheetIntoScript } from '@/lib/pull-sheet-import';
import { buildPullSheetFromScript, toPullSheetCsv } from '@/lib/pull-sheet';
import fs from 'fs';

describe('v12.154 · parseCsv 状态机', () => {
  it('引号内逗号/换行/双引号转义/BOM/CRLF', () => {
    const rows = parseCsv('﻿a,"b,1","c""x""","d\ne"\r\n1,2,3,4');
    expect(rows[0]).toEqual(['a', 'b,1', 'c"x"', 'd\ne']);
    expect(rows[1]).toEqual(['1', '2', '3', '4']);
  });
});

describe('v12.154 · 回灌 merge', () => {
  const script = {
    title: 'T',
    shots: [
      { shotNumber: 1, sceneDescription: '旧描述', dialogue: '旧台词', duration: 5, cameraMovement: 'static', characters: ['A'] },
      { shotNumber: 2, sceneDescription: 'S2', duration: 5 },
    ],
  };
  it('导出 CSV 改字段回灌:只写变化字段、"—"与空不覆盖、镜号键不动', () => {
    const sheet = buildPullSheetFromScript(JSON.parse(JSON.stringify(script)));
    let csv = toPullSheetCsv(sheet);
    // 注意:直接字符串替换要保住 CSV 结构 —— 含逗号的新值必须带引号(Excel 保存时会自动处理)
    csv = csv.replace('旧台词', '新台词带感叹号!').replace('static', 'push-in');
    const { rows } = parsePullSheetRows(csv);
    expect(rows.length).toBe(2);
    const target = JSON.parse(JSON.stringify(script));
    const r = mergePullSheetIntoScript(target, rows);
    expect(r.changes.map((c) => c.field).sort()).toEqual(['台词对白', '运镜方法']);
    expect(target.shots[0].dialogue).toBe('新台词带感叹号!');
    expect(target.shots[0].cameraMovement).toBe('push-in');
    expect(target.shots[0].sceneDescription).toBe('旧描述'); // 未改不动
    expect(target.shots[1].sceneDescription).toBe('S2');
  });
  it('角色列表分隔、时长数字校验、未知镜号上报', () => {
    const csv = '镜头,叙事要素 · 角色,时间 · 时长(s)\nS1,"甲、乙,丙",abc\n9,X,3';
    const { rows } = parsePullSheetRows(csv);
    const target = JSON.parse(JSON.stringify(script));
    const r = mergePullSheetIntoScript(target, rows);
    expect(target.shots[0].characters).toEqual(['甲', '乙', '丙']);
    expect(target.shots[0].duration).toBe(5);      // 'abc' 不合法不覆盖
    expect(r.unknownShots).toEqual([9]);
  });
  it('v12.159:affectedShots(视觉字段变更镜)+ 一键重渲接线', () => {
    const api = fs.readFileSync('app/api/projects/[id]/pull-sheet/import/route.ts', 'utf-8');
    expect(api).toContain('VISUAL_LABELS');
    expect(api).toContain('affectedShots');
    const ui = fs.readFileSync('components/project/pull-sheet-table.tsx', 'utf-8');
    expect(ui).toContain('重渲受影响的');
    expect(ui).toContain('setAffectedShots(Array.isArray(d.affectedShots)');
  });
  it('接线锁:import API(repo 双写)+ 拉片 tab 上传按钮', () => {
    const api = fs.readFileSync('app/api/projects/[id]/pull-sheet/import/route.ts', 'utf-8');
    expect(api).toContain('updateProjectById(id, { script_data');
    expect(api).toContain('mergePullSheetIntoScript');
    const ui = fs.readFileSync('components/project/pull-sheet-table.tsx', 'utf-8');
    expect(ui).toContain('回灌 CSV');
    expect(ui).toContain('pull-sheet/import');
  });
});
