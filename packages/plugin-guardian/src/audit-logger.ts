import fs from 'node:fs';
import path from 'node:path';

const auditPath = () => path.join(process.cwd(), '.samworker', 'audit.log');

export type Level = 'allow' | 'deny' | 'error';

export function appendAudit(row: {
  invocationId: string;
  tool: string;
  args: unknown;
  ruleId?: string | null;
  result: Level;
  level?: string;
  source?: string;
  voiceKey?: number;
  note?: string;
}): void {
  fs.mkdirSync(path.join(process.cwd(), '.samworker'), { recursive: true });
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    invocationId: row.invocationId,
    tool: row.tool,
    args: JSON.stringify(row.args ?? {}).slice(0, 500),
    ruleId: row.ruleId ?? null,
    result: row.result,
    level: row.level ?? null,
    source: row.source ?? 'cli',
    ...(row.voiceKey !== undefined ? { voiceKey: row.voiceKey } : {}),
    ...(row.note ? { note: row.note } : {}),
  });
  fs.appendFileSync(auditPath(), line + '\n', 'utf8');
}

export function readAudit(): string[] {
  const p = auditPath();
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
}
