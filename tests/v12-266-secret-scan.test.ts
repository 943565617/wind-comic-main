/**
 * v12.266 — 全仓密钥扫描门禁(源于真实事件:用户发现自己有项目的 key 泄露,怀疑本项目源码是泄露源)。
 *
 * 本项目经全历史审计(909 commit / 10115 文本 blob)确认干净,但"今天干净"不等于"明天干净" ——
 * 且**只审 diff 是盲区**(早已提交的泄露永远不出现在新 diff 里)。故固化为门禁,每次 CI 都全量扫。
 *
 * 三层防线:
 *  ① **禁"你自己的"**(最强):从 .env.local(gitignored,永不提交)读出本机真实密钥,断言它们
 *     **不出现在任何被 git 跟踪的文件**里。比"禁某某前缀"强 —— 前缀名单永远追不全新厂商格式,
 *     而这条直接拿真值比对。CI 无 .env.local → 该条自动跳过,本地开发必跑(泄露正是在本地发生的)。
 *  ② **通用高信号模式**:sk-/ghp_/AKIA/JWT/私钥块… 扫全部被跟踪文件(= 会被推上 GitHub 的全部内容)。
 *  ③ **对外分发面 + 卫生**:.env.example 只许占位符;.gitignore 必须盖住 .env 各变体(含 .bak)。
 *
 * 失败信息一律**脱敏**(只报键名/路径/前4后4),绝不把密钥打进 CI 日志 —— 否则门禁自己成了泄露源。
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';

const mask = (s: string) => (s.length <= 10 ? `${s.slice(0, 2)}…(len=${s.length})` : `${s.slice(0, 4)}…${s.slice(-4)} (len=${s.length})`);

const BINARY = /\.(png|jpg|jpeg|gif|webp|mp4|mp3|wav|woff2?|ttf|otf|ico|pdf|zip|lock)$/i;

/** 被 git 跟踪的全部文本文件 = 推上 GitHub / 打进开源包的全部内容。读一次,三条测试共用。 */
const tracked: Array<{ path: string; text: string }> = (() => {
  const files = execSync('git ls-files', { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter(Boolean).filter((f) => !BINARY.test(f));
  const out: Array<{ path: string; text: string }> = [];
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (st.size > 5 * 1024 * 1024) continue;
      out.push({ path: f, text: fs.readFileSync(f, 'utf-8') });
    } catch { /* 软链/已删除等,跳过 */ }
  }
  return out;
})();

describe('v12.266 · ① 本机真实密钥不得进入被跟踪文件(禁"你自己的",强于禁前缀)', () => {
  const envLocal = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf-8') : null;

  it.skipIf(!envLocal)('.env.local 中的每个真实密钥都不出现在任何被 git 跟踪的文件里', () => {
    const secrets: Array<{ name: string; value: string }> = [];
    for (const raw of (envLocal || '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const name = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      // 只盯"看起来是密钥"的:键名含 KEY/TOKEN/SECRET/PASSWORD,值够长,且不是 URL/布尔/数字
      if (!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) continue;
      if (value.length < 20) continue;
      if (/^https?:\/\//i.test(value)) continue;
      secrets.push({ name, value });
    }
    const leaks: string[] = [];
    for (const { name, value } of secrets) {
      for (const f of tracked) {
        if (f.text.includes(value)) leaks.push(`${name} → ${f.path}  ${mask(value)}`);
      }
    }
    expect(leaks, `真实密钥出现在被跟踪文件中(会被推上 GitHub!):\n${leaks.join('\n')}`).toEqual([]);
    // 保底:确实扫到了东西才算这条有效(.env.local 被清空时不该假绿)
    expect(secrets.length).toBeGreaterThan(0);
  });
});

describe('v12.266 · ② 通用高信号密钥模式(全部被跟踪文件)', () => {
  // 已知合成样本:测 PII 脱敏护栏用的假 key,不是真密钥
  const ALLOW = [/1234567890abcdefghijklmn/, /abcdefghijklmnopqrstuvwxyz0123456789/];
  const PLACEHOLDER = /(your|example|placeholder|xxx+|<[^>]+>|\.\.\.|change[-_ ]?me|dummy|sample|replace|random|填写|在此|占位)/i;

  const PATTERNS: Array<[string, RegExp]> = [
    ['sk- 系 API key', /\bsk-[A-Za-z0-9_-]{20,}/g],
    ['JWT(MiniMax 等)', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
    ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/g],
    ['AWS AKIA', /\bAKIA[0-9A-Z]{16}\b/g],
    ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
    ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
    ['PyPI token', /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,}/g],
    ['ModelScope/HF token', /\b(ms-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|hf_[A-Za-z0-9]{30,})\b/g],
    ['私钥块', /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g],
  ];

  it('无真实密钥形态的字符串(合成测试样本已白名单)', () => {
    const hits: string[] = [];
    for (const f of tracked) {
      for (const [kind, re] of PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(f.text)) !== null) {
          const val = m[0];
          if (ALLOW.some((a) => a.test(val))) continue;
          const ls = f.text.lastIndexOf('\n', m.index) + 1;
          let le = f.text.indexOf('\n', m.index);
          if (le === -1) le = f.text.length;
          if (PLACEHOLDER.test(f.text.slice(ls, le))) continue;
          const lineNo = f.text.slice(0, m.index).split('\n').length;
          hits.push(`${f.path}:${lineNo} [${kind}] ${mask(val)}`);
        }
      }
    }
    expect(hits, `疑似真实密钥(已脱敏):\n${hits.join('\n')}`).toEqual([]);
  });

  it('扫描面本身有效:确实覆盖了上千个被跟踪文件(防"扫了个空"假绿)', () => {
    expect(tracked.length).toBeGreaterThan(500);
    expect(tracked.some((f) => f.path === 'package.json')).toBe(true);
  });
});

describe('v12.266 · ③ 对外分发面 + env 卫生', () => {
  it('.env.example 全是空值或占位符(绝不含真实密钥)', () => {
    const src = fs.readFileSync('.env.example', 'utf-8');
    const bad: string[] = [];
    for (const raw of src.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const name = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) continue;
      // 允许:空值、占位符;禁止:长得像真密钥的值
      if (value.length >= 20 && !/(your|example|placeholder|xxx+|<|\.\.\.|change[-_ ]?me|dummy|sample|replace|random|填写|在此)/i.test(value)) {
        bad.push(`${name} = ${mask(value)}`);
      }
    }
    expect(bad, `.env.example 疑似含真实密钥:\n${bad.join('\n')}`).toEqual([]);
  });

  it('.gitignore 盖住 .env 各变体(含 v12.219 补的 .bak 旁路)', () => {
    const gi = fs.readFileSync('.gitignore', 'utf-8');
    expect(gi).toMatch(/^\.env\*?\.local$/m);
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.env\*\.bak\*$/m);
  });

  it('.env.local 本身绝不被 git 跟踪', () => {
    const trackedEnv = execSync('git ls-files', { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example'));
    expect(trackedEnv, `以下 .env 文件被 git 跟踪(有泄露风险):\n${trackedEnv.join('\n')}`).toEqual([]);
  });
});
