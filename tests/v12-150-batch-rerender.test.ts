/**
 * v12.150 — 失败/降级镜头批量补渲:API 分支 + isAnimatic 落库 + 项目页按钮接线锁。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.150 · 批量补渲', () => {
  it('API:failed-videos 分支(识别含 URL 兜底)+ 成功后自动重合成 + 原 stage 分支互斥', () => {
    const src = fs.readFileSync('app/api/regenerate-shot/route.ts', 'utf-8');
    expect(src).toContain("stage === 'failed-videos' && !shotNumber");
    expect(src).toContain('candidates.some((x) => /animatic-'); // v12.153 修正:双 URL 测(persistent_url 被洗成 ?key= 后仍认得出)
    expect(src).toContain("send('batchDone'");
    expect(src).toContain('runEditor(freshVideos, scriptData)');
    expect(src).toContain("stage !== 'failed-videos'"); // 不落进旧阶段分支
    expect(src).toContain('isAnimatic: !!result.isAnimatic'); // v12.154:如实存(真视频清、降级保留)
  });
  it('落库:create-pipeline 视频资产带 isAnimatic', () => {
    expect(fs.readFileSync('lib/create-pipeline.ts', 'utf-8')).toContain('isAnimatic: !!(v as any).isAnimatic');
  });
  it('项目页:降级镜识别(标记/无URL/animatic文件名)+ SSE 进度 + 完成重拉', () => {
    const ui = fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8');
    expect(ui).toContain("stage: 'failed-videos'");
    expect(ui).toContain('batch-rerender-bar');
    expect(ui).toContain('animatic-');
    expect(ui).toContain('batchDone');
  });
});
