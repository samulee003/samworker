# SamWorker — CODING AGENT BUILD SPEC
## V4.0 | 自足版(唯一真相源,不引用任何外部規格文檔)
## Stack: TypeScript + Cordis + better-sqlite3 + zod + node-cron | Host: DeepSeek Harness (dsh)

> **DIRECTIVE FOR CODING AGENT:** Implement SamWorker by following this file phase by phase.
> Do NOT invent architecture. Do NOT add features not listed here. If any acceptance test fails, fix before proceeding.
> If this spec's assumed API names differ from actual dsh source code, **source code wins** — record the deviation in `DEVIATIONS.md` and continue.

---

## 0. GROUND RULES & TRUTH SOURCES

1. SamWorker is a set of Cordis plugins that turn dsh into a **governed worker**: every tool call passes a Guardian (rules → approval → audit), adapters do the work, a vision loop verifies side effects.
2. dsh source (ground truth, pinned): `C:\Users\senghangl\.zcode\workspace\default\ds-harness` @ commit `ddefc45` (2026-09-17). Read before integrating:
   - `packages/sandbox/` — confinement service, rungs `read-only` / `workspace-write` / `danger-full-access`, Windows ACL backend
   - `packages/computer-use/` — desktop control APIs
   - `packages/core/` — Cordis plugin/kernel/service conventions
   - `docs/` — plugin authoring docs
3. **Integration seam rule:** all dsh API imports live in exactly ONE file: `packages/dsh-ports/src/index.ts`. Everything else depends on that seam. dsh is developer-preview and will break APIs; this localizes the damage.
4. Headless-first: `plugin-samworker-core` must expose a pure programmatic API (`startTask(goal)`); the eval runner drives it directly without any UI. The Cordis plugin wrapper is a thin shell over the core.
5. Windows is the target OS (win32). Use `tsx` to run TS. All paths in tests must handle win32 separators. better-sqlite3 ships prebuilds — do not run node-gyp manually.
6. All new code lives in repo `D:\02_开发项目\samworker\` (this file is `SamWorker-BUILD.md` at its root).

---

## 1. PHASE 0 — SCAFFOLD

Create exactly this structure:

```
samworker/
├── package.json
├── tsconfig.json
├── permissions.json
├── SamWorker-BUILD.md          (this file)
├── DEVIATIONS.md               (created on demand; empty is fine)
├── packages/
│   ├── dsh-ports/              # the ONLY dsh import seam
│   │   ├── package.json
│   │   └── src/index.ts
│   ├── plugin-context-store/
│   │   ├── package.json
│   │   └── src/index.ts
│   ├── plugin-guardian/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts        # Cordis plugin entry (thin)
│   │       ├── core.ts         # pure logic, UI/host-independent
│   │       ├── types.ts
│   │       ├── rule-engine.ts
│   │       ├── approval-flow.ts
│   │       ├── audit-logger.ts
│   │       └── circuit-breaker.ts
│   ├── plugin-samworker-core/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts        # Cordis plugin entry (thin)
│   │       ├── core.ts         # state machine + orchestration (pure)
│   │       └── prompt.ts       # system prompt constant
│   └── adapters/
│       ├── types.ts
│       ├── adapter-fs/         (package.json + src/{index,schema}.ts)
│       ├── adapter-shell/
│       ├── adapter-engine/
│       ├── adapter-bridge/
│       ├── adapter-computer/
│       ├── adapter-jobs/
│       └── adapter-vision/
├── eval/
│   ├── eval_dataset.json       (65 cases — already provided, do not redesign)
│   └── eval_runner.ts
└── README.md
```

Root `package.json` (exact versions floor):

```json
{
  "name": "samworker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "dsh web",
    "test:context": "tsx eval/eval_runner.ts --layer smoke --only smoke-01,smoke-08",
    "test:adapters": "tsx eval/eval_runner.ts --layer smoke --only smoke-02,smoke-04,smoke-05,smoke-09,smoke-10",
    "test:guardian": "tsx eval/eval_runner.ts --layer security",
    "eval:smoke": "tsx eval/eval_runner.ts --layer smoke",
    "eval:golden": "tsx eval/eval_runner.ts --layer golden",
    "eval:edge": "tsx eval/eval_runner.ts --layer edge",
    "eval:integration": "tsx eval/eval_runner.ts --layer integration",
    "eval:all": "tsx eval/eval_runner.ts --layer all"
  },
  "dependencies": {
    "cordis": "^3.0.0",
    "better-sqlite3": "^9.1.0",
    "zod": "^3.23.0",
    "minimatch": "^9.0.0",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "tsx": "^4.0.0"
  }
}
```

**Acceptance P0:** `npm install` exits 0. `npx tsc --noEmit` exits 0 on an empty `core.ts`/`index.ts` skeleton.

---

## 2. PHASE 1 — plugin-context-store

**File: `packages/plugin-context-store/src/index.ts`** — single source of truth, SQLite WAL.

```sql
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS approvals (scope TEXT PRIMARY KEY, level TEXT, updatedAt INTEGER);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, name TEXT, cron TEXT, task TEXT,
  enabled INTEGER DEFAULT 1, lastRunAt INTEGER, lastStatus TEXT, createdAt INTEGER);
