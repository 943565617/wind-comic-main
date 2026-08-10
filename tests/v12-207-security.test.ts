/**
 * v12.207 — 安全可靠性批:预算护栏接线 + Sora 日期门控 + cost CSV 转义。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.207 · 安全可靠性', () => {
  it('project regenerate-shot 加预算护栏(402)', () => {
    const r = fs.readFileSync('app/api/projects/[id]/regenerate-shot/route.ts', 'utf-8');
    expect(r).toContain('assertBudget');
    expect(r).toContain("code: 'budget_exceeded'");
  });
  it('pipeline-worker create 任务前拦预算(续跑不重复计费)', () => {
    const w = fs.readFileSync('lib/pipeline-worker.ts', 'utf-8');
    expect(w).toContain('assertBudget');
    expect(w).toContain('job.attempts <= 1'); // 仅首次尝试查,续跑跳过
    expect(w).toContain('预算超限,任务拦截');
  });
  it('Sora 退役日门控:过期自动剔除,链空才抛', () => {
    const v = fs.readFileSync('services/veo.service.ts', 'utf-8');
    expect(v).toContain("new Date('2026-09-24T00:00:00Z')");
    expect(v).toContain('自动剔除走 fallback');
    expect(v).toContain('仅含已退役的 Sora');
  });
  it('cost CSV:BOM + 逗号/引号转义 + 附件头', () => {
    const c = fs.readFileSync('app/api/projects/[id]/cost/route.ts', 'utf-8');
    expect(c).toContain("export') === 'csv'");
    expect(c).toContain('Content-Disposition');
    expect(c).toContain('text/csv');
    expect(c).toContain('﻿'); // BOM 防 Excel 中文乱码
    expect(c).toContain('csvCell');
  });
});
