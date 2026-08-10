/**
 * v12.221 — consent_log 授权同意日志仓库(async,双驱动)。
 *
 * 合规底线:声音克隆等深度合成操作在执行前,必须留下「谁、何时、为何、声明了什么、从哪个 IP」
 * 的可追溯凭证(《深度合成管理规定》第14条 / GDPR 第9条)。记账失败必须**阻断**克隆(与埋点相反),
 * 故 record 抛错向上冒泡,路由据此拒绝执行。
 */
import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

export interface ConsentInput {
  userId: string;
  action: string; // 'voice_clone' 等
  purpose: string;
  ownerDeclaration: string;
  ip?: string | null;
}

export interface ConsentRow {
  id: string;
  user_id: string;
  action: string;
  purpose: string;
  owner_declaration: string;
  ip: string | null;
  created_at: string;
}

/** 落一条同意凭证,返回其 id。失败抛错(调用方须据此中止敏感操作)。 */
export async function recordConsent(input: ConsentInput): Promise<string> {
  const id = 'consent_' + nanoid(14);
  await getDbDriver().run(
    `INSERT INTO consent_log (id, user_id, action, purpose, owner_declaration, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.userId, input.action, input.purpose, input.ownerDeclaration, input.ip ?? null, new Date().toISOString()],
  );
  return id;
}

/** 查某用户某类操作的同意记录(合规追溯 / 测试用)。 */
export async function listConsent(userId: string, action?: string): Promise<ConsentRow[]> {
  if (action) {
    return getDbDriver().query<ConsentRow>(
      `SELECT * FROM consent_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC`,
      [userId, action],
    );
  }
  return getDbDriver().query<ConsentRow>(
    `SELECT * FROM consent_log WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
  );
}
