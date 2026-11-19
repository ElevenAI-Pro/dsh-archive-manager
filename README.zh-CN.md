# dsh-archive-manager

**DeepSeek Harness（DSH）会话归档与清理管理器** —— 侧边栏一键「永久删除」（Codex 风格，级联子代理）+ zcodex 风格的「归档管理」页 + 自动归档（保留期可调）。

[English](README.md)

基于 [xohmai/dsh-session-delete](https://github.com/xohmai/dsh-session-delete) 的框架重构（Apache-2.0）。上游版权完整保留，与本 fork 的关系及改动见 [FORK.md](FORK.md)、[NOTICE](NOTICE)。

**作者：**[Eleven_AI](https://github.com/Only-Xwaisw)（xinshiyi）

## 功能

### 侧边栏「永久删除」（Codex 风格，全链路）

- 右键（或点 `⋯`）任意会话行 → 菜单「归档会话」**正下方**即「永久删除」（常规配色、垃圾桶图标、无快捷键）。
- 确认后一步抹除该会话**及其全部子代理会话（多级递归）**：不经回收站、无残留。
- 运行中的会话（含运行中的子代理）拒绝删除（HTTP 409），绝不留下半删状态。
- 侧栏行即时移除；删除当前打开的会话自动切到空白会话。
- 全部动作追加审计日志（`~/.dsh/trash/sessions/audit.log`）。

### 归档管理（zcodex 版式）

- **自动归档旧会话**：开关 + 保留期（1/3/7/14/30/90 天），后台每 30 分钟扫描；置顶与运行中的会话不受影响——归档只隐藏、不删数据。
- **已归档的会话**：按项目分组（可折叠），支持搜索、排序（更新时间/创建时间/体积）、项目筛选、多选批量删除；「全部永久删除」两步确认，跳过运行中会话。
- 行内三个动作：**还原**（解除归档回到侧栏）、**删除**（进回收站）、**永久删除**（直接抹除）。
- **回收站**（页面底部入口）：还原 / 彻底删除 / 清空。

### 安全

- 非 GET 请求需携带自定义头（跨站请求过不了 CORS 预检）。
- 会话 id 白名单校验 + 落盘路径转义（含 Windows 保留字符）。
- 零运行时依赖、无遥测、无网络外发；react/react-dom 仅测试用（devDependencies）。

## 安装

```sh
dsh plugin --profile <your-profile> add github:Only-Xwaisw/dsh-archive-manager
```

本地开发可用 link 方式安装（改源码后刷新页面即生效）：

```sh
dsh plugin --profile <your-profile> add link:<本仓库路径>
```

## 宿主路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/session-delete/config` | 自动归档配置（读取 / 保存并重排定时器） |
| POST | `/api/session-delete/auto-archive/run` | 立即执行一次自动归档扫描 |
| POST | `/api/session-delete/delete` | 软删除：归档隐藏 + 移入回收站 |
| POST | `/api/session-delete/delete-permanent` | 永久删除（级联子代理） |
| POST | `/api/session-delete/purge-archived` | 永久删除全部已归档会话 |
| GET/POST | `/api/session-delete/trash` / `restore` / `purge` / `unarchive` | 回收站与归档操作 |
| GET/POST | `/api/session-delete/debug` | 侧栏钩子遥测（离线诊断） |

非 GET 请求需携带自定义头 `x-dsh-plugin: session-delete`。

## 开发与测试

```sh
pnpm install   # devDependencies：react / react-dom（渲染测试用）
```

```sh
# 宿主半行为测试（mock Cordis ctx + 临时磁盘会话树，53 项断言）
ELECTRON_RUN_AS_NODE=1 <DeepSeek Harness.exe> test/smoke.mjs

# 客户端半渲染测试（真实 React，渲染槽位组件，22 项断言）
ELECTRON_RUN_AS_NODE=1 <DeepSeek Harness.exe> test/render.mjs
```

## License

Apache-2.0 —— 原始作品 © xohmai；修改 © 2026 贡献者。见 [LICENSE](LICENSE)、[NOTICE](NOTICE)、[FORK.md](FORK.md)。
