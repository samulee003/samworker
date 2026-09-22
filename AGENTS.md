# AGENTS.md — SamWorker

交接先讀本檔 + `MEMORY.md`。規格真相源：`SamWorker-BUILD.md`（V4.0）＋ `SamWorker-BUILD-ADDENDUM-MOUSE.md`。與實作衝突時以 `DEVIATIONS.md` 為準。

## 一句話
把 dsh 變成治理型 worker：每次工具呼叫過 Guardian（規則→審批→審計）。本 repo 現況＝**Mouse Seam MVP 已交付**，BUILD Phase 2–5 未做。

## 硬邊界（違反會出事）
1. dsh API 只准 import 在 `packages/dsh-ports/src/index.ts`（目前是 stub）。
2. 安全鐵律 ×10 見 BUILD §8（realpath、audit 全記錄、`bridge` 寫操作不可升 `full_trust`、transcript 不進 audit…）。
3. 不許多加：web search / email / 額外 UI 產品 / 新 LLM provider / 新工具。`/approvals` 最小頁是 headless 審批面，不是產品 UI。
4. 舊 65 條 eval 不許 redesign；只可加層（現有 `mouse` 8 條）。
5. 目標 OS win32；用 tsx 跑 TS；路徑要吃 `\` 與 `/`。

## 環境坑（實測）
- **PowerShell 執行策略**擋 `npm.ps1`/`npx.ps1`。一律：
  `& $env:MIMO_NODE node_modules\typescript\bin\tsc --noEmit`
  `& $env:MIMO_NODE node_modules\tsx\dist\cli.mjs eval\eval_runner.ts --layer mouse`
- **better-sqlite3** Node 24 無 prebuild 且無 VS Build Tools → 已改 **`node:sqlite`**（見 DEVIATIONS.md）。
- **MiMo session 禁止** `git worktree add` / `git switch` 跨分支 / `git update-ref`。本機合併請用者跑，或 `git push origin feature/xxx:master` 做遠端 ff。
- 寫 Windows 路徑腳本時注意 UNC 與反斜線（mouse-mod 環境同病）。

## 驗證（completion 前必跑，勿偽 PASS）
```text
tsc --noEmit                          → 0
eval_runner --layer mouse             → 8/8
eval_runner --layer smoke --only smoke-01,smoke-08 → 2/2
```
不要重跑已 PASS 的重測除非碼又改了。

## 目錄速查
- `packages/plugin-context-store` — kv/approvals/jobs/transcripts/pending_approvals/idem；WAL
- `packages/plugin-samworker-core/core.ts` — `startTask` / `beginTask`、審批等待、audit
- `packages/plugin-samworker-core/http.ts` — `POST /task`（zod、原子 idempotency、202/400/409）、`GET/POST /approvals`
- `packages/adapters/adapter-fs` — 最小 fs（sanitizePath / realpath）
- `eval/eval_runner.ts` + `eval/eval_dataset.json`（65 舊 + 8 mouse）
- `docs/compose/spec/mouse-seam-mvp.md` — 本次 feature 報告（delivered）

## Seam 契約（mouse-mod 第二期要用）
```
POST http://127.0.0.1:10087/task
{ goal, source:"mouse", voice:{keyId,ts,transcript}, client:"MouseOptions", idempotencyKey }
→ 202 {taskId} | 400 | 409
GET /approvals → 最小 HTML；POST /approvals/:id {answer: approve_once|approve_scope|deny}
```
mouse-mod `config.json`：`voice_source:"samworker"`、`samworker_url:"http://127.0.0.1:10087"`。逾時 2s 不自動重試。Grok 通道（`voice_source:grokbot`）不可改壞。

## 下一步（優先序）
1. **mouse-mod 第二期**：`voice_source: samworker`（錄音→asr_url→POST /task）。repo `C:\Users\senghangl\mouse-mod`，先讀該 repo 的 `AGENTS.md` 紅線。
2. SamWorker BUILD Phase 2–5：Guardian 全量、shell/engine/bridge/computer/jobs/vision adapters。
3. 可選：JEV、其他鍵綁任務、S2 UI、反向通知。

## Git
- 遠端 `https://github.com/samulee003/samworker.git`
- 內容在 `origin/master` = `origin/feature/mouse-seam-mvp` = `aaf4c3f`
- 本機 `master` 可能仍停 `0b9b6f1`；對齊：`git fetch origin && git branch -f master origin/master`
- 遠端另有 `main`（無關 Initial commit）；default branch 自行決定。

## 鐵律
- 寫操作必帶 `reason`；被 deny 不原地重試。
- audit 每工具呼叫必留；**transcript 稿文禁止寫進 audit**。
- source=mouse **不得**讓 Guardian 降級。
- 交付物是文件（REPORT.md 等），不是聊天。
