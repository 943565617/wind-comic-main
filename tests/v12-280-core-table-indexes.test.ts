/**
 * v12.280 — 5 张最早的核心表补索引。
 *
 * 病根:`lib/db.ts` 已有 54 条 CREATE INDEX,但**全部建在后期新增的表上**
 * (global_assets / cost_log / comments / invite_codes …);而最早落地的
 * projects / project_assets / generations / chat_messages / character_library
 * **一条索引都没有** —— 越老、越热的表反而越没被照顾到。
 *
 * project_assets 是全仓最热的表:`WHERE project_id = ? AND type = ?` 在代码里出现 33 处。
 *
 * 本套件不验「索引语句存在」这种表面事实,而是**直接跑 EXPLAIN QUERY PLAN**,
 * 断言查询计划真的从 SCAN 变成了 SEARCH USING INDEX —— 索引建了但没被优化器选中,等于没建。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';

/** 用与生产同源的 DDL 建库(只取本版关心的表 + 索引),避免测试与真 schema 漂移。 */
function buildDb() {
  const src = fs.readFileSync('lib/db.ts', 'utf-8');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, created_at TEXT);
    CREATE TABLE project_assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT, shot_number INTEGER, data TEXT, updated_at TEXT);
    CREATE TABLE generations (id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, project_id TEXT);
    CREATE TABLE character_library (id TEXT PRIMARY KEY, user_id TEXT);
  `);
  // 从 db.ts 里抠出本版新增的索引语句,原样执行 —— 保证测的就是生产那几条
  const wanted = [
    'idx_project_assets_project_type', 'idx_project_assets_project_shot',
    'idx_projects_user', 'idx_projects_user_created',
    'idx_generations_user', 'idx_generations_project',
    'idx_chat_messages_project', 'idx_character_library_user',
  ];
  for (const name of wanted) {
    const m = src.match(new RegExp(`CREATE INDEX IF NOT EXISTS ${name}[^;]*;`));
    expect(m, `lib/db.ts 里应有索引 ${name}`).toBeTruthy();
    db.exec(m![0]);
  }
  return db;
}

let db: Database.Database;
beforeAll(() => {
  db = buildDb();
  const ip = db.prepare('INSERT INTO projects VALUES (?,?,?,?)');
  const ia = db.prepare('INSERT INTO project_assets VALUES (?,?,?,?,?,?)');
  db.transaction(() => {
    for (let p = 0; p < 120; p++) {
      ip.run('p' + p, 'u' + (p % 4), 'T', '2026-08-01');
      for (let a = 0; a < 12; a++) {
        ia.run('a' + p + '_' + a, 'p' + p, ['script', 'video', 'storyboard'][a % 3], a, '{}', '2026-08-01');
      }
    }
  })();
});

const plan = (sql: string, ...args: any[]) =>
  (db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args) as any[]).map((r) => r.detail).join(' | ');

describe('v12.280 · 查询计划必须走索引(不是「建了就算」)', () => {
  it('最热查询 project_assets(project_id, type):SEARCH USING INDEX,不再 SCAN', () => {
    const p = plan('SELECT * FROM project_assets WHERE project_id = ? AND type = ?', 'p1', 'video');
    expect(p).toContain('USING INDEX');
    expect(p).not.toContain('SCAN project_assets');
  });

  it('复合索引也服务「只按 project_id」的查询(列顺序选对了)', () => {
    const p = plan('SELECT * FROM project_assets WHERE project_id = ?', 'p1');
    expect(p).toContain('USING INDEX');
    expect(p).not.toContain('SCAN project_assets');
  });

  it('按镜号取资产走 (project_id, shot_number)', () => {
    const p = plan('SELECT * FROM project_assets WHERE project_id = ? ORDER BY shot_number', 'p1');
    expect(p).toContain('USING INDEX');
  });

  it('项目列表 WHERE user_id 走索引', () => {
    const p = plan('SELECT * FROM projects WHERE user_id = ?', 'u1');
    expect(p).toContain('USING INDEX');
    expect(p).not.toContain('SCAN projects');
  });

  it('GET /api/projects 的关联子查询不再逐行全表扫', () => {
    const p = plan(
      `SELECT p.*, (SELECT data FROM project_assets WHERE project_id = p.id AND type = 'script' ORDER BY updated_at DESC LIMIT 1) AS d
       FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC`, 'u1');
    // 子查询侧必须用上索引(否则每个项目行都要扫一遍 project_assets)
    expect(p).toContain('USING INDEX');
    expect(p).not.toContain('SCAN project_assets');
  });

  it('generations / chat_messages / character_library 的外键列也覆盖到', () => {
    expect(plan('SELECT * FROM generations WHERE user_id = ?', 'u1')).toContain('USING INDEX');
    expect(plan('SELECT * FROM generations WHERE project_id = ?', 'p1')).toContain('USING INDEX');
    expect(plan('SELECT * FROM chat_messages WHERE project_id = ?', 'p1')).toContain('USING INDEX');
    expect(plan('SELECT * FROM character_library WHERE user_id = ?', 'u1')).toContain('USING INDEX');
  });
});

describe('v12.280 · 双驱动一致(Postgres 不能落下)', () => {
  it('PG schema 由 sqlite_master 导出 → 新索引自动同步,无需维护第二份', () => {
    const src = fs.readFileSync('lib/db-schema-export.ts', 'utf-8');
    // 导出源必须仍是 sqlite_master(若哪天改成手写 DDL,这条提醒同步索引)
    expect(src).toContain('sqlite_master');
    expect(src).toMatch(/type,\s*name,\s*sql/);
  });
});

describe('v12.280 · 幂等(重复建库不炸)', () => {
  it('索引语句都带 IF NOT EXISTS', () => {
    const src = fs.readFileSync('lib/db.ts', 'utf-8');
    const mine = src.match(/CREATE INDEX[^;]*idx_(project_assets|projects_user|generations|chat_messages|character_library)[^;]*;/g) || [];
    expect(mine.length).toBeGreaterThanOrEqual(8);
    for (const stmt of mine) expect(stmt, stmt).toContain('IF NOT EXISTS');
  });
});
