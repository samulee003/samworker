import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ContextStore } from '../packages/plugin-context-store/src/index.js';
import { startTask, readAudit } from '../packages/plugin-samworker-core/src/core.js';
import { startHttpFacade } from '../packages/plugin-samworker-core/src/http.js';

type Expect =
  | { type: string; value: string };

type Case = {
  id: string;
  name: string;
  layer: string;
  timeout_sec: number;
  setup?: string;
  task: string;
  plan_inject?: any;
  source?: string;
  voice?: any;
  idempotencyKey?: string;
  http_body?: any;
  resolve?: { approval?: string; answer?: string };
  expect: Expect;
};

type Dataset = {
  version: string;
  layers: string[];
  passing_policy: Record<string, string>;
  cases: Case[];
};

const root = process.cwd();
const dataset: Dataset = JSON.parse(
  fs.readFileSync(path.join(root, 'eval', 'eval_dataset.json'), 'utf8')
);

function parseArgs(argv: string[]) {
  const out: { layer: string; only?: string[] } = { layer: 'all' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--layer') out.layer = argv[++i];
    if (argv[i] === '--only') out.only = argv[++i].split(',');
  }
  return out;
}

function runSetup(cmd: string | undefined, workDir: string) {
  if (!cmd) return;
  fs.mkdirSync(workDir, { recursive: true });
  spawnSync(cmd, { shell: true, cwd: workDir, timeout: 20_000 });
}

function assertExpect(
  expect: Expect,
  ctx: {
    output: string[];
    errors: string[];
    denies: string[];
    workDir: string;
    audit: string[];
    httpStatus?: number;
    httpBody?: any;
  }
): { ok: boolean; detail: string } {
  const allOut = [...ctx.output, ...ctx.errors, ...ctx.denies].join('\n');
  const auditText = ctx.audit.join('\n');
  switch (expect.type) {
    case 'output_contains':
      return { ok: allOut.includes(expect.value), detail: `output must contain ${expect.value}` };
    case 'error_contains':
      return { ok: allOut.includes(expect.value), detail: `error must contain ${expect.value}` };
    case 'guardian_deny':
      return {
        ok: ctx.denies.join('\n').includes(expect.value) || allOut.includes(expect.value),
        detail: `deny must contain ${expect.value}`,
      };
    case 'file_contains': {
      const [rel, ...rest] = expect.value.split(':');
      const needle = rest.join(':');
      const p = path.join(ctx.workDir, rel);
      if (!fs.existsSync(p)) return { ok: false, detail: `missing file ${rel}` };
      const text = fs.readFileSync(p, 'utf8');
      return { ok: text.includes(needle), detail: `${rel} must contain ${needle}` };
    }
    case 'audit_log_has':
      return { ok: auditText.includes(expect.value), detail: `audit must contain ${expect.value}` };
    case 'audit_log_missing':
      return { ok: !auditText.includes(expect.value), detail: `audit must NOT contain ${expect.value}` };
    case 'http_status':
      return {
        ok: String(ctx.httpStatus ?? '') === expect.value,
        detail: `http status ${expect.value}, got ${ctx.httpStatus}`,
      };
    case 'state_transition':
      return { ok: allOut.includes(expect.value), detail: `state ${expect.value}` };
    default:
      return { ok: false, detail: `unknown expect ${expect.type}` };
  }
}

async function runCase(c: Case): Promise<{ id: string; ok: boolean; detail: string }> {
  const workDir = path.join(root, '.samworker', 'work', c.id);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const auditFile = path.join(root, '.samworker', 'audit.log');
  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
  fs.writeFileSync(auditFile, '', 'utf8');
  const dbPath = path.join(workDir, 'state.db');
  runSetup(c.setup, workDir);

  let output: string[] = [];
  let errors: string[] = [];
  let denies: string[] = [];
  let httpStatus: number | undefined;
  let httpBody: any;

  const useHttp = Boolean(c.http_body) || (c as any).http_double_post === true;

  if (useHttp) {
    const port = 18000 + Math.floor(Math.random() * 2000);
    const facade = startHttpFacade({
      port,
      workspaceRoot: workDir,
      dbPath,
      autoApprove: !c.resolve?.approval,
    });
    try {
      const body = c.http_body ?? {
        goal: c.task,
        source: 'mouse',
        voice: c.voice ?? { keyId: 203, ts: Date.now(), transcript: c.task },
        client: 'MouseOptions',
        idempotencyKey: c.idempotencyKey ?? `${c.id}-key`,
        plan: c.plan_inject,
      };
      const res = await fetch(`http://127.0.0.1:${port}/task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      httpStatus = res.status;
      httpBody = await res.json().catch(() => ({}));

      if ((c as any).http_double_post) {
        const res2 = await fetch(`http://127.0.0.1:${port}/task`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        httpStatus = res2.status;
        httpBody = await res2.json().catch(() => ({}));
      }

      if (c.resolve?.approval) {
        const store = new ContextStore(dbPath);
        const pending = store.listPendingApprovals();
        store.close();
        for (const p of pending) {
          const r = await fetch(`http://127.0.0.1:${port}/approvals/${p.id}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ answer: c.resolve.answer ?? 'approve_once' }),
          });
          if (!r.ok) errors.push(`resolve failed ${r.status}`);
        }
        // wait for worker loop
        await new Promise((r) => setTimeout(r, 800));
      }

      if (httpBody?.taskId) output.push(`taskId=${httpBody.taskId}`);
      if (httpBody?.error) errors.push(httpBody.error);
    } finally {
      await facade.close();
    }
  } else {
    const run = await startTask(c.task, {
      source: (c.source as any) ?? 'cli',
      voice: c.voice,
      plan: c.plan_inject,
      workspaceRoot: workDir,
      dbPath,
      autoApprove: true,
    });
    output = run.output;
    errors = run.errors;
    denies = run.denies;
  }

  const audit = readAudit();
  const verdict = assertExpect(c.expect, { output, errors, denies, workDir, audit, httpStatus, httpBody });
  return { id: c.id, ok: verdict.ok, detail: verdict.detail };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const layers =
    args.layer === 'all' ? dataset.layers : [args.layer];
  const cases = dataset.cases.filter(
    (c) => layers.includes(c.layer) && (!args.only || args.only.includes(c.id))
  );

  const results: { id: string; ok: boolean; detail: string }[] = [];
  for (const c of cases) {
    results.push(await runCase(c));
  }

  const count = (layer: string) => {
    const rs = results.filter((r) => dataset.cases.find((c) => c.id === r.id)?.layer === layer);
    const pass = rs.filter((r) => r.ok).length;
    return `${pass}/${rs.length}`;
  };

  const summary: string[] = [];
  for (const layer of dataset.layers) {
    if (!layers.includes(layer) && args.layer !== 'all') continue;
    const rs = results.filter((r) => dataset.cases.find((c) => c.id === r.id)?.layer === layer);
    if (!rs.length) continue;
    const pass = rs.filter((r) => r.ok).length;
    summary.push(`${layer.toUpperCase()} ${pass}/${rs.length}`);
    for (const r of rs.filter((x) => !x.ok)) {
      console.error(`FAIL ${r.id}: ${r.detail}`);
    }
  }
  console.log(summary.join(' · '));

  const required = (layer: string) => {
    const policy = dataset.passing_policy?.[layer] ?? '';
    return /required/i.test(policy);
  };
  let code = 0;
  for (const layer of Object.keys(dataset.passing_policy ?? {})) {
    if (!required(layer)) continue;
    if (!layers.includes(layer) && args.layer !== 'all' && args.layer !== layer) continue;
    const rs = results.filter((r) => dataset.cases.find((c) => c.id === r.id)?.layer === layer);
    if (!rs.length) continue;
    const pass = rs.filter((r) => r.ok).length;
    const need = rs.length;
    if (pass !== need) code = 1;
  }
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
