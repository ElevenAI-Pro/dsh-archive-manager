# Changelog

## 0.6.0 (2026-11-19)

### 变更

- **产品更名为 `dsh-archive-manager`**（原 `dsh-session-delete`；npm 上该名已被另一插件占用）。API 路径前缀 `/api/session-delete` 保持不变。

## 0.6.0 (2026-11-19)

### 新增

- **子代理级联删除**：侧边栏「永久删除」与批量永久删除现在会级联抹除目标会话的全部后代子代理会话（多级递归）；任一子代理在运行则整体拒绝（409），绝不留下半删状态；逐会话广播 removed 并写入审计（`cascade` 字段）。
- **注入诊断遥测**：`GET/POST /api/session-delete/debug`——侧边栏钩子全链路（安装/行捕获/菜单扫描/容器快照）实时上报，可离线排查注入链路。

### 变更

- 侧边栏「永久删除」改经轻量 DOM 注入实现：位于「归档会话」**正下方**、常规配色、**无快捷键**、恒单条；行组件判定按 0.2.2-rc.5 实测 props（`node.id` + `onOpen/useContextMenu/onRenameRequest`），右键/左键/中键均可触发。
- 归档管理页对齐 zcodex 版式：移除页签与大标题下的切换器，新增 22px 页面标题；自动归档卡片仅保留「自动归档旧会话（开关）」与「归档保留时长（宽下拉）」两行；「立即扫描 / 刷新」降级为扫描结果行内文字链接；分组行仅显示「N 个会话」；「回收站」降级为页面底部入口（还原/彻底删除/清空功能不变）；「全部会话」视图移除（侧栏永久删除已覆盖任意会话删除）。
- 宿主测试数据模型改为磁盘驱动（删除的会话自动从清单排除），与真实持久化一致。

### 测试

- `test/smoke.mjs` 扩至 53 项断言：级联删除（多级抹除/逐会话广播/审计/运行中子代理 409 且目录不动）、配置补丁语义、自动归档跳过逻辑、purge-archived 幂等。
- `test/render.mjs` 22 项断言：三槽位注册、菜单项与设置页（zcodex 版式）渲染、分组折叠、项目筛选、扫描入口。

## 0.5.1-fork.1 (2026-11-19)

首次 fork 变更（详见 FORK.md）：侧边栏「永久删除」初版（官方槽位）+ 归档管理页重构 + 自动归档。

## 0.5.1-fork.1 (2026-11-19)

