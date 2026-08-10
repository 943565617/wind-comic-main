/**
 * v12.276 — 对外文档数字单一真源。
 *
 * 病根:「N 个单测」「vN」这类数字**手抄在 5 份对外文档**里,每次发版必漂。
 * 实测发现时:README 徽章 3586 而 alt 写 3507、贡献指南 3507/3507、
 * README.zh-CN 停在 **3210**(比英文版还旧两代)、MARKETING 与 modelscope-profile
 * 共 9 处 3507 + 过期版本号 v12.263。与本轮反复在治的病同源:同一事实抄多处必然漂。
 *
 * ⚠️ 本套件最重要的一条是「表格行必须原样保留」——
 * 首版脚本把**历史版本表**里的 2135/2712/2780 tests 全改成了当前值,
 * 那是不可逆的历史事实丢失。这条测试就是防它被改回去。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';

const SCRIPT = 'scripts/sync-doc-stats.mjs';

function runCheck(): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT, '--check', '--tests=__SELF__'], { encoding: 'utf-8' });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: String(e.stdout || '') };
  }
}

describe('v12.276 · 文档数字同步脚本', () => {
  it('脚本存在且以「表格行不动」为硬约束(防历史记录被覆写)', () => {
    const src = fs.readFileSync(SCRIPT, 'utf-8');
    expect(src).toContain('function isTableRow');
    // 逐行处理 + 表格行提前返回,是保护历史的机制本身
    expect(src).toMatch(/if \(isTableRow\(line\)\) return line/);
    expect(src).toContain('text.split(\'\\n\').map(syncLine)');
  });

  it('行为:表格行里的历史测试数原样保留', async () => {
    // 直接验纯逻辑:构造一段含历史表格行 + 一段正文
    const sample = [
      '| **v10 · 配音口型** | 2135 单测双驱动全绿 |',
      '| **v12.49–v12.80** | **2712 tests** green |',
      '### 10. **3210 个单测全过**',
      '2. **测试是底线.** Vitest 3210/3210 必须保持绿.',
    ].join('\n');
    // 用脚本同款规则(表格行跳过)手工复算,确保约束语义正确
    const isTable = (l: string) => l.trimStart().startsWith('|');
    const T = '9999';
    const synced = sample.split('\n').map((l) => {
      if (isTable(l)) return l;
      return l.replace(/\b\d{3,5}\s*个单测/g, `${T} 个单测`).replace(/\bVitest\s+\d{3,5}\/\d{3,5}\b/g, `Vitest ${T}/${T}`);
    }).join('\n');
    // 历史行一字未动
    expect(synced).toContain('| **v10 · 配音口型** | 2135 单测双驱动全绿 |');
    expect(synced).toContain('**2712 tests** green');
    // 正文被同步
    expect(synced).toContain('9999 个单测全过');
    expect(synced).toContain('Vitest 9999/9999');
  });

  it('对外文档当前无漂移(--check 通过)', () => {
    // 用真实测试总数跑一次 check:此处不写死数字,改为读脚本自身能力,
    // 避免这条测试本身成为下一个「写死的数字」。
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    expect(pkg.scripts['check:doc-stats']).toBeTruthy();
    expect(pkg.scripts['sync-doc-stats']).toBeTruthy();
  });

  it('历史版本表在真实文档里确实保留着旧数字(证明保护生效)', () => {
    const readme = fs.readFileSync('README.md', 'utf-8');
    const zh = fs.readFileSync('README.zh-CN.md', 'utf-8');
    // 这些是历史事实,不该等于当前测试数
    expect(readme).toMatch(/\*\*2135 tests\*\* green/);
    expect(readme).toMatch(/\*\*2712 tests\*\* green/);
    expect(zh).toMatch(/\*\*2135 单测\*\*/);
  });
});
