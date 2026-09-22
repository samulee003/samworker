# DEVIATIONS.md

記錄：規格假設與實際環境／dsh 源碼不一致時，以實際為準的處置。

## 2026-09-22 · plugin-context-store

- **規格**：`better-sqlite3@^9.1.0`（BUILD 稱 ships prebuilds）。
- **實際**：Node.js v24.15.0 無對應 prebuild，`node-gyp rebuild` 需 VS Build Tools（本機無）。
- **處置**：改用 Node 內建 `node:sqlite`（`DatabaseSync`），SQL schema 與 API 面保持 BUILD 定義之方法簽名。`better-sqlite3` 之 `@types` 一併移除。
- **影響**：不改 `ContextStore` 對外契約；換機若有 better-sqlite3 prebuild 可再切回。

## 2026-09-22 · Workspace

- **規格（compose-next）**：linked worktree `.worktrees/<slug>`。
- **實際**：環境政策封鎖 `git worktree add`（mutates shared worktree registry）。
- **處置**：同 checkout 上 `git switch -c feature/mouse-seam-mvp`。
