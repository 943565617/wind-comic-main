/**
 * 宣传片「30+ 画风墙」配图重生 —— 每格一个**截然不同**的主体/媒介/配色,
 * 解决旧版「8 张都是黄昏天台上的女人」的雷同问题。MiniMax image-01。
 * 输出到 videos/wc-promo/assets/<name>.jpg。Usage: node videos/wc-promo/gen-wall.mjs
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
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const MM_KEY = process.env.MINIMAX_API_KEY || '';
const MM_BASE = 'https://api.minimaxi.com/v1';
const OUT = path.join(__dirname, 'assets');
const CONCURRENCY = 3;

// 每格:独立场景 + 独立媒介 + 独立配色,最大化视觉差异
const STYLES = [
  { id: 'cyberpunk', prompt: 'Cyberpunk close-up portrait of a young woman street-hacker with a glowing cyan cybernetic eye implant, rain-soaked neon alley at night, pink and teal holographic billboards, Blade Runner atmosphere, cinematic photoreal, volumetric haze, ultra detailed' },
  { id: 'makoto-shinkai', prompt: 'Makoto Shinkai style anime scenery, two students standing on a rural countryside train platform under an enormous luminous sky filled with towering cumulus clouds at golden sunset, dramatic god rays and lens flare, ultra detailed background art, vivid blue and warm orange' },
  { id: 'american-comic', prompt: 'Classic American superhero comic book panel, a caped hero in a dynamic flying punch pose, bold thick black ink outlines, Ben-Day halftone dot shading, saturated primary red yellow and blue, dramatic action speed lines, retro print texture' },
  { id: 'shounen', prompt: 'Japanese shounen battle anime, a determined spiky-haired young hero powering up a blazing golden energy aura, crackling electricity, swirling dust and debris, dramatic motion lines, explosive dynamic composition, vivid saturated cel shading' },
  { id: 'mihoyo-game', prompt: 'Genshin Impact style gacha splash art, an elegant fantasy heroine in an ornate flowing embroidered silk dress conjuring glowing blue ice-crystal magic, lush vibrant fantasy garden background, HoYoverse anime, high gloss, ultra detailed, saturated colors' },
  { id: 'gothic', prompt: 'Dark gothic oil painting, a pale aristocratic lady in an elaborate Victorian black lace gown standing inside a candlelit cathedral, towering stained glass windows, baroque chiaroscuro lighting, deep shadows, romantic and ornate, old master style' },
  { id: 'vaporwave', prompt: 'Vaporwave aesthetic artwork, a chrome classical Roman bust statue floating above a glowing magenta wireframe grid, pink and cyan gradient sky, palm tree silhouettes, retro 80s synthwave, subtle glitch effects, dreamy surreal' },
  { id: 'ink-wash', prompt: 'Traditional Chinese ink wash painting, shuimo style, a lone wuxia martial artist leaping between misty mountain peaks, sweeping black brush strokes and ink splashes, vast empty negative space, rice paper texture, monochrome with a single small red seal stamp' },
];

function dest(id) { return path.join(OUT, `${id}.jpg`); }

async function genOne(id, prompt, attempt = 0) {
  const r = await fetch(`${MM_BASE}/image_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MM_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'image-01', prompt: prompt.slice(0, 1400), aspect_ratio: '4:3', n: 1 }),
  });
  const j = await r.json();
  const code = j?.base_resp?.status_code;
  if (!r.ok || (code !== 0 && code !== undefined)) {
    const msg = `image-01 ${r.status} code=${code} ${j?.base_resp?.status_msg || JSON.stringify(j).slice(0, 120)}`;
    // 1026 敏感词 → 去掉可能触发的词重试一次
    if (code === 1026 && attempt === 0) {
      const soft = prompt.replace(/punch|battle|explosive|crackling electricity|energy aura/gi, 'dynamic action');
      return genOne(id, soft, 1);
    }
    throw new Error(msg);
  }
  const url = j?.data?.image_urls?.[0];
  if (!url) throw new Error('no image url: ' + JSON.stringify(j).slice(0, 160));
  const img = await fetch(url);
  if (!img.ok) throw new Error(`download ${img.status}`);
  fs.writeFileSync(dest(id), Buffer.from(await img.arrayBuffer()));
}

async function main() {
  if (!MM_KEY) { console.error('MINIMAX_API_KEY missing'); process.exit(1); }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const force = process.argv.includes('--force');
  const todo = STYLES.filter((s) => force || !fs.existsSync(dest(s.id)) || fs.statSync(dest(s.id)).mtimeMs < Date.parse('2026-06-21T23:55:00'));
  console.log(`[wall] total=${STYLES.length} todo=${todo.length} concurrency=${CONCURRENCY}`);
  const failed = [];
  let done = 0, idx = 0;
  async function worker() {
    while (idx < todo.length) {
      const s = todo[idx++];
      const t0 = Date.now();
      try { await genOne(s.id, s.prompt); done++; console.log(`  ✓ ${s.id} ${Date.now() - t0}ms [${done}/${todo.length}]`); }
      catch (e) { failed.push({ id: s.id, err: e?.message || String(e) }); console.log(`  ✗ ${s.id} ${e?.message || e}`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n[wall] DONE ok=${done} failed=${failed.length}`);
  if (failed.length) { console.log('failed:'); failed.forEach((f) => console.log(`  - ${f.id}: ${f.err}`)); process.exitCode = 2; }
}
main();
