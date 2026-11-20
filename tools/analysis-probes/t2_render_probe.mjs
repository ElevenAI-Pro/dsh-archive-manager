/**
 * T2 专项深潜 · 客户端渲染注入面实测（React 18 / react-dom SSR）
 *
 * 复现对象：dsh-archive-management 1.2.1 的渲染链
 *   - client.js#L25  h = React.createElement（React 文本槽，宿主提供）
 *   - client.js#L214-L220  menuText()：`text.split('{title}').join(v)` 模板替换
 *   - client.js#L577  description: t('dialogBody', { title })
 *   - client.js#L1394/L1471  title 属性（tooltip）：`${title}\n${id}\n${cwd}`
 *
 * 攻击输入：磁盘/接口可控的 title / cwd / id（会话标题来自 meta.json、镜像缓存或
 * 宿主 record，均不在插件白名单内，攻击者=可创建会话标题的同一用户/被镜像污染的会话）。
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const MENU_ZH = {
  dialogBody: '将永久删除会话“{title}”的全部本地记录（含日志文件）。不进回收站，此操作无法恢复。',
}
function menuText(key, params, lang = 'zh') {
  let text = (MENU_ZH[lang] ?? MENU_ZH) [key] ?? key
  if (params !== null && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v))
  }
  return text
}

const h = React.createElement

// 与 client.js#L577 同构：title 经模板替换后进入 React 文本槽
function renderDialogBody(evilTitle) {
  const title = String(evilTitle ?? '')
  const description = menuText('dialogBody', { title })
  return h('section', null, h('h3', null, '永久删除'), h('p', { style: {} }, description))
}

// 与 client.js#L1394 同构：title 属性 tooltip（${title}\n${id}\n${cwd}）
function renderRowTitle(evilTitle, evilId, evilCwd) {
  return h('span', { title: `${evilTitle ?? '未命名'}\n${evilId}\n${evilCwd ?? ''}` }, evilTitle ?? '未命名')
}

const payloads = {
  'img-onerror': '<img src=x onerror=alert(1)>',
  'script-tag': '</p><script>alert(2)</script><p>',
  'attr-breakout': '" autofocus onfocus="alert(3)',
  'svg-onload': '<svg/onload=alert(4)>',
  'html-entity': '&lt;img src=x onerror=alert(5)&gt;',
  'plain-unicode': '会话标题"引号"【重音符`】$(x)',
  'newline-spoof': '已删除\n\n全部记录已被清除',
}

console.log('===== T2-1 文本槽（dialogBody 描述）=====')
for (const [name, p] of Object.entries(payloads)) {
  const out = renderToStaticMarkup(renderDialogBody(p))
  const hasRaw = out.includes('<img') || out.includes('<script') || out.includes('<svg')
  console.log(`[${name}] raw标记物注入=${hasRaw} →`, out)
}

console.log('\n===== T2-2 title 属性槽（tooltip）=====')
for (const [name, p] of Object.entries(payloads)) {
  const out = renderToStaticMarkup(renderRowTitle(p, 'session-uint-' + (Math.random()*1e6|0), 'C:\\work'))
  // 属性转义核查：React 对属性值做 attr 转义（& " < 等）
  const quoteBreak = /"[\s\S]*"[\s\S]*"/.test(out)
  const rawOn = out.includes('onfocus=') || out.includes('onerror=') || out.includes('onload=')
  console.log(`[${name}] 属性截断=${quoteBreak} 事件注入=${rawOn} →`, out.slice(0, 160))
}

console.log('\n===== T2-3 结论汇总 =====')
console.log('若 all raw=false 且 事件注入=false → React 文本槽/属性槽均按文档转义，客户端渲染面在基元层不可达')