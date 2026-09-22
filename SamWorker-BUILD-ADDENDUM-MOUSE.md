# SamWorker — BUILD ADDENDUM: Mouse / External Task Entry
## 前置：SamWorker-BUILD.md V4.0
## 本檔範圍：只加入口契約，不加 adapter，不改 Phase 2–5 其餘內容

> BUILD 的「Do NOT add features not listed here」在本 addendum 的範圍內解除：
> **僅**增加「外部任務入口」與對應稽核欄位。其餘禁令全部有效。

---

## 1. 為什麼

mouse-mod（滑鼠硬體層）要把語音 goal 送進 SamWorker。BUILD 原文只有程式 API
`startTask(goal)`，沒有本機聽診埠。本 addendum 定義入口與稽核，使兩 repo 以
HTTP seam 連接，而不把滑鼠／語音做成 adapter（那是後續 feature）。

## 2. `startTask` 契約（擴充，向後相容）

```typescript
function startTask(goal: string, opts?: {
  source?: "cli" | "mouse" | "job";     // 預設 "cli"
  voice?: { keyId?: number; ts?: number; transcript?: string };
  plan?: unknown;                        // eval 注入；生產忽略
}): Promise<{ taskId: string }>;
```

- 呼叫 `startTask(goal)` 的既有程式碼行為不變（`source` 視同 `"cli"`）。
- `voice.transcript` **只寫入 transcripts 表**（kind: `voice`），**禁止寫入 audit.log**。
- audit JSONL 每行新增欄位：`source`（必填）、`voiceKey`（有 voice 時）。
- Guardian / 熔斷 / 審批 **不因 `source` 放寬**。任務觸發核准 ≠ 工具呼叫核准（對齊安全鐵律 9）。

## 3. HTTP 門面（薄殼，不進 adapters 列表）

| 方法 | 路徑 | 語意 |
|---|---|---|
| POST | `/task` | body `{goal, source, voice?, client?, idempotencyKey}` → `202 {taskId}` / `400` / `409` |
| GET | `/approvals` | 最小 HTML pending 清單（MVP 審批 UI） |
| POST | `/approvals/:id` | body `{answer: approve_once\|approve_scope\|deny}` → 對應 `resolveApproval` |

- 僅 bind `127.0.0.1`，預設埠 **10087**（bridge 用 10086，刻意錯開）。
- `idempotencyKey` 重複 → `409`，不建立第二個任務。
- 門面位於 `plugin-samworker-core` 的薄殼層（與 Cordis plugin wrapper 同模式）；
  不改 `packages/adapters/` 的工具清單。

## 4. 資料

- `kv` 表新增 key：`idem:<idempotencyKey>` → `taskId`（供 409 判定）。
- `transcripts` 表沿用；`kind: "voice"` 的 payload 為 JSON `{keyId, ts, transcript}`。

## 5. JEV 預留（本 feature 不實裝）

- 位置：`startTask` 入口對 `goal` 原文（對齊 JEV I-2）。
- hook：`opts` 不變；實裝時在 zod parse 之後、建 plan 之前插入 `jev.decide("injection", {taskText: goal})`。
- MVP 預設不呼叫；失敗必須可降級（JEV 規格原句）。

## 6. 明確不變的事

- BUILD 安全鐵律 ×10 全部有效。
- adapters 清單不變：fs / shell / engine / bridge / computer / jobs / vision。
- 禁止項目（web search、email、新 UI 產品、新 LLM provider、新工具）仍禁止。
  `/approvals` 是 headless `askUserPolling` 的最小回覆面，不是「額外 UI 產品」。

## 7. mouse-mod 側（本 repo 不實裝，契約如下）

```json
{
  "voice_source": "samworker",
  "samworker_url": "http://127.0.0.1:10087"
}
```

短按語音鍵 → 系統麥克風錄音 → 現有 `asr_url` 轉文字 → `POST /task`
（`source: "mouse"`, `client: "MouseOptions"`, `idempotencyKey: uuid`）。
逾時 2s 且失敗：不重試、不建任務。長按語音鍵維持現狀。
END
