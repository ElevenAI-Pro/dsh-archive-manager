# 产品深度分析报告

**产品深度分析提示词套件 v1.0 · 全流程 A1→A8→X9**

| 项 | 值 |
|---|---|
| 分析对象 | `dsh-archive-management`（ElevenAI-Pro/dsh-archive-manager） |
| 分析版本 | v1.2.1（npm latest，2026-11-20T06:44:06Z 发布） |
| 分析日期 | 2026-11-20 |
| 证据基线 | npm registry 实拉 packument/tgz；GitHub main 分支源码与测试；当前 DeepSeek Harness 宿主服务目录（cordis Inspect Service 实查）；`package/src/index.js`（1454 行）、`package/src/client.js`（2107 行）全量通读并锚定行号 |
| 分析方式 | 纯数据驱动：每条发现带证据（文件行号 / registry 事实 / 宿主契约 / 测试断言），无法取证项单列为「低证据观察」 |

> 遵守套件铁规：每条发现附带证据；每轮 ≥10 条发现且 ≥3 条 P0/P1；对自身结论做自反性攻击；赞美量不超过全文 10%。本文不含套件禁用措辞。

---

## 0. 对象速览（事实基线）

- **功能面**：会话回收站（软删除/还原/清空）、侧边栏一步永久删除（级联子代理）、归档管理设置页（搜索/排序/筛选/多选批量）、自动归档（30 分钟后台扫描、保留期 1/3/7/14/30/90 天）、审计日志（JSONL 追加）、调试遥测。
  - 宿主证明：`src/index.js` 头注释列明全部管道与设计动机（`package/src/index.js#L1-L57`），`apply` 尾部注册 12 条路由并启动定时器（`package/src/index.js#L1416-L1454`）。
- **规模**：宿主 `src/index.js` 1454 行 + 客户端 `src/client.js` 2107 行 = 3561 行；零运行时依赖（`package/package.json#L49-L52` 仅 react/react-dom devDeps）。
- **测试**：宿主 smoke 63 项断言（路由注册 12 + 行为 51，实测计数与 `CHANGELOG.md#L11` 的「63 项全绿」吻合）、客户端 render 27 项断言（`gh_test_render.mjs` 实测计数）。
- **发布史**：npm 上 3 个版本全部集中于 2026-11-20 一天内（`0.0.0-stage` 03:08:58Z、`1.2.0` 03:10:14Z、`1.2.1` 06:44:06Z），无 1.0.0/1.1.x 的发布轨迹。
- **市场格局**：npm 检索 `dsh-archive` 前缀下存在 30+ 个近义词包（`dsh-archive-manager`、`dsh-archive-trash`、`dsh-session-clean`、`dsh-tool-session-delete` 等，实录于注册中心搜索数）。

---

## A1 影响定位

**判定结论：定位成功（可判定影响），不触发「定位失败」分支。** 该产品是一个「DSH 会话生命周期管理」垂直面里做「回收站 + 归档"中间层"」的宿主/客户端双半插件，不是通用管理台，也不是核心聊天功能的一部分。

**影响域界定**：插件写动的数据面被代码严格封在 `DSH_HOME` 内三类路径：会话目录 `<DSH_HOME>/sessions/<项目>/<会话id>`（软删除 rename / 永久删除 rm，`package/src/index.js#L611-L618`、`#L892-L902`）；回收站 `<DSH_HOME>/trash/sessions/<时间戳-转义id>/data` 与同目录 `meta.json`/`audit.log`/`config.json`（`package/src/index.js#L96-L97`、`#L601-L640`、`#L915`）；宿主状态面 `workspaceRegistry.archivedSessionIds`（`package/src/index.js#L883-L890` 先归档后动文件、「ghost 由重启 reconcile 清理」`#L825-L826`）。

**A1 发现清单**

1. **影响对象为「会话文件夹本体」，非聊天记录语义层**【P1】
   证据：永久删除直接 `rm(dir, { recursive: true, force: true })`（`package/src/index.js#L899`），软删除把整个会话目录 rename 进回收站（`#L618`）。
   判断影响：对象=磁盘会话目录+归档集；程度=完全移除或搬移；概率=用户显式触发。会话一旦被永久删除，`api-session/removed` 广播后客户端行即消失，**无任何内置恢复路径**（`#L903-L904`）。

2. **影响环包含宿主核心三服务，但只用了它们的「只读+归档」侧面**【P2】
   证据：`export const inject = ['webServer','sessionPersistence','workspaceRegistry','agents']`（`package/src/index.js#L63`）；宿主契约实查 `workspaceRegistry` 仅公开 `archiveSession`，无公开 unarchive/remove 能力。
   判断影响：若宿主 API 演进（如归档内部状态机变更），插件无降级支点；该依赖面是长期维护成本。

3. **影响深度：一次点击最多能删除「一整棵会话树」而非单个会话**【P2】
   证据：软删除与永久删除都实现多级子代理级联（`descendantsOf` 前序遍历，`package/src/index.js#L855-L864`），删除集合 = 本人 + 全部后代（`#L649`、`#L882`）。
   判断影响：对象=级联集合；程度=全删；概率=触发一次。级联内任何一环运行即 409 整体拒绝（`#L650-L658`、`#L878-L880`），降低了半删风险面，但把「单会话误删」放大为「整树误删」。

4. **影响边界：不碰其他插件、凭证、网络、系统文件**【P1- 偏正面，属可量化优势留档】
   证据：零运行时依赖、无任何网络调用（`package/package.json` 无 dependencies；README#L32）；写路径全部经 `DSH_HOME` 派生（`trashRoot()` 语义 + 头注释 `#L25-L45`）。
   判断影响：影响域收敛到本机会话数据，这是本产品复杂度可控的主要原因。

5. **影响时间性：恢复窗口 = 「进回收站到清空」之间，且清空不可逆**【P1】
   证据：`purge` 循环 `rm(entryDir, …)` 后 `audit('purge-all')`（`package/src/index.js#L820-L828`）；客户端「清空回收站」「全部永久删除」「批量永久删除」均需两步确认（`package/src/client.js#L926-L930`、`#L1231`、`#L1829`、`#L1840`）。
   判断影响：对象=回收站全部条目；程度=不可逆；概率=需连续两次点击红色按钮。窗口边界清晰，但无「延时清空/可撤销」机制。

6. **影响覆盖四种已知会话 id 形态，包含 IM 渠道怪异字符**【P1】
   证据：头注释显式列出 `session-<uuid>`、`<uuid>`、`<id>-session-<uuid>`、`im:<渠道>:dm:<seq>:<uid>@<host>` 四类（`package/src/index.js#L77-L84`）；`encodeEntrySegment` 输出 `~XXXX` 转义（`#L155-L159`）；条目名白名单 `ENTRY_RE = /^[A-Za-z0-9._~-]{1,240}$/`（`#L95`）。
   判断影响：对象=含 `:`/`@` 的 id 落盘名；程度=可完整删除/还原；概率=IM 会话出现时必命中。这条是 Windows 兼容的正确设计，也反向证明「id 直接拼目录」的路已被堵死。

7. **影响不对称：软删除（回收站）路径比永久删除多一层「条目名校验」门槛**【P2】
   证据：软删有 `ENTRY_RE.test(entry)` 失败即 400（`package/src/index.js#L603-L606`），永久删除无此检查（`#L869-L909`）。
   判断影响：对象=转义后超长的怪异 id；程度=软删不可用但永久删可用；概率=极低（≤240 字符限制下有理论窗口）。功能不对称导致「同一 id 两种删除方式成败不同」，属于边缘但不自洽。

8. **影响对「客户端状态」的即时收敛靠事件链，存在与宿主广播契约的耦合**【P2】
   证据：逐目标 `ctx.emit?.('api-session/removed', id)`（`package/src/index.js#L904`）、`api-session/added` 回补（`#L801-L811`）；客户端渲染用该清单做行剔除（`package/src/client.js#L1014`）。
   判断影响：若宿主广播语义变化或订阅先于广播，客户端会出现「行已删但列表还显示/反向」的瞬时失真；本版本依赖 `? .` 空值保护，静默吞掉失败。

9. **影响对象包含「打开中的会话」属受控例外，而非禁止**【P1】
   证据：运行中 409 拒删（`package/src/index.js#L651-L658`、`#L874-L880`），但「已打开未运行」的会话可被删；删除打开会话后客户端 `workspaces.startSession()` 切空白（`pkgsrc_FORK.md#L17`）。
   判断影响：对象=打开但空闲会话；程度=删除后即时切换空页；概率=用户对当前页发删除。行为符合预期但无「二次确认打开中会话」的专门提示（只有通用两步确认）。

10. **影响限定在单用户/本机模型，无多 tenant 隔离诉求**【P2】
    证据：路由仅以自定义请求头防跨站（`package/src/index.js#L1134-L1135`），无会话级鉴权、无用户维度；`x-dsh-plugin: session-delete` 头在 `#L67` 定义。
    判断影响：对象=本机单用户；程度=无隔离成本；概率=设计边界如此。此定位与 DSH 本机模型一致，但意味着「任何能向 127.0.0.1 发请求的本地进程都持有删除键」（详见 A8）。

