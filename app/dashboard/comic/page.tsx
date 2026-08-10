'use client';

/**
 * /dashboard/comic · 漫转视频分格台(v12.250 前端入口 → v12.247 /api/comic/panels)
 *
 * 漫转视频模式的前端入口:传一张漫画 → 后端用投影法自动**分格**(检出每格边界框)→
 * 本页把格子框叠在原图上可视化。
 *
 * 诚实边界:分格 → **裁图**(v12.252,sharp 真裁出每格)→ 每格图交给单图变视频(u2v)加动效 →
 * 卡点拼接成动态漫剧。本页做到「分格 + 裁图 + 一键交接 u2v」;拼接复用既有 video-composer,是下一步。
 * 投影法对条漫/规则网格准;不规则跨栏布局切不准(需 CV,暂不支持),后端 hint 会提示。
 */

import { useRef, useState } from 'react';
import { Upload, Link as LinkIcon, GridFour, Warning as AlertTriangle, CircleNotch as Loader2, Rows, Scissors, FilmReel, Download, FilmSlate, X, Sparkle as Sparkles } from '@phosphor-icons/react';
import Link from 'next/link';
import { useToast } from '@/components/ui/toast-provider';

interface Panel { x: number; y: number; w: number; h: number; row: number; col: number; }
interface CroppedPanel extends Panel { url: string; }

// 分格框轮换配色(相邻格不同色,肉眼好数)。
const BOX_COLORS = ['#E8C547', '#4A7EBB', '#3F8F7A', '#C4576D', '#9B6DC4', '#D4883B'];

