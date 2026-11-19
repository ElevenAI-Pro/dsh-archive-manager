# 开源合规审计报告（OSS_AUDIT）

审计时间：2026-11-19 · 审计对象：本仓库全部发布文件（10 个源文件 + 测试 + 文档）

## 结论

**可以开源。** Apache-2.0 的全部义务已履行，未发现著作权侵权隐患，未发现敏感信息泄漏。

## 一、代码来源谱系

| 来源 | 是否包含 | 说明 |
|---|---|---|
| xohmai/dsh-session-delete v0.5.1（Apache-2.0） | ✅ 部分包含（底座） | 宿主软删除/回收站/审计管线、设置页框架来自上游；LICENSE 全文保留，FORK.md + CHANGELOG 显式声明修改 |
| vtxf/dsh-session-delete npm@0.1.0（MIT） | ❌ 不包含 | 曾短暂安装后卸载；本仓库无任何其代码 |
| ljp888/dsh-session-delete-next | ❌ 不包含 | 仅阅读其源码确认官方槽位 props 契约；本仓库侧栏实现为独立编写的 DOM 注入（技法思路受其启发，无逐字复制） |
| 本 fork 新增 | ✅ 主体 | 级联删除、zcodex 归档管理页、自动归档、诊断遥测、全部测试、DOM 注入侧栏钩子 |

> 著作权法保护「表达」而非「思想」：fiber 遍历、克隆菜单行等技法思路不受版权约束；本仓库相关代码均为独立编写，且已在 FORK.md 致谢 vtxf 与 ljp888 的启发。

## 二、Apache-2.0 义务核对

| 义务 | 状态 | 落点 |
|---|---|---|
| 保留原始许可文本 | ✅ | `LICENSE`（完整标准文本） |
| 保留上游版权与致谢 | ✅ | `NOTICE`（Copyright 2026 xohmai + 修改声明） |
| 显著声明修改 | ✅ | `FORK.md`、`CHANGELOG.md`（fork 段落逐条列明） |
| 随分发提供许可副本 | ✅ | `LICENSE` 随仓库分发 |
| 上游 NOTICE 文件 | — | 上游无 NOTICE，无需保留 |

## 三、敏感信息扫描

扫描范围：10 个发布文件（README/FORK/CHANGELOG/SECURITY/LICENSE/package.json/cordis.patch.yml/src×2/tools）。
扫描模式：用户名、本地绝对路径、cookie、token、密钥（sk-/私钥块）、邮箱、内网地址、调试端口。

**结果：0 命中。**

配套措施：`.gitignore` 已排除 `node_modules/`、`*.log`；发布前请再确认不含本地实测数据。

## 四、发布前待办（人工两步）

1. 全局替换 `Only-Xwaisw`（package.json 三处仓库地址）与 `xinshiyi <Only-Xwaisw@users.noreply.github.com>`（author、NOTICE）为你的真实信息。
2. **如需发布到 npm**：`dsh-session-delete` 这个名字在 npm 上已被占用，必须改名（例如 `dsh-archive-manager` / `dsh-session-cleaner`）；改名时同步修改 `package.json` 的 `name`、`cordis.patch.yml` 的 `insert.name`，并更新 README 安装命令。仅发布 GitHub 源码则无需改名。

## 五、运行时依赖说明

本插件仅调用 DSH 公开宿主服务（`webServer` / `sessionPersistence` / `workspaceRegistry` / `agents` / `slots` / `locale`）与官方客户端槽位（`settings.section`、`shell.overlay`），无私有内部 API、无网络外发、无遥测。测试用的 react/react-dom 仅存在于 devDependencies，不进入运行时。