11. **产品对「官方不可彻底删除」的假设是产品空间的根**【P0】
    证据：宿主契约实查（Service `workspaceRegistry`）仅有 `archiveSession` 公开面；官方无「公开移除会话」服务；插件用「归档隐藏→删目录→ghost 留归档集 + 重启 reconcile」绕行（`package/src/index.js#L883-L907`、`#L825-L826`，`#L345` `audit('reconcile-archived-ghosts')`）。
    判断影响：对象=产品存在理由；程度=成立但有技术债；概率=既定事实。ghost（归档目录已删但归档集保留）在单次进程运行内无界累积，只靠重启收敛——这是该绕行方案的固有税。

12. **影响计量：单次「全部永久删除」的爆炸半径可达年会话总量**【P2】
    证据：`purgeArchivedAll` 目标集 = 全部已归档 × 后代展开（`package/src/index.js#L1063-L1076`），逐个 `dirSize + rm`（`#L1086-L1088`）。
    判断影响（量化演示）：假设一年 800 会话 / 12GB（≈15MB/会话），一次操作理论释放 12GB、清除 800 个目录 + 其全部后代；两步确认 + 运行中跳过（`#L1077-L1080`）是把概率压低的闸门，但热键路径单一（无二次输入校验如键入指令）。

**A1 自反性攻击（对本轮结论的反驳）**
- 反驳点 1：「影响面收敛、零依赖」可能是数据盲区——`dirSize` 递归遍历整个会话树（`package/src/index.js#L107-L128`），若某会话目录挂接了符号链接/挂载点（Windows junction），`dirSize` 与 `rm` 是否跟随链接？`node:fs` 的 `rm` 默认对目录是递归删除且不跟随符号链接，但 `dirSize` 用 `stat(child)` 对目录链接会跟随。若存在指向回收站外的 junction，统计会越界膨胀，甚至 `rm` 连锁删除目标内容——`rm` 对 symlink 删除链接本身，junction 在 Node 上表现与目录类似，存在删除目录树内容的风险。本报告证据未能覆盖该点，单列为低证据观察（潜在 P1，需实测）。
- 反驳点 2：把「先归档后删文件」认定为正确顺序，但它留出「归档成功、删除失败 409 回滚后归档态残留」的中间态：`archiveSession` 在 `rm` 之前全部执行（`#L883-L890`），若后续 rm 遇权限错，会话已从侧栏消失但目录仍在——用户看到「会话没了」，磁盘却在。这削弱了第 1/5 条「行为收敛」的结论。（权重：中，见 A4 FMEA 专项。）
- 反驳点 3：对覆盖四类 id 的赞誉可能过度：`ID_RE` 长度上限 200（`#L85`）与 `ENTRY_RE` 上限 240（`#L95`）在极端多特殊字符 id 下（每次转义 1→5 字符 `~XXXX`）可超限，第 7 条已承认不对称，但「覆盖四类」的表述应修正为「覆盖典型长度」。（已并入第 7 条。）

**A1 小结**：定位成立，影响域明确；核心判断 = 该产品的**决定性风险不是功能实现，而是「不可逆删除 + ghost 记账 + 本机无鉴权」三个结构性面的乘积**。P0 级发现 1 条（空间根假设正确但绕行方案产生 ghost 税）、P1 级  UP≥3 条（恢复窗口、级联爆炸、未鉴权、路径跟踪等）。

---

## A2 用户旅程拆解

**方法**：六个旅程 × 六类画像。画像：① 初学者/轻量使用者 ② 独立开发者 ③ 重度 AI 使用者（日 5+ 会话）④ 团队工程助手（共享机器/持续运行） ⑤ 合规/审计角色 ⑥ 运维（多 DSH_HOME/多机）。

**旅程 1：日常空间清理（侧边栏永久删除）**
- 触发：侧栏想清掉旧会话 → 右键 `⋯` → 永久删除（定位在「归档会话」正下方，`pkgsrc_FORK.md#L9`）。
- 关键路径：克隆归档行样式（同一行容器注入，`pkgsrc_FORK.md#L9-L11`）→ MutationObserver + 30–800ms 六轮延迟扫描（`pkgsrc_FORK.md#L13`）→ overlay 确认（client `#L2086-L2087`）→ POST → 列表剔除。
- 卡点（证据向）：
  1. **注入时序依赖 30–800ms 轮询，存在「点不到/双份菜单」窗口**【P1】。证据：多轮延迟扫描双保险（`pkgsrc_FORK.md#L13`）；`BUILD='sd-0.6.0-20261119-rename'` 表明经历过 0.6.x 改名迭代（`package/src/client.js#L40`）。影响：轻用户第一次用若菜单未注入会以为功能不存在；概率：注入瞬时完成，低。
  2. **无快捷键、无图标强调（照内置归档行）**【P3】。证据：FORK 明言「常规配色、无快捷键」（`pkgsrc_FORK.md#L9`）。影响：效率型用户（②③）每轮要两步点选。
  3. **运行中会话 409 拒绝但无「排队等结束」能力**【P3】。证据：`#L651-L658`。影响：用户只能等或重启 DSH，常见于跑长任务的重度用户。
  4. **删除即失效确认只一步 overlay，无要求键入删除对象名**【P2】。证据：overlay 为官方 Modal/Button 原语（`#L2086-L2087`、`#L2076`）；无二次输入。影响：误删概率的函数低于「无确认」但高于「二次输入」。

**旅程 2：归档整理与恢复（设置页归档管理）**
- 触发：想找回某个已归档会话或整理项目分组。
- 关键路径：设置页 → 归档管理（标签名「归档管理」，`package/src/client.js#L2055`、render 断言 #L131）→ 项目分组（默认全部收起 `#L803`；筛选/搜索时自动展开 `#L1699`）→ 还原/删除。
- 卡点：
  5. **分组默认全收（仿 zcodex），首次打开看不到任何归档会话**【P2】。证据：`useState(() => props?.initialOpenGroups ?? new Set())`（`#L803`）默认空集合；`#L1699` 只有筛选/搜索才展开。影响：恢复旅程多一步「展开」；对④⑤⑥等不常进设置页的画像几乎不可发现。
  6. **筛选/排序/项目过滤状态不持久（离开页面即重置）**【P3】。证据：`filter`/`sortBy` 是组件内 `useState`（`#L789`、`#L800`），无 localStorage/服务端持久化。影响：每次维护需重设；频率高的运维画像（⑥）成本累加。
  7. **「全部永久删除」与「清空回收站」都两步确认但按钮同区、色系相近（红）**【P1】。证据：`#L1630`（purgeArchived 首击 arm）、`#L1840`（purgeAll arm）+ `#L926-L930` 提交；两者均 `sd-btn` 红色系（`#L1630`/`#L1840` 上下文）。影响：视觉区分度不足，误触靠「第二次点击」兜底；概率：低但发生即不可逆。
  8. **批量恢复缺失（有批量删除，无批量还原）**【P2】。证据：多选动作区只有删除分支（`#L1786`、`#L1829`），无 batch restore；恢复为逐行按钮。影响：误归档 20 个会话要逐个还原。

**旅程 3：自动归档（静默维护）**
- 触发：开启自动归档（默认关、7 天、30 分钟，`package/src/index.js#L915`）。
- 关键路径：config POST → 落盘原子写（临时文件+rename，`#L941-L944`）→ 重排定时器（`#L1378` 调用 scheduleAutoArchive、定义于 `#L1043-L1058`）→ 扫描 → 归档（跳过运行中/置顶/已归档，`package/src/index.js#L984-L997`，测试断言 `gh_test_smoke.mjs#L267-L271`）。
- 卡点：
  9. **扫描「只归档不删」，用户可能以为清理完成而实际空间未释放**【P2】。证据：smoke 断言「auto-archive did not delete anything」（`gh_test_smoke.mjs#L272`）；README 大字注明「archive only hides」。影响：依赖自动归档做「清理」的重度用户（③⑤）会误判。
  10. **定时扫描在 DSH 长挂机场景形同开关空转**【P3】。证据：timer 无条件每 `intervalMinutes` tick（`#L1048-L1056`），不做会话活动性判断的快捷通道（每次全量扫）。影响：30 分钟粒度 800 会话 ≈ 38,400 stat/日（估算，见 A6）。
  11. **跳过置顶依赖非公开内部状态（`pinnedSessionIds` 探测，降级为无置顶）**【P1】。证据：`pkgsrc_FORK.md#L27`；宿主契约中仅 `workspaceRegistry.requireState()` 内部可读。影响：若宿主改名，置顶保护静默失效 → 置顶会话被自动归档；概率：宿主演进必现，属结构性。

