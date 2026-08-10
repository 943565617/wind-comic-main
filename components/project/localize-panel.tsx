'use client';

/**
 * LocalizePanel (v12.202) — 出海多语版一键生成入口。
 *
 * 病根:POST /api/projects/:id/localize(v12.187 完整实现:LLM 只翻文案字段 + 结构 byte-identical
 * 校验 + script-<lang> 资产,apply:true 再套用+重配音)前端从无任何入口 —— 核心出海能力等于未交付。
 * 本面板挂在分发/交付区:选目标语种 → 生成译制剧本(先出稿)→ 满意再「套用并重配音」。
 * 需登录(cookie 自动带)。TTS 不可靠的语种如实标注。
 */

import { useState } from 'react';
import { listSupportedLanguages } from '@/lib/language-detect';

const LANGS = listSupportedLanguages().filter((l) => l.code !== 'zh'); // 母语 zh 无需译制

export function LocalizePanel({ projectId }: { projectId: string }) {
  const [lang, setLang] = useState('en');
  const [busy, setBusy] = useState<'idle' | 'gen' | 'apply'>('idle');
  const [result, setResult] = useState<{ language: string; title?: string; applied: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const call = async (apply: boolean) => {
    setBusy(apply ? 'apply' : 'gen'); setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/localize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang, apply }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message || '译制失败');
      setResult({ language: d.language, title: d.title, applied: !!d.applied });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '译制失败');
    } finally {
      setBusy('idle');
    }
  };

  const picked = LANGS.find((l) => l.code === lang);

  return (
    <div className="cinema-card p-4 mb-4">
      <h3 className="text-sm font-semibold text-white/90 mb-1">🌏 出海多语版</h3>
      <p className="text-[11px] text-white/45 mb-3">
        一键把剧本译制到目标语种(只翻台词/旁白,画面与结构不动),满意后套用并重新配音。对标阅文 ToonScroll 出海管线。
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={lang}
          onChange={(e) => { setLang(e.target.value); setResult(null); }}
          disabled={busy !== 'idle'}
          className="cinema-input !text-xs !py-1.5 max-w-[160px]"
        >
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>{l.nativeName} · {l.enName}</option>
          ))}
        </select>
        <button
          onClick={() => call(false)}
          disabled={busy !== 'idle'}
          className="cinema-btn-ghost !text-xs !py-1.5"
        >
          {busy === 'gen' ? '译制中…' : '生成译制剧本'}
        </button>
        {result && !result.applied && (
          <button
            onClick={() => call(true)}
            disabled={busy !== 'idle'}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/80 hover:bg-cyan-500 text-white disabled:opacity-40"
          >
            {busy === 'apply' ? '套用+重配音中…' : '套用并重配音'}
          </button>
        )}
      </div>
      {picked && !picked.ttsReliable && (
        <p className="text-[10px] text-amber-400/80 mt-2">⚠️ {picked.nativeName} 的 TTS 配音可能降级(仅字幕),画面与译制字幕不受影响。</p>
      )}
      {err && <p className="text-[11px] text-red-400 mt-2">{err}</p>}
      {result && (
        <p className="text-[11px] text-emerald-400/90 mt-2">
          ✓ 已生成《{result.title || '—'}》{result.language} 版剧本
          {result.applied ? ',并已套用+重配音(可在成片区查看)' : '(script-' + result.language + ' 资产,点「套用并重配音」出片)'}
        </p>
      )}
    </div>
  );
}
