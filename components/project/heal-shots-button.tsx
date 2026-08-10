'use client';

import { useState } from 'react';
import { useToast } from '@/components/ui/toast-provider';

interface Props {
  projectId: string;
  /** 自愈完成后触发(可用于刷新体检报告) */
  onHealed?: () => void;
}

/**
 * 一键自愈按钮 — POST /api/projects/[id]/heal-shots { heal: true }
 * 适配成片体检面板(film-health-panel)中有降级/缺失镜时显示。
 */
export function HealShotsButton({ projectId, onHealed }: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function handleHeal() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/heal-shots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heal: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast({
          title: '自愈失败',
          description: data?.error || `服务器返回 ${res.status}`,
          type: 'error',
          duration: 6000,
        });
        return;
      }
      const healed: number = data?.healedCount ?? data?.healed?.length ?? 0;
      const failed: number = data?.failed?.length ?? 0;
      const skipped: number = data?.skipped?.length ?? 0;
      if (healed > 0) {
        showToast({
          title: `🩺 自愈完成：修复 ${healed} 镜`,
          description: [
            failed > 0 ? `${failed} 镜失败` : '',
            skipped > 0 ? `${skipped} 镜无分镜图跳过` : '',
          ].filter(Boolean).join('，') || '全部镜头已修复',
          type: 'success',
          duration: 7000,
        });
        onHealed?.();
      } else if (failed > 0) {
        showToast({
          title: '自愈未成功',
          description: `${failed} 镜补拍失败，${skipped} 镜无分镜图跳过`,
          type: 'warning',
          duration: 6000,
        });
      } else {
        showToast({
          title: '无可自愈镜',
          description: skipped > 0 ? `${skipped} 镜无分镜图，无法锚定补拍` : '成片质量良好，无需自愈',
          type: 'info',
          duration: 5000,
        });
      }
    } catch (e) {
      showToast({
        title: '自愈请求失败',
        description: e instanceof Error ? e.message : '网络错误',
        type: 'error',
        duration: 6000,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleHeal()}
      disabled={busy}
      className="cinema-btn-ghost !text-[10px] !py-0.5 !px-2 disabled:opacity-40"
    >
      {busy ? '自愈中…' : '🩺 一键自愈'}
    </button>
  );
}
