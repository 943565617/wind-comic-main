/**
 * v12.138 — 资产行字段兼容(live 抓获:listAssetsByType 返回蛇形行,三处调用点误用驼峰
 * → 草图锁取不到草图 / heal-shots hasStoryboard 恒 false)。
 */
import { describe, it, expect } from 'vitest';
import { assetShotNumber, assetFirstMediaUrl, identifyHealableShots } from '@/lib/heal-shots';

describe('v12.138 · 资产行兼容', () => {
  it('assetShotNumber:蛇形/驼峰都认', () => {
    expect(assetShotNumber({ shot_number: 3 })).toBe(3);
    expect(assetShotNumber({ shotNumber: 5 })).toBe(5);
    expect(assetShotNumber({})).toBeNull();
    expect(assetShotNumber({ shot_number: null })).toBeNull();
  });
  it('assetFirstMediaUrl:persistent_url 优先;media_urls JSON 字符串/数组都认', () => {
    expect(assetFirstMediaUrl({ persistent_url: 'https://p.png', media_urls: '["https://m.png"]' })).toBe('https://p.png');
    expect(assetFirstMediaUrl({ media_urls: '["https://m.png"]' })).toBe('https://m.png');       // 蛇形 JSON 字符串
    expect(assetFirstMediaUrl({ mediaUrls: ['https://c.png'] })).toBe('https://c.png');            // 驼峰数组
    expect(assetFirstMediaUrl({ media_urls: '{bad' })).toBeNull();
    expect(assetFirstMediaUrl({})).toBeNull();
  });
  it('回归场景:蛇形分镜行喂 identifyHealableShots 的 hasStoryboard 现在为 true', () => {
    const sbRows = [{ shot_number: 3 }, { shot_number: 4 }];
    const shots = sbRows.map(assetShotNumber).filter((n): n is number => Number.isInteger(n) && (n as number) > 0);
    const h = identifyHealableShots({ shotReasons: { 3: ['missing-video'] } }, shots);
    expect(h[0].hasStoryboard).toBe(true); // 修复前恒 false
  });
});
