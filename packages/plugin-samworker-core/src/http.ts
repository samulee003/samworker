import http from 'node:http';
import { z } from 'zod';
import { ContextStore } from '../../plugin-context-store/src/index.js';
import { beginTask } from './core.js';

const TaskBody = z.object({
  goal: z.string().min(1),
  source: z.literal('mouse'),
  voice: z
    .object({ keyId: z.number().optional(), ts: z.number().optional(), transcript: z.string().optional() })
    .optional(),
  client: z.string().optional(),
  idempotencyKey: z.string().min(1),
  plan: z.unknown().optional(),
});

export function startHttpFacade(
  opts: { port?: number; workspaceRoot?: string; dbPath?: string; autoApprove?: boolean } = {}
) {
  const port = opts.port ?? 10087;
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'POST' && url.pathname === '/task') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(400, { error: 'invalid json' });
      }
      const parsed = TaskBody.safeParse(raw);
      if (!parsed.success) {
        return send(400, { error: 'validation failed', issues: parsed.error.issues });
      }
      const body = parsed.data;

      const plan =
        (body.plan as any) ??
        {
          goal: body.goal,
          steps: [
            {
              id: 1,
              tool: 'fs.writeFile',
              args: {
                path: 'REPORT.md',
                content: `# ${body.goal}\n`,
                reason: 'voice goal deliverable',
              },
              done_when: 'REPORT.md written',
            },
          ],
          definition_of_done: 'REPORT.md exists',
        };

      // Generate taskId first, claim idempotency BEFORE any side effects.
      const pendingId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let existing: string | null = null;
      let claimed = false;
      const store = new ContextStore(opts.dbPath);
      try {
        existing = store.getIdempotentTask(body.idempotencyKey);
        if (!existing) {
          claimed = store.claimIdempotentTask(body.idempotencyKey, pendingId);
          if (!claimed) existing = store.getIdempotentTask(body.idempotencyKey);
        }
      } finally {
        store.close();
      }
      if (!claimed) {
        return send(409, { error: 'duplicate idempotencyKey', taskId: existing ?? pendingId });
      }

      const { taskId, done } = beginTask(body.goal, {
        source: 'mouse',
        voice: body.voice,
        plan,
        workspaceRoot: opts.workspaceRoot,
        dbPath: opts.dbPath,
        autoApprove: opts.autoApprove ?? false,
      });
      // Rewrite claim to the real taskId (same key, same owner).
      const store2 = new ContextStore(opts.dbPath);
      try {
        store2.saveIdempotentTask(body.idempotencyKey, taskId);
      } finally {
        store2.close();
      }

      void done.catch(() => {});
      return send(202, { taskId });
    }

    if (req.method === 'GET' && url.pathname === '/approvals') {
      const store = new ContextStore(opts.dbPath);
      let pending: Awaited<ReturnType<typeof store.listPendingApprovals>> = [];
      try {
        pending = store.listPendingApprovals();
      } finally {
        store.close();
      }
      const items = pending
        .map((p) => {
          const d = JSON.parse(p.data);
          return `<li>${p.id} — ${d.tool} <button data-id="${p.id}" data-a="approve_once">僅這一次</button> <button data-id="${p.id}" data-a="approve_scope">以後都允許</button> <button data-id="${p.id}" data-a="deny">拒絕</button></li>`;
        })
        .join('\n');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>SamWorker approvals</title>
<h1>待審批</h1><ul>${items || '<li>（無）</li>'}</ul>
<script>document.querySelectorAll('button[data-id]').forEach(b=>b.onclick=async()=>{await fetch('/approvals/'+b.dataset.id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({answer:b.dataset.a})});location.reload()})</script>`);
      return;
    }

    const m = url.pathname.match(/^\/approvals\/([^/]+)$/);
    if (req.method === 'POST' && m) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const answer = body?.answer;
        if (!['approve_once', 'approve_scope', 'deny'].includes(answer)) {
          return send(400, { error: 'bad answer' });
        }
        const store = new ContextStore(opts.dbPath);
        try {
          store.resolveApproval(m[1], answer);
        } finally {
          store.close();
        }
        return send(200, { ok: true });
      } catch {
        return send(400, { error: 'invalid json' });
      }
    }

    send(404, { error: 'not found' });
  }

  server.listen(port, '127.0.0.1');
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
