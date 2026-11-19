# dsh-archive-manager

**Session archive & cleanup manager for DeepSeek Harness (DSH)** — sidebar one-click **permanent delete** (Codex-style), a **zcodex-style archive management** page, and **auto-archive** with retention.

[中文说明](README.zh-CN.md)

Built on the framework of [xohmai/dsh-session-delete](https://github.com/xohmai/dsh-session-delete) (Apache-2.0). Upstream copyright fully retained; see [FORK.md](FORK.md) and [NOTICE](NOTICE) for the relationship and changes.

**Author:** [Only-Xwaisw](https://github.com/Only-Xwaisw) · xinshiyi

## Features

### Sidebar "Delete permanently" (Codex-style, full chain)

- Right-click (or `⋯`) any session → the entry sits **right below "Archive session"**, normal color, trash icon, **no shortcut**.
- One click (with confirmation) permanently erases the session **and all of its sub-agent sessions recursively**. No trash, no residue.
- Running sessions (or running children) are refused with HTTP 409 — never a half-deleted state.
- The sidebar row disappears immediately (broadcast + projection refresh); deleting the open session switches to a blank one.
- Every action is appended to an audit log (`~/.dsh/trash/sessions/audit.log`).

### Archive management (zcodex-style page)

- **Auto-archive old sessions**: toggle + retention (1/3/7/14/30/90 days), background scan every 30 minutes; pinned & running sessions are skipped — archive only hides, never deletes.
- **Archived sessions** grouped by project (collapsible), with search, sorting (updated/created/size), project filter, multi-select batch delete, and a red **Delete all permanently** (two-step confirm).
- Row actions: **Restore** (unarchive back to the sidebar), **Delete** (to trash), **Delete permanently** (irreversible).
- **Trash** (entry at the bottom of the page): restore / delete permanently / empty.

### Safety

- Non-GET API requests require a custom header (cross-site posts cannot pass the CORS preflight).
- Session ids are whitelist-validated and path-escaped before touching the disk (Windows reserved characters included).
- Zero runtime dependencies, no telemetry, no network calls. `react`/`react-dom` are dev-only (tests).

## Install

```sh
dsh plugin --profile <your-profile> add github:Only-Xwaisw/dsh-archive-manager
```

Local development can install from a link (edits apply on page refresh):

```sh
dsh plugin --profile <your-profile> add link:<this-repo-path>
```

## Host API

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/session-delete/config` | auto-archive config (read / save & reschedule) |
| POST | `/api/session-delete/auto-archive/run` | run one archive scan now |
| POST | `/api/session-delete/delete` | soft delete: archive + move to trash |
| POST | `/api/session-delete/delete-permanent` | permanent delete (cascades to sub-agents) |
| POST | `/api/session-delete/purge-archived` | permanently delete all archived sessions |
| GET/POST | `/api/session-delete/trash` / `restore` / `purge` / `unarchive` | trash & archive ops |
| GET/POST | `/api/session-delete/debug` | sidebar hook telemetry (offline diagnosis) |

Non-GET requests must carry `x-dsh-plugin: session-delete` (cross-site requests cannot pass the CORS preflight).

## Development & tests

```sh
pnpm install   # devDependencies: react / react-dom (render tests only)
```

```sh
# Host-half behaviour suite (mocked Cordis ctx + temp session tree)
ELECTRON_RUN_AS_NODE=1 <DeepSeek Harness.exe> test/smoke.mjs

# Client-half render suite (real React, renders the slot components)
ELECTRON_RUN_AS_NODE=1 <DeepSeek Harness.exe> test/render.mjs
```

## License

Apache-2.0 — original work © xohmai; modifications © 2026 contributors. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [FORK.md](FORK.md).
