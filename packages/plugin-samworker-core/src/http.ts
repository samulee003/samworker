import http from 'node:http';
import { ContextStore } from '../../plugin-context-store/src/index.js';
import { startTask } from './core.js';

type Body = {
  goal: string;
  source: string;
  voice?: { keyId?: number; ts?: number; transcript?: string };
  client?: string;
  idempotencyKey?: string;
  plan?: unknown;
};

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
      let parsed: Body;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(400, { error: 'invalid json' });
      }
      if (typeof parsed?.goal !== 'string' || parsed.goal.length < 1 || parsed.source !== 'mouse') {
        return send(400, { error: 'goal and source=mouse required' });
      }
      if (!parsed.idempotencyKey) return send(400, { error: 'idempotencyKey required' });

      const store = new ContextStore(opts.dbPath);
      const existing = store.getIdempotentTask(parsed.idempotencyKey);
      if (existing) {
        store.close();
        return send(409, { error: 'duplicate idempotencyKey', taskId: existing });
      }
      store.saveIdempotentTask(parsed.idempotencyKey, 'pending');
      store.close();

      const plan =
        (parsed.plan as any) ??
        {
          goal: parsed.goal,
          steps: [
            {
              id: 1,
              tool: 'fs.writeFile',
              args: {
                path: 'REPORT.md',
                content: `# ${parsed.goal}\n`,
                reason: 'voice goal deliverable',
              },
              done_when: 'REPORT.md written',
            },
          ],
          definition_of_done: 'REPORT.md exists',
        };

      const resultPromise = startTask(parsed.goal, {
        source: 'mouse',
        voice: parsed.voice,
        plan,
        workspaceRoot: opts.workspaceRoot,
        dbPath: opts.dbPath,
        autoApprove: opts.autoApprove ?? false,
      });

      const taskId = `task_http_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // Register idempotency immediately so double-post hits 409 even while the task runs.
      const s = new ContextStore(opts.dbPath);
      s.saveIdempotentTask(parsed.idempotencyKey, taskId);
      s.close();

      void resultPromise.then((result) => {
        const s2 = new ContextStore(opts.dbPath);
        s2.saveIdempotentTask(parsed.idempotencyKey ?? taskId, result.taskId);
        s2.appendTranscript({ taskId: result.taskId, kind: 'result', payload: { status: result.status } });
        s2.close();
      });

      return send(202, { taskId });
    }

    if (req.method === 'GET' && url.pathname === '/approvals') {
      const store = new ContextStore(opts.dbPath);
      const pending = store.listPendingApprovals();
      store.close();
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
        store.resolveApproval(m[1], answer);
        store.close();
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