CREATE TABLE IF NOT EXISTS transcripts (id INTEGER PRIMARY KEY AUTOINCREMENT,
  jobId TEXT, taskId TEXT, ts INTEGER, kind TEXT, payload TEXT);
```

Service `ContextStore` methods:
- `getState(): any`, `saveState(s: any)` (kv key `state`)
- `getPlan(): any`, `savePlan(plan: any)` (kv key `task_plan`), `getPlanTools(): string[]`
- `getApproval(scope): string | null`, `saveApproval(scope, level)`
- `savePendingApproval(id, data)`, `getApprovalResult(id): string | null`, `clearPendingApproval(id)`, `listPendingApprovals(): any[]`, `resolveApproval(id, answer)`
- `createJob({name, cron, task}): Job`, `listJobs(): Job[]`, `deleteJob(id)`, `updateJobRun(id, status)`
- `appendTranscript({jobId, taskId, kind, payload})`, `listTranscripts(jobId?)`
- DB path from `config.dbPath` or `.samworker/state.db`; `pragma journal_mode = WAL`

**Acceptance P1 (`npm run test:context`):** save/read roundtrip works; 50 concurrent writes (Promise.all) leave DB consistent; jobs + transcripts tables roundtrip.

---

## 3. PHASE 2 — ADAPTER FOUNDATIONS (types + fs + shell)

**File: `packages/adapters/types.ts`**

```typescript
import { z } from 'zod';
export interface AdapterImage { base64: string; mimeType: string }
export interface AdapterResult { data: any; images?: AdapterImage[] }   // images flow to model context
export interface ToolAdapter {
  readonly name: string;
  readonly tools: string[];
  getSchema(tool: string): z.ZodType | null;
  execute(tool: string, args: any, ctx: { invocationId: string; workspaceRoot: string }): Promise<AdapterResult>;
}
```

**adapter-fs** (tools `fs.listDir, fs.readFile, fs.writeFile, fs.searchContent`):
- schemas: `writeFileSchema` requires `reason: z.string().min(1)`; `readFile` encoding enum `utf-8|base64`
- `sanitizePath(userPath)`: `path.resolve(workspaceRoot, userPath)` → `fs.realpath` (catch → resolved) → must startWith workspaceRoot else throw `Path traversal denied`
- `readFile`: must be a file, ≤ 10MB; `searchContent`: regex, max 20 results; `listDir`: recursive via `path.relative(workspaceRoot, full)`
- `writeFile` executes under dsh sandbox rung `workspace-write` via `dsh-ports` (if seam unavailable in headless mode, fall back to direct `fs.writeFile` — record in DEVIATIONS.md)

**adapter-shell** (tool `shell.exec`):
- `SAFE_COMMANDS = ['ls','cat','grep','find','head','tail','wc','echo','pwd','whoami','date','uname','du','df','sort','uniq','cut','tr','sed','awk','diff','file','stat']`
- `exec({command, timeout≤300, cwd?})`: cwd resolve inside workspaceRoot; `spawn(command, [], {cwd, shell: true, timeout: timeout*1000})` + extra `setTimeout` 1s SIGKILL insurance; truncate stdout 100KB / stderr 50KB; return `{stdout, stderr, exitCode, timedOut}`
- static `isSafeCommand(cmd)` for rule-engine reuse
- confinement mapping: whitelist-only commands may run under `read-only`; everything else requests `workspace-write` via seam

**Acceptance P2 (`npm run test:adapters`):** smoke-02 (ENOENT), smoke-04, smoke-05, smoke-09, smoke-10 all pass.

---

## 4. PHASE 3 — plugin-guardian (生 死 週)

**types.ts**

```typescript
export type PermissionLevel = 'deny' | 'ask_everytime' | 'allow_once' | 'allow_same_scope' | 'full_trust';
export interface ToolCallRequest { tool: string; args: Record<string, any>; invocationId: string }
export interface PermissionRule {
  id: string; capability: string; scope: string;
  conditions?: { fileExists?: boolean; isDestructive?: boolean; commandWhitelist?: string[];
                 inPlan?: boolean; requiresVision?: boolean };
  defaultLevel: PermissionLevel; allowEscalateTo?: PermissionLevel; priority?: number;
}
```

**rule-engine.ts**
- `calcScore(rule) = scope.length + Object.keys(conditions||{}).length*20 + (priority||0) + (!scope.includes('**') ? 30 : 0)`
- `match(request, planTools)`: capability filter (`fs.listDir/readFile/searchContent→fs.read`, `fs.writeFile→fs.write`, `shell.exec→shell.exec`, engine/bridge/computer/jobs/vision keep their own); scope via minimatch; `fileExists` checked by REAL `fs.stat` at match time (TOCTOU-safe); `commandWhitelist` = first token; `inPlan` = planTools includes tool. Sort score desc, return first, else null.

**circuit-breaker.ts** — CLOSED/OPEN/HALF_OPEN; failureThreshold 3, resetTimeoutMs 5min, halfOpenMaxAttempts 1; `recordFailure(isDeny)` only for deny OR exception (grep exit 1 does NOT count); `recordSuccess()` decay after 10 min.

**approval-flow.ts**
- `makeCacheKey(rule, capability)` = rule ? `${capability}:${rule.id}` : `${capability}:${scope}`  ← anti-escalation fix, do not change
- `request(request, level, rule)`: deny→deny; full_trust→allow; cached `allow_same_scope`/`full_trust`→allow; else `askUserBlocking` (harness confirm UI via dsh-ports; headless fallback: `askUserPolling` → save pending to DB, return `{status:'waiting_for_approval'}` — worker core polls, never block inside the service >100ms)

**audit-logger.ts** — JSONL append `.samworker/audit.log`, one line per call:
`{timestamp: ISO, invocationId, tool, args: JSON.stringify(args).slice(0,500), ruleId, result: allow|deny|error, level}`
**Vision images NEVER go to the audit file** (rule 10). Only the fact `vision.verify` ran + pass/fail.

**core.ts — `worker_tool_call(rawArgs)` pipeline (exact order):**
1. zod parse `{tool: enum(adapters), args: record}` → throw on fail
2. attach invocationId
3. BLACKLIST regex deny + breaker.recordFailure(true) + throw: `[/rm\s+-rf\s+(\/|~|\*)/, /mkfs/, /:\(\)\{\s*:\|:&\s*;\}/, /curl.*\|\s*(sh|bash)/, /wget.*\-\s*O\s*-\s*\|\s*(sh|bash)/, /dd\s+if=.*\s+of=\/dev/]`
4. breaker.isOpen() → throw
5. adapter lookup (missing → throw)
6. adapter zod re-validate
7. `matchedRule = ruleEngine.match(...)`, `level = matchedRule?.defaultLevel || 'ask_everytime'`
8. approval decision (deny → breaker.recordFailure(true) + audit deny + throw)
9. `requiresVision` rules: set `pendingVisionCheck` flag in a per-invocation registry (worker core reads it in VERIFYING)
10. execute → audit allow + breaker.recordSuccess + return AdapterResult; catch → breaker.recordFailure(false) + audit error + throw

**Default `permissions.json` (root)** — load in plugin config:

```json
{ "rules": [
  {"id":"fs-read-workspace","capability":"fs.read","scope":"./work/**","defaultLevel":"allow_once","allowEscalateTo":"allow_same_scope"},
  {"id":"fs-write-new","capability":"fs.write","scope":"./work/**","conditions":{"fileExists":false},"defaultLevel":"allow_once","allowEscalateTo":"allow_same_scope"},
  {"id":"fs-write-overwrite","capability":"fs.write","scope":"./work/**","conditions":{"fileExists":true},"defaultLevel":"ask_everytime","allowEscalateTo":"allow_same_scope"},
  {"id":"fs-sensitive","capability":"fs.read","scope":"**/.env","defaultLevel":"deny","allowEscalateTo":"ask_everytime"},
  {"id":"fs-ssh","capability":"fs.read","scope":"**/.ssh/**","defaultLevel":"deny"},
  {"id":"shell-safe","capability":"shell.exec","scope":"*","conditions":{"commandWhitelist":["ls","cat","grep","find","head","tail","wc","echo","pwd"]},"defaultLevel":"allow_once","allowEscalateTo":"allow_same_scope"},
  {"id":"shell-default","capability":"shell.exec","scope":"*","defaultLevel":"ask_everytime","allowEscalateTo":"full_trust"},
  {"id":"engine-zcode","capability":"engine.zcode","scope":"*","defaultLevel":"ask_everytime","allowEscalateTo":"allow_same_scope"},
  {"id":"bridge-read","capability":"bridge.cmd","scope":"navigate|snapshot|screenshot|list_tabs|find_tab","defaultLevel":"allow_once","allowEscalateTo":"allow_same_scope"},
  {"id":"bridge-write","capability":"bridge.cmd","scope":"click|fill|upload|cdp|evaluate","defaultLevel":"ask_everytime"},
  {"id":"computer-use","capability":"computer.use","scope":"*","defaultLevel":"ask_everytime"},
  {"id":"jobs-manage","capability":"jobs.create|jobs.delete","scope":"*","defaultLevel":"ask_everytime"},
  {"id":"vision-verify","capability":"vision.verify","scope":"*","defaultLevel":"allow_once","allowEscalateTo":"allow_same_scope"}
] }
```
Note: `bridge-write` and `computer-use` have NO `allowEscalateTo` — real-world write actions can never reach full_trust (security rule 8).

**Acceptance P3 (`npm run test:guardian` → security 15/15):** path traversal ×5, shell injection ×5, prompt injection ×5 all guardian_deny.

---

## 5. PHASE 4 — plugin-samworker-core (state machine + prompt)

**States:** `IDLE → PLANNING → EXECUTING → VERIFYING → DELIVERING → COMPLETED`, plus `REFLECTING / CLARIFYING / FAILED` reachable from EXECUTING.

**core.ts**
- `startTask(goal)`: build plan (LLM call via dsh-ports; headless test mode: accept injected plan object) → savePlan → PLANNING→EXECUTING
- Loop: next step → `guardian.worker_tool_call({tool, args})`
- `waiting_for_approval` → CLARIFYING, poll `contextStore.getApprovalResult(id)` (1s interval, max task timeout)
- error → REFLECTING: failureCount < 2 → LLM replan; ≥ 2 → FAILED
- every 3 steps → REFLECTING against `definition_of_done`
- steps done → **VERIFYING**: (a) done_when satisfied (b) every `pendingVisionCheck` from step 9 registry was followed by a `vision.verify` (c) task's audit slice has zero denies. Any miss → REFLECTING.
- pass → DELIVERING: write `REPORT.md` (what was done, files touched, risks, audit excerpt) via fs adapter; COMPLETED

**prompt.ts — SYSTEM PROMPT (inject verbatim):**

```
你是 SamWorker。你只能通過 worker_tool_call 調用工具。
工具:fs.listDir / fs.readFile / fs.writeFile(path,content,reason) / fs.searchContent、
shell.exec、engine.zcode(重活或需要視覺的任務)、bridge.cmd(真實瀏覽器)、
computer.use(桌面操作)、jobs.create/list/delete(定時任務)、vision.verify(截圖自查)。
鐵律:
1. 任何改變頁面或系統狀態的動作(click/fill/type/computer.use)之後,下一步必須是 vision.verify,或給出明確跳過理由
2. 同一個失敗交互盲重試最多一次;第二次失敗必須先 vision.verify 再決定
3. 寫操作必須帶 reason;被 Guardian 拒絕後不許原地重試,先反思
4. 不確定就 ask_clarification,不要猜
5. 交付物是文件(REPORT.md 等),不是聊天
輸出 task_plan.json 格式:{goal, steps:[{id, goal, tool, done_when}], definition_of_done}
```

**Acceptance P4 (`npm run eval:smoke` 10/10 + `eval:golden` basic ≥5/6):** with injected plans for smoke; LLM optional for golden basic.

---

## 6. PHASE 5 — INTEGRATION ADAPTERS (engine / bridge / computer / jobs / vision)

**adapter-engine** — tool `engine.zcode({ task: string })`:
- `spawn('zcode', ['-p', task], { cwd: workspaceRoot, timeout: 15*60*1000 })` under sandbox rung `workspace-write` via seam. Run `zcode --help` first; if the one-shot flag differs (e.g. `--print`/`-p` semantics), adjust and log to DEVIATIONS.md.
- Success = exit 0; harvest created/modified files under workspaceRoot (mtime > spawn time) into `data.files`; stdout (truncated 100KB) into `data.stdout`. Timeout → throw `EngineTimeout` (breaker counts it).

**adapter-bridge** — tool `bridge.cmd({ action: string, args: object })`:
- `POST http://127.0.0.1:10086/command` JSON `{action, args, session: 'samworker'}` via Node fetch (inline JSON is safe in Node — the file-body workaround is only for shell curl on Windows; do NOT cargo-cult it)
- ECONNREFUSED → spawn `%USERPROFILE%\.kimi-webbridge\bin\kimi-webbridge.exe start` once → retry ×1
- action `screenshot` returns `{data:{path}}` → read file bytes → return as `images: [{base64, mimeType}]`
- capability mapping for Guardian: `navigate|snapshot|screenshot|list_tabs|find_tab` = read-class; `click|fill|upload|cdp|evaluate` = write-class (see permissions.json)

