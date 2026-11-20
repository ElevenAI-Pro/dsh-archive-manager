/**
 * T1 修复回归验证 — patched/src/index.js 的 dirSize / isRealDir 行为（Node 22/Windows）
 *
 * 方法：把 patched/src/index.js 的修复逻辑（dirSize + isRealDir）原样抽取独立可导入验证，
 * 复用 baseline 探针同样构型的 victim/junction 场景，断言修复后的期望值。
 * 期望：
 *   A2'（会话本体=junction）：dirSize 必须 = 0（修复前 800，穿透已封）
 *   A3'（内含 junction 子项）：dirSize 必须 = 自身 100（不穿透，行为保持）
 *   B1'（rm 会话=junction）：外域 secret 仍在 + patched.isRealDir(链接)=false（门禁拒绝）
 */
import { readdir, mkdir, writeFile, readFile, rm, lstat, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const BASE = join(process.cwd(), '_t1regress')

// ---- patched/src/index.js 修复版 dirSize（同构抽取） ----
async function dirSize(path) {
  let total = 0
  let entries
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) return 0
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

// ---- patched/src/index.js 修复版 isRealDir（同构抽取） ----
async function isRealDir(path) {
  try {
    const info = await lstat(path)
    return info.isDirectory() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

const log = (...a) => console.log(...a)

async function main() {
  await rm(BASE, { recursive: true, force: true }).catch(() => {})
  await mkdir(BASE, { recursive: true })

  const victim = join(BASE, 'victim')
  await mkdir(victim, { recursive: true })
  await writeFile(join(victim, 'secret.txt'), 'x'.repeat(500), 'utf8')
  await mkdir(join(victim, 'nested'), { recursive: true })
  await writeFile(join(victim, 'nested', 'deep.txt'), 'y'.repeat(300), 'utf8')

  console.log('===== T1 修复回归 =====')

  // A2'：会话本体=junction → 修复后 dirSize 必须 0
  const sessJ = join(BASE, 'sess-junction')
  await rm(sessJ, { recursive: true, force: true }).catch(() => {})
  execSync(`cmd /c mklink /J "${sessJ}" "${victim}"`, { stdio: 'pipe' })
  const a2p = await dirSize(sessJ)
  log(`A2' 修复版 dirSize(会话本体=junction) = ${a2p}  (期望 0)  → ${a2p === 0 ? 'PASS' : 'FAIL'}`)

  // A3'：真实会话内含 junction 子项 → 仍为自身 100（行为不回归）
  const sessN = join(BASE, 'sess-nested')
  await mkdir(sessN, { recursive: true })
  await writeFile(join(sessN, 'log.jsonl'), 'z'.repeat(100), 'utf8')
  await rm(join(sessN, 'extra'), { recursive: true, force: true }).catch(() => {})
  execSync(`cmd /c mklink /J "${join(sessN, 'extra')}" "${victim}"`, { stdio: 'pipe' })
  const a3p = await dirSize(sessN)
  log(`A3' 修复版 dirSize(会话含 junction 子项) = ${a3p}  (期望 100)  → ${a3p === 100 ? 'PASS' : 'FAIL'}`)

  // A1'：普通真实目录仍正常计量（行为不回归）
  const realDir = join(BASE, 'real')
  await mkdir(realDir, { recursive: true })
  await writeFile(join(realDir, 'f.txt'), 'z'.repeat(100), 'utf8')
  const a1p = await dirSize(realDir)
  log(`A1' 修复版 dirSize(普通目录) = ${a1p}  (期望 100)  → ${a1p === 100 ? 'PASS' : 'FAIL'}`)

  // isRealDir 门禁：junction=拒绝，真实目录=放行
  log(`isRealDir(sessJ) junction = ${await isRealDir(sessJ)} (期望 false)  → ${(await isRealDir(sessJ)) === false ? 'PASS' : 'FAIL'}`)
  log(`isRealDir(realDir) 普通目录 = ${await isRealDir(realDir)} (期望 true)  → ${(await isRealDir(realDir)) === true ? 'PASS' : 'FAIL'}`)

  // B1'：修复后仍保留「删链接本体不删目标」的既有安全行为（回归）
  const vB = join(BASE, 'v-b1')
  await mkdir(vB, { recursive: true })
  await writeFile(join(vB, 'secret.txt'), 'b'.repeat(20), 'utf8')
  const linkB = join(BASE, 'sess-b1')
  await rm(linkB, { recursive: true, force: true }).catch(() => {})
  execSync(`cmd /c mklink /J "${linkB}" "${vB}"`, { stdio: 'pipe' })
  // 修复后删除路径用 isRealDir 门禁：junction 不通过 → rm 不执行 → 链接原样保留
  if (await isRealDir(linkB)) await rm(linkB, { recursive: true, force: true })
  const secretAlive = (await readFile(join(vB, 'secret.txt'), 'utf8').catch(() => null)) !== null
  const linkLeft = (await stat(linkB).catch(() => null)) !== null
  log(`B1' 门禁跳过 rm 后：外域 secret 仍在=${secretAlive}、链接本体仍在=${linkLeft}  → 均应为 true`)

  console.log('\n===== 清理 =====')
  await rm(BASE, { recursive: true, force: true }).catch(() => {})
  log('[DONE]')
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })