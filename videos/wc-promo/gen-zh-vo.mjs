/**
 * 中文配音 —— 用平台自家 MiniMax TTS(speech-02-hd, presenter_male 旁白)生成 8 句中文旁白,
 * dogfood。输出 videos/wc-promo/assets/audio/zh{1..8}.mp3。Usage: node videos/wc-promo/gen-zh-vo.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
function loadEnv() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i < 0) continue;
    const k = t.slice(0, i).trim(); const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();
const KEY = process.env.MINIMAX_API_KEY || '';
const BASE = 'https://api.minimaxi.com/v1';
const OUTDIR = path.join(__dirname, 'assets', 'audio');
const VOICE = process.env.ZH_VOICE || 'presenter_male';

const LINES = [
  '一句话,一部短剧。',
  '青枫漫剧,你的 AI 短剧制作台。',
  '不止是生成:节奏审计、质量门禁、角色锁脸。',
  '同一个主角,跨镜跨集不漂移。',
  '三十多种画风任选,全片始终如一。',
  '横屏竖屏,一键出双版本。',
  '多集系列,持久队列,自动批量成片。',
  '一句话,生成你的第一部短剧。现在就开始。',
];

async function genOne(idx, text) {
  const body = {
    model: 'speech-02-hd', text, stream: false,
    voice_setting: { voice_id: VOICE, speed: 1.0, vol: 1.0, pitch: 0 },
    audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3', channel: 1 },
  };
  const r = await fetch(`${BASE}/t2a_v2`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok || (j?.base_resp?.status_code && j.base_resp.status_code !== 0)) {
    throw new Error(`${r.status} ${j?.base_resp?.status_msg || JSON.stringify(j).slice(0, 160)}`);
  }
  const hex = j?.data?.audio;
  if (typeof hex === 'string' && /^[0-9a-fA-F]+$/.test(hex.slice(0, 64))) {
    const out = path.join(OUTDIR, `zh${idx}.mp3`);
    fs.writeFileSync(out, Buffer.from(hex, 'hex'));
    return out;
  }
  throw new Error('no hex audio: ' + JSON.stringify(j).slice(0, 160));
}

async function main() {
  if (!KEY) { console.error('MINIMAX_API_KEY missing'); process.exit(1); }
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });
  console.log(`[zh-vo] voice=${VOICE}`);
  for (let i = 0; i < LINES.length; i++) {
    try { const out = await genOne(i + 1, LINES[i]); console.log(`  ✓ zh${i + 1} ${(fs.statSync(out).size / 1024).toFixed(0)}KB`); }
    catch (e) { console.log(`  ✗ zh${i + 1} ${e.message}`); process.exitCode = 2; }
  }
}
main();
