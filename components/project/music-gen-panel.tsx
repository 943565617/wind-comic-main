'use client';

/**
 * MusicGenPanel (v12.203) — AI 作曲 BGM 生成入口。
 *
 * 病根:MiniMax music-2.6 生成(generateMusic)早已实现,前端零入口。本面板按剧情/风格描述
 * 一键生成免版权 BGM → 存为 music 资产(recompose 自动作背景乐)。诚实降级:失败给明确指引。
 */

import { useState } from 'react';

export function MusicGenPanel({ projectId }: { projectId: string }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const gen = async () => {
    setBusy(true); setErr(null); setUrl(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/music`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message || '生成失败');
      setUrl(d.musicUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cinema-card p-4 mb-4">
      <h3 className="text-sm font-semibold text-white/90 mb-1">🎵 AI 作曲(免版权 BGM)</h3>
      <p className="text-[11px] text-white/45 mb-3">
        按剧情/风格描述生成专属背景乐(MiniMax music-2.6),存为项目配乐,重新合成时自动用作 BGM。
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy}
          placeholder="例:悬疑 noir,低频大提琴,节奏沉重"
          className="cinema-input !text-xs !py-1.5 flex-1 min-w-[200px]"
        />
        <button onClick={gen} disabled={busy || prompt.trim().length < 4} className="cinema-btn-ghost !text-xs !py-1.5">
          {busy ? '作曲中…(约1分钟)' : '生成 BGM'}
        </button>
      </div>
      {err && <p className="text-[11px] text-red-400 mt-2">{err}</p>}
      {url && (
        <div className="mt-2">
          <audio src={url} controls className="w-full h-8" />
          <p className="text-[10px] text-emerald-400/80 mt-1">✓ 已存为项目配乐,重新合成即用作 BGM。</p>
        </div>
      )}
    </div>
  );
}