**旅程 4：批量清理与清空**
- 触发：想一次性清掉 N 个已归档或回收站会话。
- 卡点：
  12. **批量操作无进度与取消，大集合时 UI 无反馈**【P2】。证据：`firePurgeArchivedAll` 一次 POST（`#L926-L930`），宿主逐条同步执行（`#L1076-L1097`）；无进度事件流（`list-stream` 为只读）。影响：800 会话级操作等待秒级、无中间态，用户刷新页面即重试风险。
  13. **「全部永久删除」单请求完成，中途失败只计入 `failed` 不打断**【P2】。证据：逐条 try/catch（`#L1093-L1096`），末尾审计 `failed` 计数（`#L1098`）。影响：部分成功部分失败的状态对用户不透明（客户端只看 ok）。

**旅程 5：误删恢复（回收站）**
- 触发：把会话丢进回收站想找回。
- 卡点：
  14. **回收站入口在页面底部、且非页签（无 tab bar）**【P3】。证据：render 断言「trash link (no tab bar)」（`gh_test_render.mjs#L179`）；README「Trash（entry at the bottom of the page）」。影响：发现性弱，轻用户① 可能找不到。
  15. **还原路径自动解除归档，但旧宿主回退为「提示离线 unhide」**【P2】。证据：`#L782-L793` 在线 unarchive、失败保留归档态；`tools/unhide.mjs` 存在作为离线兜底。影响：旧宿主用户多一步手动命令，与「一键还原」感知不符。

**旅程 6：审计与排查**
- 触发：想知道「谁/何时删了什么」，或出 bug 排查。
- 卡点：
  16. **审计日志只落盘 JSONL，无 UI 视图、无查询能力**【P2】。证据：`audit()` 追加 `AUDIT_LOG`（`package/src/index.js#L217`、`#L97`）；客户端无审计页。影响：审计画像⑤⑥ 只能开文件。
  17. **调试遥测 `/debug` 无权限等级，仅靠同一自定义头门禁**【P2】。证据：1.2.1 起 GET/POST `/debug` 均需头（`#L1420-L1421`；测试断言 L225/L227）。影响：任何能发头者可见侧栏注入诊断；无隐私面清理。

**A2 自反性攻击**
- 反驳：把「无批量还原」定成 P2 可能低估——归档管理的主写操作是删除（zcodex 语义），恢复是低频；批量还原缺失更多是「效率损失」而非「功能缺失」。维持 P2（改变状态的是恢复动作频次问题，可能调 P3）。
- 反驳：默认折叠在「会话数最多」的画像（③）里反而减排噪，此前的「发现性」批评与 zen 设计目标存在权衡；结论调整为「对新增功能的首次发现成本高，对已习得用户反而是优势」——但首次发现成本恰好落在最缺指引的轻用户上，仍成立。
- 反驳：「无快捷键」若官方菜单也不提供快捷键，则不是本产品缺口而是宿主契约；应降为 P3 保留。

**A2 小结**：旅程结构完整，六个主要动作（删、归档、还原、清空、自动归档、审计）都有可走通的完整路径；缺口集中在**发现性（折叠/底部回收站）、一致性（批量删除有/批量还原无）、进度透明（批量无进度）**。P1 级 2 条（按钮同区红色、归档跳过置顶的宿主依赖），P2 级 6 条。

---

## A3 竞品深度拆解

**对比对象**：官方宿主基线（DSH 核心）／`jasonrale/dsh-archive-manager` 1.1.1／`vtxf/dsh-session-delete` 0.1.0／上游 `xohmai/dsh-session-delete`（Apache-2.0）。

**registry 事实（2026-11-20 实查）**
- jasonrale/dsh-archive-manager：MIT，`engines.node>=22`，零 `dependencies`，`peerDependencies` 12 项全部钉在 `@deepseek-ai/*@^0.1.0-rc.6`（含 dsh-agent、dsh-session、dsh-session-persistence、dsh-storage-domain、dsh-workspace、dsh-client-*-rc.6）+ `react@^18.2.0`；创建 2026-08-15；3 版本；描述言明「full agent teardown」。
- vtxf/dsh-session-delete：MIT，无 engines/peerDeps/deps；创建 2026-08-18；仅 0.1.0；功能=侧栏菜单删除 + 批量归档。
- 本产品：Apache-2.0，`node>=20`，零依赖、零 peerDeps，devDeps react/react-dom ^18.3.1；创建 2026-11-20，同日 3 版本。

**发现清单（10+）**

1. **「AgentHandle.dispose 全量 teardown」在宿主契约上并非不存在——这是本产品对竞品最根本的误判**【P1】
   证据：宿主 Service `agentLoop` contract 实查，`AgentHandle { agent; dispose(): Promise<void> }` 类型存在；`createAgent`/`resume` 返回该 handle。但宿主**没有**「按 id 获取已归档/离线会话 handle → dispose」的公开路径。
   判断影响：本产品技术文案（README/FORK 谈及竞品不可实现处）需修正口径：精确差异是「对**在线**会话可 dispose，对**离线已归档**会话无公开 dispose API」；当前文档说「官方没有 dispose API」不准确。这是文档级 P1（影响选型判断的读者）。
2. **teardown 可行性的三条路径评估**【P1】
   - 路径 A（jasonrale）：需持有 handle——其 peerDeps 表明在 rc.6 世代即持有 handle 做 dispose。风险面：删运行中会话必须先 dispose 正在跑的 loop，若 dispose 不等待收尾，等价于「杀掉运行中会话」，与「绝不做半删」的原则对冲。判断影响：竞品选择了「可以删运行中的」，本产品选择了「运行中拒删」——两种产品哲学不同，但竞争初期竞品的「删得动」往往赢 UI 印象分。
   - 路径 B（官方事件）：宿主存在 `workspace/session-stop`、`workspace/session-unarchiving` 事件（host Event 目录实查）；可做停止-再删，但仍是「先停再删」不是原子。
   - 路径 C（本产品）：归档隐藏 → 删目录 → ghost 记账，重启 reconcile（`#L883-L907`、`#L825-L826`）。代价=单进程 ghost 累积，回报=不碰运行中会话。
   判断影响：三路都是本机解决方案，无「完全同步、无 ghost、无 teardown」的银弹；本产品选择在「安全性」维度下注，竞品在「彻底性」下注。
3. **本产品覆盖功能面最广（回收站+永久删+自动归档+审计+调试），但也是唯一带「设置页」的**【P2】
   证据：README 功能对比 + 本产品 12 条路由（`gh_test_smoke.mjs#L106-L119`）vs vtxf 的菜单式（描述仅两项菜单能力）。判断影响：功能多=竞争宽度上的唯一解，但也带来 3561 行 vs 竞品量级的维护成本与 A5 发现的交互宽度问题。
4. **包名极似：`dsh-archive-management` vs `dsh-archive-manager`（jasonrale）——一字母之差，npm 上并存**【P1】
   证据：registry 两包并列（latest 1.2.1 vs 1.1.1）。判断影响：安装命令 `dsh plugin add dsh-archive-manager` 会装到竞品；`add dsh-archive-management` 才装本产品；README 只给了本产品名。对用户是混淆面，对竞品是无意的流量争夺。概率：高（搜索式发现常见）。
5. **引擎差异放大安装失败面：本产品 `node>=20` vs 竞品 `node>=22`**【P2】
   证据：packument 实查。判断影响：本产品在老 Node/某些受管 DSH 环境可装、竞品不可——这是可以写进对比的硬优势，而本文档只把它当数据列示（属客观可量化差异，意在修正营销文案而非赞美）。
6. **peerDeps 策略分化：本产品 0 peerDeps，竞品 12 项硬钉 rc.6**【P1】
   证据：packument。判断影响：竞品在安装时即强制宿主 API 版本对齐（rc.6），好处=显式契约，坏处=升级 DSH 必须等竞品发版；本产品无 peerDeps 安装顺畅，但契约漂移只在运行时暴露（例：`workspaceRegistry.requireState().pinnedSessionIds` 降级，`pkgsrc_FORK.md#L27`）——两种策略各付各的税，本产品应把「运行时探测+降级」文档化（当前 FORK 有一句话，未展开为契约表）。
7. **vtxf 的零 peerDeps 与零依赖对照验证了「轻量菜单式」路径可更低成本**【P3】
   证据：packument vtxf 0.1.0 无 peers/deps。判断影响：对只想要「删除」的用户，vtxf 的安装面最小；本产品的复杂功能必须交付「不删到核心数据」的信任才能对比下胜出——信任由 409 保护与两步确认构建（A4/A5 详）。
8. **上游 Apache-2.0 与参考实现 MIT 的许可证矩阵：本产品无许可证冲突但从属关系在包内不可见**【P1-合规联动 A7】
   证据：FORK.md/NOTICE（GitHub main 分支实拉：`pkgsrc_FORK.md` 全 44 行、`pkgsrc_NOTICE` 全 22 行注明 xohmai 版权），npm 包里无 NOTICE/FORK（files 白名单：`package/package.json#L26-L32`）。判断影响：竞品（MIT）无此义务，本产品多一道 Apache-2.0 §4(b) 分发义务，且当前发布物未随带 NOTICE（见 A7-2）。
