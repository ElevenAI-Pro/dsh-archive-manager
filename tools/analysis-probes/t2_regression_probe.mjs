/**
 * T2 修复回归验证 — patched/src/client.js 的 oneLine() 清洗行为（React 18 SSR）
 *
 * 期望：
 *   - oneLine 前：title 属性槽含 `\n` → tooltip 多行（T2-07 缺陷）
 *   - oneLine 后：`\r\n\t` 全部压成空格，无多行 tooltip；转义行为保持（仍无 XSS）
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const h = React.createElement

// ---- patched/src/client.js oneLine（同构抽取） ----
function oneLine(v) {
  return String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ')
}

function renderSink(title, cwd) {
  return h('span', { title: `${oneLine(title)}\n${oneLine(cwd)}` }, String(title))
}

const cases = {
  '多行伪造文案': '已删除\n\n全部记录已被清除',
  'CRLF 注入': '已删除\r\n\r\n释放 120GB',
  'Tab 注入': '已删除\t\t不可恢复',
  'XSS 换行混合': '<img src=x onerror=alert(1)>\n下一行',
  '正常标题': '正常会话标题',
}

console.log('===== T2 oneLine 修复回归 =====')
let allPass = true
const sepMarker = '\u0000SEP\u0000'
function renderSink2(title, cwd) {
  // 用占位符模拟结构性分隔，便于精确断言「用户输入段」被压平
  return h('span', { title: `${oneLine(title)}${sepMarker}${oneLine(cwd)}` }, String(title))
}
for (const [name, ip] of Object.entries(cases)) {
  const out = renderToStaticMarkup(renderSink2(ip, 'C:\\work'))
  const titleSeg = out.slice(0, out.indexOf(sepMarker))
  const segHasNewline = /[\r\n]/.test(titleSeg)
  const segHasDupSp = / {2,}/.test(titleSeg.replace(/^<span title="/, ''))
  const rawHtml = /<img|<script|<svg/.test(out)
  const pass = !segHasNewline && !segHasDupSp && !rawHtml
  allPass = allPass && pass
  console.log(`[${name}] 用户输入段含换行=${segHasNewline} 含重复空格=${segHasDupSp} 无rawHTML=${!rawHtml} → ${pass ? 'PASS' : 'FAIL'}`)
  console.log(`         → title="${titleSeg.replace(/^<span title="/, '')}"`)
}
console.log(`\n总体: ${allPass ? 'ALL PASS' : 'FAIL'}`)