**adapter-computer** — tool `computer.use({ op: string, args: object })`: passthrough to dsh computer-use API via seam ONLY. Guardian gates it ask_everytime, always.

**adapter-jobs** — tools `jobs.create({name, cron, task}) / jobs.list / jobs.delete`:
- node-cron schedule; each fire → `samworker-core.startTask(task)` with full pipeline (Guardian per tool call — job approval ≠ tool approval, security rule 9); every run appends transcript rows (kind: `step|audit|result`)
- boot recovery: read jobs table, re-register crons; if `lastRunAt` missed a cron tick while down → run once at boot (flagged `catchup:true` in transcript)

**adapter-vision** — tool `vision.verify({ what: string })`:
- capture: bridge `screenshot` (fallback: computer screenshot via seam); return `images:[...]` + `data:{what, capturedAt}`
- audit records ONLY `{tool:'vision.verify', result:'allow', note: what}` — never the image bytes

**Acceptance P5 (`npm run eval:integration` 12/12):** incl. engine timeout→breaker, bridge auto-start daemon, click-after-vision enforcement (int-08), 3-minute cron job with ≥3 transcripts (int-09).

---

## 7. EVAL RUNNER

**File: `eval/eval_runner.ts`** — dataset `eval_dataset.json` (provided, 65 cases, 5 layers: smoke 10 / golden 18 / security 15 / edge 10 / integration 12):
- per case: run `setup` shell in a fresh `.samworker/work/<id>/` workspace → `startTask(task)` (injected-plan mode for smoke/security/edge; LLM mode optional for golden/integration) → wait ≤ `timeout_sec` → assert `expect.type`:
  `output_contains | error_contains | file_contains | guardian_deny | audit_log_has | shell_exit_code | schema_error | images_returned | state_transition`