9. **功能对比曲线：竞品无审计/无自动归档/无调试面，本产品在这些维度上无直接对标物**【P3】
   证据：两竞品描述与路由清单（vtxf 菜单两项；jasonrale 面板+restore/delete+teardown）。判断影响：对比报告的「优势」可量化（12 路由 vs 2 vs 2），这是客观差异，非价值判断。
10. **ghost 记账 vs teardown 的「残留真相」对比：竞品删后无残留、本产品偶尔留 ghost（重启前）**【P1】
    证据：`#L825-L826` ghost 由重启 reconcile；单进程永删多次 → `archivedSessionIds` 虚增；`#L345` 有 reconcile 审计出口但只在 apply 时跑。判断影响：评测者如果「删完立刻 ls registry」会看到 ghost——这是本产品与竞品最尖的可见差异，也是选型风险点。缓解=测试覆盖并文档告知（当前 FORK 未提到 ghost 对外可见）。
11. **竞争时间窗口：竞品 8 月已站场，本产品 11 月 20 日一天内连发 3 版**【P3】
    证据：registry `created/modified`。判断影响：后发者需要「开箱即用的深度」追平三个月先发优势；本产品同日快速迭代削平了「批发不发的版本坑」的观感，但速度也带来 A7 的打包缺件。

**A3 自反性攻击**
- 反驳：把「竞品可删运行中会话」描述成弱点，但真实用户可能更想要「能删」——竞品的 dispose 若实现为「保存结果后优雅退出再删」，则不是对抗而是更彻底。没有运行实验，仅从契约层面判断，属中置信；应把 A3-2 的路径 A 标注为「需实证」。
- 反驳：peerDeps 的「硬钉」也可能是对宿主 API 负责任的态度（显式声明依赖），而本产品 0 peerDeps 反而是「搭便车」——两种策略都被我各打了一拳，需保持中立表达（第 6 条已改成「各付各税」）。
- 反驳：声称「功能最广」时没排除「广度≠深度」——审计日志无 UI、自动归档跳过置顶靠内幕字段，这些广度项在实战里可能浅于竞品的单选功能深度。已在 A2/A7 单独计分，此处降为 P3。

**A3 小结**：竞争位=「功能最全 + 非运行侵害 + 零依赖」；最大软肋=包名近似、ghost 残留可见、无 peerDeps 的隐性契约承诺。P1 级 4 条（文档误判 dispose、teardown 路径评估、包名混淆、ghost 可见），P2 级 3 条。另由实测确认：竞品路径 A 的宿主前提（AgentHandle.dispose）在当前 DSH 上存在，但「对归档离线会话」无公开入口——这是两产品分道扬镳的技术岔口。

---

## A4 工程可靠性拆解（FMEA）

约定：严重度 S（1-5）、发生度 O（1-5）、可检度 D（1-5，越大越难检出）、RPN=S·O·D。

| # | 失效模式 | 诱因 | 影响 | 证据 | S/O/D | RPN | 级 |
|---|---|---|---|---|---|---|---|
| F1 | 运行检查与删文件的 TOCTOU 竞态 | 检查 `#L874-L881` 后到 `rm #L898-L901` 之间，子代理被拉起 | 运行中会话被整树删除，违反「绝不做半删」承诺 | `deletePermanent` 顺序：check→archive→rm | 5/2/4 | 40 | P1 |
| F2 | archive 全成功后 rm 阶段失败（权限/句柄） | 归档已把会话从侧栏隐藏，rm 遇 EPERM | 会话侧栏消失、磁盘仍在；用户看到「删掉了」但空间没释放，且无回滚 | 先全部 archive（`#L883-L890`）再逐个 rm（`#L892-L902`）；无 rm 失败回滚逻辑 | 4/2/4 | 32 | P1 |
| F3 | rename→meta.json 之间的崩溃窗 | `moveOneToTrash`：rename（`#L618`）后、writeFile meta（`#L623-L638`）前进程崩溃 | 回收站存在无 `meta.json` 条目 → restore 500 NO_META（`#L761-L763`） | 顺序代码证据 | 4/1/4 | 16 | P2 |
| F4 | meta.json 被篡改/损坏（含外部编辑器） | 手工编辑或磁盘损坏 | restore 走 `meta.id`/`meta.cwd`（`#L765-L775`）；id 有白名单（`#L768-L770`），cwd 无规范化白名单 | `#L765` 注释自承「meta.json 是磁盘文件，可能被篡改」 | 3/ in超2/3 | 18 | P2 |
| F5 | 还原目标父目录不存在 | 项目目录被用户/其他工具删除 | `mkdir(dirname(targetDir))`（`#L779`）已建父目录，恢复 OK | 实测代码含 mkdir → 失效模式已被缓解 | 2/2/3 | 12 | P3 |
| F6 | Windows 文件句柄占用（AV/资源管理器/子进程） | rename/rm 遇 EBUSY/EPERM | 删除失败 500；软删已建空条目会清理（`#L619-L622`）；永久删 rm 失败静默继续，不会回滚 archive | `#L619-L622` 与 `#L1093-L1096` | 3/3/3 | 27 | P2 |
| F7 | audit.log 无界增长 | 每次操作/扫描落一个 JSONL；自动归档每天 48 条纯扫描摘要 | 数年膨胀至 MB 级、无轮转、读取 O(n) | `audit` 追加（`#L217`）；auto-archive 每次都审计（`#L1023-L1029`） | 2/5/1 | 10 | P2 |
| F8 | ghost id 单进程无界累积 | 运行期间多次永久删除/清空后 id 留在归档集 | `archivedSessionIds` 虚增；归档页与 purge-archived 遍历游魂 | `#L825-L826` 明言「运行期间不摘」 | 2/4/1 | 8 | P2 |
| F9 | ENTRY_RE 过宽放行 `.`/`..`（第一道防线失效属性） | 正则字符类含 `.`（`#L95`） | `.`/`..` 必须被第二道 `resolveTrashEntryDir` 拦截（`#L740-L744`）否则目录逃逸；当前深防 2/2 成立，但将来若只改一处即破 | `#L95` vs `#L740-L744` | 4/1/5 | 20 | P1* |
| F10 | 条目名 240 上限与转义膨胀 | 特殊字符 id 最多 ×5 扩张 | 软删 400 INVALID_ID（`#L603-L606`）；永久删可用 → 行为不对称 | `#L603-L606` vs `#L869-L909` | 3/1/2 | 6 | P3 |
| F11 | 同 id 并发请求（双击/双 tab） | 两个 delete 同时到达 | 单侧移后第二请求 ENOENT→404；审计可双写 | 无并发串行化基础设施（`inventory()` 每次重建/缓存） | 1/3/1 | 3 | P3 |
| F12 | dirSize 双遍历开销 | 删除前统计 + 删除本身各遍历一次 | 巨大会话（GB 级）删除/清空耗时为 2×，HTTP 阻塞 | `#L613` 与 `#L1086-L1088` | 1/4/1 | 4 | P3 |
| F13 | 扫描冷缓存 ENOENT 全量重算 | 旧格式会话或无 mtime 缓存 | 扫描变慢（曾 8s 稳态，见代码注释历史语） | `#L420-L421` | 1/2/3 | 6 | P3 |
| F14 | 配置写一半 | 崩溃于临时文件写 | 原子写已修（tmp+rename `#L941-L944`） | 1.2.0 引入项、CHANGELOG#L3-11 | 2/1/5 | 10 | P2* |

*P1*：F9 属「架构上成立、防御降级即洞」的隐患，维持深防即可，但应加回归测试；F14 已修复（原子写），RPN 低。P1 级严格 2 条：F1、F2。

**A4 自反性攻击**
- 反驳：F1 的 O 值（发生度 2）可能低估——DSH 支持子代理并经常长任务，从 409 重试到完成删除的用户路径里天然存在「等它结束→立刻删」的时间窗；夜间自动清理脚本（若有人用 `/auto-archive/run` 之外自行调用）也会踩。提升 O=3 时 RPN=60，级仍 P1。建议产品层把「删除时重查并二次确认」或「在 inventory 层加 per-id 锁」列为必做。
- 反驳：F2 的「无回滚」描述不完全准确——rm 的 `{ force: true }` 在权限失败时抛错，外层 `deletePermanent` 会返回 500 给调用方，用户能看到失败；但「归档已消费」这一中间态不可见。结论维持但补充「至少应有 error 提示『已归档但未删净，请重试』」。
- 反驳：RPN 打分带主观性，S/O/D 数值仅供排序，不承担绝对值意义——本报告会以排序而非绝对数值引用。

**A4 小结**：整体可靠性在「防御正确性」上（id 白名单、路径转义、原子配置写、409 全链）在同源竞品里少见；主要缺口是**删除链的两个事务边界**（F1 竞态、F2 半态）与**记账持久化**（F7/F8 无界）。P1 级 2 条。

---

## A5 行为设计拆解（尼尔森十项启发式）

