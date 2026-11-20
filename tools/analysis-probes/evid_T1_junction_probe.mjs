/**
 * T1 专项深潜 · junction 跟随语义实测（Node 22 / Windows） — v2
 *
 * 复现对象：dsh-archive-management 1.2.1 的
 *   A) dirSize（index.js#L107-L128）：readdir(withFileTypes) + entry.isDirectory() 递归 + stat(child)
 *   B) 删除/移动链：rm(dir,{recursive,force})、rename（index.js#L618/L899/L1088）
 *
 * v2 修正：
 *   1) junction 链接位绝不预创建（mklink /J 要求目标不存在）
 *   2) 每场景独立 victim，且 execSync 失败只标记 SKIP，不中断整轮
 *   3) 追加 symlink（文件与目录）对照，确认“跟随/不跟随”由类型判定主导
 */
import { readdir, stat, rm, mkdir, writeFile, readFile, rename, lstat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const BASE = process.env.T1_BASE ?? join(process.cwd(), '_t1probe')

// ---- 与 index.js#L107-L128 dirSize 逐行同构的复刻 ----
async function dirSize(path) {
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await dirSize(child)
    else if (entry.isFile()) {
      try {
        total += (await stat(child)).size
      } catch {
        /* 并发消失的文件忽略 */
      }
    }
  }
  return total
}

const log = (...a) => console.log(...a)

/** 建 junction；失败返回 null 并记录原因 */
async function makeJunction(link, target) {
  try {
    // mklink /J 的链接位必须不存在；先清理同名残留
    await rm(link, { recursive: true, force: true, maxRetries: 4 }).catch(() => {})
    execSync(`cmd /c mklink /J "${link}" "${target}"`, { stdio: 'pipe' })
    return true
  } catch (e) {
    log('[SKIP-junction] 创建失败，判定该场景无法测：', link, '→', String(e.message).split('\n')[0])
    return false
  }
}

