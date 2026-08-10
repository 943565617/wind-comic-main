import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '@/lib/db';

// 进程级随机开发密钥(惰性生成;仓库里**没有任何可用密钥串**)。
// 重启即失效 —— dev/test 重新登录无妨;泄露的旧硬编码值因此彻底作废。
let devSecret: string | null = null;

/**
 * 已知弱/占位密钥黑名单(v12.219 密钥硬化)。
 * `.env.example` 里的 `change_me_...` 是公开可见的占位值:任何人只要拷模板忘改,
 * 生产就会用这串公开密钥签发/校验令牌 → 可被据此伪造任意用户(含 admin)令牌。
 * 生产环境命中黑名单 = 与未设置同等危险,一律 fail-fast 拒起。
 * 判定用小写去空白规范化,挡「大小写/首尾空格」绕过。
 */
const WEAK_JWT_SECRETS = new Set(
  [
    'change_me_to_a_random_32_char_string', // .env.example 默认占位
    'change_me',
    'changeme',
    'secret',
    'your-secret-key',
    'your_secret_key',
    'e2e-fixture-secret-not-for-prod', // .env.example 里 e2e 示例串,非生产密钥
    // v12.231(收官 · 堵 🟡-24):CI workflow 里的明文夹具密钥。
    // 它们只用于临时 runner,本身不触达线上;真风险是**被人 fork 后复制进生产 env**。
    // 加进黑名单 = 即便复制了,生产也拒启动(纵深防御)。CI 自身不受影响 ——
    // v12.226 已改成「非生产环境采用显式设置的密钥」,只有 production 才 fail-fast。
    'dummy_for_build_only_change_in_production',
    'e2e-ci-fixture-secret-not-for-prod',
  ].map((s) => s.toLowerCase()),
);

function isWeakSecret(s: string): boolean {
  return WEAK_JWT_SECRETS.has(s.trim().toLowerCase());
}

/**
 * 运行时解析 JWT 密钥(刻意不在模块顶层求值 —— 避免 `next build` 期间误抛中断构建)。
 *   - 设了 `JWT_SECRET` 且非弱默认 → 用它(生产/CI/e2e 都走这条)。
 *   - 设了但命中弱默认黑名单 + 生产 → **fail-fast 抛错**:拷模板忘改等同裸奔。
 *   - 没设 + 生产环境(`NODE_ENV=production`)→ **fail-fast 抛错**:绝不静默用弱密钥。
 *   - 没设/弱默认 + 开发/测试 → 生成**进程级随机密钥**(非源码内置,无法被仓库读者据此伪造令牌),
 *     首次打一次告警提醒部署前必须设 JWT_SECRET。
 *
 * 安全说明:历史上这里曾内置公开兜底串,任何人都能据此伪造任意用户(含 admin)的令牌。
 * 改随机后,即便误以 `NODE_ENV≠production` 裸跑,攻击者也拿不到可用密钥;旧泄露值作废。
 */
function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === 'production';
  if (s && s.length > 0 && !isWeakSecret(s)) return s;
  if (isProd) {
    if (s && isWeakSecret(s)) {
      throw new Error(
        '[auth] JWT_SECRET 是公开占位/弱默认值(如 .env.example 的 change_me_...)—— 生产环境拒启动。' +
          '请用 `openssl rand -hex 32` 生成高强度随机密钥后重设。',
      );
    }
    throw new Error(
      '[auth] JWT_SECRET 未设置 —— 生产环境必须配置一个高强度随机密钥(否则无法签发/校验令牌)。',
    );
  }
  // v12.226 修 v12.219 引入的回归:非生产环境下**显式设置的密钥必须被采用**(哪怕是弱串),
  // 只告警不替换。原实现把弱串忽略掉改用进程级随机密钥,会让「多进程共用一个 fixture 密钥」
  // 的场景直接崩 —— 典型如 e2e:dev server 与 playwright 测试进程各自随机 → JWT 不匹配 → 全 401,
  // 而 `.env.example` 恰恰就教用户用 `JWT_SECRET=e2e-fixture-secret-not-for-prod` 跑本地 e2e。
  // 黑名单的职责是**拦生产**(上面已 fail-fast),不该越界破坏开发/测试工作流。
  if (s && s.length > 0) {
    if (isWeakSecret(s)) {
      console.warn('[auth] ⚠️ JWT_SECRET 为弱默认/占位值(仅开发/测试可用,生产会拒启动);部署前务必设为高强度随机串。');
    }
    return s;
  }
  if (!devSecret) {
    devSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[auth] ⚠️ JWT_SECRET 未设置,已生成进程级随机开发密钥(重启失效);部署前务必设置 JWT_SECRET。');
  }
  return devSecret;
}

export interface JWTPayload {
  sub: string;
  role: string;
}

export function signToken(user: { id: string; role: string }): string {
  return jwt.sign({ sub: user.id, role: user.role }, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, getJwtSecret()) as JWTPayload;
}

// ── v10.4.3: httpOnly 会话 cookie ───────────────────────────────────────────
// 动机:JWT 存 localStorage,任何 XSS 即可窃取令牌;cookie(HttpOnly)对脚本不可见,
// SameSite=Lax 抵御跨站携带。过渡期双轨:登录/注册继续在 body 返回 token(旧前端
// Bearer 不破),同时下发 cookie;服务端双读。SSE/EventSource 设不了请求头,
// cookie 顺带解决其鉴权(lib/sse-client 的 fetch-Bearer 变通将来可退役)。

export const SESSION_COOKIE = 'qfmj-session';
const SESSION_MAX_AGE = 7 * 24 * 3600; // 与 signToken 的 7d 对齐

export function sessionCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

export function clearSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function tokenFromCookie(request: Request): string | null {
  const raw = request.headers.get('cookie') || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * v10.4.3 双读:Authorization Bearer 优先,会话 cookie 兜底。
 * Bearer 在前 —— 显式随请求传的头比环境 cookie 更有「本次请求」的意图性
 * (换账号调试 / E2E mint 时旧 cookie 残留不会抢权)。
 */
export function getUserFromRequest(request: Request): JWTPayload | null {
  const header = request.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  for (const token of [bearer, tokenFromCookie(request)]) {
    if (!token) continue;
    try {
      return verifyToken(token);
    } catch {
      /* 该来源无效,试下一个 */
    }
  }
  return null;
}

export function getUserById(id: string) {
  const user = db
    .prepare(
      'SELECT id, email, name, role, avatar_url, locale, subscription_tier, subscription_status FROM users WHERE id = ?',
    )
    .get(id) as any;
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatar_url,
    locale: user.locale,
    // v2.12 Sprint C.2: 把订阅 tier/status 透传给前端,billing 页面 + 功能 gate 用
    subscriptionTier: user.subscription_tier || 'free',
    subscriptionStatus: user.subscription_status || null,
  };
}