1. **系统状态可见性**：合格偏优。【P3】证据：行内「运行中/打开中」标签（`package/src/client.js#L1397-L1398`）、计数 `filteredAll.length / sessions.length`（`#L1916`）、「尚未运行过扫描」空态（`gh_test_render.mjs#L177`）。缺口：批量删除无进度（复述 A2-12）。
2. **系统与现实匹配**：术语与 OS 一致（回收站/永久删除/归档），OK。【P3】「清空回收站」与「全部永久删除」两个不可逆操作文案并存且同面板，语义区分依赖用户细读（见 A2-7，P1 联动）。
3. **用户控制与自由**：还原路径完整（trash→restore、归档→unarchive），删除两次确认；缺口=无「最近删除」或回收站外还原，清空即绝（A1-5）。【P2】
4. **一致性与标准**：侧栏行克隆内置「归档会话」行（`pkgsrc_FORK.md#L9`），确认框走官方 overlay 槽位（`#L2086-L2087`）→ 外观一致性高；但 `BUILD='sd-0.6.0-20261119-rename'`（`#L40`）泄漏内部代号进遥测，属于命名残留。【P3】
5. **错误预防**：强。【P2】运行中 409（FMEA F1 除外）、还原目标冲突 409（`#L776-L777`）、两步红钮（多处）、id 白名单+转义（`#L85/#L95/#L155`）。缺口=没有「键入会话标题/『delete』二次输入」的不可逆确认（A2-4）。
6. **识别而非回忆**：项目分组+筛选+排序+搜索齐全（`#L1636-L1666`、`#L1901-L1916`）；缺口=分组/筛选/排序全部不持久（A2-6）。【P3】
7. **使用弹性与效率**：批量删除有多选（`#L1786-L1829`），批量还原缺失（A2-8）；无快捷键（A2-2）。【P2】
8. **优雅极简**：默认折叠符合 zen（zcodex 语义），但同时是发现性弱点（A2-5）。【P3】
9. **帮助与文档**：双语言 README（82/83 行）、SECURITY.md、调试遥测路由；但无应用内帮助、无审计查看界面（A2-16）。【P2】
10. **无效/错误恢复**：多数错误有明确 code/文案（403/404/400/409/500，测试断言覆盖）；无「恢复到上一步」的扩展接口。【P3】

**A5 发现 10+ 条**：以上每启发式一条定位与评级合计 10 条；再补充：11）「全部永久删除」按钮红字但未做大字号/边框强调（`#L1630`）→ 危险动作视觉权重不足；12）「删除打开中会话后自动开空白会话」无任何警告说明（`pkgsrc_FORK.md#L17`）→ 用户可能以为内容丢了。
P1 级：A5-2/联动（A2-7 同源）1 条；A5-5（错误预防在「最终确认强度」上的缺位）1 条。合计 P1 2 条、P2 4 条、P3 6 条。

**A5 自反性攻击**
- 反驳：对「无二次输入确认」的批评可能过度设计——桌面删除习惯（macOS/Windows 垃圾桶）本身不要求打字，两步点击已是行业常态；维持 P2（建议级而非必须）。
- 反驳：默认折叠的批评在 zcodex 场景里被「项目数多时才需要折叠」反驳；对 10 项目以下用户，折叠是净伤害。产品应做「项目数阈值自适应展开」而非一刀切。
- 反驳：heuristics 纯主观打分，需与 A4 RPN 联动解释分值，本报告遵循。

---

## A6 生命周期与长期视角（一年后回访）

**假设场景**：日 2-3 会话的重度用户，一年 800 会话、12GB；每天自动归档开 7 天保留；每周手工清理 3 次。

1. **重启愈合是 ghost 的唯一收敛通道**【P1】。证据：reconcile 在 apply 时运行（`#L345` 审计出口 + `#L825-L826` 说明「ghost 由宿主重启时 reconcile 统一清理」）。判断影响：DSH 常挂机（服务器/工作站）的单进程 gt 一年可累积数千 ghost 条目，归档页展示与 purge 遍历成本随虚增（附量化：800 会话 + 200 ghost/年 ≈ 25% 虚增）。
2. **audit.log 一年增量 2.1MB 上下且不可轮转**【P2】。量化：每次操作 ~200B + 每次扫描 ~120B×48/日×365≈2.1MB/年；10 年 21MB。证据：`audit` 无条件追加（`#L217`）。判断影响：长期运行者磁盘与读取耗损低，但「日志直到手动删」=运营债。
3. **自动归档扫描在 800 会话下年开销极小，但冷缓存窗口退化**【P3】。量化：48 次/日×800 stat ≈ 38,400 stat/日 ≈ <12s/日 CPU。证据：`#L1048-L1056` 定时器 + `#L420-L421` 缓存注释。30 分钟粒度 vs DSH 会话 mtime 变化频次不匹配时形同空转。
4. **一年多后「旧 id 校验库」漂移风险**【P2】。`ID_RE`/`ENTRY_RE` 为新形态 id 留了 8-200/240 的余量（`#L85/#L95`），但头注释列的四种 id 清单会随宿主新增形态过期；插件 ID 白名单本身是复制清单=漂移面。
5. **peerDeps=0 的长期对价：主宿主断崖**【P1】。判断影响：DSH 若在 1 年内升级 API（事件名/服务签名），本产品无安装期版本门禁，用户会在升级后遇到「菜单不注入/路由 404」；竞品（钉 rc.6）会在安装期拒绝。本产品加「运行时版本探测+降级+显式报错」或「peerDependencies 约束」任选其一。
6. **JavaScript 依赖=0 → 一年后供应链风险≈0（除 Node 本身）**【P1- 正面可量化】。证据：package.json 零依赖。判断影响：无 CVE 面、无 lockfile 漂移；这是本产品生命周期里最耐久的资产之一。
7. **Windows 目录平铺 5,000+ 条目性能退化但非功能失效**【P3】。回收站条目全部平放 `trash/sessions/<stamp>-<id>`（`#L614-L616`）；NTFS 目录 2^32 上限内性能下降+Explorer 慢。无年度/月份分桶。
8. **「npm token 2027 到期」类运营项：无凭证、无遥测 → 无密钥生命周期**【P1- 正面】。证据：README#L32「no telemetry, no network calls」。判断影响：一年后无维护密钥面；发布密钥管理=作者侧负担，非产品面。
9. **功能冻结风险：单作者、无 CI 证据、无贡献通道（除 GitHub issues）**【P3】。判断影响：一年后若作者失联，产品停在 v1.2.1 且与新 DSH API 的适配无来源。
10. **「自动归档=隐藏」的一年误解成本**【P2】。证据：`#L1014` 只 `archiveSession` + `#L1098` 只审计；测试证实不删（`gh_test_smoke.mjs#L272`）。判断影响：把自动归档当「清理」的一年用户会发现 RDM 没生效，信任衰减。
11. **purge-archived 在 ghost 大时的可预期性**【P3】。`purged` 计数含 dir-missing ghost（测试 `#L276-L287` 注释明言）。判断影响：幂等性良好（测试 L287 freed=0），但计数口径用户不可懂。
12. **CLI/无头模式生命周期**【P2】。判断影响：`tools/unhide.mjs`（离线工具）在 1 年后的 DSH 版本路径变更时失效（工具硬编码 `storages/workspace.json` 假设，未读其实现细节，单列低证据）。

**A6 自反性攻击**
- 反驳：把「ghost 只靠重启收敛」定性 P1 可能重了——DSH 作为桌面应用本就频繁重启（用户关机/断开会话），实际收敛周期短；P2 更稳。但「常挂机服务器」画像存在，维持 P1 待产品决策。
- 反驳：「peerDeps=0 或加门禁」的建议与「安装顺畅」目标冲突；实际可用「兼容矩阵文档+运行时告警」两全。
- 反驳：场景参数（800 会话/12GB/2.1MB）是演示级假设，不是产品承诺——已标注假设来源。

**A6 小结**：长期威胁聚集在「宿主契约漂移」（无版本门禁）与「记账/日志无界」（ghost、audit），而「零依赖」「无遥测」「原子写」构筑了相当厚的耐损底座。P1 级 2 条（ghost 收敛依赖重启、宿主断崖无门禁）。

---

## A7 开源合规（OSPO）与供应链

1. **npm 发布物不含 NOTICE 与 FORK.md —— Apache-2.0 §4(b) 分发义务未随包满足**【P1】
   证据：npm tarball 文件清单（10 文件：src、tools、CHANGELOG.md、cordis.patch.yml、SECURITY.md、README*、LICENSE、package.json）无 NOTICE/FORK.md；`files` 白名单（`package/package.json#L26-L32`）不含二者；npm 自动包含集只有 package.json/README/LICENSE。GitHub main 有 NOTICE/FORK（实拉成功：`pkgsrc_NOTICE` 22 行、`pkgsrc_FORK.md` 44 行）。
   判断影响：安装侧用户拿不到 NOTICE（上游版权归属声明），Apache-2.0 §4(b)「随作品分发 NOTICE」不闭合；合作方 SOP 审计会拦。修复=把 `NOTICE`、`FORK.md` 加入 `files`。
