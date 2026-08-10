/**
 * v12.181 — 跨集一致性传播:series_anchors repo 往返 + 管线两端接线锁。
 */
import { describe, it, expect } from 'vitest';
import { getSeriesAnchor, setSeriesAnchor } from '@/lib/repos/series-repo';
import fs from 'fs';

describe('v12.181 · 跨集锚点', () => {
  it('repo:set→get 往返 + upsert 覆盖(双驱动)', async () => {
    const sid = 'test-series-' + Date.now();
    expect(await getSeriesAnchor(sid)).toBeNull();
    await setSeriesAnchor(sid, { lockedCharacters: [{ name: '柳如烟', imageUrl: 'http://x/1.png' }], fromEpisode: 1 });
    const a1 = await getSeriesAnchor(sid);
    expect(a1?.lockedCharacters?.[0].name).toBe('柳如烟');
    await setSeriesAnchor(sid, { lockedCharacters: [{ name: '李长安', imageUrl: 'http://x/2.png' }], fromEpisode: 2 });
    const a2 = await getSeriesAnchor(sid);
    expect(a2?.fromEpisode).toBe(2);
    expect(a2?.lockedCharacters?.[0].name).toBe('李长安');
  });
  it('接线锁:启动注入(显式传参优先)+ 收尾写回 + styleAnchor setter', () => {
    const p = fs.readFileSync('lib/create-pipeline.ts', 'utf-8');
    expect(p).toContain('getSeriesAnchor(seriesIdOfProject)');
    expect(p).toContain('!lockedCharacters || lockedCharacters.length === 0'); // 显式优先
    expect(p).toContain('setSeriesAnchor(sid');
    expect(p).toContain('跨集一致性');
    expect(fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8')).toContain('setStyleAnchorUrl(url: string)');
  });
});