本版本是 [xohmai/dsh-session-delete](https://github.com/xohmai/dsh-session-delete) v0.5.1 的本地魔改 fork（Apache-2.0，原始许可与版权保留，修改内容见下与 FORK.md）。

### 新增

- **侧边栏「永久删除」（仿 Codex）**：会话行 `…` 菜单新增红色「永久删除」项（官方槽位 `sidebar.workspaces.session.menu.item` + 官方原语 `MenuItemButton`/`Modal`，不再依赖 DOM 注入），确认框走 `shell.overlay` 槽位，菜单关闭后仍存活。删除一步完成：归档隐藏 → 直接抹除磁盘目录，**不经回收站、不可恢复**；运行中的会话拒绝（409）；删除当前打开的会话后自动切到空白会话。宿主新增 `POST /api/session-delete/delete-permanent`。
- **归档管理（仿 zcodex）**：设置页默认页签重构为「归档管理」——顶部「自动归档旧会话」卡片（开关 + 保留期 1/3/7/14/30/90 天 + 扫描间隔 10 分钟~24 小时 + 立即扫描 + 上次扫描结果行），下方「已归档的会话」按项目分组清单（搜索 + 按更新时间/创建时间/体积排序 + 多选批量）+ 红色「全部永久删除」（两步确认，跳过运行中会话，返回成功/失败/跳过统计）。宿主新增 `GET|POST /api/session-delete/config`、`POST /api/session-delete/auto-archive/run`、`POST /api/session-delete/purge-archived`。
- 自动归档配置落盘 `<DSH_HOME>/trash/sessions/config.json`；插件启动时恢复定时扫描，卸载时清理定时器。
- 行内新增「永久删除」按钮（两步确认），与回收站「彻底删除」区分开。

### 兼容性

- 原「归档会话/全部会话/回收站」三页签行为不变；设置页 nav 名称由「归档会话」改为「归档管理」（CSS 图标替换的选择器文本同步更新）。
- 侧边栏入口依赖 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button/Modal/MenuItemButton/IconTrashOutlineRegular`：缺失时仅跳过侧边栏注册并打警告，设置页不受影响。

## 0.5.1 (2026-11-06) — 上游 xohmai/dsh-session-delete

## 0.5.1

- Fix (PR #4): deleting a session now broadcasts `api-session/removed` to every connected client, so sidebar rows are pruned immediately everywhere — previously only the acting client refreshed its list, leaving stale rows in other clients that failed with `session/not-found` when opened. Verified end-to-end against DSH source before merging: the event is whitelisted in `dsh-api-remotes`' forwarded-event registry (cordis emits from plugin contexts reach it the same way `plugin-market/changed` does), and the client's `handleSessionRemoved` is no-op-safe for cold, non-resident sessions while still recording the store removal. Double emission when the host later disposes a live session is idempotent
- Fix (PR #4): restoring from trash broadcasts `api-session/added` with a minimal summary so the row reappears in connected clients without waiting for a baseline refresh; the summary now carries `formatStatus: "current"` like the host's own `summaryFor` (follow-up to the PR)
- Prefer the public `workspaceRegistry.unarchiveSession()` on current DSH (same serial queue and persistence as `archiveSession`); the internal state-machine path stays as the legacy fallback (≤0.1.1-rc.x) and capability detection is unchanged
- Tests: emit assertions for the delete/restore broadcasts; the smoke stub now encodes session-directory names the same way the core does, fixing the Windows-only mkdir failures the PR author reported (raw `:` from IM ids is not a legal directory name on NTFS)
- Known edge (core semantics, not a bug): official clients treat `origin === "subagent"` rows as durable — `api-session/removed` only marks them not-running; such rows disappear on the client's next list refresh

## 0.5.0

- New: streaming session list with real progress. A new `GET /api/session-delete/list-stream` route emits NDJSON — a `meta` line first (total count, workspaces, unarchive capability) so the total is known immediately, then one line per session as soon as it is computed, then `done`. The client switches to this route and shows a live "已加载 N / M 个会话" counter instead of a bare wait; rows render once, sorted by `mtimeMs` (same order as before, no reshuffle flicker). The old one-shot `/list` route stays for compatibility and tests
- UI: first-load transitions are now centered horizontally and vertically in the scroll area (spinner + label + live counter); the trash tab gets the same centered spinner without a counter (its endpoint is millisecond-fast). Reloads with existing data stay silent (old list remains usable, ↻ spins)
- Perf (critical): titles no longer decompress session logs one-by-one. Two compounding costs were removed — `readTitleSnapshots` re-scans the whole persistence listing on every call, so per-session calls were quadratic (520 sessions: 60s+ and still incomplete), and every session paid a full zstd decompress. Titles now resolve in one batched pass: cold sessions hit the `sessionProjectionCache` `title` row first (zero I/O, same source the sidebar's `session.list` serves and prewarms; identity-witnessed so it can never cross sessions; seeded headers follow the official predecessor probe), and only actual misses go through one batched `readTitleSnapshots` call (its internal concurrency pool decompresses in parallel). Live sessions keep reading in-memory titles. Measured on 520 sessions / 401 MB of logs: the stat+readdir pass is ~50 ms, versus 60s+ before
- Perf: record computation runs as three phases (parallel stat precheck → batched title resolve → 16-way row pool); mtime-keyed record cache hits skip title resolution and dir sizing entirely, so repeat loads are stat-only
- Fix (perf): `locate()` returns the *current-generation* log path (e.g. `session.v3.jsonl.zstd`), which does not exist for not-yet-migrated old-format sessions (v0 keeps the plain `session.jsonl.zstd` name) — the mtime record cache could never warm for them and every reload recomputed everything (measured 8s steady on 520 sessions). The precheck now falls back to scanning the session directory for the highest-generation log actually present
- UI: switching tabs no longer refetches on every entry — data loads once when absent and is kept in sync by the post-action refreshes (delete/restore/purge already reload); the ↻ button remains for a manual refresh
- Diagnostics: the `done` line of `/list-stream` now carries per-phase timings (`inventoryMs`/`prepMs`/`titleMs`/`rowMs`) and title-source counts (recordCache/snapshot/predecessor/batched), which pinpointed both regressions above
- Fix (IM channels, #3): sessions from IM channels (`dsh-im-connect`, ids like `im:weixin_…@im.wechat` containing `:`/`@`/`_`/`.`) could neither be deleted, restored, nor unarchived. Two layers: the id whitelist rejected them with 400 before any logic ran, and — once widened — the raw id embedded in the trash entry name made `mkdir` fail with ENOENT on Windows (`:` is a reserved character). Per the core contract (`SessionId` is an *unvalidated* branded string that "MUST be encoded before use in a path"), the whitelist now only guards against injection (`[A-Za-z0-9._:@~-]{8,200}`, still no `/`/`\`/whitespace) and entry names escape the id through the same `~XXXX` scheme the core's own `encodeSegment` uses (verbatim-aligned; `:`→`~003A`, `@`→`~0040`). `ENTRY_RE` is tightened to exactly the escape output charset (contains `~`, never `:`/`@` — entry names become real directories), restore/purge keep taking ids from `meta.json` (never reverse-parsing entry names), and ids whose escaped entry would overflow the entry whitelist are rejected *before* any mutation, preserving the invariant that every trashed entry stays restorable. Full IM-id pipeline covered by tests: preview → delete → trash → restore → purge

## 0.4.1

- Fix (compat): DSH 0.1.5 changed `sessionPersistence.list()` to return `{ header, revision, sizeBytes }` snapshots instead of bare header arrays; the wrapper flowed into `locate()` and crashed every `/api/session-delete/list` and `/trash` request with "Cannot read properties of undefined (reading 'length')" (inside `encodeSegment(undefined)`). Both call sites now unwrap snapshots via a compat helper (`item.header ?? item`, same unwrap the official session-query uses), so both the new and the legacy (≤0.1.1-rc.x) shapes work
- Dev: `react`/`react-dom` 18.3.1 as devDependencies — DSH 0.1.5 no longer ships react in its node_modules, so the render smoke tests resolve it from the plugin's own dev install
- Tests: smoke stub now models the 0.1.5+ snapshot shape by default; a dedicated test keeps the legacy bare-header shape covered

## 0.4.0

- Fix (complete): deleted sessions no longer reappear in the workspace sidebar, in any client. Root cause beyond 0.3.0's live-session case: client sidebars render rows from an in-memory list store that only prunes on `host/session-removed` (live disposals only) or a fresh `session.list` baseline — forgetting a deleted cold session's archive id broadcast `archived-sessions-changed` and resurrected the stale row in every connected client
- Delete / purge / purge-all now always keep the archive-set entry during runtime (`keptHidden`); a ghost id without a list row renders nothing in the official UI, so keeping it is free. Ghosts are reconciled once at Host restart (plugin mount), when every client rebuilds from a fresh baseline and un-archiving can resurrect nothing
- `/list` no longer reconciles ghosts during runtime (that broadcast was itself a resurrection trigger for long-lived clients)
- The acting client now pulls a fresh `session.list` baseline after deletes and restores (`sessions.refresh()`, capability-detected), pruning its own stale rows immediately

## 0.3.0

- Fix: deleting an archived session that is still attached in memory ("打开中") no longer makes it reappear in the workspace sidebar — the Host serves live sessions from memory regardless of disk state, so the archive-set entry is now deliberately kept (`keptHidden`) to hold the session hidden; the leftover id is reconciled automatically once the session is no longer live (e.g. after a Host restart)
- The same live-aware keep-hidden rule now applies to trash purge / purge-all and to the `/list` ghost reconcile (which no longer strips archive entries belonging to live sessions)
- Delete responses carry `keptHidden`; the UI notice explains when a deleted session stays hidden until restart
- UI: batch "删除所选" now uses the same two-step arm-and-confirm as single delete and trash purge (auto-disarms on selection change / tab switch); delete buttons carry explanatory tooltips; the Archived tab shows a contextual hint when live sessions are present

## 0.2.3

- Reconcile historical `archivedSessionIds` ghosts on `/list`: ids present in `workspace.json` but missing from the on-disk session inventory are removed best-effort

## 0.2.2

- Clear `workspace.json` `global.archivedSessionIds` ghosts after delete / purge so official archive counts do not keep deleted sessions (best-effort when the registry state machine is available)

## 0.2.1

- Accept bare-UUID and `<id>-session-<uuid>` session ids in the host ID whitelist so continuable / configured subagent sessions can be previewed, deleted, and restored (thanks @xi146)
- Make `test/render.mjs` resolve `react` / `react-dom` from the local DSH install instead of a hard-coded Linux global path

## 0.2.0

- Online unarchive: restore from the Archived tab returns the session to the sidebar immediately; trash restore also unarchives automatically
- Older DSH builds without the registry state machine fall back to the offline `tools/unhide.mjs` guidance
- Trash entries show session titles (captured into `meta.json` on delete) with multi-select batch restore / purge
- Stronger selection styling and unified `.sd-check` checkbox size across group headers and rows
- Security and quality: trash entry path traversal guards, audit-log protection, 400 for malformed JSON, per-domain UI loading states

## 0.1.0

- Settings-page session manager with Archived / All / Trash tabs
- Soft-delete into `~/.dsh/trash/sessions/` with restore and purge
- Running-session guard and CSRF header on mutating routes
- `tools/unhide.mjs` to remove restored ids from the archive set while DSH is stopped
