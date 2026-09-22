import path from 'node:path';
import fs from 'node:fs';
import { ContextStore } from '../../plugin-context-store/src/index.js';
import { fsAdapter } from '../../adapters/adapter-fs/src/index.js';
import { appendAudit, readAudit } from '../../plugin-guardian/src/audit-logger.js';
import { SYSTEM_PROMPT } from './prompt.js';

export type StartOpts = {
  source?: 'cli' | 'mouse' | 'job';
  voice?: { keyId?: number; ts?: number; transcript?: string };
  plan?: any;
  workspaceRoot?: string;
  dbPath?: string;
  autoApprove?: boolean;
};

export type TaskResult = {
  taskId: string;
  status: 'COMPLETED' | 'FAILED' | 'CLARIFYING';
  output: string[];
  errors: string[];
  denies: string[];
};

export function systemPrompt(): string {
  return SYSTEM_PROMPT;
}

function matchLevel(tool: string, args: any): { level: string; ruleId: string | null; needApproval: boolean } {
  if (tool.startsWith('fs.')) {
    if (tool === 'fs.writeFile') {
      const exists = false; // existence checked in adapter; treat write as overwrite-sensitive
      return { level: 'ask_everytime', ruleId: exists ? 'fs-write-overwrite' : 'fs-write-new', needApproval: true };
    }
    return { level: 'allow_once', ruleId: 'fs-read-workspace', needApproval: false };
  }
  return { level: 'ask_everytime', ruleId: 'default', needApproval: true };
}

export async function startTask(goal: string, opts: StartOpts = {}): Promise<TaskResult> {
  const source = opts.source ?? 'cli';
  const workspaceRoot = path.resolve(opts.workspaceRoot ?? path.join(process.cwd(), '.samworker', 'work', `t_${Date.now()}`));
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const store = new ContextStore(opts.dbPath);
  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const plan = opts.plan ?? { goal, steps: [], definition_of_done: 'n/a' };
  store.savePlan(plan);
  store.appendTranscript({ taskId, kind: 'result', payload: { goal, source, plan } });

  if (opts.voice?.transcript) {
    store.appendTranscript({
      taskId,
      kind: 'voice',
      payload: { keyId: opts.voice.keyId, ts: opts.voice.ts, transcript: opts.voice.transcript },
    });
  }

  const result: TaskResult = { taskId, status: 'COMPLETED', output: [], errors: [], denies: [] };
  const steps: any[] = Array.isArray(plan) ? plan : (plan.steps ?? []);

  for (const step of steps) {
    const invocationId = `${taskId}:${step.id ?? 0}`;
    const tool = String(step.tool ?? '');
    const args = step.args ?? {};
    try {
      if (tool.includes('../') || String(args.path ?? '').includes('..')) {
        // adapter will also deny; guardian-style deny first
      }
      const gate = matchLevel(tool, args);
      let answer = gate.needApproval ? 'ask' : 'allow';
      if (gate.needApproval && opts.autoApprove) answer = 'allow';
      if (gate.needApproval && !opts.autoApprove) {
        const approvalId = `appr_${invocationId}`;
        store.savePendingApproval(approvalId, { invocationId, tool, args, ruleId: gate.ruleId, source });
        appendAudit({
          invocationId,
          tool,
          args,
          ruleId: gate.ruleId,
          result: 'error',
          level: 'ask_everytime',
          source,
          voiceKey: opts.voice?.keyId,
          note: 'waiting_for_approval',
        });
        const deadline = Date.now() + 30_000;
        let resolved: string | null = null;
        while (Date.now() < deadline) {
          resolved = store.getApprovalResult(approvalId);
          if (resolved) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        store.clearPendingApproval(approvalId);
        if (!resolved || resolved === 'deny') {
          appendAudit({
            invocationId,
            tool,
            args,
            ruleId: gate.ruleId,
            result: 'deny',
            level: 'deny',
            source,
            voiceKey: opts.voice?.keyId,
          });
          result.denies.push(tool);
          result.status = 'FAILED';
          result.errors.push(`approval ${resolved ?? 'timeout'}`);
          return result;
        }
        if (resolved === 'approve_scope') {
          store.saveApproval(`${gate.ruleId}:*`, 'allow_same_scope');
        }
      }

      const res = await fsAdapter.execute(tool, args, { invocationId, workspaceRoot });
      if (typeof res.data?.content === 'string') result.output.push(res.data.content);
      if (typeof res.data?.entries === 'object') result.output.push(JSON.stringify(res.data.entries));
      if (res.data?.ok) result.output.push(String(args.content ?? ''));
      appendAudit({
        invocationId,
        tool,
        args,
        ruleId: gate.ruleId,
        result: 'allow',
        level: answer === 'allow' ? 'allow_once' : 'allow_same_scope',
        source,
        voiceKey: opts.voice?.keyId,
      });
      store.appendTranscript({ taskId, kind: 'step', payload: { tool, ok: true } });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const deny = msg.includes('Path traversal denied');
      appendAudit({
        invocationId,
        tool,
        args,
        ruleId: deny ? 'fs-read-workspace' : null,
        result: deny ? 'deny' : 'error',
        level: deny ? 'deny' : 'error',
        source,
        voiceKey: opts.voice?.keyId,
      });
      result.errors.push(msg);
      if (deny) {
        result.denies.push('Path traversal denied');
        result.status = 'FAILED';
        return result;
      }
      result.status = 'FAILED';
      return result;
    }
  }

  store.appendTranscript({ taskId, kind: 'result', payload: { status: result.status, output: result.output } });
  store.saveState({ taskId, status: result.status, source });
  store.close();
  return result;
}

export { readAudit };
