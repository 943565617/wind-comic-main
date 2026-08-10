#!/usr/bin/env node
/**
 * 「消费方门禁」CLI —— v12.240。
 *
 *   npm run gate:consumer            # 检查:有新增违规就 exit 1
 *   npm run gate:consumer -- --update  # 重写基线(清理完债、或确认新增合理时用)
 *   npm run gate:consumer -- --list    # 列出全部违规(含基线内的),用于挑债来还
 *
 * 由来:v12.218→239 二十多个版本里,「改了判定层却没跟到消费方」这个病犯了五次,
 * 每次都靠人肉对抗复检才发现(五轮 ~340 万 token)。复检只能发现已经发生的;
 * 这个门禁负责让**下一次新代码**当场被拦下。
 */
import path from 'path';
import { fileURLToPath } from 'url';

// 本文件由 tsx 运行(见 package.json 的 gate:consumer),因此可以直接 import TS 源。
// 注:早先试过 node + register('tsx/esm'),Node 25 已移除该用法 —— 项目里其他 TS 脚本
// (pg:migrate / s3:smoke)也都是直接用 tsx 跑的,保持一致。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { runConsumerGate } = await import(path.join(ROOT, 'lib/consumer-gate/scan.ts'));
const { partition, writeBaseline, BASELINE_PATH } = await import(path.join(ROOT, 'lib/consumer-gate/baseline.ts'));
const { RUNTIME_ONLY_GAPS } = await import(path.join(ROOT, 'lib/consumer-gate/contracts.ts'));

const args = process.argv.slice(2);
const violations = runConsumerGate(ROOT);

if (args.includes('--update')) {
  writeBaseline(ROOT, violations);
  console.log(`✅ 基线已重写:${BASELINE_PATH}(${violations.length} 条存量债)`);
  process.exit(0);
}

const { fresh, known, stale } = partition(ROOT, violations);

if (args.includes('--list')) {
  console.log(`全部命中 ${violations.length} 处(新增 ${fresh.length} / 存量 ${known.length})\n`);
  const by = {};
  for (const v of violations) (by[v.contractId] ||= []).push(v);
  for (const [id, list] of Object.entries(by)) {
    console.log(`━━ ${id}(${list.length})`);
    for (const v of list) console.log(`   ${v.file}:${v.line}  ${v.snippet.slice(0, 100)}`);
  }
  process.exit(0);
}

// ── 报告 ───────────────────────────────────────────────────────────────────
if (stale.length) {
  console.log(`ℹ️  基线里有 ${stale.length} 条已还清的债,建议跑 --update 收敛基线。`);
}

if (fresh.length === 0) {
  console.log(`✅ 消费方门禁通过(无新增违规;基线内存量债 ${known.length} 条待清理)`);
  console.log(`\n⚠️  门禁只覆盖静态可查的部分。以下这几类**扫不出来**,靠专门的运行时测试守:`);
  for (const g of RUNTIME_ONLY_GAPS) console.log(`   · ${g.gap}\n     由 ${g.guardedBy} 守`);
  process.exit(0);
}

console.error(`\n❌ 消费方门禁失败:新增 ${fresh.length} 处绕过唯一入口的写法\n`);
const grouped = {};
for (const v of fresh) (grouped[v.contractId] ||= []).push(v);
for (const [id, list] of Object.entries(grouped)) {
  const first = list[0];
  console.error(`━━━ ${id}`);
  console.error(`    规则:${first.rule}`);
  console.error(`    应走:${first.entry}`);
  console.error(`    病史:${first.incident}`);
  for (const v of list) console.error(`      → ${v.file}:${v.line}  ${v.snippet.slice(0, 100)}`);
  console.error('');
}
console.error(`怎么办(按优先级):`);
console.error(`  1. 改成走唯一入口 —— 绝大多数情况这才是对的;`);
console.error(`  2. 确属合法例外 → 加进 lib/consumer-gate/contracts.ts 的 allow,**并写清 why**;`);
console.error(`  3. 只有在批量重构等特殊情况下,才用 --update 把它收进基线(会在 diff 里被看见)。\n`);
process.exit(1);