export default function ComicPanelsPage() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [urlDraft, setUrlDraft] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [panels, setPanels] = useState<Panel[] | null>(null);
  const [summary, setSummary] = useState('');
  const [hint, setHint] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  // v12.252 裁图态
  const [cropping, setCropping] = useState(false);
  const [cropped, setCropped] = useState<CroppedPanel[] | null>(null);
  const [cropError, setCropError] = useState('');
  // v12.256 真片段 → 动态漫剧:按分格顺序贴每格动效片段,顺序拼接
  const [dramaClips, setDramaClips] = useState<string[]>([]);
  const [clipDraft, setClipDraft] = useState('');
  const [dramaMusic, setDramaMusic] = useState('');
  const [composing, setComposing] = useState(false);
  const [dramaUrl, setDramaUrl] = useState('');
  const [dramaMusicDropped, setDramaMusicDropped] = useState(false); // 配乐被丢(格式不对/超 64MB)→ 诚实提示
  const [dramaError, setDramaError] = useState('');
  const { showToast } = useToast();

  const addDramaClip = () => {
    const u = clipDraft.trim();
    if (!u) return;
    if (!/^(https?:\/\/|\/api\/serve-file)/.test(u)) { showToast({ title: '片段 URL 需为 http(s) 或站内 serve-file', type: 'error' }); return; }
    setDramaClips((prev) => (prev.includes(u) ? prev : [...prev, u]).slice(0, 30));
    setClipDraft('');
  };

  const composeDrama = async () => {
    if (dramaClips.length < 2) { showToast({ title: '至少两段片段才能拼成动态漫剧', type: 'error' }); return; }
    setComposing(true);
    setDramaUrl(''); setDramaMusicDropped(false); setDramaError('');
    try {
      const res = await fetch('/api/comic/compose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoClips: dramaClips, musicUrl: dramaMusic.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        const msg = body?.message || `合成失败 (HTTP ${res.status})`;
        setDramaError(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      setDramaUrl(body.finalVideoUrl || '');
      setDramaMusicDropped(!!body.musicDropped);
      showToast({ title: body.musicDropped ? '动态漫剧已合成(配乐被跳过)' : '动态漫剧已合成', type: body.musicDropped ? 'warning' : 'success' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误,合成失败';
      setDramaError(msg); showToast({ title: msg, type: 'error' });
    } finally {
      setComposing(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { showToast({ title: '只能上传图片', type: 'error' }); return; }
    if (file.size > 10 * 1024 * 1024) { showToast({ title: '图片太大(上限 10MB)', type: 'error' }); return; }
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/upload/character-face', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showToast({ title: body.error || '上传失败', type: 'error' }); return; }
      resetResult();
      setImageUrl(body.url);
      setImagePreview(body.url);
    } catch (e) {
      // 断网/传输层失败:fetch 直接 throw,若不接住就是静默的未处理 rejection、用户毫无反馈。
      showToast({ title: e instanceof Error ? e.message : '上传失败,请检查网络', type: 'error' });
    }
  };

  const acceptUrl = async () => {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) { showToast({ title: 'URL 必须以 http(s):// 开头', type: 'error' }); return; }
    try {
      const res = await fetch('/api/upload/character-face', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showToast({ title: body.error || 'URL 抓取失败', type: 'error' }); return; }
      resetResult();
      setImageUrl(body.url);
      setImagePreview(body.url);
      setShowUrlInput(false);
      setUrlDraft('');
    } catch (e) {
      showToast({ title: e instanceof Error ? e.message : 'URL 抓取失败,请检查网络', type: 'error' });
    }
  };

  const resetResult = () => { setPanels(null); setSummary(''); setHint(''); setErrorMsg(''); setNatural(null); setCropped(null); setCropError(''); };

  const detect = async () => {
    if (!imageUrl) { showToast({ title: '先上传一张漫画图', type: 'error' }); return; }
    setDetecting(true);
    setPanels(null); setErrorMsg(''); setHint(''); setCropped(null); setCropError('');
    try {
      const res = await fetch('/api/comic/panels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body.message || `分格失败 (HTTP ${res.status})`;
        setErrorMsg(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      setPanels(body.panels || []);
      setSummary(body.summary || '');
      setHint(body.hint || '');
      showToast({ title: `检出 ${body.panelCount} 格`, type: 'success' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误,分格失败';
      setErrorMsg(msg); showToast({ title: msg, type: 'error' });
    } finally {
      setDetecting(false);
    }
  };

  /** 裁图:把检出的每格从原图真正裁出来,得到可喂给单图变视频的素材图。 */
  const crop = async () => {
    if (!imageUrl) return;
    setCropping(true);
    setCropped(null); setCropError('');
    try {
      const res = await fetch('/api/comic/crop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        const msg = body?.message || `裁图失败 (HTTP ${res.status})`;
        setCropError(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      const list: CroppedPanel[] = Array.isArray(body.panels) ? body.panels : [];
      setCropped(list);
      if (list.length === 0) {
        // 0 格不是「成功裁出 0 格」—— 把后端 hint 显出来,给 warning 而非 success,别误导。
        const msg = body.hint || '未裁出格子(不规则布局投影法切不准)';
        setCropError(msg); showToast({ title: '未裁出格子', type: 'warning' });
      } else {
        showToast({ title: `已裁出 ${body.count} 格`, type: 'success' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误,裁图失败';
      setCropError(msg); showToast({ title: msg, type: 'error' });
    } finally {
      setCropping(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GridFour className="w-6 h-6 text-[#E8C547]" weight="duotone" />
          漫转视频 · 分格台
        </h1>
        <p className="text-sm text-[var(--soft)] mt-1">
          传一张漫画 → 投影法自动检出每格边界(条漫/规则网格最准)。分格后每格加动效 → 拼成动态漫剧(下一步)。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 输入区 */}
        <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <label className="text-xs text-[var(--soft)] uppercase tracking-wider">漫画图</label>
          <div
            onClick={() => !imagePreview && fileRef.current?.click()}
            className={`aspect-[3/4] max-h-[420px] rounded-xl overflow-hidden flex items-center justify-center border relative ${
              imagePreview ? 'border-[#E8C547]/30 bg-black/20' : 'cursor-pointer border-dashed border-white/15 bg-white/[0.02] hover:bg-white/5'
            }`}
          >
            {imagePreview ? (
              // 原图 + 分格框叠层。框用百分比定位,自适应任意显示尺寸。
              <div className="relative w-full h-full">
                <img
                  loading="lazy" decoding="async" src={imagePreview} alt="comic"
                  className="w-full h-full object-contain"
                  onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
                {panels && natural && natural.w > 0 && natural.h > 0 && panels.map((p, i) => (
                  <div
                    key={i}
                    className="absolute border-2 grid place-items-start"
                    style={{
                      left: `${(p.x / natural.w) * 100}%`, top: `${(p.y / natural.h) * 100}%`,
                      width: `${(p.w / natural.w) * 100}%`, height: `${(p.h / natural.h) * 100}%`,
                      borderColor: BOX_COLORS[i % BOX_COLORS.length],
                      boxShadow: `inset 0 0 0 9999px ${BOX_COLORS[i % BOX_COLORS.length]}12`,
                    }}
                  >
                    <span className="text-[10px] font-mono font-bold px-1 rounded-br" style={{ background: BOX_COLORS[i % BOX_COLORS.length], color: '#000' }}>
                      {i + 1}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-[var(--soft)]">
                <Upload className="w-7 h-7 mx-auto mb-1 opacity-50" />
                <div className="text-xs">点击上传 或 用 URL</div>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); if (fileRef.current) fileRef.current.value = ''; }} />
          <div className="flex gap-2">
            <button onClick={() => fileRef.current?.click()} className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs inline-flex items-center justify-center gap-1.5">
              <Upload className="w-3.5 h-3.5" /> 上传文件
            </button>
            <button onClick={() => setShowUrlInput(v => !v)} className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs inline-flex items-center justify-center gap-1.5">
              <LinkIcon className="w-3.5 h-3.5" /> 用 URL
            </button>
          </div>
          {showUrlInput && (
            <div className="flex gap-1">
              <input type="url" value={urlDraft} onChange={e => setUrlDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') acceptUrl(); }} placeholder="https://..."
                className="flex-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded focus:outline-none focus:border-[#E8C547]/50" />
              <button onClick={acceptUrl} disabled={!urlDraft.trim()} className="px-3 py-1 text-xs rounded bg-[#E8C547]/15 text-[#E8C547] hover:bg-[#E8C547]/25 disabled:opacity-40">抓取</button>
            </div>
          )}

          <button
            onClick={detect}
            disabled={detecting || !imageUrl}
            className="w-full px-4 py-2.5 rounded-xl bg-[#E8C547] hover:bg-[#E8C547]/90 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold inline-flex items-center justify-center gap-2"
          >
            {detecting ? (<><Loader2 className="w-4 h-4 animate-spin" /> 分格中…</>) : (<><Rows className="w-4 h-4" weight="bold" /> 自动分格</>)}
          </button>
        </div>

        {/* 结果区 */}
        <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5">
          <label className="text-xs text-[var(--soft)] uppercase tracking-wider">分格结果</label>
          {errorMsg ? (
            <div className="mt-3 text-center py-8">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-400" />
              <div className="text-sm text-rose-300 mb-1">分格失败</div>
              <div className="text-[11px] text-white/50">{errorMsg}</div>
            </div>
          ) : panels ? (
            <div className="mt-3">
              <div className="text-sm text-white font-medium mb-3">{summary}</div>
              {panels.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead>
                      <tr className="text-[var(--soft)] text-left border-b border-white/10">
                        <th className="py-1.5 pr-3 font-medium">格</th>
                        <th className="py-1.5 pr-3 font-medium">行/列</th>
                        <th className="py-1.5 pr-3 font-medium">x,y</th>
                        <th className="py-1.5 font-medium">宽×高</th>
                      </tr>
                    </thead>
                    <tbody>
                      {panels.map((p, i) => (
                        <tr key={i} className="border-b border-white/5 last:border-0">
                          <td className="py-1.5 pr-3">
                            <span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: BOX_COLORS[i % BOX_COLORS.length] }} />
                            <span className="text-white align-middle">{i + 1}</span>
                          </td>
                          <td className="py-1.5 pr-3 text-[var(--muted)]">{p.row}/{p.col}</td>
                          <td className="py-1.5 pr-3 text-[var(--muted)]">{p.x},{p.y}</td>
                          <td className="py-1.5 text-[var(--muted)]">{p.w}×{p.h}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-[13px] text-[var(--soft)] py-4">没检出格子。</div>
              )}
              {hint && <p className="text-[11px] text-amber-300/80 mt-3 leading-relaxed">⚠ {hint}</p>}

              {/* v12.252 裁图:把每格裁成真图,再一键交给单图变视频加动效 */}
              {panels.length > 0 && (
                <button
                  onClick={crop}
                  disabled={cropping}
                  className="mt-4 w-full px-4 py-2 rounded-xl bg-[#E8C547] hover:bg-[#E8C547]/90 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold inline-flex items-center justify-center gap-2 text-sm"
                >
                  {cropping ? (<><Loader2 className="w-4 h-4 animate-spin" /> 裁图中…</>) : (<><Scissors className="w-4 h-4" weight="bold" /> 裁切分格图</>)}
                </button>
              )}
              {cropError && <div className="mt-2 text-[12px] text-rose-300">✕ {cropError}</div>}

              {cropped && cropped.length > 0 && (
                <div className="mt-4">
                  <div className="text-[12px] text-white font-medium mb-2">分格图({cropped.length})—— 每格可下载,或直接送去加动效:</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {cropped.map((c, i) => (
                      <div key={i} className="rounded-lg overflow-hidden border border-white/10 bg-black/20">
                        <img loading="lazy" decoding="async" src={c.url} alt={`分格 ${i + 1}`} className="w-full h-auto object-contain bg-black/30" />
                        <div className="flex items-center justify-between px-2 py-1.5 gap-1">
                          <span className="text-[10px] text-[var(--soft)]">第 {i + 1} 格</span>
                          <div className="flex items-center gap-1.5">
                            <a href={c.url} target="_blank" rel="noopener" title="下载此格" className="text-[var(--soft)] hover:text-white"><Download className="w-3.5 h-3.5" /></a>
                            <Link
                              href={`/dashboard/u2v?image=${encodeURIComponent(c.url)}`}
                              title="用此格做单图变视频"
                              className="inline-flex items-center gap-1 text-[10px] text-[#E8C547] hover:text-[#E8C547]/80"
                            >
                              <FilmReel className="w-3.5 h-3.5" /> 动效
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-[var(--soft)] mt-3 opacity-70 leading-relaxed">
                ✦ 流程:分格 → 裁图(本页)→ 每格「单图变视频」加动效 → 下面**按分格顺序**贴回真片段拼成动态漫剧。
              </p>

              {/* v12.256 真片段 → 动态漫剧:按分格顺序贴每格动效片段,顺序拼接 + 可选配乐 */}
              <div className="mt-5 pt-4 border-t border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <FilmSlate className="w-4 h-4 text-[#E8C547]" weight="duotone" />
                  <span className="text-sm text-white font-medium">拼成动态漫剧 · 真片段按分格顺序</span>
                </div>
                <p className="text-[11px] text-[var(--soft)] mb-3 opacity-70 leading-relaxed">
                  把每格「单图变视频」出的成片 URL **按阅读顺序**贴进来(≥2 段),顺序拼接成动态漫剧。可选配乐。
                  片段最好同编码/分辨率(通常同一 provider 出的就是),否则顺序拼接可能报错。
                </p>

                {dramaClips.length > 0 && (
                  <ul className="space-y-1 mb-2">
                    {dramaClips.map((u, i) => (
                      <li key={i} className="flex items-center gap-2 text-[11px] bg-black/25 rounded px-2 py-1">
                        <span className="w-4 h-4 rounded bg-[#E8C547]/15 text-[#E8C547] grid place-items-center font-mono shrink-0">{i + 1}</span>
                        <span className="flex-1 truncate text-[var(--muted)]" title={u}>{u}</span>
                        <button onClick={() => setDramaClips((prev) => prev.filter((_, j) => j !== i))} title="移除" className="text-[var(--soft)] hover:text-rose-300"><X className="w-3 h-3" /></button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-1.5 mb-2">
                  <input
                    type="url" value={clipDraft} onChange={e => setClipDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addDramaClip(); }}
                    placeholder="第 N 格的动效片段 URL(http(s) 或站内 serve-file)"
                    className="flex-1 px-2 py-1.5 bg-black/30 border border-white/10 rounded text-xs focus:outline-none focus:border-[#E8C547]/50"
                  />
                  <button onClick={addDramaClip} disabled={!clipDraft.trim()} className="px-3 py-1 text-xs rounded bg-[#E8C547]/15 text-[#E8C547] hover:bg-[#E8C547]/25 disabled:opacity-40">加片段</button>
                </div>
                <input
                  type="url" value={dramaMusic} onChange={e => setDramaMusic(e.target.value)}
                  placeholder="配乐 URL(可选,http(s) 或站内 serve-file)"
                  className="w-full px-3 py-2 mb-3 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-xs"
                />
                <button
                  onClick={composeDrama}
                  disabled={composing || dramaClips.length < 2}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#E8C547] hover:bg-[#E8C547]/90 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold inline-flex items-center justify-center gap-2 text-sm"
                >
                  {composing ? (<><Loader2 className="w-4 h-4 animate-spin" /> 拼接中…</>) : (<><FilmSlate className="w-4 h-4" weight="bold" /> 拼成动态漫剧({dramaClips.length} 段)</>)}
                </button>
                {dramaError && <div className="mt-2 text-[12px] text-rose-300">✕ {dramaError}</div>}
                {dramaUrl && (
                  <div className="mt-4">
                    <div className="text-[12px] text-emerald-400 mb-2 inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4" weight="duotone" /> 动态漫剧合成完成</div>
                    {dramaMusicDropped && (
                      <div className="text-[11px] text-amber-300/85 mb-2">⚠ 配乐未生效(URL 格式不对或超 64MB 被限流)—— 成片无 BGM,其余正常。</div>
                    )}
                    <video src={dramaUrl} controls className="w-full rounded-xl bg-black/40 max-h-[460px]" />
                    <a href={dramaUrl} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-white">
                      <Download className="w-3.5 h-3.5" /> 打开 / 下载动态漫剧
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3 text-center text-[var(--soft)] text-sm opacity-60 py-10">
              上传漫画后点「自动分格」——检出的格子会框在左图上,明细列在这里。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