- **exit code 1 if smoke ≠ 10/10, security ≠ 15/15, or integration ≠ 12/12.** golden/edge report scores only.
- summary line per layer: `SMOKE 10/10 · SECURITY 15/15 · INTEGRATION 12/12 · GOLDEN x/18 · EDGE x/10`

---

## 8. SECURITY REQUIREMENTS (NON-NEGOTIABLE ×10)

1. Every fs op → sanitizePath with realpath (symlink-proof)
2. Every shell exec → cwd inside workspaceRoot
3. Blacklist regex BEFORE rule engine
4. Write ops → zod-validated `reason`
5. Audit log: every tool call, zero exceptions
6. Breaker counts only deny + exception (not grep exit 1)
7. Approval cache key = `capability:ruleId` (never raw path)
8. `bridge` write-class + `computer.use` can NEVER escalate to full_trust
9. Jobs: every triggered run goes through Guardian per tool call
10. Vision images → model context only; audit stores the fact, never the pixels

---

## 9. FINAL ACCEPTANCE CHECKLIST

- [ ] `npm install && npx tsc --noEmit` clean
- [ ] `npm run eval:smoke` → 10/10
- [ ] `npm run test:guardian` → 15/15
- [ ] `npm run eval:integration` → 12/12
- [ ] Golden basic ≥ 5/6; medium ≥ 75%; hard ≥ 50%
- [ ] Golden log-analysis case → `REPORT.md` exists with correct ERROR count
- [ ] Symlink escape → denied (realpath)
- [ ] `while true; do echo 1; done` → `timedOut: true` ≤ 31s
- [ ] Write same file twice: first `allow_same_scope` answer → second auto-allowed
- [ ] 3-day cron job replays from transcripts (simulate by timestamps)
- [ ] Coexists with ZCode desktop (no port/process conflicts; bridge session name distinct)
- [ ] `.samworker/` removed = full uninstall
- [ ] DEVIATIONS.md lists every place dsh source overrode this spec

**DO NOT ADD:** web search, email, extra UI, new LLM providers, extra tools. This spec is the whole product.

END OF SPEC
