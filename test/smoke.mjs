/**
 * Host-half behavioural smoke test (fork addition).
 * Runs the real src/index.js apply() against a fully mocked Cordis context and
 * a throwaway on-disk "session tree", exercising the fork's new routes:
 *   /config (GET+POST patch semantics), /delete-permanent (403/404/409/200),
 *   /auto-archive/run (retention + pinned/running skips), /purge-archived.
 * Run: ELECTRON_RUN_AS_NODE=1 <electron> test/smoke.mjs   (plain node works too)
 */
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mod = await import(new URL('../src/index.js', import.meta.url).href)

const failures = []
function check(name, cond, detail) {
  if (cond) console.log(`ok - ${name}`)
  else {
    failures.push(name)
    console.error(`FAIL - ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`)
  }
}

// ---- throwaway session tree ----
const home = mkdtempSync(join(tmpdir(), 'sd-smoke-'))
const headersById = new Map()
const runningSet = new Set()
function makeSession(id, { ageDays = 0, size = 32, parentSession } = {}) {
  const dir = join(home, 'sessions', 'proj', id)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'session.v3.jsonl.zstd')
  writeFileSync(file, 'x'.repeat(size))
  if (ageDays > 0) {
    const t = new Date(Date.now() - ageDays * 86_400_000)
    utimesSync(file, t, t)
  }
  headersById.set(id, parentSession === undefined ? { id, cwd: join(home, 'proj') } : { id, cwd: join(home, 'proj'), parentSession })
  return dir
}

const COLD = 'session-cold0001'
const RUNNING = 'session-run00001'
const PINNED = 'session-pinn0001'
const FRESH = 'session-fresh001'
const OLDAUTO = 'session-oldau001'
const ARCHIVED = 'session-arch0001'
runningSet.add(RUNNING)
const dirs = {
  [COLD]: makeSession(COLD),
  [RUNNING]: makeSession(RUNNING, { ageDays: 10 }),
  [PINNED]: makeSession(PINNED, { ageDays: 10 }),
  [FRESH]: makeSession(FRESH),
  [OLDAUTO]: makeSession(OLDAUTO, { ageDays: 10 }),
  [ARCHIVED]: makeSession(ARCHIVED, { ageDays: 3, size: 2048 }),
}

// ---- mocked Cordis context ----
const routes = new Map()
const disposals = []
const emitted = []
const archivedCalls = []
const state = { archivedSessionIds: [ARCHIVED], pinnedSessionIds: [PINNED] }

const ctx = {
  effect(fn, label) {
    const dispose = fn()
    if (typeof dispose === 'function') disposals.push(dispose)
    return dispose
  },
  emit: (event, id) => emitted.push([event, id]),
  get: () => undefined,
  webServer: { register: (route) => routes.set(route.path, route.handler) },
  sessionPersistence: {
    // 磁盘驱动：日志文件消失的会话自动从清单中排除（与真实持久化一致）
    list: async () =>
      Array.from(headersById.values()).filter((h) =>
        existsSync(join(home, 'sessions', 'proj', h.id, 'session.v3.jsonl.zstd')),
      ),
    locate: (header) => ({ path: join(home, 'sessions', 'proj', header.id, 'session.v3.jsonl.zstd') }),
  },
  workspaceRegistry: {
    archivedSessionIds: state.archivedSessionIds,
    archiveSession: async (id) => {
      archivedCalls.push(id)
      if (!state.archivedSessionIds.includes(id)) state.archivedSessionIds.push(id)
    },
    unarchiveSession: async (id) => {
      // 原地移除（保持数组引用稳定，mock 内部状态一致）
      const idx = state.archivedSessionIds.indexOf(id)
      if (idx !== -1) state.archivedSessionIds.splice(idx, 1)
    },
    list: () => [],
    get: () => undefined,
    requireState: () => state,
    enqueueOperation: async (fn) => fn(),
    setState: async (next) => {
      state.archivedSessionIds = next.archivedSessionIds
    },
  },
  agents: { get: (id) => (runningSet.has(id) ? { status: 'running' } : undefined) },
}

mod.apply(ctx)

function expectRoutes() {
  for (const p of [
    '/api/session-delete/list',
    '/api/session-delete/list-stream',
    '/api/session-delete/preview',
    '/api/session-delete/delete',
    '/api/session-delete/delete-permanent',
    '/api/session-delete/trash',
    '/api/session-delete/restore',
    '/api/session-delete/unarchive',
    '/api/session-delete/purge',
    '/api/session-delete/config',
    '/api/session-delete/auto-archive/run',
    '/api/session-delete/purge-archived',
  ]) {
    check(`route registered ${p}`, typeof routes.get(p) === 'function')
  }
}