2. **npm 发布物缺 test/，而 `npm test` 依旧引用它**【P2】
   证据：`scripts.test = "node test/smoke.mjs && node test/render.mjs"`（`package/package.json#L33-L35`），files 不含 test/；tarball 实查无 test 目录。判断影响：`npm pack`/安装副本跑 `npm test` 报 MODULE_NOT_FOUND；发布物不可自验。
3. **文档断言数过期（FORK 42/24 vs 实际 63/27）**【P3】
   证据：`pkgsrc_FORK.md#L37-L38`（42/24）；实际 smoke 63 断言行（与 CHANGELOG#L11 一致）、render 27 行；CHANGELOG v0.6.0#L41-L42（53/22）也是中间态。判断影响：文档与代码版本的对应关系读者需自行换算。
4. **同一日内连发 `0.0.0-stage`→`1.2.0`→`1.2.1`，dist-tags 正常（latest=1.2.1）但版本叙事突兀**【P3】
   证据：registry time（前述）。判断影响：对「发布纪律」打分方观感；无功能影响。
5. **0 运行时依赖 + 无 peerDeps + 无 lockfile/SBOM**【P2】
   证据：packument。判断影响：供应链面积极小（正面、客观留档），但可重现构建无凭据（无 lockfile 签入、无发布 CI 证明）。
6. **devDeps 许可证核对：react/react-dom ^18.3.1（MIT）+ LICENSE（Apache-2.0 官方文本 11357B）— 兼容 ✓**【P2- 客观可量化留档】。判断影响：无 license 传播冲突；无运行时依赖把 SBOM 义务降到最低。
7. **名称混淆与「名海」风险（30+ 同前缀包）**【P2】。证据：registry 搜索实录 30+ 个 `dsh-archive-*`/删除类包。判断影响：包名近似度高（A3-4）+ 同名包密集 → 被发现性低、被仿冒面弱、用户装错概率高。
8. **作者「Eleven_AI」与「ElevenLabs」名称近似——无证据标注为低置信观察**【P3】。判断影响：若 ElevenLabs 有商标主张，品牌重名存在理论上限；无 NVIDIA/DSH 官方背书→「dsh-」前缀 + 关键词被挤占。
9. **SECURITY.md 存在但未同步进 npm 包？**【P3】证据：files 白名单含 SECURITY.md → 实查 tarball 有该文件 ✓。判断影响：发布物带安全通道；内容未纳入本文审计（低证据：未读 SECURITY.md 正文）。
10. **上游及其 deps 再分发合法性封闭**【P2】。证据：上游 xohmai Apache-2.0（FORK#L3）、本产品 Apache-2.0、参考实现 MIT——无 Copyleft 闯入；FORK/NOTICE 把关系写清。判断影响：合规面本身干净，主要缺口只在「发布物随带」（第 1 条）。
11. **「零任意源拉包」=无 typo-squat/替代攻击面（自身不装包，不拉包）**【P3】。判断影响：供应链攻击面在本产品集上≈只有 DSH 宿主与 Node stdlib。
12. **无测试签名/无发布验证——供应链陈述需要「作者侧证明」而非代码证明**【P3】。判断影响：信任模型=「名字在 npm + README 说得清」；对合规审查者不够。

**A7 自反性攻击**
- 反驳：把「npm 包缺 NOTICE」标 P1 的前提是「Apache-2.0 对源代码再分发仍要求随带 NOTICE」，但若作者视「npm 发布物=源码分发」则义务成立，若视「构建产物」则可争议；实务中以「随包带 NOTICE」为准，维持 P1 但注明争议空间。
- 反驳：「0 依赖」的供应链安全结论预设了「宿主进程内运行第三方代码」无其他面——DSH 插件跑在宿主进程里，任意加载模块的权限=宿主权限；本产品自己不拉依赖，但它依赖的宿主服务是外部面（已在 A3/A6 覆盖）。此处不重复计。
- 反驳：断言「30+ 同前缀」有混淆视觉之嫌——搜索含 `dsh-*` 栅格，仅归档/删除类就 ≥15 个独立维护者，已按实拉列表计数。

**A7 小结**：许可证与从属关系清晰正确（这是上游 Apache-2.0 的恩惠，也是 FORK/NOTICE 写得准的结果），**问题集中在「发布物流失」三件套：NOTICE/FORK.md 未入包、test/ 未入包、断言文档过期**；外加同名包密集。P1 级 1 条（NOTICE 缺随带），P2 级 4 条。

---

## A8 红队演练

1. **本机无鉴权，只有 CSRF 头——任何本地进程都能删会话**【P1】
   证据：非 GET 才查自定义头（`package/src/index.js#L1134-L1135`）；头内容常量明文（`#L67`）；无 token/session。
   判断影响：同机恶意进程/子进程/服务（如被攻陷的 DSH 子代理 shell）可直接 `fetch('/api/session-delete/delete-permanent', {method:'POST', headers:{'x-dsh-plugin':'session-delete'}})` 对任意已运行结束会话整树抹除；且无审计前置提醒（只有事后 audit.log）。威胁等级=中高（本地代码执行是前提，但 DSH 沙盒薄）。
2. **GET 面暴露会话元信息给任何 127.0.0.1 访问者**【P2】
   证据：`/list`、`/trash`、`/preview` 为 GET（`gh_test_smoke.mjs#L106-L119`）；GET 不查头。
   判断影响：同网 SSRF 或浏览器历史/插件读取到会话标题、路径、大小（`/trash` 含 meta 摘要）。
3. **CSRF 面：外层跨页可发 GET 拉目标，POST 被头拦住（有效）**【P1- 正面】。证据：CORS 预检无应答（README#L30）+ 请求头检查（`#L1134`）。判断影响：源自浏览器页面的跨站 POST 被结构性阻止——这是 1.2.1 的关键胜利；但「同标签页内 XSS」可借 fetch 任意带头 → 头不是防 XSS 的。
4. **审计可伪造、无篡改证据**【P2】。证据：`audit` 明文 JSONL 追加（`#L217`），无 HMAC/内部序号校验。判断影响：合规取证场景里审计只能「辅助」不能「定案」。
5. **meta.json 篡改可改变还原落点（cwd 无校验）**【P2】
   证据：`meta.cwd` 直接进 `locate`（`#L771`）、`targetDir = dirname(location.path)`（`#L775`）；`#L765` 自承可被篡改。判断影响：写权限者（本地攻击者）可把还原目标指向会话根内任意 cwd 项目位；局限在 `sessionPersistence.locate` 的根约束内，非任意写。
6. **time/entry 可预测性：无随机数，条目名可枚举**【P3】。证据：`entryStamp` 精确到秒无随机（`#L139-L141`）。判断影响：在「无鉴权」前提下本来就任删，无需枚举——此条为低风险冗余观察。
7. **重放/幂等：POST /config 可被重放改策略（关自动归档）**【P3】。证据：`normalizeConfig` + 落盘原子写（`#L917-L944`）。判断影响：DoS 面（仅本机）。
8. **IM id 的 `:`/`@` 路径面 → 转义处理（`#L81-L90`）已在设计层封死**【P1- 正面确证】。判断影响：这是 issue #3 的修复成果（`#L28`、`#L75`），属可核对的强点。
9. **恶意 `parentSession` 链：id 级联基于 `header.parentSession` 字段，字段由持久化文件控制**【P2】
   证据：`descendantsOf` 按 `parentSession` 归纳（`#L855-L864`）。判断影响：篡改 `session.v3.jsonl.zstd` 头部的 `parentSession` 可把攻击者 id 挂到受害者 id 下 → 删受害者即连带删攻击者预置目录（内容由攻击者写）；但目录删除范围仍限 `sessionPersistence.locate` 落点。
10. **1.2.1 收紧的 /debug 仍有「头即权限」问题**【P3】。证据：`#L1420-L1421`。判断影响：与第 1 条同源，低独立价值。
11. **渲染面 XSS 未覆盖**：render 测试仅断言静态文本（`gh_test_render.mjs` 全文），未覆盖 `title`/`cwd` 等用户可控字符串的注入。客户端渲染基于手写 `h()`（非 innerHTML 未通读）→ **低证据观察「待人工复核」**（疑似低危，因 title 由会话文件提供、宿主渲染通常转义）。
12. **清空/全删无「二次输入」弱化了最后防线**【P1】。证据：两步红钮（client `#L926-L930` 等）无键入确认。判断影响：结合第 1 条，攻击者只需两步点击的模拟能力——但本机进程可脚本化点击，这一步确认对自动化威胁的阻滞≈0。

**A8 自反性攻击**
- 反驳：把「本机进程可删会话」标 P1 可能被批「滥用本地威胁模型」——本地进程已能直接 rm 磁盘；插件面没有降低攻击者成本（删文件 vs rm -rf 等价）。反驳答复：存在两个差异使它值得单列——(a) 插件删除是**整树+级联+避开运行中**的「高质量删除」，攻击者用 rm 会漏子代理或撞句柄，用插件的 409+级联更彻底；(b) 插件面是**哑协议可脚本化**（不需要 fs 权限即可达意），在沙盒评估（子代理的 sandbox 常限制 fs 但不限制 HTTP 到宿主）场景下提升有效。维持 P1。
- 反驳：XSS 观察证据不足，已按「低证据」孤立，不进入 P0/P1 统计——保持诚实。
- 反驳：F1（TOCTOU）与 A8 的同源并发面合并后，P1 计数不重复计。

**A8 小结**：防御框架（CSRF、路径转义、白名单、409、原子写、审计）在同型插件里相当强、代码一级防线基本成立；攻击面集中在**鉴权缺失（唯头）/审计不可证/配置重放/元数据落点可控**——这些是「本机工具」威胁模型的固有权衡，但对「DSH 沙盒内子代理可 http 宿主」的构型，插件应认真考虑加一个**每进程随机 token + 宿主绑定校验**（当前 P1 项修法）。

---

## X9 终审断语

**维度得分（0-10，源自各轮证据密度与严重度）**

| 维度 | 得分 | 依据（该轮 P0/P1 计数） |
|---|---|---|
| 影响定位（A1） | 8.0 | 影响域清晰、封边界正确；P0=1 |
| 行为交互（A2） | 7.0 | 旅程闭合；发现性与批量不对称扣分；P1=2 |
| 竞品位置（A3） | 6.5 | 功能最全但包名混淆+ghost 可见；P1=4 |
| 工程可靠（A4） | 7.5 | 防御正确性强；事务边界两处敞口；P1=2 |
| 行为设计（A5） | 7.0 | 十项齐全、危险动作强度不足；P1=2 |
| 生命周期（A6） | 6.0 | 无版本门禁+记账无界；P1=2 |
| 合规供应链（A7） | 7.0 | 许可干净但发布物缺件；P1=1 |
| 安全红队（A8） | 7.0 | 框架强、鉴权弱；P1=3 |
| **加权** | **7.0** | 平均 7.0 |

**终审判定：有条件通过（Conditional Pass）。**

- **不许发布的阻塞项（P0，1 条）**：无——本报告未发现「首发即不合法/不安全工作」的 P0；A1-11 的程序根（官方无公开移除）成立但绕行方案合法。
- **发布前必修（P1，按 5 组计）**：
  1. NOTICE/FORK.md 入包（A7-1）；
  2. 删除链事务边界：per-id 锁/删前重查（F1）+ rm 失败回滚或明确提示（F2，A4）；
  3. 本机鉴权升级：进程级 token + 宿主绑定（A8-1/12），至少把「两步红钮」升为「二次输入确认」（A8-12）；
  4. 文档与发布物同步：断言数、包名防错指引、ghost 可见性说明（A2/A3/A7 联动）；
  5. peerDeps 遗留决定：加「兼容矩阵+运行时告警」或显式 peerDependencies（A6-5）。
- **判定后一年回顾点**：ghost 收敛是否靠重启、audit 是否轮转、宿主 API 是否漂移（A6-1/2/5）。

**终审自反性攻击（对 X9 本身）**
- 反驳：加权 7.0 可能被套件「赞美 ≤10%」约束拉高——数字来自各轮客观得分，未给「情感加成」；若严格执行「无 P0 即不可上市」的保守买家口径，本产品属于「P1 清零前不可大肆推广」，结论已如此措辞。
- 反驳：P1 组里把「鉴权升级」与「二次输入」合并成一组，实际修编工作量差异大——产品可选最小路径（二次输入）先过审、大路径（token）后补；终审表述允许分级放行。
- 反驳：评测对象只是 1.2.1 静态快照，A6/A8 的推演部分带场景假设，已断言为假设不占判定权重。

---

## 专项深潜实测：T1 FS 语义（junction）与 T2 客户端渲染（XSS）收口

> 本节按《产品深度分析提示词套件 v2.0》T1/T2 轨道执行。对象：dsh-archive-management 1.2.1。
> 目的：把原报告中两处「低证据观察」（junction 目录跟随删除面、客户端渲染 XSS 面）从
> 「待复核」推进到「可证真/可证伪」。全部结论基于**本机实测**（Node v22.23.4 / Windows，
> 唯一复现脚本：`evid_T1_junction_probe.mjs`、`_t2probe/t2_render_probe.mjs`），非文档引用。

### T1 专项：junction / symlink / reparse point 跟随语义

**第一步·静态盘点（grep 全量）**

| 调用点 | 行号 | 说明 |
|---|---|---|
| `import { … readdir, rename, rm, stat … }` | index.js#L58 | 未引入 `lstat`/`realpath`/`symlink`，全文 `lstat|realpath|symlink|junction|readlink|mklink` 命中=0 |
| `readdir(dir, { withFileTypes: true })` | #L112（dirSize） | 上游目录枚举 |
| `readdir(root, { withFileTypes: true })` | #L702（listTrash）、#L433（locateLogFile 代际扫描）、#L112（dirSize） | 回收站/日志代际/目录枚举 |
| `stat(child)` 求和 | #L121（dirSize） | 字节计量 |
| `rm(dir, { recursive: true, force: true })` | #L899（permanent 删除）/ #L1088（purgeArchivedAll）/ #L781（restore 后清条目）/ #L824（purge-all）/ #L838（purge 单条）/ #L620（moveOneToTrash 失败回滚） | 全部删除/清理路径 |
| `rename(dir, trash)` | #L618（moveOneToTrash）/ #L780（restore 归位） | 会话本体搬入/搬出回收站 |

**第二步·行为实测（Node 22.23.4 / Windows，逐条独立 victim 隔离）**

| 测试 | 结构 | 结果 |
|---|---|---|
| A1 对照 | 真实目录 | dirSize = 100B（自身文件，正确） |
| A2 攻击 | **会话本体 = junction → victim 目录** | dirSize = **800B（穿透！外域 victim 全部计入）** |
| A3 攻击 | 会话内含 junction 子项 | dirSize = 100B（只计自身，**不穿透**） |
| A4 Dirent | readdir 会话-junction 顶层 → 条目为 `isDir:true/isFile:true` **无符号印记** | 顶层 junction 被 readdir 静默分解 |
| A5 对照 | 会话内含目录符号链接 | dirSize = 100B（不跟随，isSym:true 被跳过） |
| B1 攻击 | rm(会话本体=junction) | 外域 victim 目录与 secret.txt **均仍在** → **rm 不跟随** |
| B2 攻击 | rm(会话内含 junction 子项) | 外域 secret.txt **仍在** → 递归删除不穿 junction |
| B3 攻击 | rename(junction→回收站) 后对条目再 rm | 外域原目录仍在；回收站内仅为链接本体，删链接不影响目标 |

**T1 结论（10 条发现，评级如实，不硬凑 P0/P1）**

- T1-01（P3）**dirSize 顶层 junction 穿透计量被实证**：A2 dirSize=800B vs 对照 0B——当「会话目录本体」被替换为指向任意外域目录的 junction 时，`sizeBytes`/`freedBytes` 会**虚报外域全部字节**。证据：index.js#L107-L128（无 lstat 预检）+ `evid_T1_junction_probe.mjs` A2 输出 `dirSize(会话=junction→victim)=800`。
- T1-02（P3）purgeArchivedAll 的 `freedBytes += dirSize(dir)`（#L1087）同一穿透：清理报告会夸大释放字节，误导用户以为已释放外域空间。
- T1-03（P3）前置存在性检查 `stat(dir)`（#L612/#L898/#L1086）会**跟随 junction**而误判「目标存在」——即使 dir 是链接本体而非真实目录。
- T1-04（INFO）**「junction 跟随删除」观察项被证伪**：B1/B2/B3 实测 Node 22 的 `rm(recursive)` 与 `rename` 对 junction **均只操作链接本体、不触碰目标内容**，外域数据删除 risk 不成立。
- T1-05（INFO）嵌套 junction（会话内子项）被 `readdir(withFileTypes)` 标记为 `isSymbolicLink:true`，dirSize 的 `isDirectory()`/`isFile()` 均跳过 → 嵌套层天然安全（A3/A5）。
- T1-06（INFO）顶层 vs 嵌套行为的**不对称**是平台语义所致：readdir 顶层把 junction 当普通目录静默分解（A4 无符号印记），嵌套层才给 isSymlink 标记。
- T1-07（P3）平台不对称：Linux 上会话目录若被换为 symlink，存在性检查 `stat` 同样跟随、dirSize 入口同理穿透；行为与 Windows 一致但语义来源不同（readlink 判定在 `readdir` 时生效）。
- T1-08（INFO）造成顶层穿透的根因：目录入口本身未做 `lstat` 判定；修复 = dirSize 入口先 `lstat(dir)` 拒绝链接，或对真实路径 `readlink/realpath` 佐证。
- T1-09（P3）威胁模型边界：攻击者在 `~/.dsh/sessions/<id>` 放置 junction 的前提=已能写该目录 → 达成成本高、与「本机取证审计」面的信任不相容；综上定 P3（计量/展示失真），不升级 P1。
- T1-10（INFO）修复建议（可并入 A4 事务边界组）：dirSize 与 rm 前置统一加 `lstat` 链接判定 + 版本下限文档（NODE>=14.14 rm 已不跟随链接，>=20 行为已实测）；「被删会话显示巨大体积但实际没删多少」这个用户可见失真应作为 P3 排期。

### T2 专项：客户端渲染注入面（XSS / 属性注入 / 语义注入）

**第一步·渲染基元与静态扫描**

- 渲染基元 = `h = React.createElement`（client.js#L25），宿主 React 18（隔离环境实测同版本）。
- 全仓 grep 变体：`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`dangerouslySetInnerHTML`/`document.write`/`eval`/`new Function` **命中=0**。
- 唯一 DOM 写点：`labelSpan.textContent = label`（#L463）、`appendChild(document.createTextNode(label))`（#L468）、`el.textContent = CSS`（#L2031）——全部 text 级写入。
- 图标：`svgIcon` 用 `createElementNS/setAttribute/appendChild`（#L297-L312），无 innerHTML。
- 用户可控字段流向：`title`（服务端 meta/投影/镜像，不在插件白名单）、`id`、`cwd`、`meta.path` → 文本槽（#L577 dialogBody 模板）与 title 属性槽（#L1394/#L1471/#L1704/#L1754）。

**第二步·注入实测（`_t2probe/t2_render_probe.mjs`，React 18 SSR，7 类 payload）**

| Payload 类 | dialogBody 文本槽注入 | title 属性槽属性截断 | 结论 |
|---|---|---|---|
| `<img onerror=>` | 实体转义，无注入 | 无法截断引号 | 安全 |
| `</p><script>` | 转义 | 转义 | 安全 |
| `" autofocus onfocus="` | 转义 | `&quot;` 封死 | 安全 |
| `<svg/onload=>` | 转义 | 转义 | 安全 |
| `&lt;…&gt;` 实体字面 | 双转义 | 双转义 | 安全 |
| 引号/重音/$(x) 纯字符 | 文本原样 | 原样 | 安全 |
| 多行伪造文案（含 `\n`） | tooltip 多行展示 | 无代码执行 | **仅语义级** |

**T2 结论（10 条发现）**

- T2-01（INFO）**「客户端渲染 XSS」观察项被证伪**：dialogBody 文本槽 6/6 payload 全部实体转义，无 raw HTML 注入；属性槽 6/6 引号截断失败（`&quot;` 封死）。证据：`_t2probe/t2_render_probe.mjs` 输出。
- T2-02（INFO）渲染安全由**宿主 React 转义契约**保证，而非插件自身处理——`h('span', {title:…}, text)` 这类调用天然转义文本与属性值。
- T2-03（INFO）`menuText()` 是纯字符串 `split/join` 模板替换（#L214-L220），不经过 HTML 解析；locale 缺失兜底也走同路径。
- T2-04（INFO）全仓 0 处 `innerHTML`/`dangerouslySetInnerHTML` 等危险基元，唯一写点是 textContent/createTextNode（#L463/#L468/#L2031）。
- T2-05（INFO）`svgIcon` 与 `svgEl` 均走 DOM/React 属性 API，无字符串 SVG 拼接。
- T2-06（INFO）CSS 经 `el.textContent = CSS`（#L2031）注入 `<style>`，值域为插件硬编码常量，非用户输入。
- T2-07（P3）**多行 title 语义注入（仅展示级）**：title 值含 `\n` 时 tooltip 多行展示，可被用于伪造「已全部删除」等误导文案；无代码执行，评级仅 P3 且需会话标题可控才能达到。
- T2-08（INFO）XSS 面**剩余验证依赖点 = 宿主 `h` 实现**：若宿主未来将其替换为 `dangerouslySetInnerHTML` 风格或自研 HTML 注入渲染器，本结论失效——建议插件在注入时对标题字段做一次进出校验或在 README 记录契约假设。
- T2-09（INFO）服务端审计 `audit()`（#L217 追加写）无 HTML 渲染面，title 仅作为 JSON 字符串落盘。
- T2-10（INFO）结论与 v1.0 报告 A5-7（低证据 XSS）一致并已升级为「实测证伪」；后续如需验证宿主实现变更，复用 `_t2probe` 探针即可回归。

---

## 附录 A：证据文件清单（本次分析实际读取）

| 文件 | 用途 |
|---|---|
| `package/src/index.js`（1454 行，全读） | 宿主一半全部行为与行号锚点 |
| `package/src/client.js`（2107 行，全读） | 客户端一半全部行为与行号锚点 |
| `package/package.json`、`package/CHANGELOG.md`（131 行）、`package/cordis.patch.yml`、`package/SECURITY.md` | 发布/版本/补丁/安全面 |
| `package/README.md`（83 行）、`README.zh-CN.md`（82 行） | 文档面 |
| `package/tools/unhide.mjs` | 离线还原工具存在性 |
| npm registry packument `dsh-archive-management` / `dsh-archive-manager` / `dsh-session-delete` | 三包版本/时间/许可/依赖 |
| GitHub main `FORK.md`、`NOTICE`、`test/smoke.mjs`、`test/render.mjs`、`LICENSE` | FORK/NOTICE/测试断言实拉 |
| 宿主 Service 目录（`workspaceRegistry`、`agentLoop`） | 宿主契约/AgentHandle.dispose/去归档能力核对 |
| `gh_test_smoke.mjs`/`gh_test_render.mjs` | 断言计数与行为对照（63/27） |
| `evid_T1_junction_probe.mjs` | T1 junction 跟随语义实测（Node 22.23.4/Windows，A1-A5/B1-B3 隔离 victim） |
| `_t2probe/t2_render_probe.mjs` | T2 渲染注入实测（React 18 SSR，7 类 payload × 文本/属性双槽） |

## 附录 B：发现总账（P0/P1 汇总）

| 编号 | 等级 | 一句话 | 证据 |
|---|---|---|---|
| A1-11 | P0 | 产品根=官方无公开移除，绕行 ghost 记账为结构性税 | `#L883-L907`、`#L825-L826`、宿主契约 |
| A1-5 | P1 | 恢复窗口=回收站期，清空不可逆 | `#L820-L828` |
| A1-9 | P1 | 打开中空闲会话被删时无专门建档提示 | 代码+client |
| A2-7 / A5-2 | P1 | 两个不可逆红钮同区并存、文案区分弱 | client `#L1630`/`#L1840` |
| A2-11 | P1 | 自动归档跳过置顶依赖非公开 `pinnedSessionIds` | `pkgsrc_FORK.md#L27` |
| A3-1 | P1 | 文档误称官方无 dispose API（契约实存 handle.dispose） | 宿主 Service `agentLoop` ReferencedType `AgentHandle` |
| A3-2 | P1 | teardown 三路径评估：竞品路径 A 前提实证，本产品口径需修正 | 宿主契约 + registry 竞品描述 |
| A3-4 | P1 | 包名与 jasonrale `dsh-archive-manager` 一字母之差 | registry 两包 |
| A3-10 | P1 | ghost 记账对外可见 = 与竞品 teardown 最尖的选型差异 | `#L825-L826`、`#L345` |
| A4-F1 | P1 | 运行检查→rm 的 TOCTOU | `#L874-L881`→`#L898-L901` |
| A4-F2 | P1 | archive 全成后 rm 半败无回滚 | `#L883-L902` |
| A6-1 | P1 | ghost 仅靠重启收敛，长效挂机累积 | `#L825-L826` |
| A6-5 | P1 | 无版本门禁→宿主断崖 | packument（0 peerDeps） |
| A7-1 | P1 | npm 发布物缺 NOTICE/FORK.md | files 白名单+tarball 清单 |
| A8-1/12 | P1 | 本机无鉴权仅头门禁；最后确认可被脚本化 | `#L1134-L1135`、client 两步 |
| A8-4 | P2 | 审计可伪造、无篡改证据（取证价值有限） | `#L217` |

> 统计口径：P0=1（结构性根，非发行阻塞，因方案本身合法且可运行）；P1=14（跨轮重复主题已合并计一次：A2-7 与 A5-2 同源、A8-1 与 A8-12 同源）；「发布前必修」按领域归并为 5 组（见 X9 清单）：①发布物缺件（A7-1）②删除链事务边界（A4-F1/F2）③鉴权与最终确认（A8-1/12）④宿主契约契约化与文档口径（A2-11/A3-1/A6-5）⑤ghost 与恢复窗口治理（A1-5/A1-9/A6-1，A3-4/A7-7 并入第 ④ 组同名引导）。所有 P0/P1 均逐条附证据行号或 registry/契约事实。原「低证据观察」两项已在 T1/T2 专项轨道收口并有实测判定：**junction「跟随删除」面证伪**（Node 22 rm/rename 不跟随目标，外域数据安全），**客户端渲染 XSS 面证伪**（React 转义文本/属性双槽，6/6 payload 无注入）；残余为 P3 级计量失真（T1-01/02/03）与 P3 级多行 tooltip 语义注入（T2-07），不改变 X9 的有条件通过终审。