'use client';

/**
 * CharacterCastPanel (v12.198) — 项目详情页的「角色档案」多主体人脸库。
 *
 * 对标即梦/可灵的角色管理系统:建成后仍可补/改最多 3 个角色的人脸参考,
 * 复用 create 页的 CharacterLockSection(自带上传→persist→traits 抽取),
 * 存档走 PUT /api/projects/:id/characters(写 locked_characters + 归一表)。
 * orchestrator 生成/重生每镜时按角色名注入 subject_reference,锁跨镜一致性。
 */

import { useEffect, useState, useCallback } from 'react';
import { CharacterLockSection, type LockedCharacter } from '@/components/create/character-lock-section';
import { useToast } from '@/components/ui/toast-provider';

export function CharacterCastPanel({ projectId }: { projectId: string }) {
  const [cast, setCast] = useState<LockedCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/characters`);
        const data = await res.json();
        if (alive && Array.isArray(data?.characters)) setCast(data.characters);
      } catch { /* 拉不到就空档案,不打扰 */ } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const onChange = useCallback((next: LockedCharacter[]) => {
    setCast(next);
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/characters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characters: cast }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '保存失败');
      setCast(data.characters || []);
      setDirty(false);
      showToast({ title: `角色档案已保存(${data.count} 个)`, description: '后续生成/重生该镜将锁定这些人脸', type: 'success', duration: 3000 });
    } catch (e) {
      showToast({ title: e instanceof Error ? e.message : '保存失败', type: 'error', duration: 3000 });
    } finally {
      setSaving(false);
    }
  }, [cast, projectId, showToast]);

  if (loading) return null;

  return (
    <div className="cinema-card p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-white/90">🎭 角色档案(跨镜锁脸)</h3>
          <p className="text-[11px] text-white/45 mt-0.5">
            锁定角色人脸后,后续生成/重生该镜自动注入参考,治「每个镜头脸都不一样」。最多 3 个。
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            saving || !dirty
              ? 'bg-white/5 text-white/30 cursor-not-allowed'
              : 'bg-pink-500/80 hover:bg-pink-500 text-white active:scale-95'
          }`}
        >
          {saving ? '保存中…' : dirty ? '保存档案' : '已保存'}
        </button>
      </div>
      <CharacterLockSection value={cast} onChange={onChange} />
    </div>
  );
}