async function call(pathname, { method = 'GET', withHeader = true, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    headers: withHeader ? { 'x-dsh-plugin': 'session-delete' } : {},
    url: pathname,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  const res = {
    statusCode: 0,
    bodyOut: '',
    writeHead(status) {
      this.statusCode = status
    },
    end(out) {
      this.bodyOut = out ?? ''
    },
  }
  const handler = routes.get(pathname)
  await handler(req, res)
  return { status: res.statusCode, body: res.bodyOut === '' ? null : JSON.parse(res.bodyOut) }
}

expectRoutes()

// ---- /config: defaults + patch semantics ----
{
  const r = await call('/api/session-delete/config')
  check('GET /config 200', r.status === 200)
  check('GET /config defaults', r.body.config.enabled === false && r.body.config.retentionDays === 7 && r.body.config.intervalMinutes === 30, r.body)
}
{
  const r = await call('/api/session-delete/config', { method: 'POST', withHeader: false, body: {} })
  check('POST /config without header -> 403', r.status === 403, r)
}
{
  const r1 = await call('/api/session-delete/config', { method: 'POST', body: { retentionDays: 30 } })
  check('POST /config retentionDays=30', r1.status === 200 && r1.body.config.retentionDays === 30, r1)
  const r2 = await call('/api/session-delete/config', { method: 'POST', body: { enabled: true } })
  check('patch: enabled toggle preserves retentionDays', r2.body.config.retentionDays === 30 && r2.body.config.enabled === true, r2)
  const bad = await call('/api/session-delete/config', { method: 'POST', body: { retentionDays: 0 } })
  check('POST /config invalid -> 400', bad.status === 400 && bad.body.error.code === 'INVALID_CONFIG', bad)
  const reset = await call('/api/session-delete/config', { method: 'POST', body: { enabled: false, retentionDays: 7 } })
  check('POST /config reset defaults', reset.body.config.enabled === false && reset.body.config.retentionDays === 7, reset)
  check('config persisted on disk', existsSync(join(home, 'trash', 'sessions', 'config.json')))
}

// ---- /delete-permanent ----
{
  const csrf = await call('/api/session-delete/delete-permanent', { method: 'POST', withHeader: false, body: { id: COLD } })
  check('delete-permanent without header -> 403', csrf.status === 403, csrf)
  const missing = await call('/api/session-delete/delete-permanent', { method: 'POST', body: { id: 'session-nope0001' } })
  check('delete-permanent unknown id -> 404', missing.status === 404 && missing.body.error.code === 'NOT_FOUND', missing)
  const bad = await call('/api/session-delete/delete-permanent', { method: 'POST', body: { id: 'bad id/with slash' } })
  check('delete-permanent invalid id -> 400', bad.status === 400 && bad.body.error.code === 'INVALID_ID', bad)
  const ok = await call('/api/session-delete/delete-permanent', { method: 'POST', body: { id: COLD } })
  check('delete-permanent cold -> 200', ok.status === 200 && ok.body.ok === true, ok)
  check('delete-permanent removed dir', !existsSync(dirs[COLD]))
  check('delete-permanent archived first', archivedCalls.includes(COLD))
  check('delete-permanent emitted removed', emitted.some(([ev, id]) => ev === 'api-session/removed' && id === COLD))
  const run = await call('/api/session-delete/delete-permanent', { method: 'POST', body: { id: RUNNING } })
  check('delete-permanent running -> 409', run.status === 409 && run.body.error.code === 'RUNNING', run)
  const audit = readFileSync(join(home, 'trash', 'sessions', 'audit.log'), 'utf8')
  check('audit has delete-permanent', audit.includes('"action":"delete-permanent"'))
}

// ---- /delete 软删除级联（fork：子代理跟随进回收站，可独立还原）----
{
  const P = 'session-softp001'
  const C = 'session-softc001'
  const dirP = makeSession(P)
  const dirC = makeSession(C, { parentSession: P })
  const r = await call('/api/session-delete/delete', { method: 'POST', body: { id: P } })
  check('soft delete parent cascades -> 200', r.status === 200 && r.body.ok === true && r.body.cascade === 1, r)
  check('soft delete removed both dirs', !existsSync(dirP) && !existsSync(dirC))
  const trashAfter = await call('/api/session-delete/trash')
  check('trash holds parent+child entries', trashAfter.status === 200 && trashAfter.body.items.some((i) => i.id === P) && trashAfter.body.items.some((i) => i.id === C), trashAfter.body)
  const parentEntry = trashAfter.body.items.find((i) => i.id === P).entry
  const rs = await call('/api/session-delete/restore', { method: 'POST', body: { entry: parentEntry } })
  check('restore parent -> 200', rs.status === 200 && rs.body.ok === true, rs)
  check('parent dir restored', existsSync(join(home, 'sessions', 'proj', P, 'session.v3.jsonl.zstd')))
  const dp = await call('/api/session-delete/delete-permanent', { method: 'POST', body: { id: P } })
  check('cleanup: restored parent permanently deleted -> 200', dp.status === 200, dp)
}
{
  const P4 = 'session-softp401'
  const C4 = 'session-softc401'
  makeSession(P4, { ageDays: 1 })
  makeSession(C4, { ageDays: 1, parentSession: P4 })
  runningSet.add(C4)
  const refused = await call('/api/session-delete/delete', { method: 'POST', body: { id: P4 } })
  check('soft delete refuses running child -> 409', refused.status === 409 && refused.body.error.code === 'RUNNING', refused)
  check('refusal leaves dirs untouched', existsSync(join(home, 'sessions', 'proj', P4)) && existsSync(join(home, 'sessions', 'proj', C4)))
  runningSet.delete(C4)
}

// ---- /debug 访问控制（fork P0）----
{
  const noH = await call('/api/session-delete/debug', { withHeader: false })
  check('GET /debug without header -> 403', noH.status === 403, noH)
  const withH = await call('/api/session-delete/debug', { withHeader: true })
  check('GET /debug with header -> 200', withH.status === 200 && withH.body.ok === true, withH)
}

// ---- /delete-permanent cascade（子代理级联，fork 全链路）----
{
  const PARENT = 'session-parent01'
  const CHILD = 'session-child001'
  const GRAND = 'session-grand001'
  const dirP = makeSession(PARENT)
  const dirC = makeSession(CHILD, { parentSession: PARENT })
  const dirG = makeSession(GRAND, { parentSession: CHILD })
  const ok = await call('/api/session-delete/delete-permanent', { method: 'POST', body: { id: PARENT } })
  check('cascade delete parent -> 200', ok.status === 200 && ok.body.ok === true, ok)
  check('cascade count = 2 (child + grandchild)', ok.body.cascade === 2, ok)
  check('cascade removed parent dir', !existsSync(dirP))
  check('cascade removed child dir', !existsSync(dirC))
  check('cascade removed grandchild dir', !existsSync(dirG))
  for (const id of [PARENT, CHILD, GRAND]) {
    check(`cascade emitted removed: ${id}`, emitted.some(([ev, rid]) => ev === 'api-session/removed' && rid === id))
  }
  const auditText = readFileSync(join(home, 'trash', 'sessions', 'audit.log'), 'utf8')
  check('audit has cascade record', auditText.includes('"cascade":2'))
}
{
  const PARENT2 = 'session-parent02'
  const CHILD2 = 'session-child002'
  makeSession(PARENT2, { ageDays: 1 })
  makeSession(CHILD2, { ageDays: 1, parentSession: PARENT2 })
  runningSet.add(CHILD2)
  const refused = await call('/api/session-delete/delete-permanent', { method: 'POST', body: { id: PARENT2 } })
  check('cascade refuses when a child is running -> 409', refused.status === 409 && refused.body.error.code === 'RUNNING', refused)
  check('refusal leaves dirs untouched', existsSync(join(home, 'sessions', 'proj', PARENT2)) && existsSync(join(home, 'sessions', 'proj', CHILD2)))
  runningSet.delete(CHILD2)
}

// ---- /auto-archive/run ----
{
  await call('/api/session-delete/config', { method: 'POST', body: { enabled: true, retentionDays: 7, intervalMinutes: 5 } })
  const r = await call('/api/session-delete/auto-archive/run', { method: 'POST', body: {} })
  check('auto-archive 200', r.status === 200 && r.body.ok === true, r)
  check('auto-archive archived the old unpinned idle one', r.body.archived === 1, r.body)
  check('auto-archive skipped running', r.body.skippedRunning === 1, r.body)
  check('auto-archive skipped pinned', r.body.skippedPinned === 1, r.body)
  check('auto-archive left fresh session alone', !state.archivedSessionIds.includes(FRESH))
  check('auto-archive marked old session', state.archivedSessionIds.includes(OLDAUTO))
  check('auto-archive did not delete anything', existsSync(dirs[OLDAUTO]))
}

// ---- /purge-archived ----
// 说明：delete-permanent 已把 COLD 归档（先归档后删文件的流水线），COLD 目录虽已
// 删除但仍留在归档集（运行期间有意保留 ghost），dir-missing 按 purged 计数——
// 与 deleteSession 的同款约定一致，故首次 purge = ARCHIVED + OLDAUTO + COLD = 3。
{
  const r = await call('/api/session-delete/purge-archived', { method: 'POST', body: {} })
  check('purge-archived 200', r.status === 200 && r.body.ok === true, r)
  check('purge-archived counts on-disk archived sessions', r.body.purged === 2, r.body)
  check('purge-archived freed bytes', r.body.freedBytes > 0, r.body)
  check('ARCHIVED dir gone', !existsSync(dirs[ARCHIVED]))
  check('OLDAUTO dir gone', !existsSync(dirs[OLDAUTO]))
  const again = await call('/api/session-delete/purge-archived', { method: 'POST', body: {} })
  check('purge-archived idempotent on disk (freed=0)', again.status === 200 && again.body.freedBytes === 0, again)
}

// ---- cleanup: disposals stop the auto-archive timer ----
for (const dispose of disposals.splice(0)) dispose()

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) FAILED`)
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
  } catch {
    /* Windows 上偶发句柄占用，留给系统临时目录清理 */
  }
  process.exit(1)
}
console.log('\nall host smoke checks passed')
try {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
} catch {
  /* 同上 */
}
process.exit(0)
