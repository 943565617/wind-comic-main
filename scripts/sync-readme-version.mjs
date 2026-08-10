#!/usr/bin/env node
/**
 * v12.192 — README H1 版本号自动同步(治本:package.json 是单一真相)。
 * npm postversion 钩子调用;手动:node scripts/sync-readme-version.mjs
 */
import fs from 'fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const v = `v${pkg.version.replace(/\.0$/, '')}`;
for (const f of ['README.md', 'README.zh-CN.md']) {
  if (!fs.existsSync(f)) continue;
  let s = fs.readFileSync(f, 'utf-8');
  const before = s;
  s = s.replace(/<sub><sup>v[\d.]+<\/sup><\/sub>/, `<sub><sup>${v}</sup></sub>`);
  if (s !== before) { fs.writeFileSync(f, s); console.log(`${f} → ${v}`); }
}
