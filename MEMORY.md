# MEMORY.md — 跨 session 記憶（新 agent 先讀這個）

> 2026-09-22。ZCode 接手用。技術規格見 `AGENTS.md`；本檔是「做到哪、下一步、踩過什麼雷」。

## 專案一句話
SamWorker＝治理型 AI worker（Cordis/TS）；正在和 mouse-mod（小米滑鼠）以 HTTP seam 接起來，終點是「按滑鼠語音鍵 → goal → 審批 → REPORT.md」。

## 現況快照
- **Mouse Seam MVP 已交付**（feature `mouse-seam-mvp`，報告 `docs/compose/spec/mouse-seam-mvp.md`）
  - context-store（node:sqlite）、最小 startTask/beginTask、HTTP `/task`+`/approvals`、eval 層 `mouse` 8 條
  - 驗證全綠：tsc 0、mouse 8/8、smoke-01/08 2/2
  - 三輪 review critical 已清（zod、真 taskId、原子 idempotency、approve_scope、store finally）
- **未做**：BUILD Phase 2–5（Guardian 全量、各 adapters）、JEV、mouse-mod 側改碼
- Git：`origin/master=aaf4c3f`（=feature tip）；已推 `https://github.com/samulee003/samworker.git`
  本機 master 可能落後，用 `git branch -f master origin/master` 對齊（session 不准 agent switch/update-ref）

## 決策（已定，別重開）
| 項 | 決定 |
|---|---|
| 產品關係 | SamWorker 是大腦；mouse-mod 是硬體/輸入層 |
| 語音後端 | 可插拔：`grokbot` 保留 + 新增 `samworker` |
| 倉庫 | 雙 repo + seam（CLI 契約 + HTTP 10087） |
| MVP | 語音→審批→檔案；不做 vision/jobs 反向通知 |
| ASR | mouse-mod 現有 `asr_url`；只送文字 goal |
| 審批 UI | `/approvals` 最小頁；正式 S2 UI 之後 |
| eval | 舊 65 不動；`mouse` 層 required |

## 下一步
1. **mouse-mod 第二期**（主線）：`C:\Users\senghangl\mouse-mod` 加 `voice_source:samworker` → MCI 錄音 → asr_url → `POST /task`。先讀該 repo `AGENTS.md`/`交接指令.md`（含嚴禁盲送 key、不能 csc/cmd、COL05 抢占等紅線）。
2. SamWorker BUILD Phase 2–5。
3. 可選：JEV、其他鍵、S2 UI、task 完成通知。

## 血淚教訓
1. **better-sqlite3 裝不起來**（Node 24 無 prebuild、無 VS）→ 用 `node:sqlite`，勿改回。
2. **不要把 node_modules commit 進去**（已加 `.gitignore`；曾誤 commit 後清掉）。
3. HTTP 必須 **先原子 claim idempotency 再 beginTask**，否則並發重複都會執行。
4. 審批路徑 **禁止同步 await startTask**，會堵死 /task 回應 → 用 `beginTask()`。
5. PowerShell 只能 `& $env:MIMO_NODE ...`，別叫 npm/npx。
6. MiMo agent 不能 worktree/switch/update-ref；merge 用者跑或遠端 ff push。
7. 審查過一次以上才交付；critical 必須修到復審通過。

## 關聯 repo
`C:\Users\senghangl\mouse-mod` — 小米智能滑鼠魔改（v0.8，語音鍵→Grok Bot 已實機驗證）。其 `AGENTS.md` 有硬體事實與死路清單；第二期只動 `VoiceRelay`/config，不要碰固件 key。
