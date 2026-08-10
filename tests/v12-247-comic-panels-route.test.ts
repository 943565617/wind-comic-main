/** v12.247 — 漫画分格端点:鉴权 + 输入校验。 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-guard', () => ({ requireUser: vi.fn(() => ({ ok: true, userId: 'u-comic' })) }));
const { POST } = await import('@/app/api/comic/panels/route');
const { requireUser } = await import('@/lib/auth-guard');
const req = (body: unknown): any => ({ json: async () => body });

describe('v12.247 POST /api/comic/panels', () => {
  it('未登录 → 401', async () => {
    vi.mocked(requireUser).mockReturnValueOnce({ ok: false, status: 401, message: 'Unauthorized' } as any);
    expect((await POST(req({ imageUrl: 'https://x/a.png' }))).status).toBe(401);
  });
  it('缺 imageUrl → 400', async () => {
    expect((await POST(req({}))).status).toBe(400);
  });
  it('非法协议(裸路径)→ 400,不进 persistAsset', async () => {
    expect((await POST(req({ imageUrl: '/etc/passwd' }))).status).toBe(400);
  });
});
