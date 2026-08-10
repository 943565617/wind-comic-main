/**
 * v12.200 — 画质一致性:基础调色纯函数 + 转场多样性扩池 + composer 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { buildColorGradeFilter, detectGradeGenre } from '@/lib/color-grade';
import { selectTransitions } from '@/lib/edit-rhythm';
import fs from 'fs';

describe('v12.200 · 画质一致性', () => {
  it('调色:通用补偿 + 题材偏移 + env 关', () => {
    expect(buildColorGradeFilter('default')).toContain('eq=contrast=1.05');
    expect(buildColorGradeFilter('suspense')).toContain('gamma=1.06'); // 压沉
    expect(buildColorGradeFilter('epic')).toContain('saturation=1.2');  // 浓烈
    expect(buildColorGradeFilter('default', { COLOR_GRADE_DISABLE: '1' } as any)).toBeNull();
  });
  it('题材嗅探', () => {
    expect(detectGradeGenre('悬疑 noir 压抑')).toBe('suspense');
    expect(detectGradeGenre('甜宠治愈')).toBe('sweet');
    expect(detectGradeGenre('热血燃向战斗')).toBe('epic');
    expect(detectGradeGenre('普通广告')).toBe('default');
    expect(detectGradeGenre(null)).toBe('default');
  });
  it('转场多样性:8 镜不再三连 dissolve,含≥3 种转场', () => {
    const clips = Array.from({ length: 8 }, (_, i) => ({
      shotNumber: i + 1, emotionTemperature: (i % 3) - 1, tensionLevel: i % 5, hasDialogue: i % 2 === 0,
    }));
    const trans = selectTransitions(clips as any);
    const kinds = new Set(trans.filter(Boolean));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    // 无连续 3 次同转场
    for (let i = 2; i < trans.length; i++) {
      if (trans[i] && trans[i] === trans[i - 1] && trans[i] === trans[i - 2]) throw new Error(`连续3次 ${trans[i]} @${i}`);
    }
  });
  it('composer 接线:每镜挂 grade,mapTransition 认 pixelize/radial', () => {
    const s = fs.readFileSync('services/video-composer.ts', 'utf-8');
    expect(s).toContain('buildColorGradeFilter(_gradeGenre)');
    expect(s).toContain("'pixelize': 'pixelize'");
    expect(s).toContain("'radial': 'radial'");
    expect(s.match(/\$\{_grade \? ',' \+ _grade : ''\}/g)?.length).toBe(1); // 多镜路径挂一次
  });
});
