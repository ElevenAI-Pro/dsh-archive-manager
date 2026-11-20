# PATCH T1/T2 — junction 穿透计量 & 客户端标题多行注入修复

> 对象：dsh-archive-management 1.2.1（GitHub: ElevenAI-Pro/dsh-archive-manager）
> 依据：《产品深度分析提示词套件 v2.0》T1/T2 专项深潜轨道实测结论（Node v22.23.4 / Windows）
> 文件：`patch_T1T2.diff`（对 `src/index.js`、`src/client.js`，LF 行尾，`git apply` 验证通过）

---

## 1. 背景与证据（为什么修，不是拍脑袋）

原报告本有两条「低证据观察」：junction 目录跟随删除、客户端渲染 XSS。
专项轨道用 `evid_T1_junction_probe.mjs` / `_t2probe/t2_render_probe.mjs` **实测定案**：

| 观察项 | 实测结论 | 残余缺陷（本 patch 修复对象） |
|---|---|---|
| junction 跟随删除 | **证伪**——Node 22 的 `rm(recursive)`/`rename` 对 junction 只删/移链接本体，外域数据不被触碰（B1/B2/B3 全过） | — |
| junction 穿透计量 | **证实**——`dirSize` 顶层入口为链接时被 `readdir` 静默分解，外域字节全计入：A2=800B vs 对照 100B | T1-01/02/03：计数虚报 + stat 前置误判 |
| 客户端渲染 XSS | **证伪**——React 18 SSR 7 类 payload 文本槽/属性槽全转义、属性截断全失败 | — |
| 标题多行注入 | **证实**——`title` 属性槽拼接 `${title}\n${id}\n${cwd}` 允许多行伪造文案（示义级） | T2-07：多行 tooltip 冒名文案 |

评级如实：两缺陷均为 **P3**（计量/展示失真）。本 patch 按修复建议落地，不改变任何接口与语义。

## 2. 改动清单

### `src/index.js`（+17/-7）

1. **`import` 增加 `lstat`**（#L58）。
2. **`dirSize` 入口层链接拒绝**（#L107-L128）：先 `lstat(path)`，`isSymbolicLink()` 立即 `return 0`。
   - 修复前的穿透：`~/.dsh/sessions/<id>` 本体被换成 junction 时，`readdir` 顶层静默分解链接，
     `sizeBytes`/`freedBytes` 计入外域全部字节（实测 A2=800B）。
   - 修复后：链接本体计量=0，真实会话目录计量不变（实测回归 A1'=100/A2'=0/A3'=100）。
3. **新增 `isRealDir()` helper**：`lstat` + `isDirectory()` + 拒绝 `isSymbolicLink()`。
4. **六处 stat 前置存在性检查改 `isRealDir()`**：
   - `moveOneToTrash`：链接路径不判为「会话目录」，跳过移入回收站。
   - `deleteSession` 级联循环：链接路径继续跳过。
   - `resolveTrashEntryDir`：回收站条目必须是**真实目录**，链接条目被拒（`NOT_ENTRY`）。
   - `restoreSession` 的 `dataDir` 检查。
   - `deletePermanent` 与 `purgeArchivedAll` 的删除前置。

### `src/client.js`（+9/- reserved）

1. **新增 `oneLine()` 清洗**：折叠 `\r\n\t`→空格、合并连续空格。
2. **应用处（8 处）**：
   - dialogBody 模板：`t('dialogBody', { title: oneLine(title) })`。
   - 全部会话列表 / 回收站列表的 `title` 属性槽（`${oneLine(s.title)}\n…${oneLine(s.cwd)}`、
     `${oneLine(it.title)}\n…${oneLine(it.cwd)}`）。
   - 两个 `title: oneLine(meta.path)`（工作区分组）。

## 3. 修复验证（回归实测）

| 探针 | 断言 | 结果 |
|---|---|---|
| `evid_T1_regression.mjs` | A1' 普通目录=100 / A2' 会话本体=junction=0 / A3' 内含junction子项=100 / isRealDir(junction)=false / isRealDir(真实目录)=true / B1' 门禁跳过 rm 后外域与被删链接均保留 | **6/6 PASS** |
| `_t2probe/t2_regression_probe.mjs` | 用户输入段含换行=false / 重复空格=false / 无 raw HTML（5 类 payload，含多行伪造、CRLF、Tab、XSS 混合） | **5/5 PASS** |
| `git apply --check patch_T1T2.diff` | 从 `package/` 基线干净应用（无冲突、无 `-p` 手调） | PASS |

## 4. 回滚与风险

- 回滚 = `git apply -R patch_T1T2.diff`（或直接删除 8 处 `oneLine(` 与还原 import/两函数）。
- 行为不变断言：patch 不触碰任何路由/命名/权限逻辑；`dirSize` 对**真实目录**的计量结果与
  baseline 逐字节一致；`isRealDir` 仅新增「链接拒绝」分支，普通目录路径走原逻辑。

## 5. 备注

- `patch_T1T2.diff` 内 `oneLine`/`isRealDir` 与 `patched/src` 实际文件逐字节一致（由 git diff 生成）。
- 若宿主未来将 `h`（React.createElement）替换为 HTML 注入式渲染器，T2 的「XSS 证伪」结论
  失效——见报告 T2-08，需复跑 `_t2probe` 回归（三探针均可重复执行）。