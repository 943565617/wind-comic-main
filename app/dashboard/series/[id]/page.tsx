'use client';

/**
 * 系列剧面板(阶段二十六 · v12.18.0)—— 看整季各集状态 + 一键批量生成。
 * 各集 draft→active→completed;有「生成中」时每 5s 轮询刷新。
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { getSystemLanguage } from '@/lib/system-language';
import { languageDisplayName } from '@/lib/language-detect';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { FilmStrip as Film, CircleNotch as Loader2, CheckCircle as CheckCircle2, Clock, Play, ArrowLeft, Image as ImageIcon, DownloadSimple } from '@phosphor-icons/react';
import { useLocale } from '@/hooks/use-locale';
import { DramaPackageButton } from '@/components/project/drama-package-button';

interface Episode { id: string; title: string; status: string; episode_number: number | null; aspect: string | null }

const STATUS_CLS: Record<string, string> = {
  draft: 'text-gray-400 bg-white/5 border-white/10',
  active: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  completed: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  failed: 'text-red-300 bg-red-500/10 border-red-500/30',
};

export default function SeriesPanel() {
  const params = useParams();
  const seriesId = String(params?.id || '');
  const { t } = useLocale();

  const STATUS: Record<string, { label: string; cls: string }> = {
    draft: { label: t.seriesDetail.statusDraft, cls: STATUS_CLS.draft },
    active: { label: t.seriesDetail.statusActive, cls: STATUS_CLS.active },
    completed: { label: t.seriesDetail.statusCompleted, cls: STATUS_CLS.completed },
    failed: { label: t.seriesDetail.statusFailed, cls: STATUS_CLS.failed },
  };

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  // v12.155:逐集体检(后台拉,徽章渐进);全季补渲(逐集调 failed-videos,串行防抢引擎额度)
  const [healthMap, setHealthMap] = useState<Record<string, any> | null>(null);
  const [seasonFixBusy, setSeasonFixBusy] = useState(false);
  const [seasonFixMsg, setSeasonFixMsg] = useState('');
  const loadSeriesHealth = useCallback(async () => {
    try {
      const d = await fetch(`/api/series/${encodeURIComponent(seriesId)}/health`).then((r) => r.json());
      if (Array.isArray(d.episodes)) {
        const map: Record<string, any> = {};
        for (const e of d.episodes) map[e.projectId] = e;
        setHealthMap(map);
      }
    } catch { /* 徽章缺席不阻塞 */ }
  }, [seriesId]);
  useEffect(() => { void loadSeriesHealth(); }, [loadSeriesHealth]);
  const seasonFixAll = async () => {
    if (seasonFixBusy || !healthMap) return;
    setSeasonFixBusy(true);
    const targets = Object.values(healthMap).filter((h: any) => h.animaticShots?.length > 0);
    let done = 0;
    for (const h of targets as any[]) {
      setSeasonFixMsg(t.seriesDetail.seasonFixProgressMsg.replace('{episode}', String(h.episodeNumber ?? '?')).replace('{current}', String(done + 1)).replace('{total}', String(targets.length)));
      try {
        await fetch('/api/regenerate-shot', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: h.projectId, stage: 'failed-videos' }),
        }).then((r) => r.body?.getReader && new Response(r.body).text());
      } catch { /* 单集失败继续下一集 */ }
      done++;
    }
    setSeasonFixMsg(t.seriesDetail.seasonFixDoneMsg.replace('{n}', String(done)));
    await loadSeriesHealth();
    setSeasonFixMsg('');
    setSeasonFixBusy(false);
  };
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  // v12.25.0 季级产物
  const [seasonCover, setSeasonCover] = useState<string | null>(null);
  const [seasonVideo, setSeasonVideo] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    const tok = getToken();
    return tok ? { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` } : { 'Content-Type': 'application/json' };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}`, { headers: authHeaders() });
      const body = await res.json();
      if (res.ok && Array.isArray(body.episodes)) {
        setEpisodes(body.episodes);
        setSeasonCover(body.seasonCover ?? null);
        setSeasonVideo(body.seasonVideo ?? null);
      } else if (!res.ok) {
        setMsg(body?.error || t.seriesDetail.loadFailStatus.replace('{status}', String(res.status))); // v12.26.0:加载失败不再静默
      }
    } catch { setMsg(t.seriesDetail.loadFailNetwork); } finally { setLoading(false); }
  }, [seriesId, authHeaders, t]);

  useEffect(() => { load(); }, [load]);

  // 有「生成中」就轮询。v12.23.0:依赖布尔 hasActive(非 episodes 引用),避免每次 load 后重建 interval。
  const hasActive = episodes.some((e) => e.status === 'active');
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  const batchGenerate = async (force = false) => {
    if (busy) return;
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/generate`, {
        // v12.165:整季统一制作语言(系统默认;'auto' 则按各集创意自动检测)
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ force, language: getSystemLanguage() }),
      });
      const body = await res.json();
      if (!res.ok) { setMsg(body?.error || `失败 ${res.status}`); return; }
      // v12.23.0:队列模式无 concurrency 字段,按 mode 分支文案(不再显示「并发 undefined」)
      setMsg(body.started > 0
        ? (body.mode === 'queue'
            ? t.seriesDetail.batchQueuedMsg.replace('{n}', String(body.started))
            : t.seriesDetail.batchStartedMsg.replace('{n}', String(body.started)).replace('{concurrency}', String(body.concurrency)))
        : (body.message || t.seriesDetail.noPendingEpisodes));
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : t.seriesDetail.requestFailed); }
    finally { setBusy(false); }
  };

  // v12.25.0:导出整季合集
  const exportSeason = async () => {
    if (exporting) return;
    setExporting(true); setMsg(t.seriesDetail.exportingSeasonMsg);
    try {
      let res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/export`, { method: 'POST', headers: authHeaders(), body: '{}' });
      let body = await res.json();
      // v12.158:体检闸门 409 → 列出问题集,confirm 后带 ignoreHealth 重试
      if (res.status === 409 && body?.error === 'health_gate') {
        const detail = (body.details || []).map((d: any) => t.seriesDetail.healthGateEpisodeDetail.replace('{ep}', String(d.episode)).replace('{shots}', String(d.animaticShots?.length || 0))).join('、');
        if (!window.confirm(`${body.message}\n\n${t.seriesDetail.healthGateIssuePrefix}${detail}\n\n${t.seriesDetail.healthGateConfirmHint}`)) { setMsg(t.seriesDetail.exportCanceledMsg); return; }
        res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/export`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ignoreHealth: true }) });
        body = await res.json();
      }
      if (!res.ok) { setMsg(body?.error || t.seriesDetail.exportFailedStatus.replace('{status}', String(res.status))); return; }
      setSeasonVideo(body.videoUrl); setMsg(t.seriesDetail.exportDoneMsg.replace('{n}', String(body.count)));
    } catch (e) { setMsg(e instanceof Error ? e.message : t.seriesDetail.requestFailed); }
    finally { setExporting(false); }
  };

  // v12.25.0:生成季封面
  const genCover = async () => {
    if (coverBusy) return;
    setCoverBusy(true); setMsg(t.seriesDetail.coverGeneratingMsg);
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/cover`, { method: 'POST', headers: authHeaders(), body: '{}' });
      const body = await res.json();
      if (!res.ok) { setMsg(body?.error || t.seriesDetail.coverFailedStatus.replace('{status}', String(res.status))); return; }
      setSeasonCover(body.coverUrl); setMsg(t.seriesDetail.coverDoneMsg);
    } catch (e) { setMsg(e instanceof Error ? e.message : t.seriesDetail.requestFailed); }
    finally { setCoverBusy(false); }
  };

  // v12.182:断点续跑 —— 卡死 active 集重置 draft
  const resumeStuck = async () => {
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/resume`, { method: 'POST', headers: authHeaders(), body: '{}' });
      const b = await res.json();
      setMsg(b?.message || (res.ok ? t.seriesDetail.resumeCheckedMsg : t.seriesDetail.resumeFailStatus.replace('{status}', String(res.status))));
      await load();
    } catch { setMsg(t.seriesDetail.resumeFailedMsg); }
  };
  const pending = episodes.filter((e) => e.status === 'draft' || e.status === 'failed').length; // 待生成 + 失败可重试
  const generating = episodes.filter((e) => e.status === 'active').length;
  const done = episodes.filter((e) => e.status === 'completed').length;
  const failed = episodes.filter((e) => e.status === 'failed').length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-6">
        <ArrowLeft className="w-4 h-4" /> {t.seriesDetail.backLink}
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/15 grid place-items-center"><Film className="w-6 h-6 text-cyan-400" /></div>
        <div>
          <h1 className="text-xl font-bold text-white">{t.seriesDetail.pageTitle}</h1>
          <p className="text-xs text-gray-500 font-mono">{seriesId}</p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-400 mt-3 mb-5">
        <span>{t.seriesDetail.statTotal.replace('{n}', String(episodes.length))}</span>
        <span className="text-emerald-400">{t.seriesDetail.statCompleted.replace('{n}', String(done))}</span>
        <span className="text-amber-300">{t.seriesDetail.statGenerating.replace('{n}', String(generating))}</span>
        {failed > 0 && <span className="text-red-300">{t.seriesDetail.statFailed.replace('{n}', String(failed))}</span>}
        <span>{t.seriesDetail.statPending.replace('{n}', String(pending))}</span>
      </div>

      <div className="flex items-center gap-2 mb-5">
        <button
          onClick={() => batchGenerate(false)}
          disabled={busy || pending === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-medium disabled:opacity-40">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {t.seriesDetail.batchGenerateBtn}{pending > 0 ? t.seriesDetail.batchGeneratePendingHint.replace('{n}', String(pending)) : ''}
        </button>
        {done > 0 && (
          <button onClick={() => batchGenerate(true)} disabled={busy}
            className="px-3 py-2 rounded-xl border border-white/15 text-gray-300 text-xs hover:text-white disabled:opacity-40">
            {t.seriesDetail.regenerateAll}
          </button>
        )}
      </div>

      {msg && <div className="mb-4 text-[13px] text-cyan-200/90 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2">{msg}</div>}

      {/* v12.25.0 季级产物:封面 + 整季合集 */}
      <div className="flex items-start gap-4 mb-6 bg-white/5 border border-white/10 rounded-xl p-4">
        <div className="w-20 shrink-0 rounded-lg overflow-hidden bg-black/30 aspect-[3/4] grid place-items-center">
          {seasonCover ? <img src={seasonCover} alt={t.seriesDetail.seasonCoverAlt} className="w-full h-full object-cover" /> : <ImageIcon className="w-6 h-6 text-gray-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white mb-2">{t.seriesDetail.seasonAssetsTitle}</div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={genCover} disabled={coverBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-gray-200 text-xs hover:text-white disabled:opacity-40">
              {coverBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
              {seasonCover ? t.seriesDetail.regenCoverBtn : t.seriesDetail.genCoverBtn}
            </button>
            <button onClick={exportSeason} disabled={exporting || done === 0}
              title={done === 0 ? t.seriesDetail.exportFirstEpisodeHint : ''}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-gray-200 text-xs hover:text-white disabled:opacity-40">
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DownloadSimple className="w-3.5 h-3.5" />}
              {seasonVideo ? t.seriesDetail.reexportSeasonBtn : t.seriesDetail.exportSeasonBtn}
            </button>
            {seasonVideo && (
              <a href={seasonVideo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200">
                <Play className="w-3.5 h-3.5" /> {t.seriesDetail.watchSeasonVideo}
              </a>
            )}
            <DramaPackageButton seriesId={seriesId} />
          </div>
          <p className="text-[10px] text-gray-500 mt-2">{t.seriesDetail.seasonVideoDesc}</p>
        </div>
      </div>

      {/* v12.155:系列质量中枢 —— 逐集体检徽章 + 全季一键补渲降级镜 */}
      {healthMap && Object.values(healthMap).some((h: any) => h.animaticShots?.length > 0) && (
        <div className="mb-3 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled={seasonFixBusy}
            onClick={() => void seasonFixAll()}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
          >
            {seasonFixBusy ? t.seriesDetail.seasonFixBusyLabel : t.seriesDetail.seasonFixLabel.replace('{n}', String(Object.values(healthMap).filter((h: any) => h.animaticShots?.length > 0).length))}
          </button>
          {seasonFixMsg && <span className="text-[10px] text-gray-400 font-mono">{seasonFixMsg}</span>}
        </div>
      )}
      {/* v12.182:断点续跑 —— 有生成中的集时提供「恢复卡死集」(重启后 active 永卡的救生索) */}
      {episodes.some((e) => e.status === 'active') && (
        <div className="mb-3">
          <button type="button" onClick={() => void resumeStuck()} className="text-[11px] px-3 py-1.5 rounded-lg border border-white/15 text-gray-300 hover:bg-white/5">
            {t.seriesDetail.resumeStuckBtn}
          </button>
        </div>
      )}
      {loading ? (
        <div className="text-center py-12 text-gray-500 text-sm"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />{t.seriesDetail.loading}</div>
      ) : episodes.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">{t.seriesDetail.noEpisodes}</div>
      ) : (
        <div className="space-y-2">
          {episodes.map((ep) => {
            const st = STATUS[ep.status] || STATUS.draft;
            return (
              <div key={ep.id} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <span className="text-cyan-400 font-bold text-sm w-12 shrink-0">{t.seriesDetail.episodeLabel.replace('{n}', String(ep.episode_number ?? '?'))}</span>
                <span className="flex-1 text-sm text-white truncate">{ep.title}</span>
                {ep.aspect && <span className="text-[10px] text-gray-500 font-mono">{ep.aspect}</span>}
                {/* v12.155:该集体检徽章(🟢🟡🔴;降级镜数一眼可见) */}
                {healthMap?.[ep.id] && (
                  <span
                    className="text-[11px]"
                    title={[...(healthMap[ep.id].failItems || []), ...(healthMap[ep.id].warnItems || [])].join(' · ') || t.seriesDetail.healthCheckAllGreen}
                  >
                    {({ ok: '🟢', warn: '🟡', fail: '🔴', unknown: '⚪' } as any)[healthMap[ep.id].overall] || '⚪'}
                    {healthMap[ep.id].animaticShots?.length > 0 && <span className="text-amber-400/80 ml-0.5">{t.seriesDetail.shotsDowngradedLabel.replace('{n}', String(healthMap[ep.id].animaticShots.length))}</span>}
                  </span>
                )}
                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border ${st.cls}`}>
                  {ep.status === 'active' && <Loader2 className="w-3 h-3 animate-spin" />}
                  {ep.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                  {ep.status === 'draft' && <Clock className="w-3 h-3" />}
                  {st.label}
                </span>
                <Link href={`/projects/${ep.id}`} className="text-[11px] text-cyan-300 hover:text-cyan-200 shrink-0">{t.seriesDetail.openEpisodeLink}</Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
