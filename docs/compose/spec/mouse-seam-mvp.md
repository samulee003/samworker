---
feature: mouse-seam-mvp
status: designed
updated: 2026-09-22
branch: feature/mouse-seam-mvp
commits: 0b9b6f1..HEAD
---

# Mouse Seam MVP

## Report

## [S1] Problem

mouse-mod（小米智能滑鼠硬體層）與 SamWorker（治理型 worker）是兩個獨立專案。使用者要的整條 AI 工作流是：**滑鼠語音鍵 → 文字 goal → SamWorker 規劃／審批 → 交付 REPORT.md**。目前兩邊沒有任何正式接點：SamWorker 只有 `startTask(goal)` 程式 API，沒有本機 HTTP 入口；mouse-mod 只會叫 Grok Bot。缺一條可稽核的 seam，工作流接不起來。

## [S2] Design

### 產品關係（已定案）

- SamWorker 是大腦；mouse-mod 是硬體／輸入層。
- Grok Bot 保留為可插拔語音後端之一（`voice_source: "grokbot"` 不改）。
- 新增 `voice_source: "samworker"`：MCI 錄音 → 現有 `asr_url` 轉文字 → `POST /task`。
- 倉庫分離；seam ＝ mouse-mod 的 `MouseOptions.exe --cli` 契約（SamWorker→mouse）＋ 本機 HTTP（mouse→SamWorker）。

### HTTP seam（mouse → SamWorker）

```
POST http://127.0.0.1:10087/task
Content-Type: application/json

{
  "goal": "…",
  "source": "mouse",
  "voice": { "keyId": 203, "ts": 0, "transcript": "…" },
  "client": "MouseOptions",
  "idempotencyKey": "uuid-v4"
}
```

| 回應 | 語意 |
|---|---|
| `202 { "taskId": "…" }` | 已接受，異步執行 |
| `400` | zod 驗證失敗 |
| `409` | 同 `idempotencyKey` 已存在 |

失敗語意：SamWorker 未起／連線逾時 2s → **客戶端不自動重試建任務**，只留 log／tray 提示。僅 bind `127.0.0.1`。

### `startTask` 契約（ADDENDUM 對齊）

```
startTask(goal, opts?: {
  source?: "cli" | "mouse" | "job",
  voice?: { keyId?: number, ts?: number, transcript?: string },
  plan?: injectedPlan   # eval 用；生產由 LLM 產生
})
```

- 既有 `startTask(goal)` 相容。
- audit JSONL 每行新增 `source`；**transcript 稿文不進 audit**（只進 transcripts 表）。
- Guardian 不因 `source` 降級：mouse 來源照走全套規則／審批／熔斷。

### 審批介面（MVP）

- `GET  http://127.0.0.1:10087/approvals` — 最小 HTML，列 pending
- `POST http://127.0.0.1:10087/approvals/:id` body `{ "answer": "approve_once" | "approve_scope" | "deny" }`
- 同步提供 CLI（腳本／eval 用）：`tsx eval/eval_runner.ts` 不負責審批；另見 `packages/plugin-guardian` 的 polling 路徑

### 架構落點

- HTTP 門面＝ `plugin-samworker-core` 的薄殼（與 Cordis wrapper 同模式），不新建 adapter。
- 本 feature 僅交付：Phase 0 scaffold、Phase 1 `plugin-context-store`、最小 `startTask` 可跑 injected plan／approval 等待、HTTP 門面、`mouse` eval 層、BUILD-ADDENDUM。
- **不做**（Out of scope 亦列於 [S3]）：Guardian 全量、fs/shell adapters 實裝、JEV、mouse-mod 改碼、vision/jobs。

### mouse-mod 側契約（本 repo 不改碼，只定約）

`config.json` 新欄位（第二期 mouse-mod 實裝）：

```json
{
  "voice_source": "samworker",
  "samworker_url": "http://127.0.0.1:10087"
}
```

行為：短按語音鍵 → 錄音 → `asr_url` → `POST {goal, source:"mouse", voice, client:"MouseOptions", idempotencyKey}`。長按語音鍵維持現狀。MVP **無反向通知**。

## [S3] Out of Scope

- mouse-mod / MouseOptions.cs 任何改動（含 `voice_source: samworker` 實裝）——第二期
- Guardian 規則引擎／熔斷／adapters 完整實裝（BUILD Phase 2–5）
- JEV / plugin-jev（ADDENDUM 只預留 hook 敘述）
- SamWorker 六屏 UI（S2 卡片）；MVP 只要 `/approvals` 最小頁
- vision、jobs、bridge、computer
- 反向通知（task 完成 toast）
- 長按語音鍵新語意
- ASR 服務本身（沿用 mouse-mod `asr_url`）

## Tasks

- [ ] T1: Phase 0 scaffold（package.json / tsconfig / permissions.json / 套件骨架）— acceptance: `npm install` 與 `npx tsc --noEmit` 退出碼 0 (covers: S2)
- [ ] T2: Phase 1 plugin-context-store（kv / approvals / jobs / transcripts，WAL）— acceptance: `npm run test:context` 全綠 (covers: S2; depends: T1)
- [ ] T3: 最小 core.startTask（opts、audit.source、injected plan、approval 等待→resolve）— acceptance: 單元可經 eval mouse-01/03/04 (covers: S2; depends: T2)
- [ ] T4: HTTP 門面 `/task` + `/approvals`（127.0.0.1:10087，202/400/409）— acceptance: mouse eval 命中 (covers: S2; depends: T3)
- [ ] T5: eval 層 `mouse`（8 條）+ runner `--layer mouse` + passing_policy — acceptance: `npm run eval:mouse` 8/8 (covers: S2; depends: T4)
- [ ] T6: `SamWorker-BUILD-ADDENDUM-MOUSE.md`（startTask 契約、audit 欄位、JEV hook 一行）— acceptance: 文件與實作簽名一致 (covers: S2)
