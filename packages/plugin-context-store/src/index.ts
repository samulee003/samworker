import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type Job = {
  id: string;
  name: string;
  cron: string;
  task: string;
  enabled: number;
  lastRunAt: number | null;
  lastStatus: string | null;
  createdAt: number;
};

export type PendingApproval = {
  id: string;
  data: string;
  createdAt: number;
};

export class ContextStore {
  private db: DatabaseSync;

  constructor(dbPath = path.join(process.cwd(), '.samworker', 'state.db')) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS approvals (scope TEXT PRIMARY KEY, level TEXT, updatedAt INTEGER);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, name TEXT, cron TEXT, task TEXT,
        enabled INTEGER DEFAULT 1, lastRunAt INTEGER, lastStatus TEXT, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS transcripts (id INTEGER PRIMARY KEY AUTOINCREMENT,
        jobId TEXT, taskId TEXT, ts INTEGER, kind TEXT, payload TEXT);
      CREATE TABLE IF NOT EXISTS pending_approvals (id TEXT PRIMARY KEY, data TEXT, createdAt INTEGER, resolved TEXT);
    `);
  }

  private kvGet(key: string): any {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  private kvSet(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  getState(): any {
    return this.kvGet('state');
  }

  saveState(s: any): void {
    this.kvSet('state', s);
  }

  getPlan(): any {
    return this.kvGet('task_plan');
  }

  savePlan(plan: any): void {
    this.kvSet('task_plan', plan);
  }

  getPlanTools(): string[] {
    const plan = this.getPlan();
    if (!plan?.steps) return [];
    return plan.steps.map((s: any) => s.tool).filter(Boolean);
  }

  getApproval(scope: string): string | null {
    const row = this.db.prepare('SELECT level FROM approvals WHERE scope = ?').get(scope) as { level: string } | undefined;
    return (row?.level as string) ?? null;
  }

  saveApproval(scope: string, level: string): void {
    this.db
      .prepare(
        'INSERT INTO approvals (scope, level, updatedAt) VALUES (?, ?, ?) ON CONFLICT(scope) DO UPDATE SET level = excluded.level, updatedAt = excluded.updatedAt'
      )
      .run(scope, level, Date.now());
  }

  savePendingApproval(id: string, data: unknown): void {
    this.db
      .prepare('INSERT OR REPLACE INTO pending_approvals (id, data, createdAt, resolved) VALUES (?, ?, ?, NULL)')
      .run(id, JSON.stringify(data), Date.now());
  }

  getApprovalResult(id: string): string | null {
    const row = this.db.prepare('SELECT resolved FROM pending_approvals WHERE id = ?').get(id) as
      | { resolved: string | null }
      | undefined;
    return row?.resolved ?? null;
  }

  clearPendingApproval(id: string): void {
    this.db.prepare('DELETE FROM pending_approvals WHERE id = ?').run(id);
  }

  listPendingApprovals(): PendingApproval[] {
    return this.db
      .prepare('SELECT id, data, createdAt FROM pending_approvals WHERE resolved IS NULL ORDER BY createdAt')
      .all() as unknown as PendingApproval[];
  }

  resolveApproval(id: string, answer: string): void {
    this.db.prepare('UPDATE pending_approvals SET resolved = ? WHERE id = ?').run(answer, id);
  }

  getIdempotentTask(key: string): string | null {
    return (this.kvGet(`idem:${key}`) as string) ?? null;
  }

  /** Atomic claim: true if this caller owns the key. */
  claimIdempotentTask(key: string, taskId: string): boolean {
    const info = this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
      .run(`idem:${key}`, JSON.stringify(taskId));
    return Number((info as any)?.changes ?? 0) === 1;
  }

  saveIdempotentTask(key: string, taskId: string): void {
    this.kvSet(`idem:${key}`, taskId);
  }

  createJob({ name, cron, task }: { name: string; cron: string; task: string }): Job {
    const job: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      cron,
      task,
      enabled: 1,
      lastRunAt: null,
      lastStatus: null,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        'INSERT INTO jobs (id, name, cron, task, enabled, lastRunAt, lastStatus, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(job.id, job.name, job.cron, job.task, job.enabled, job.lastRunAt ?? null, job.lastStatus ?? null, job.createdAt);
    return job;
  }

  listJobs(): Job[] {
    return this.db.prepare('SELECT * FROM jobs').all() as unknown as Job[];
  }

  deleteJob(id: string): void {
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  }

  updateJobRun(id: string, status: string): void {
    this.db.prepare('UPDATE jobs SET lastRunAt = ?, lastStatus = ? WHERE id = ?').run(Date.now(), status, id);
  }

  appendTranscript({
    jobId = null,
    taskId = null,
    kind,
    payload,
  }: {
    jobId?: string | null;
    taskId?: string | null;
    kind: string;
    payload: unknown;
  }): void {
    this.db
      .prepare('INSERT INTO transcripts (jobId, taskId, ts, kind, payload) VALUES (?, ?, ?, ?, ?)')
      .run(jobId, taskId, Date.now(), kind, JSON.stringify(payload));
  }

  listTranscripts(jobId?: string): any[] {
    if (jobId) {
      return this.db.prepare('SELECT * FROM transcripts WHERE jobId = ? ORDER BY ts, id').all(jobId) as any[];
    }
    return this.db.prepare('SELECT * FROM transcripts ORDER BY ts, id').all() as any[];
  }

  close(): void {
    this.db.close();
  }
}
