# GitHub Discussions 发布公告草稿

> 发布位置：deepseek-ai/deepseek-harness → Discussions（参照既有「[Plugin] …」帖格式）
> 建议标签：Plugins / Show and tell

---

## [Plugin] dsh-archive-manager — 侧栏永久删除（级联子代理）+ zcodex 风格归档管理 + 自动归档

给 DSH 补上会话清理的最后一块拼图。三个能力，全部打通到磁盘：

### 1. 侧边栏「永久删除」（右键即用）
- 会话右键菜单、「归档会话」正下方，常规配色、无快捷键
- 确认后一步抹除：**连同级联删除全部子代理会话（多级递归）**，磁盘目录直接清掉，不经回收站
- 运行中的会话（含子代理）自动拒绝，绝不半删；删除当前打开的会话自动切到空白页
- 每次删除写入审计日志（JSONL）

### 2. 归档管理（设置 → 归档管理，zcodex 风格）
- 大标题 + 卡片式「自动归档旧会话」：开关 + 保留期（1/3/7/14/30/90 天），后台每 30 分钟扫描
- 已归档会话按项目分组（可折叠）：搜索 / 排序 / 项目筛选 / 多选批量
- 红色「全部永久删除」：两步确认，跳过运行中会话，结果显示「成功 X 项，失败 Y 项，跳过 Z 项」

### 3. 回收站
- 软删除先入回收站：还原（原位归位 + 自动解除归档）/ 彻底删除 / 清空
- 所有删除动作记录审计日志，误删有得救

### 安全设计
- 非 GET 请求需自定义头（跨站请求过不了 CORS 预检）
- 会话 id 白名单 + 路径转义（Windows 保留字符安全），删除动作沙箱限定在会话目录
- 零运行时依赖、无遥测、无网络外发；删除均限定了目录范围

### 安装

```sh
dsh plugin --profile <your-profile> add dsh-archive-management
```

GitHub 源码安装：`github:ElevenAI-Pro/dsh-archive-manager`

（附 2–3 张截图：①侧栏菜单里的「永久删除」②确认框 ③归档管理页）

### 致谢
- 上游框架：[xohmai/dsh-session-delete](https://github.com/xohmai/dsh-session-delete)（Apache-2.0）
- 界面参考：zcodex 的归档管理；侧栏交互参考：Codex
- 欢迎提 issue / PR

---

*英文 TL;DR：Sidebar "Delete permanently" (cascades to sub-agents) + zcodex-style archive management with auto-archive & retention, plus a recoverable trash. Apache-2.0, zero runtime deps.*
