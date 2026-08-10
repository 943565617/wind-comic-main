/**
 * v12.261 — 神类瘦身:runWriter 从 hybrid-orchestrator(5517 行)抽到 services/agents/writer-agent.ts。
 * 行为逐字节保持(sed this→ctx + ctx 接口视图);此处锁住「已抽出 + orchestrator 委派 + 未残留裸 this」。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { runWriter } from '@/services/agents/writer-agent';

describe('v12.261 · runWriter 抽离', () => {
  it('writer-agent 导出 runWriter(ctx, plan)', () => {
    expect(typeof runWriter).toBe('function');
    expect(runWriter.length).toBe(2); // (ctx, plan)
  });
  it('orchestrator 只保留委派,不再内联实现', () => {
    const o = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(o).toContain("import { runWriter as runWriterAgent, type WriterAgentCtx } from './agents/writer-agent'");
    expect(o).toContain('return runWriterAgent(this as unknown as WriterAgentCtx, plan)');
    // 实现已迁走:orchestrator 里不该再有 runWriter 的 Writer 预算铁律
    expect(o).not.toContain('输出预算铁律');
  });
  it('抽出的模块无残留裸 this(sed 转换完整)', () => {
    const w = fs.readFileSync('services/agents/writer-agent.ts', 'utf-8');
    // 去掉注释/字符串近似:代码里不该出现 `this.`(应全为 ctx.)
    const codeThis = w.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//') && /\bthis\./.test(l));
    expect(codeThis).toEqual([]);
  });
});
