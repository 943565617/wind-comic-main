import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';

export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  let userId = payload?.sub;

  // If no auth, fall back to the first user (demo mode)
  if (!userId) {
    // v12.218(安全止血):不再回落 DB 首用户,匿名用 sentinel(查空不泄露)
    userId = '__no_auth__';
  }

  const projects = (db.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id = ?').get(userId) as any).count;
  const generations = (db.prepare('SELECT COUNT(*) as count FROM generations WHERE user_id = ?').get(userId) as any).count;
  const cases = (db.prepare('SELECT COUNT(*) as count FROM cases').get() as any).count;

  return NextResponse.json({ projects, generations, cases, uptime: Math.floor(process.uptime()) });
}
