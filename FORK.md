# FORK 说明

本目录是 [xohmai/dsh-session-delete](https://github.com/xohmai/dsh-session-delete)（Apache-2.0）的本地魔改版本，版本号 `0.5.1-fork.1`。上游版权与许可完整保留（见 LICENSE）；本文件说明本地改动。

## 改动清单

### 1. 侧边栏「永久删除」（仿 Codex，最终实现：轻量 DOM 注入）

- 会话 `…` 菜单「归档会话」**正下方**追加「永久删除」行（图标 + 文案，**常规配色、无快捷键、恒单条**）：克隆内置归档行保证样式与主题完全一致。
- 注入链路 v3（实测适配 0.2.2-rc.5）：
  - 行捕获：pointerdown/mousedown/click/contextmenu 全监听（右键可用），行组件判定按实测 props（`node.id` + `onOpen/useContextMenu/onRenameRequest` 任一），不再依赖已移除的 `onArchive`；
  - 菜单定位：按「归档会话」文案找内置按钮 → 取其行容器（唯一注入点，注入前清残留防重复）；
  - 时序：MutationObserver + 激活后 30~800ms 六轮延迟扫描双保险；
  - 诊断：全链路遥测上报 `GET/POST /api/session-delete/debug`，离线排查不用猜。
- 确认框走 `shell.overlay` 官方槽位 + 官方 `Modal/Button` 原语（`dsh.client.inject` 注入原语包，`immediately: true`）。
- 宿主新增 `POST /api/session-delete/delete-permanent`：归档隐藏 → `rm -rf` 会话目录，一步完成，不经回收站。运行保护、id 白名单、`api-session/removed` 广播与审计日志（`delete-permanent`）与原删除流水线一致。
- 删除当前打开的会话后自动 `workspaces.startSession()` 切到空白会话（能力探测，失败静默）。

### 2. 归档管理（仿 zcodex）

- 设置页默认页签重构：`AutoArchiveCard`（开关/保留期/扫描间隔/立即扫描/上次扫描结果）+「已归档的会话」按项目分组清单（搜索、排序、多选）+「全部永久删除」红色两步确认。
- 宿主新增：
  - `GET|POST /api/session-delete/config`（落盘 `<DSH_HOME>/trash/sessions/config.json`，POST 校验并重排定时器）；
  - `POST /api/session-delete/auto-archive/run`（手动扫描，只做官方归档、不删数据；跳过运行中/置顶/已归档，返回成功/失败/跳过统计）；
  - `POST /api/session-delete/purge-archived`（永久删除全部已归档会话，跳过运行中，审计 `purge-archived`）。
- 定时扫描在插件 apply 时按配置恢复，卸载时清理。
- 置顶集合从 `workspaceRegistry.requireState()` 的 `pinnedSessionIds`（含旧字段名回退）探测；取不到时视为无置顶（功能降级不报错）。

### 3. 其它

- 设置页 nav 名称「归档会话」→「归档管理」（`NAV_LABEL`、页签文字、nav 图标替换选择器同步）。
- 行内新增「永久删除」两步确认按钮（归档管理页签），与软删除（进回收站）明确区分。
- `exports.inject` 增加 `locale`。

### 4. 测试（新增）

- `test/smoke.mjs`：宿主半全流程行为测试（mock Cordis ctx + 临时磁盘会话树，42 项断言）——12 条路由注册、配置补丁语义/校验/落盘、CSRF 403、永久删除（403/404/400/200/409 + 目录抹除 + 归档先行 + removed 广播 + 审计）、自动归档（保留期命中/跳过运行中/跳过置顶/不动新会话/不删数据）、purge-archived（含 ghost 计数与幂等）。
- `test/render.mjs`：客户端半真实 React 渲染测试（24 项断言）——三个槽位注册、菜单项按官方 props 契约渲染（danger/分隔线/图标/文案）、无 sessionId 渲染空、设置页归档管理卡片/分组列表/行内永久删除按钮、overlay 空态。
- 运行：`ELECTRON_RUN_AS_NODE=1 <DeepSeek Harness.exe|node> test/smoke.mjs`（render 同理；react 从 fork devDependencies 解析）。

## 与上游同步

重新基于上游修改时，注意保留本文件与本 CHANGELOG 的 fork 段落。原始 README 其余部分仍然适用（路径、接口、回收站约定均未变）。