async function main() {
  await rm(BASE, { recursive: true, force: true }).catch(() => {})
  await mkdir(BASE, { recursive: true })

  console.log('================= 场景准备 =================')
  // 外域 victim：文件 500B + 嵌套目录 300B
  const victim = join(BASE, 'victim')
  await mkdir(victim, { recursive: true })
  await writeFile(join(victim, 'victim-secret.txt'), 'x'.repeat(500), 'utf8')
  await mkdir(join(victim, 'nested'), { recursive: true })
  await writeFile(join(victim, 'nested', 'deep.txt'), 'y'.repeat(300), 'utf8')

  console.log('\n================= 实测定点 A：dirSize 是否“跟随” =================')
  // A1 对照组：真实目录
  const realDir = join(BASE, 'real-dir')
  await mkdir(realDir, { recursive: true })
  await writeFile(join(realDir, 'f1.txt'), 'z'.repeat(100), 'utf8')
  log('[A1 对照] dirSize(真实目录 real-dir)                  =', await dirSize(realDir), '(expect 100)')

  // A2 会话本体 = junction → 指向外域
  const sessJ = join(BASE, 'sess-junction')
  if (await makeJunction(sessJ, victim)) {
    log('[A2 攻击] dirSize(会话本体=junction→victim)          =', await dirSize(sessJ), '(若跟随=800；若不跟随=0)')
  }

  // A3 真实会话「内」放 junction 子项
  const sessN = join(BASE, 'sess-nested')
  await mkdir(sessN, { recursive: true })
  await writeFile(join(sessN, 'log.jsonl'), 'z'.repeat(100), 'utf8')
  if (await makeJunction(join(sessN, 'extra'), victim)) {
    log('[A3 攻击] dirSize(会话内含 junction 子项)            =', await dirSize(sessN), '(若跟随=100+800=900；否则只计自身100)')
  }

  // A4 Dirent 分类证据
  for (const p of [realDir, sessJ, sessN]) {
    const ents = await readdir(p, { withFileTypes: true }).catch(() => [])
    log(`[A4 Dirent] readdir(${p.split(BASE)[1]}) =`, ents.map((e) => `${e.name}[isDir:${e.isDirectory()},isFile:${e.isFile()},isSym:${e.isSymbolicLink()}]`).join(' '))
  }

  // A5 对照：真符号链接（同步能建一个看看）
  try {
    const sl = join(BASE, 'symlink-file')
    await rm(sl, { force: true, maxRetries: 3 }).catch(() => {})
    await symlink(join(victim, 'victim-secret.txt'), sl)
    const slSess = join(BASE, 'sess-symlink')
    await mkdir(slSess, { recursive: true })
    await writeFile(join(slSess, 'log.jsonl'), 'z'.repeat(100), 'utf8')
    await symlink(join(victim, 'nested'), join(slSess, 'ln-dir'))
    log('[A5 对照] dirSize(会话内含目录符号链接 ln-dir→nested) =', await dirSize(slSess), '(若跟随=100+300=400；否则只计自身100)')
    const d = await readdir(slSess, { withFileTypes: true })
    log('[A5 Dirent]', d.map((e) => `${e.name}[isDir:${e.isDirectory()},isSym:${e.isSymbolicLink()}]`).join(' '))
  } catch {
    log('[A5 SKIP] 符号链接场景不可测（需要在开发者模式，预期内）')
  }

  console.log('\n================= 实测定点 B：rm(recursive) 是否“跟随删除” =================')
  // B1 会话本体 = junction → rm 后外域内容是否被抹
  {
    const v = join(BASE, 'v-b1')
    await mkdir(v, { recursive: true })
    await writeFile(join(v, 'secret.txt'), 'b1'.repeat(10), 'utf8')
    const link = join(BASE, 'sess-b1')
    if (await makeJunction(link, v)) {
      await rm(link, { recursive: true, force: true })
      const targetAlive = (await stat(v).catch(() => null)) !== null
      const secretAlive = (await readFile(join(v, 'secret.txt'), 'utf8').catch(() => null)) !== null
      log(`[B1] rm(会话本体=junction) 后 → 外域目录仍在 = ${targetAlive} | 外域secret.txt仍在 = ${secretAlive}`)
      log(`[B1] 判定：rm 是否“跟随删除”外域内容 = ${!secretAlive}`)
    }
  }
  // B2 会话内 junction 子项 → rm 递归后外域内容是否被抹
  {
    const v = join(BASE, 'v-b2')
    await mkdir(v, { recursive: true })
    await writeFile(join(v, 'secret.txt'), 'b2'.repeat(10), 'utf8')
    const sess = join(BASE, 'sess-b2')
    await mkdir(sess, { recursive: true })
    await writeFile(join(sess, 'log.jsonl'), 'z'.repeat(10), 'utf8')
    if (await makeJunction(join(sess, 'extra'), v)) {
      await rm(sess, { recursive: true, force: true })
      const secretAlive = (await readFile(join(v, 'secret.txt'), 'utf8').catch(() => null)) !== null
      log(`[B2] rm(会话内含 junction 子项) 后 → 外域 secret.txt 仍在 = ${secretAlive}`)
      log(`[B2] 判定：递归删除是否沿 junction 进入外域 = ${!secretAlive}`)
    }
  }
  // B3 rename 语义：moveOneToTrash 把会话目录 rename 进回收站（index.js#L618）——junction 本体 vs 目标
  {
    const v = join(BASE, 'v-b3')
    await mkdir(v, { recursive: true })
    await writeFile(join(v, 'secret.txt'), 'b3'.repeat(10), 'utf8')
    const link = join(BASE, 'sess-b3')
    if (await makeJunction(link, v)) {
      const dst = join(BASE, 'trash-entry', 'data')
      try {
        await mkdir(join(BASE, 'trash-entry'), { recursive: true })
        await rename(link, dst)
        const targetAlive = (await stat(v).catch(() => null)) !== null
        const movedIsJunction = targetAlive && (await lstat(dst).catch(() => null)) !== null
        log(`[B3] rename(会话=junction→回收站) 后 → 外域原目录仍在 = ${targetAlive} | 回收站里的条目仍存在 = ${!!movedIsJunction}`)
        // 那回收站条目是 junction 还是目录？删它对目标有无影响
        if (movedIsJunction) {
          await rm(dst, { recursive: true, force: true })
          const after = (await readFile(join(v, 'secret.txt'), 'utf8').catch(() => null)) !== null
          log(`[B3] 再对回收站里的 junction 条目 rm(recursive) → 外域 secret.txt 仍在 = ${after}`)
        }
      } catch (e) {
        log('[B3 SKIP] rename 失败', String(e.message).split('\n')[0])
      }
    }
  }

  console.log('\n================= 清理 =================')
  await rm(BASE, { recursive: true, force: true }).catch(() => {})
  log('[DONE] 临时目录已清理')
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })