/**
 * Client-half render test (fork addition).
 * Loads the real src/client.js through a mocked __ModuleLoader__, registers all
 * three slots against a mocked client ctx, and renders the menu item and the
 * settings section with real React (react-dom/server) resolved from the running
 * DSH installation.
 * Run: ELECTRON_RUN_AS_NODE=1 <electron-or-node> test/render.mjs
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const INSTALL = process.env.DSH_INSTALL_DIR
const failures = []
function check(name, cond, detail) {
  if (cond) console.log(`ok - ${name}`)
  else {
    failures.push(name)
    console.error(`FAIL - ${name}${detail !== undefined ? ` :: ${String(detail).slice(0, 300)}` : ''}`)
  }
}

// ---- resolve react / react-dom from the running installation ----
// pnpm 隔离布局：react 不是 CLI 根的直接依赖，逐锚点实际 require，最后兜底扫 .pnpm。
const anchors = [
  path.join(import.meta.dirname, '..'),
  INSTALL,
  path.join(INSTALL, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar'),
  path.join(INSTALL, 'node_modules', '@deepseek-ai', 'dsh-client-ui-renderer'),
  path.join(INSTALL, 'node_modules', '@deepseek-ai', 'dsh-web-app'),
]
let React = null
let reactDomServer = null
let reactFrom = null
for (const anchorRaw of anchors) {
  try {
    // asar 内是 pnpm 符号链接：必须 realpath 到 .pnpm 真实路径，react 才在同级的
    // 虚拟 store 里可解析（符号链接路径向上走只会回到顶层 node_modules）。
    const anchor = fs.realpathSync(anchorRaw)
    const candidate = createRequire(path.join(anchor, 'noop.js'))
    const reactCandidate = candidate('react')
    const domCandidate = candidate('react-dom/server')
    React = reactCandidate
    reactDomServer = domCandidate
    reactFrom = anchor
    break
  } catch {
    /* try next anchor */
  }
}
if (React === null) {
  try {
    const pnpmDir = path.join(INSTALL, 'node_modules', '.pnpm')
    const reactDir = fs.readdirSync(pnpmDir).find((n) => n.startsWith('react@'))
    const domDir = fs.readdirSync(pnpmDir).find((n) => n.startsWith('react-dom@'))
    if (reactDir && domDir) {
      React = createRequire(path.join(pnpmDir, reactDir, 'node_modules', 'react', 'noop.js'))('react')
      reactDomServer = createRequire(path.join(pnpmDir, domDir, 'node_modules', 'react-dom', 'noop.js'))('react-dom/server')
      reactFrom = `pnpm:${reactDir}`
    }
  } catch {
    /* fallthrough */
  }
}
check('react resolved from installation', React !== null, reactFrom ?? 'not found')
const { renderToStaticMarkup } = reactDomServer ?? {}

// ---- mock primitives ----
// 注意：React 函数组件的 children 在 props.children 里，不在第二个参数。
// 侧边栏「永久删除」已改为 DOM 注入（不依赖原语），这里只需 Modal/Button。
const primitives = {
  Button: (props) => React.createElement('button', { variant: props?.variant }, props?.children ?? null),
  Modal: (props) =>
    React.createElement('div', { 'data-modal': props?.title ?? '' }, [props?.description ?? null, props?.footer ?? null, props?.children ?? null]),
}

/** 渲染失败不中断：返回 { ok, html | error }，把错误留给断言报告。 */
function safeRender(name, element) {
  try {
    return { ok: true, html: renderToStaticMarkup(element) }
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

// ---- capture the __ModuleLoader__ registration ----
let factory = null
globalThis.window = { __ModuleLoader__: { load(def) { factory = def.factory } } }

await import(new URL('../src/client.js', import.meta.url).href)
check('module loader captured factory', typeof factory === 'function')

const moduleRequire = (name) => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require: ${name}`)
}
const exports = factory(moduleRequire)
check('exports apply', typeof exports.apply === 'function')

// ---- apply against a mocked client ctx ----
const registered = new Map()
const ctx = {
  effect(fn) {
    return typeof fn === 'function' ? fn() : undefined
  },
  get: () => undefined,
  slots: {
    inject: (slotName, fn) => {
      const registration = fn()
      const arr = registered.get(slotName) ?? []
      arr.push(registration)
      registered.set(slotName, arr)
    },
    register: (decl, component) => ({ decl, component }),
  },
  locale: { register: () => () => {} },
  workspaces: { startSession: () => {} },
}
globalThis.document = {
  createElement: () => ({ id: '', textContent: '', setAttribute() {}, style: {} }),
  createElementNS: () => ({ setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} },
  body: null,
}
exports.apply(ctx)

for (const slotName of ['settings.section', 'shell.overlay']) {
  check(`slot registered: ${slotName}`, (registered.get(slotName) ?? []).length > 0)
}
check('settings section label = 归档管理', registered.get('settings.section')[0].decl.label() === '归档管理')
const t = (key, params) => {
  let text = { dialogTitle: '永久删除会话' }[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v))
  return text
}

// ---- render the settings section (default loading state) ----
const section = exports.ArchiveSettingsSection
const loadingRender = safeRender('section-loading', React.createElement(section, { useSessions: (selector) => selector(undefined), close: () => {} }))
check('section renders without throwing', loadingRender.ok, loadingRender.error)
if (loadingRender.ok) {
  check('section renders tab 归档管理', loadingRender.html.includes('归档管理'), loadingRender.html.slice(0, 200))
  check('section renders auto-archive card', loadingRender.html.includes('自动归档旧会话'), null)
  check('section renders purge-all button', loadingRender.html.includes('全部永久删除'), null)
  check('section renders other tabs', !loadingRender.html.includes('全部会话'), null)
}

// ---- render with initial archived data（展开分组，覆盖 分组 + 行内永久删除 路径）----
const now = Date.now()
const dataRender = safeRender(
  'section-data',
  React.createElement(exports.SettingsPage, {
    initialTab: 'archived',
    initialOpenGroups: new Set(['C:\\proj\\alpha']),
    initialList: [
      { id: 'session-archd0001', cwd: 'C:\\proj\\alpha', title: '已归档甲', mtimeMs: now - 3600_000, sizeBytes: 2048, archived: true, live: false, running: false },
      { id: 'session-archd0002', cwd: 'C:\\proj\\alpha', title: '已归档乙', mtimeMs: now - 7200_000, sizeBytes: 4096, archived: true, live: false, running: false },
      { id: 'session-live00001', cwd: 'C:\\proj\\alpha', title: '未归档丙', mtimeMs: now, sizeBytes: 1, archived: false, live: true, running: false },
    ],
    initialWorkspaces: [{ workspaceId: 'w1', title: 'alpha', path: 'C:\\proj\\alpha' }],
    initialListLoading: false,
    initialUnarchiveSupported: true,
    useSessions: (selector) => selector(undefined),
    close: () => {},
  }),
)
check('section with data renders without throwing', dataRender.ok, dataRender.error)
if (dataRender.ok) {
  check('data view renders archived titles', dataRender.html.includes('已归档甲') && dataRender.html.includes('已归档乙'), null)
  check('data view renders project group', dataRender.html.includes('alpha'), null)
  check('data view renders project filter option', dataRender.html.includes('所有项目'), null)
  check('data view renders sort label', dataRender.html.includes('排序方式'), null)
  check('data view hides unarchived row on archived tab', !dataRender.html.includes('未归档丙'), null)
  check('data view renders 永久删除 row buttons', dataRender.html.includes('永久删除'), null)
  check('data view renders manual scan entry', dataRender.html.includes('立即扫描'), null)
  check('data view renders zcodex result-line format', dataRender.html.includes('尚未运行过扫描。'), null)
  check('data view renders big page title', dataRender.html.includes('归档管理'), null)
  check('data view renders trash link (no tab bar)', dataRender.html.includes('回收站'), null)

// ---- render with project filter（zcodex 行为：选中项目自动展开该组会话）----
const filteredRender = safeRender(
  'section-filtered',
  React.createElement(exports.SettingsPage, {
    initialTab: 'archived',
    initialProjectFilter: 'alpha',
    initialList: [
      { id: 'session-archd0001', cwd: 'C:\\proj\\alpha', title: '已归档甲', mtimeMs: now - 3600_000, sizeBytes: 2048, archived: true, live: false, running: false },
      { id: 'session-archd0002', cwd: 'C:\\proj\\beta', title: '已归档乙', mtimeMs: now - 7200_000, sizeBytes: 4096, archived: true, live: false, running: false },
    ],
    initialWorkspaces: [{ workspaceId: 'w1', title: 'alpha', path: 'C:\\proj\\alpha' }],
    initialListLoading: false,
    initialUnarchiveSupported: true,
    useSessions: (selector) => selector(undefined),
    close: () => {},
  }),
)
check('project-filtered section renders without throwing', filteredRender.ok, filteredRender.error)
if (filteredRender.ok) {
  check('filter shows selected project sessions (auto-expanded)', filteredRender.html.includes('已归档甲'), null)
  check('filter hides other projects', !filteredRender.html.includes('已归档乙'), null)
  check('filter renders project dropdown value', filteredRender.html.includes('alpha'), null)
}
}

// ---- render the overlay (no pending request -> nothing) ----
const overlay = registered.get('shell.overlay')[0].component
const overlayRender = safeRender('overlay', React.createElement(overlay, { t }))
check('overlay renders empty without pending request', overlayRender.ok && overlayRender.html === '', overlayRender)

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall client render checks passed')
process.exit(0)
