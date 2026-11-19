/**
 * dsh-archive-manager — Client half.
 *
 * 手写 __ModuleLoader__ 包壳（与 tsdown 产物同构），零构建步骤。
 * 槽位：
 *   settings.section  设置页「归档管理」页（管理入口）：
 *     · 归档管理（默认页签，仿 zcodex）—— 自动归档旧会话（开关 + 保留期 +
 *       扫描间隔 + 立即扫描）+ 已归档会话按项目分组清单（搜索/排序/多选）
 *       + 全部永久删除（红字两步确认）
 *     · 全部会话 —— 按工作区分组的全量清单，搜索/过滤/批量删除
 *     · 回收站 —— 按名称识别被删会话，多选批量还原 / 彻底删除 / 一键清空
 *   sidebar.workspaces 会话「…」菜单「永久删除」——轻量 DOM 注入（仿 Codex）：
 *     克隆菜单既有行为最后一项，位于内置「归档会话」之下、配色自动同步；
 *   shell.overlay —— 永久删除确认框（独立于菜单，菜单关闭后仍存活）
 *
 * 数据全部来自本机 Host API（/api/session-delete/*）；删除当前打开的会话后
 * 经 workspaces.startSession() 切到同工作区空白会话，UI 不悬空。
 */
window.__ModuleLoader__.load({
  id: 'dsh-archive-manager',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    // fork：官方 UI 原语（仅侧边栏菜单行 / 确认框需要）。宿主缺原语时只跳过
    // 这两处注册并打警告，设置页只用 react，不受影响。
    let primitives = null
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      primitives = null
    }

    const PREFIX = '/api/session-delete'
    const HDR = 'x-dsh-plugin'
    // 构建标记：随每次代码变更手动更新，经 /debug 上报用于确认页面运行的代码版本
    const BUILD = 'sd-0.6.0-20261119-rename'

    // ---------- 交互样式（注入 <style>，随插件停止移除） ----------
    const CSS = `
      @keyframes sdFade { from { opacity: 0; transform: translateY(2px) } to { opacity: 1; transform: translateY(0) } }
      @keyframes sdSpin { to { transform: rotate(360deg) } }
      .sd-fade { animation: sdFade .18s ease-out both }
      .sd-btn { transition: background .15s ease, border-color .15s ease, color .15s ease, transform .1s ease, opacity .15s ease }
      .sd-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-1)); border-color: var(--dsw-alias-border-l2) }
      .sd-btn:active:not(:disabled) { transform: scale(.96) }
      .sd-btn:disabled { opacity: .55; cursor: default }
      .sd-spin { display: inline-block; animation: sdSpin .8s linear infinite }
      /* 列表行：行间真实间距让相邻的选中背景彼此分开；选中/悬停样式统一在类里，
       * 避免 inline style 压掉 :hover（选中行悬停加深的反馈不能丢）。 */
      .sd-row { border-radius: 6px; margin-bottom: 3px; transition: background .14s ease, box-shadow .14s ease }
      .sd-row:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 6%, transparent) }
      /* 选中态三件套：品牌色底 + 3px 左侧强调条 + 1px 内描边——描边让选中行
       * 在密集列表里「浮」出来，与仅变灰的悬停态拉开层级；切换有 0.14s 过渡。 */
      .sd-row.sd-sel {
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
        box-shadow:
          inset 3px 0 0 var(--dsw-alias-brand-primary),
          inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent);
      }
      .sd-row.sd-sel:hover {
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
      }
      /* 复选框统一 14px：会话行/分组头/回收站行三处共用 .sd-check 类——
       * 尺寸规则挂在类上而非位置派生选择器上，分组头（非 .sd-row）不会漏；
       * 默认 13px 与显式 14px 混用正是「分组的选择框看起来更小」的原因。 */
      .sd-check { width: 14px; height: 14px; flex: none }
      /* 搜索框左侧内嵌放大镜（mask 着色，主题自动适配） */
      .sd-search {
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23888' stroke-width='1.3' stroke-linecap='round'><circle cx='7' cy='7' r='4.2'/><path d='M10.2 10.2L14 14'/></svg>");
        background-repeat: no-repeat;
        background-position: 9px center;
        background-size: 14px;
        padding-left: 30px;
      }
      .sd-chev { display: inline-flex; transition: transform .15s ease; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)) }
      /* 工作区分组头：标签化（小一号/加粗/次要色），吸顶 + 底部分隔线——
       * 长列表滚动时分组归属始终可见；与 13px/常规/主色的会话行形成清晰层级。 */
      .sd-grouphd {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 6px 5px 10px;
        margin-top: 8px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-2);
        cursor: pointer;
      }
      .sd-grouphd:first-child { margin-top: 0 }
      .sd-grouphd:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 5%, transparent) }
      /*
       * 滚动让渡：官方设置面板把 section 内容放进 .options 容器（overflow-y:auto、
       * 普通 block）——按设计各 section 整体长高、容器滚动，tab 栏会跟着滚走。
       * 本页激活时（slot 锚点的直接子元素是 .sd-page）把该容器变成有界 flex 列并
       * 关掉自身滚动，让页面内部的列表区接管滚动、头部区固定。
       * 选择器只用结构（data-slot 锚点 + 类名），不依赖官方 CSS-module 哈希类名。
       */
      div:has(> [data-slot="settings.section"] > .sd-page) {
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      /* 设置面板 nav 行：把回退的齿轮图标换成 16px 线性垃圾桶（currentColor mask） */
      button[data-sd-nav] > svg:first-of-type { display: none !important }
      button[data-sd-nav] > span:first-of-type::before {
        content: '';
        display: inline-block;
        width: 16px;
        height: 16px;
        margin-right: 7px;
        flex: none;
        vertical-align: -3px;
        background-color: currentColor;
        -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'><path d='M2.5 4.2h11M6.3 2.2h3.4M3.8 4.2l.55 8.5a1 1 0 0 0 1 .93h5.3a1 1 0 0 0 1-.93l.55-8.5M6.5 7v4.3M9.5 7v4.3'/></svg>") center / contain no-repeat;
        mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'><path d='M2.5 4.2h11M6.3 2.2h3.4M3.8 4.2l.55 8.5a1 1 0 0 0 1 .93h5.3a1 1 0 0 0 1-.93l.55-8.5M6.5 7v4.3M9.5 7v4.3'/></svg>") center / contain no-repeat;
      }
      @media (prefers-reduced-motion: reduce) {
        .sd-fade, .sd-spin { animation: none !important }
        .sd-btn, .sd-row { transition: none !important }
      }
    `

    const T = {
      bg: 'var(--dsw-alias-bg-layer-2)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      border: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      label: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      err: 'var(--dsw-alias-state-error-primary)',
    }

    // ---------- workspaces 客户端服务（apply 时注入） ----------
    let workspacesService = null
    // 插件 client ctx（apply 时记录）：用于删除/还原后刷新宿主会话列表 store。
    let clientCtx = null

    /**
     * 让操作方客户端的 list store 重拉 session.list 基线。
     * 删除冷会话后宿主不发任何帧，本客户端 store 里的残留行只能靠基线重拉
     * 剪掉（mergeOrderedBaseline 会移除基线中不存在的 id）——不刷新的话行虽
     * 被归档隐藏，却仍留在内存里。refresh 不在 ISessions 类型化接口上（具体
     * 类 SessionRuntime 的方法），故惰性解析 + 能力探测，失败静默。
     */
    function refreshClientSessionList() {
      try {
        const s = clientCtx?.sessions ?? clientCtx?.get?.('sessions')
        s?.refresh?.()?.catch?.(() => {})
      } catch {
        /* 能力缺失时跳过：归档隐藏本身已保证已删会话不复活 */
      }
    }

    // ---------- 本机 API ----------
    async function api(path, options) {
      const res = await fetch(path, options)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? `HTTP ${res.status}`), { data })
      return data
    }
    function post(path, body) {
      return api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [HDR]: 'session-delete' },
        body: JSON.stringify(body ?? {}),
      })
    }

    // =========================================================================
    // fork：侧边栏会话菜单「永久删除」（仿 Codex）——官方槽位 + 官方原语
    // =========================================================================

    const SD_NS = 'session-delete'

    const MENU_DICTS = {
      zh: {
        action: '永久删除',
        dialogTitle: '永久删除会话',
        dialogBody: '将永久删除会话“{title}”的全部本地记录（含日志文件）。不进回收站，此操作无法恢复。',
        confirm: '永久删除',
        cancel: '取消',
        busy: '删除中…',
        close: '关闭',
        errRunning: '该会话正在运行，无法删除。请等运行结束或重启 DSH 后再试。',
        errMissing: '未找到该会话的磁盘记录（可能已被删除）。',
        errUnknown: '删除失败（{code}）。',
        toastOk: '已永久删除「{title}」',
      },
      en: {
        action: 'Delete permanently',
        dialogTitle: 'Delete session permanently',
        dialogBody: 'Permanently delete all local records of session “{title}” (log file included). This skips the trash and cannot be undone.',
        confirm: 'Delete permanently',
        cancel: 'Cancel',
        busy: 'Deleting…',
        close: 'Close',
        errRunning: 'This session is running and cannot be deleted. Wait for it to finish or restart DSH first.',
        errMissing: 'No persisted record found for this session (it may already be deleted).',
        errUnknown: 'Delete failed ({code}).',
        toastOk: 'Permanently deleted “{title}”',
      },
    }

    /** t 缺席时的兜底翻译（官方 locale 注入失败也能用中文完成确认）。 */
    function menuText(key, params, lang = 'zh') {
      let text = (MENU_DICTS[lang] ?? MENU_DICTS.zh ?? {})[key] ?? key
      if (params !== null && typeof params === 'object') {
        for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v))
      }
      return text
    }

    /** 当前打开的会话 id（能力探测；取不到返回 null，调用方跳过自动切换）。 */
    function currentSessionId() {
      try {
        const s = clientCtx?.sessions ?? clientCtx?.get?.('sessions')
        const snap =
          typeof s?.getSnapshot === 'function'
            ? s.getSnapshot()
            : typeof s?.getStore === 'function'
              ? s.getStore()?.getSnapshot?.()
              : null
        return snap?.current ?? snap?.currentSessionId ?? null
      } catch {
        return null
      }
    }

    /** 待确认请求（外部 store）：菜单行发布，overlay 消费，二者无父子关系。 */
    const pendingDelete = { value: null, listeners: new Set() }

    function setPendingDelete(next) {
      pendingDelete.value = next
      for (const listener of [...pendingDelete.listeners]) {
        try {
          listener()
        } catch (error) {
          console.error('[dsh-archive-manager] pending listener', error)
        }
      }
    }

    function subscribePendingDelete(listener) {
      pendingDelete.listeners.add(listener)
      return () => pendingDelete.listeners.delete(listener)
    }

    // ---- 侧边栏注入诊断遥测：钩子把每一步上报到宿主 /debug，供离线排查 ----
    const hookDebug = {
      installed: false,
      installedAt: null,
      activated: 0,
      rowCaptured: null,
      scans: 0,
      lastContainers: 0,
      lastSnapshot: null,
      notes: [],
    }
    let debugPostTimer = null

    function debugNote(text, data) {
      hookDebug.notes.push({ at: new Date().toISOString(), text, data: data === undefined ? null : data })
      if (hookDebug.notes.length > 30) hookDebug.notes.splice(0, hookDebug.notes.length - 30)
      if (debugPostTimer !== null) return
      debugPostTimer = setTimeout(() => {
        debugPostTimer = null
        try {
          fetch(`${PREFIX}/debug`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [HDR]: 'session-delete' },
            body: JSON.stringify({ state: hookDebug, build: BUILD }),
          }).catch(() => {})
        } catch {}
      }, 800)
    }

    // ---- 侧边栏菜单 DOM 注入（仿 Codex：置于「归档会话」之下、常规配色） ----
    // 官方槽位固定渲染在内置「归档」之前且只能整行覆盖样式，位置与配色都达不
    // 到要求；改用 vtxf 同款轻量 DOM 注入：克隆菜单既有行追加为最后一项，样式
    // 与主题天然一致。任何一步失败都静默——菜单不出现，其余功能不受影响。

    const ICON_PATH_TRASH =
      'M2.5 4.2h11M6.3 2.2h3.4M3.8 4.2l.55 8.5a1 1 0 0 0 1 .93h5.3a1 1 0 0 0 1-.93l.55-8.5M6.5 7v4.3M9.5 7v4.3'
    const ICON_PATH_CHEVRON = 'M6 3.5 L10.5 8 L6 12.5'
    const ICON_PATH_FOLDER =
      'M1.8 4.6c0-.5.4-.9.9-.9h3.1l1.2 1.3h5.2c.5 0 .9.4.9.9v5.4c0 .5-.4.9-.9.9H2.7c-.5 0-.9-.4-.9-.9z'

    function svgIcon(d, size = 16) {
      const NS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('width', String(size))
      svg.setAttribute('height', String(size))
      const p = document.createElementNS(NS, 'path')
      p.setAttribute('d', d)
      p.setAttribute('fill', 'none')
      p.setAttribute('stroke', 'currentColor')
      p.setAttribute('stroke-width', '1.3')
      p.setAttribute('stroke-linecap', 'round')
      p.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(p)
      return svg
    }

    /** React 版线性图标（DOM 版 svgIcon 不能塞进 React 树——原生节点不是合法 child）。 */
    function svgEl(d, size = 16) {
      const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size }, h('path', { d, ...stroke }))
    }

    function fiberOf(el) {
      try {
        for (const key of Object.keys(el)) if (key.indexOf('__reactFiber$') === 0) return el[key]
      } catch {}
      return null
    }

    /**
     * 会话行组件判定。0.2.2-rc.5 实测行 props：
     *   node / currentId / now / onOpen / onRenameRequest / renderSlot /
     *   renderFactorySlot / useContextMenu / useContextMenuTarget / onReveal
     * （旧版 vtxf 依赖的 onArchive 已不存在——归档走 contextMenu 机制）。
     * 用 node.id + 行为回调三选一判定，避免误配工作区分组行。
     */
    function isSessionRowProps(p) {
      return (
        p !== null &&
        typeof p === 'object' &&
        p.node !== null &&
        p.node !== undefined &&
        typeof p.node.id === 'string' &&
        (typeof p.onOpen === 'function' || typeof p.useContextMenu === 'function' || typeof p.onRenameRequest === 'function')
      )
    }

    function sessionRowPropsFromFiber(startFiber) {
      let fiber = startFiber
      let guard = 0
      while (fiber !== null && fiber !== undefined && guard++ < 40) {
        const p = fiber.memoizedProps
        if (isSessionRowProps(p)) {
          return { id: p.node.id, title: String(p.node.title == null ? '' : p.node.title) }
        }
        fiber = fiber.return
      }
      return null
    }

    function sessionRowTarget(rowEl) {
      return sessionRowPropsFromFiber(fiberOf(rowEl))
    }

    const ARCHIVE_LABEL_RE = /归档会话|Archive\s*session/i

    /** 在容器里找内置「归档会话」按钮（菜单最后一项；我们的行要排在它下面）。 */
    function findArchiveButton(root) {
      for (const btn of root.querySelectorAll('button')) {
        if (ARCHIVE_LABEL_RE.test((btn.textContent ?? '').trim())) return btn
      }
      return null
    }

    /** 行结构：容器 > 行 wrap > button；取包含 ≥2 行的那层为菜单行容器。 */
    function menuContainerOf(archiveBtn) {
      const wrap = archiveBtn.parentElement
      const container = wrap !== null ? wrap.parentElement : null
      if (container === null) return null
      if (container.querySelectorAll('button').length >= 2) return container
      const up = container.parentElement
      if (up !== null && up.querySelectorAll('button').length >= 2) return up
      return container
    }

    /**
     * 常驻 DOM 钩子（v2，更耐版本差异）：
     *   - 左键/右键/中键按下会话行时经 fiber 记下目标（右键也能工作）；
     *   - 菜单出现后定位内置「归档会话」按钮，克隆它所在行、改文案为
     *     「永久删除」（常规配色、垃圾桶图标），追加为菜单最后一项——
     *     恰好位于「归档会话」之下；
     *   - MutationObserver + 激活后多轮延迟扫描双保险，覆盖「菜单只挂载
     *     一次、之后靠显隐」的实现；任何一步失败都静默。
     */
    function startSidebarMenuHook(lang) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || document.body === null) {
        debugNote('hook not installed (env missing)')
        return () => {}
      }
      hookDebug.installed = true
      hookDebug.installedAt = new Date().toISOString()
      debugNote('hook installed')
      let pendingRow = null
      let lastInjectedKey = ''

      /** 事件目标 → 会话行：先试 role 选择器，失败直接沿 fiber 向上找行 props。 */
      function findSessionFrom(target) {
        if (target instanceof Element) {
          const rowEl = target.closest('[role="treeitem"]')
          if (rowEl !== null) {
            const viaRole = sessionRowTarget(rowEl)
            if (viaRole !== null) return viaRole
          }
        }
        const viaFiber = sessionRowPropsFromFiber(fiberOf(target))
        if (viaFiber !== null) debugNote('row via fiber walk', viaFiber.id)
        return viaFiber
      }

      function scanAndInject() {
        if (pendingRow === null || Date.now() - pendingRow.ts > 4000) return
        const key = `${pendingRow.id}:${pendingRow.ts}`
        if (key === lastInjectedKey) return
        hookDebug.scans += 1
        // 唯一锚点：内置「归档会话」按钮所在的行容器——绝不多容器重复注入
        let container = null
        let wrap = null
        for (const btn of document.querySelectorAll('button')) {
          if (ARCHIVE_LABEL_RE.test((btn.textContent ?? '').trim())) {
            const c = menuContainerOf(btn)
            if (c !== null) {
              container = c
              wrap = btn.parentElement
              break
            }
          }
        }
        if (container === null || wrap === null) {
          debugNote('scan: no open menu container', { scans: hookDebug.scans })
          return
        }
        hookDebug.lastContainers = 1
        if (container.getAttribute('data-sd-permanent') === '1') return
        // 清掉历史残留，保证菜单里只有一条「永久删除」
        for (const stale of container.querySelectorAll('[data-sd-row]')) stale.remove()
        const clone = wrap.cloneNode(true)
        clone.removeAttribute('id')
        clone.setAttribute('data-sd-row', '1')
        const btn = clone.querySelector('button')
        if (btn === null) return
        // 永久删除没有快捷键：移除克隆行里的快捷键提示（Ctrl + Shift + A 等）
        const shortcutRe = /(Ctrl|Alt|Shift|Meta|Cmd|⌘|⌥|⇧)/i
        for (const span of Array.from(btn.querySelectorAll(':scope > span'))) {
          if (span.children.length === 0 && shortcutRe.test((span.textContent ?? '').trim())) span.remove()
        }
        for (const kbd of Array.from(btn.querySelectorAll('kbd'))) kbd.remove()
        let labelSpan = null
        for (const span of btn.querySelectorAll(':scope > span')) {
          if (span.children.length === 0 && (span.textContent ?? '').trim() !== '') {
            labelSpan = span
            break
          }
        }
        const label = menuText('action', undefined, lang)
        if (labelSpan !== null) {
          labelSpan.textContent = label
        } else {
          for (const node of Array.from(btn.childNodes)) {
            if (node.nodeType === 3 && (node.textContent ?? '').trim() !== '') node.remove()
          }
          btn.appendChild(document.createTextNode(label))
        }
        const oldSvg = btn.querySelector('svg')
        const icon = svgIcon(ICON_PATH_TRASH, 16)
        if (oldSvg !== null && oldSvg.parentNode !== null) oldSvg.parentNode.replaceChild(icon, oldSvg)
        else btn.insertBefore(icon, btn.firstChild)
        const capturedRow = pendingRow
        btn.addEventListener('click', (event) => {
          event.stopPropagation()
          event.preventDefault()
          try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
          } catch {}
          setPendingDelete({ sessionId: capturedRow.id, displayTitle: capturedRow.title })
        })
        container.appendChild(clone)
        container.setAttribute('data-sd-permanent', '1')
        lastInjectedKey = key
        debugNote('injected below archive (no shortcut, single row)', capturedRow.id)
        console.log('[dsh-archive-manager] 永久删除已注入会话菜单（无快捷键）：', capturedRow.id)
      }

      function activate(event) {
        hookDebug.activated += 1
        try {
          const found = findSessionFrom(event.target)
          if (found !== null) {
            pendingRow = { ...found, ts: Date.now() }
            hookDebug.rowCaptured = { id: found.id, at: new Date().toISOString() }
            debugNote('row captured', found.id)
            for (const delay of [30, 80, 160, 300, 500, 800]) setTimeout(scanAndInject, delay)
          } else if (hookDebug.activated <= 3) {
            // 前几次失败带一份 fiber 采样，离线分析行组件的真实 props 形状
            const sample = []
            let fiber = fiberOf(event.target)
            let guard = 0
            while (fiber !== null && fiber !== undefined && guard++ < 8) {
              const p = fiber.memoizedProps
              sample.push({
                keys: p !== null && typeof p === 'object' ? Object.keys(p).slice(0, 10) : typeof p,
                hasNode: p !== null && typeof p === 'object' && p.node !== undefined,
              })
              fiber = fiber.return
            }
            debugNote('activation miss (fiber sample)', sample)
          }
        } catch (error) {
          debugNote('activation error', String(error?.message ?? error))
        }
      }
      for (const type of ['pointerdown', 'mousedown', 'click', 'contextmenu']) {
        document.addEventListener(type, activate, true)
      }

      const observer = new MutationObserver(() => scanAndInject())
      observer.observe(document.body, { childList: true, subtree: true })
      return () => {
        for (const type of ['pointerdown', 'mousedown', 'click', 'contextmenu']) {
          document.removeEventListener(type, activate, true)
        }
        observer.disconnect()
      }
    }

    /** 确认框：一次请求一个实例，进行中/错误状态随实例消亡。 */
    function PermanentDeleteConfirm({ request, t }) {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const close = React.useCallback(() => {
        if (busy) return
        setPendingDelete(null)
      }, [busy])
      const confirm = React.useCallback(() => {
        setBusy(true)
        setError('')
        post(`${PREFIX}/delete-permanent`, { id: request.sessionId })
          .then(() => {
            setPendingDelete(null)
            try {
              if (currentSessionId() === request.sessionId) workspacesService?.startSession?.()
            } catch {
              /* 切换失败不影响删除结果 */
            }
            refreshClientSessionList()
          })
          .catch((e) => {
            setBusy(false)
            const code = e?.data?.error?.code
            setError(
              code === 'RUNNING'
                ? t('errRunning')
                : code === 'NOT_FOUND'
                  ? t('errMissing')
                  : menuText('errUnknown', { code: code ?? e?.message ?? '' }),
            )
          })
      }, [request, t])
      const title = request.displayTitle === '' ? request.sessionId : request.displayTitle
      const alert =
        error === ''
          ? null
          : h('div', { role: 'alert', style: { color: T.err, fontSize: 12, lineHeight: '18px', wordBreak: 'break-word' } }, error)
      return h(
        primitives.Modal,
        {
          open: true,
          onClose: close,
          closeLabel: t('close'),
          title: t('dialogTitle'),
          description: t('dialogBody', { title }),
          footer: h(React.Fragment, null, [
            h(primitives.Button, { key: 'cancel', variant: 'outline', disabled: busy, onClick: close }, t('cancel')),
            h(
              primitives.Button,
              { key: 'ok', variant: 'outline', disabled: busy, onClick: confirm, style: { color: T.err } },
              busy ? t('busy') : t('confirm'),
            ),
          ]),
        },
        alert,
      )
    }

    /** `shell.overlay` 条目：无待确认请求时渲染 null。 */
    function PermanentDeleteOverlay(props) {
      const t = typeof props?.t === 'function' ? props.t : menuText
      const request = React.useSyncExternalStore(subscribePendingDelete, () => pendingDelete.value, () => pendingDelete.value)
      if (request === null) return null
      return h(PermanentDeleteConfirm, { key: request.sessionId, request, t })
    }

    // ---------- 批量删除（返回统计与成功 id；命中当前会话时自动切走） ----------
    async function deleteMany(ids, currentId, onProgress) {
      let ok = 0
      let failed = 0
      let message = null
      const okIds = []
      let deletedCurrent = false
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i]
        try {
          await post(`${PREFIX}/delete`, { id })
          ok += 1
          okIds.push(id)
          if (id === currentId) deletedCurrent = true
        } catch (e) {
          failed += 1
          if (message === null) message = `${shortId(id)}：${e?.message ?? e}`
        }
        if (onProgress) onProgress(i + 1, ids.length)
      }
      if (deletedCurrent && workspacesService) {
        try {
          workspacesService.startSession()
        } catch {}
      }
      return { ok, failed, message, okIds }
    }

    // ---------- 格式化 ----------
    function fmtSize(b) {
      if (b == null) return '—'
      if (b < 1024) return `${b} B`
      if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
      if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
      return `${(b / 1024 ** 3).toFixed(2)} GB`
    }
    function fmtAgo(ms) {
      if (!ms) return '—'
      const s = Math.floor((Date.now() - ms) / 1000)
      if (s < 60) return '刚刚'
      const m = Math.floor(s / 60)
      if (m < 60) return `${m} 分钟前`
      const hh = Math.floor(m / 60)
      if (hh < 48) return `${hh} 小时前`
      return `${Math.floor(hh / 24)} 天前`
    }
    function fmtDate(ms) {
      if (!ms) return '—'
      const d = new Date(ms)
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    }
    function shortId(id) {
      return String(id ?? '').replace(/^session-/, '').slice(0, 8)
    }

    // ---------- 样式片段 ----------
    const btnBase = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      border: `1px solid ${T.border}`,
      borderRadius: 6,
      background: 'transparent',
      color: T.label,
      fontSize: 13,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }
    const smallBtn = {
      ...btnBase,
      padding: '3px 9px',
      fontSize: 12,
    }
    const inputStyle = {
      padding: '4px 8px',
      border: `1px solid ${T.border}`,
      borderRadius: 6,
      background: T.layer1,
      color: T.label,
      fontSize: 13,
      outline: 'none',
      minWidth: 0,
    }
    const tagStyle = (color) => ({
      fontSize: 11,
      color,
      border: `1px solid ${color}`,
      borderRadius: 4,
      padding: '0 4px',
      lineHeight: '15px',
      flexShrink: 0,
      opacity: 0.9,
    })
    /**
     * 统一操作反馈通知：状态点 + 标题 + 详情 + 关闭。
     * ok 6 秒自动消失；warn/err 常驻直到手动关闭或下一次操作。
     */
    function NoticeBanner({ notice, onClose }) {
      if (!notice) return null
      const color = notice.kind === 'err' ? T.err : notice.kind === 'warn' ? T.warn : T.ok
      return h(
        'div',
        {
          className: 'sd-fade',
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            margin: '10px 0 0',
            padding: '7px 10px',
            borderRadius: 8,
            flex: 'none',
            background: `color-mix(in srgb, ${color} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color} 30%, ${T.border})`,
          },
        },
        [
          h('span', { key: 'dot', style: { width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 5 } }),
          h(
            'div',
            { key: 'body', style: { flex: 1, minWidth: 0 } },
            [
              h('div', { key: 't', style: { fontSize: 13, fontWeight: 600, color: T.label, lineHeight: '20px', wordBreak: 'break-word' } }, notice.title),
              notice.detail
                ? h('div', { key: 'd', style: { fontSize: 12, color: T.secondary, lineHeight: '18px', marginTop: 2, wordBreak: 'break-word' } }, notice.detail)
                : null,
            ].filter(Boolean),
          ),
          h(
            'button',
            {
              key: 'x',
              className: 'sd-btn',
              onClick: onClose,
              title: '关闭',
              style: { border: 'none', background: 'transparent', color: T.secondary, cursor: 'pointer', padding: '0 2px', fontSize: 12, lineHeight: '18px', flexShrink: 0 },
            },
            '✕',
          ),
        ],
      )
    }

    /** 单条两步确认删除按钮：第一次点击武装（变红），4 秒内再点执行。 */
    function ArmDeleteButton({ armed, onArm, onFire, busy, label = '删除', hint, armedLabel = '确认删除' }) {
      return h(
        'button',
        {
          className: 'sd-btn',
          style: {
            ...smallBtn,
            background: armed ? T.err : 'transparent',
            borderColor: armed ? T.err : T.border,
            color: armed ? '#fff' : T.label,
            fontWeight: armed ? 600 : 400,
          },
          disabled: busy,
          title: hint,
          onClick: armed ? onFire : onArm,
        },
        armed ? armedLabel : label,
      )
    }

    // =========================================================================
    // 设置页
    // =========================================================================
    function SettingsPage(props) {
      const currentId = props?.currentId

      // 可选 initial* 用于测试注入（生产恒为 undefined → 走 fetch 加载），
      // 让渲染测试能确定性覆盖「有数据」的分支（页脚/行/分组头等）。
      const [tab, setTab] = useState(props?.initialTab ?? 'archived') // archived | all | trash
      const [list, setList] = useState(props?.initialList ?? null)
      const [workspaces, setWorkspaces] = useState(props?.initialWorkspaces ?? [])
      const [trash, setTrash] = useState(props?.initialTrash ?? null)
      // 按数据域独立的加载/错误状态：回收站后台刷新不会干扰会话页签的按钮与错误提示
      const [listLoading, setListLoading] = useState(props?.initialListLoading ?? false)
      const [listError, setListError] = useState(null)
      // 流式清单进度：{ count, total }——count 为已到达的会话行数，total 来自
      // 首行 meta。仅首次加载（list === null）时展示，静默刷新不显示。
      const [listProgress, setListProgress] = useState(props?.initialListProgress ?? null)
      const [trashLoading, setTrashLoading] = useState(props?.initialTrashLoading ?? false)
      const [trashError, setTrashError] = useState(null)
      // 宿主 /list 上报的在线解除归档能力（registry 内部状态机可用性）；
      // 旧版 DSH 为 false：隐藏还原入口，保留离线 unhide 指引
      const [unarchiveSupported, setUnarchiveSupported] = useState(props?.initialUnarchiveSupported ?? true)
      const [query, setQuery] = useState('')
      const [filter, setFilter] = useState('active') // active | archived | stale30 | all（仅 all 页签）
      const [selected, setSelected] = useState(new Set())
      const [busy, setBusy] = useState(false)
      const [progress, setProgress] = useState(null)
      const [notice, setNotice] = useState(null) // { kind: 'ok'|'warn'|'err', title, detail, at }
      const [arm, setArm] = useState(null) // 单条两步确认的目标（会话 id 或回收站条目名）
      const [purgeAllArmed, setPurgeAllArmed] = useState(false)
      // fork（仿 zcodex）：自动归档配置与状态
      const [aaConfig, setAaConfig] = useState(null) // { enabled, retentionDays, intervalMinutes }
      const [aaBusy, setAaBusy] = useState(false)
      const [lastRun, setLastRun] = useState(null)
      const [sortBy, setSortBy] = useState('mtime') // mtime | createdAt | size
      const [purgeArchArmed, setPurgeArchArmed] = useState(false)
      const [projectFilter, setProjectFilter] = useState(props?.initialProjectFilter ?? '') // '' = 所有项目（归档管理页签）
      const [openGroups, setOpenGroups] = useState(() => props?.initialOpenGroups ?? new Set()) // 默认全部收起（仿 zcodex）

      // ok 类通知 6 秒自动消失（warn/err 常驻，直到手动关闭或下一次操作）
      useEffect(() => {
        if (!notice || notice.kind !== 'ok') return
        const timer = setTimeout(() => setNotice(null), 6000)
        return () => clearTimeout(timer)
      }, [notice?.at])

      /**
       * 流式拉取全量清单（/list-stream，NDJSON 逐行）：
       * 首行 meta 带 total（即时知道总量）与 workspaces；随后每算完一个会话推
       * 一行。行到达即更新计数（首次加载时居中动画显示「已加载 N / M」），
       * 全部到齐后客户端按 mtimeMs 降序排序一次性渲染（与旧 /list 的服务端
       * 排序同序，避免流式期间行序闪跳）。已有数据时静默刷新：保留旧列表，
       * 仅右上角 ↻ 旋转。
       */
      async function loadList() {
        setListLoading(true)
        setListError(null)
        if (list === null) setListProgress({ count: 0, total: null })
        try {
          const resp = await fetch(`${PREFIX}/list-stream`)
          if (!resp.ok || !resp.body) {
            let message = `HTTP ${resp.status}`
            try {
              const data = await resp.json().catch(() => ({}))
              if (data?.error?.message) message = data.error.message
            } catch {
              /* 非 JSON 错误体保留 HTTP 状态码文案 */
            }
            throw new Error(message)
          }
          const rows = []
          const reader = resp.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          for (;;) {
            const { done, value } = await reader.read()
            if (value) buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.trim()) continue
              const msg = JSON.parse(line)
              if (msg.type === 'meta') {
                setWorkspaces(msg.workspaces ?? [])
                setUnarchiveSupported(msg.unarchiveSupported === true)
                setListProgress((p) => ({ count: p?.count ?? 0, total: msg.total }))
              } else if (msg.type === 'session') {
                rows.push(msg.session)
                setListProgress((p) => ({ count: rows.length, total: p?.total ?? null }))
              } else if (msg.type === 'error') {
                throw new Error(String(msg.message ?? '流式加载失败'))
              }
              // 'done'：循环自然结束，无需处理
            }
            if (done) break
          }
          rows.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
          setList(rows)
        } catch (e) {
          setListError(String(e?.message ?? e))
        } finally {
          setListLoading(false)
          setListProgress(null)
        }
      }
      async function loadTrash() {
        setTrashLoading(true)
        setTrashError(null)
        try {
          const data = await api(`${PREFIX}/trash`)
          setTrash(data.items ?? [])
        } catch (e) {
          setTrashError(String(e?.message ?? e))
        } finally {
          setTrashLoading(false)
        }
      }

      // ---------- fork：自动归档 / 永久删除动作 ----------
      /** 读取自动归档配置与上次扫描结果（失败不阻塞列表，控件按未加载态禁用）。 */
      async function loadConfig() {
        try {
          const data = await api(`${PREFIX}/config`)
          setAaConfig(data.config ?? null)
          setLastRun(data.lastRun ?? null)
        } catch {
          /* 静默：控件保持默认值 */
        }
      }
      async function fireSaveConfig(patch) {
        setAaBusy(true)
        try {
          const data = await post(`${PREFIX}/config`, patch)
          setAaConfig(data.config ?? null)
          setNotice({ kind: 'ok', title: '自动归档设置已保存', detail: null, at: at() })
        } catch (e) {
          setNotice({ kind: 'err', title: '保存失败', detail: String(e?.message ?? e), at: at() })
        } finally {
          setAaBusy(false)
        }
      }
      async function fireRunScan() {
        setAaBusy(true)
        try {
          const r = await post(`${PREFIX}/auto-archive/run`, {})
          setLastRun(r)
          setNotice({
            kind: r.failed > 0 ? 'warn' : 'ok',
            title: `扫描完成：成功 ${r.archived} 项，失败 ${r.failed} 项，跳过 ${(r.skippedRunning ?? 0) + (r.skippedPinned ?? 0)} 项`,
            detail: `跳过运行中 ${r.skippedRunning ?? 0} · 置顶 ${r.skippedPinned ?? 0} · 已归档 ${r.skippedArchived ?? 0}`,
            at: at(),
          })
          await loadList()
        } catch (e) {
          setNotice({ kind: 'err', title: '扫描失败', detail: String(e?.message ?? e), at: at() })
        } finally {
          setAaBusy(false)
        }
      }
      /** 全部永久删除（zcodex 红色按钮）：一步抹掉全部已归档会话，不经回收站。 */
      async function firePurgeArchivedAll() {
        setPurgeArchArmed(false)
        setBusy(true)
        try {
          const r = await post(`${PREFIX}/purge-archived`, {})
          const skipped = r.skippedRunning ?? 0
          if ((r.failed ?? 0) > 0) {
            setNotice({
              kind: 'warn',
              title: `已永久删除 ${r.purged} 个 · ${r.failed} 个失败`,
              detail: `跳过运行中 ${skipped} · 首条失败：${r.failures?.[0]?.message ?? ''}`,
              at: at(),
            })
          } else {
            setNotice({
              kind: 'ok',
              title: `已永久删除 ${r.purged} 个已归档会话 · 释放 ${fmtSize(r.freedBytes ?? 0)}`,
              detail: skipped > 0 ? `跳过运行中 ${skipped} 个` : '已彻底抹除，不经回收站',
              at: at(),
            })
          }
          setSelected(new Set())
          await loadList()
          loadTrash()
          refreshClientSessionList()
        } catch (e) {
          setNotice({ kind: 'err', title: '全部永久删除失败', detail: String(e?.message ?? e), at: at() })
        } finally {
          setBusy(false)
        }
      }
      /** 行内单条永久删除（两步确认后进入；不经回收站）。 */
      async function fireSinglePermanentDelete(id) {
        setArm(null)
        setBusy(true)
        const title = (list ?? []).find((s) => s.id === id)?.title
        try {
          await post(`${PREFIX}/delete-permanent`, { id })
          setNotice({
            kind: 'ok',
            title: `已永久删除「${title || shortId(id)}」`,
            detail: `释放 ${fmtSize(freedOf([id]))} · 已彻底抹除，不经回收站`,
            at: at(),
          })
          removeDeletedLocally([id])
        } catch (e) {
          setNotice({ kind: 'err', title: '永久删除失败', detail: String(e?.message ?? e), at: at() })
        } finally {
          setBusy(false)
          setSelected(new Set())
        }
      }

      useEffect(() => {
        setNotice(null)
        setArm(null)
        setSelected(new Set())
        // 仅首次（数据为 null）拉取；已有数据直接展示——删除/还原后各动作
        // 已显式调 loadList/loadTrash 同步，页签来回切换不再重拉（要刷新点 ↻）。
        if (tab === 'trash') {
          if (trash === null) loadTrash()
          return
        }
        if (tab === 'archived' && aaConfig === null) loadConfig()
        if (list === null) {
          loadList()
          // 预载回收站计数：首开即有「回收站 (N)」徽标，删除后能立即递增
          if (trash === null) loadTrash()
        }
      }, [tab])

      // 4 秒未确认自动解除武装
      useEffect(() => {
        if (arm === null && !purgeAllArmed && !purgeArchArmed) return
        const t = setTimeout(() => {
          setArm(null)
          setPurgeAllArmed(false)
          setPurgeArchArmed(false)
        }, 4000)
        return () => clearTimeout(t)
      }, [arm, purgeAllArmed, purgeArchArmed])

      // ---------- 动作 ----------
      /** 删除成功后本地移除对应行，并同步回收站状态（页签徽标即时反映新删条目）。 */
      function removeDeletedLocally(okIds) {
        if (okIds.length === 0) return
        if (list !== null) {
          const gone = new Set(okIds)
          setList(list.filter((s) => !gone.has(s.id)))
        }
        loadTrash() // 1ms 级接口；trash 从 null→有值 后「回收站 (N)」徽标立即出现/更新
        refreshClientSessionList() // 剪掉本客户端 list store 里的残留行
      }
      /** 在线解除归档成功后本地把对应行标记为未归档：离开归档页签、徽标即时递减。 */
      function markUnarchivedLocally(okIds) {
        if (okIds.length === 0 || list === null) return
        const done = new Set(okIds)
        setList(list.map((s) => (done.has(s.id) ? { ...s, archived: false } : s)))
      }
      /** 成功删除的会话体积合计（按删除前清单精确计算）。 */
      const sizeById = new Map((list ?? []).map((s) => [s.id, s.sizeBytes ?? 0]))
      const freedOf = (okIds) => okIds.reduce((acc, id) => acc + (sizeById.get(id) ?? 0), 0)
      const at = () => Date.now()

      async function fireSingleDelete(id) {
        setArm(null)
        setBusy(true)
        const title = (list ?? []).find((s) => s.id === id)?.title
        try {
          const r = await deleteMany([id], currentId)
          if (r.ok > 0) {
            setNotice({
              kind: 'ok',
              title: `已删除「${title || shortId(id)}」`,
              detail: `已移入回收站（${fmtSize(freedOf(r.okIds))}）· 侧栏已隐藏 · 可在「回收站」页签还原`,
              at: at(),
            })
          } else {
            setNotice({ kind: 'err', title: '删除失败', detail: r.message, at: at() })
          }
          removeDeletedLocally(r.okIds)
        } finally {
          setBusy(false)
          setSelected(new Set())
        }
      }
      async function fireBatchDelete(ids) {
        setArm(null)
        setBusy(true)
        setProgress({ done: 0, total: ids.length })
        try {
          const r = await deleteMany(ids, currentId, (done, total) => setProgress({ done, total }))
          if (r.failed === 0) {
            setNotice({
              kind: 'ok',
              title: `已删除 ${r.ok} 个会话 · 释放 ${fmtSize(freedOf(r.okIds))}`,
              detail: '已移入回收站 · 侧栏已隐藏 · 可在「回收站」页签还原',
              at: at(),
            })
          } else if (r.ok > 0) {
            setNotice({
              kind: 'warn',
              title: `已删除 ${r.ok} 个 · ${r.failed} 个失败`,
              detail: `成功部分已入回收站；首条失败：${r.message}`,
              at: at(),
            })
          } else {
            setNotice({ kind: 'err', title: `全部删除失败（${r.failed} 个）`, detail: r.message, at: at() })
          }
          removeDeletedLocally(r.okIds)
        } finally {
          setBusy(false)
          setProgress(null)
          setSelected(new Set())
        }
      }
      async function fireSingleUnarchive(id) {
        setBusy(true)
        const title = (list ?? []).find((s) => s.id === id)?.title
        try {
          await post(`${PREFIX}/unarchive`, { id })
          markUnarchivedLocally([id])
          setNotice({
            kind: 'ok',
            title: `已还原「${title || shortId(id)}」`,
            detail: '已解除归档 · 侧栏原分组立即可见',
            at: at(),
          })
        } catch (e) {
          const code = e?.data?.error?.code
          setNotice({
            kind: code === 'UNSUPPORTED' ? 'warn' : 'err',
            title: '还原失败',
            detail: String(e?.message ?? e),
            at: at(),
          })
        } finally {
          setBusy(false)
        }
      }
      async function fireBatchUnarchive(ids) {
        setBusy(true)
        setProgress({ done: 0, total: ids.length, label: '还原中' })
        let ok = 0
        let failed = 0
        let message = null
        const okIds = []
        try {
          for (let i = 0; i < ids.length; i += 1) {
            const id = ids[i]
            try {
              await post(`${PREFIX}/unarchive`, { id })
              ok += 1
              okIds.push(id)
            } catch (e) {
              failed += 1
              if (message === null) message = `${shortId(id)}：${e?.message ?? e}`
            }
            setProgress({ done: i + 1, total: ids.length, label: '还原中' })
          }
          markUnarchivedLocally(okIds)
          if (failed === 0) {
            setNotice({ kind: 'ok', title: `已还原 ${ok} 个会话`, detail: '已解除归档 · 侧栏原分组立即可见', at: at() })
          } else if (ok > 0) {
            setNotice({ kind: 'warn', title: `已还原 ${ok} 个 · ${failed} 个失败`, detail: `首条失败：${message}`, at: at() })
          } else {
            setNotice({ kind: 'err', title: `全部还原失败（${failed} 个）`, detail: message, at: at() })
          }
        } finally {
          setBusy(false)
          setProgress(null)
          setSelected(new Set())
        }
      }
      async function fireRestore(entry) {
        setArm(null)
        setBusy(true)
        try {
          const r = await post(`${PREFIX}/restore`, { entry })
          if (r.stillArchived) {
            setNotice({
              kind: 'warn',
              title: `文件已还原（${shortId(r.id ?? '')}）`,
              detail: '当前 DSH 版本无法在线解除归档；彻底找回见 README 的 unhide 步骤',
              at: at(),
            })
          } else {
            setNotice({ kind: 'ok', title: `已还原（${shortId(r.id ?? '')}）`, detail: '已解除归档 · 侧栏原分组立即可见', at: at() })
          }
        } catch (e) {
          setNotice({ kind: 'err', title: '还原失败', detail: String(e?.message ?? e), at: at() })
        } finally {
          setBusy(false)
          await loadTrash()
          loadList() // 还原的会话回到清单（归档页签/全部页签与徽标同步）
          refreshClientSessionList() // 拉最新基线，让还原的会话行数据与磁盘一致
        }
      }
      async function firePurge(entry) {
        setArm(null)
        setBusy(true)
        try {
          await post(`${PREFIX}/purge`, { entry })
          setNotice({ kind: 'ok', title: '已彻底删除 1 项', detail: '回收站中已不可恢复', at: at() })
        } catch (e) {
          setNotice({ kind: 'err', title: '彻底删除失败', detail: String(e?.message ?? e), at: at() })
        } finally {
          setBusy(false)
          await loadTrash()
        }
      }
      async function firePurgeAll() {
        setPurgeAllArmed(false)
        setBusy(true)
        try {
          const r = await post(`${PREFIX}/purge`, { all: true })
          setNotice({ kind: 'ok', title: `已清空回收站（${r.count ?? 0} 项）`, detail: null, at: at() })
        } catch (e) {
          setNotice({ kind: 'err', title: '清空失败', detail: String(e?.message ?? e), at: at() })
        } finally {
          setBusy(false)
          await loadTrash()
        }
      }
      /** 批量还原回收站条目：文件归位 + 自动解除归档，逐条容错。 */
      async function fireBatchRestore(entries) {
        setArm(null)
        setBusy(true)
        setProgress({ done: 0, total: entries.length, label: '还原中' })
        let ok = 0
        let failed = 0
        let message = null
        try {
          for (let i = 0; i < entries.length; i += 1) {
            try {
              await post(`${PREFIX}/restore`, { entry: entries[i] })
              ok += 1
            } catch (e) {
              failed += 1
              if (message === null) message = String(e?.message ?? e)
            }
            setProgress({ done: i + 1, total: entries.length, label: '还原中' })
          }
          if (failed === 0) {
            setNotice({
              kind: 'ok',
              title: `已还原 ${ok} 项`,
              detail: unarchiveSupported ? '已解除归档 · 侧栏原分组立即可见' : '文件已归位；解除归档见「归档会话」页签',
              at: at(),
            })
          } else if (ok > 0) {
            setNotice({ kind: 'warn', title: `已还原 ${ok} 项 · ${failed} 项失败`, detail: `首条失败：${message}`, at: at() })
          } else {
            setNotice({ kind: 'err', title: `全部还原失败（${failed} 项）`, detail: message, at: at() })
          }
        } finally {
          setBusy(false)
          setProgress(null)
          setSelected(new Set())
          await loadTrash()
          loadList()
          refreshClientSessionList()
        }
      }
      /** 批量彻底删除所选条目（两步确认后进入）。 */
      async function fireBatchPurgeSelected() {
        const entries = [...selected]
        setArm(null)
        setBusy(true)
        setProgress({ done: 0, total: entries.length, label: '彻底删除中' })
        let ok = 0
        let failed = 0
        let message = null
        try {
          for (let i = 0; i < entries.length; i += 1) {
            try {
              await post(`${PREFIX}/purge`, { entry: entries[i] })
              ok += 1
            } catch (e) {
              failed += 1
              if (message === null) message = String(e?.message ?? e)
            }
            setProgress({ done: i + 1, total: entries.length, label: '彻底删除中' })
          }
          if (failed === 0) {
            setNotice({ kind: 'ok', title: `已彻底删除 ${ok} 项`, detail: '回收站中已不可恢复', at: at() })
          } else if (ok > 0) {
            setNotice({ kind: 'warn', title: `已彻底删除 ${ok} 项 · ${failed} 项失败`, detail: `首条失败：${message}`, at: at() })
          } else {
            setNotice({ kind: 'err', title: `全部彻底删除失败（${failed} 项）`, detail: message, at: at() })
          }
        } finally {
          setBusy(false)
          setProgress(null)
          setSelected(new Set())
          await loadTrash()
        }
      }

      // ---------- 数据视图 ----------
      const sessions = list ?? []
      const archivedSessions = sessions.filter((s) => s.archived)
      const q = query.trim().toLowerCase()
      const now = Date.now()
      const filteredAll = sessions.filter((s) => {
        if (filter === 'active' && s.archived) return false
        if (filter === 'archived' && !s.archived) return false
        if (filter === 'stale30' && now - (s.mtimeMs ?? 0) < 30 * 86400000) return false
        if (q && !`${s.title ?? ''}\n${s.id}`.toLowerCase().includes(q)) return false
        return true
      })
      // fork：归档管理页签的数据视图（排序 → 搜索 → 按项目分组）
      const archivedSorted = [...archivedSessions].sort((a, b) => {
        if (sortBy === 'size') return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)
        if (sortBy === 'createdAt') return (b.createdAt ?? 0) - (a.createdAt ?? 0)
        return (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0)
      })
      const archivedFiltered = q
        ? archivedSorted.filter((s) => `${s.title ?? ''}\n${s.id}`.toLowerCase().includes(q))
        : archivedSorted
      const archivedGroups = new Map()
      for (const s of archivedFiltered) {
        const key = s.cwd ?? '(无目录)'
        if (!archivedGroups.has(key)) archivedGroups.set(key, [])
        archivedGroups.get(key).push(s)
      }

      const toggle = (id) => {
        // 批量删除/彻底删除处于武装态时改选集会让按钮计数失真——直接解除武装
        if (arm === 'trash-sel' || arm === 'sel:del') setArm(null)
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }
      const toggleGroup = (groupSessions) => {
        if (arm === 'sel:del') setArm(null)
        setSelected((prev) => {
          const next = new Set(prev)
          const allIn = groupSessions.every((s) => next.has(s.id))
          for (const s of groupSessions) {
            if (allIn) next.delete(s.id)
            else next.add(s.id)
          }
          return next
        })
      }

      const groups = new Map()
      for (const s of filteredAll) {
        const key = s.cwd ?? '(无目录)'
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(s)
      }
      const groupMeta = (key) => {
        const ws = workspaces.find((w) => w.path === key)
        const name = ws?.title || (key === '(无目录)' ? key : key.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || key)
        return { name, path: key }
      }

      const tabBtn = (id, label, count) => {
        const active = tab === id
        return h(
          'button',
          {
            key: id,
            className: 'sd-btn',
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 10px',
              border: 'none',
              borderRadius: 6,
              background: active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, transparent)' : 'transparent',
              color: active ? T.brand : T.secondary,
              fontWeight: active ? 600 : 400,
              fontSize: 13,
              lineHeight: '20px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            },
            onClick: () => setTab(id),
          },
          [
            h('span', { key: 'l' }, label),
            count !== undefined && count !== null
              ? h('span', { key: 'c', style: { fontSize: 11, opacity: 0.8, fontVariantNumeric: 'tabular-nums' } }, String(count))
              : null,
          ].filter(Boolean),
        )
      }

      const selectedBytes = (rows) => rows.filter((s) => selected.has(s.id)).reduce((acc, s) => acc + (s.sizeBytes ?? 0), 0)

      // ---------- 行渲染 ----------
      /** 会话行：整行可点击切换选中（复选框/操作按钮自身阻止冒泡）。选中态样式见 .sd-sel。 */
      const sessionRow = (s, opts) => {
        const isSel = selected.has(s.id)
        return h(
          'div',
          {
            key: s.id,
            className: isSel ? 'sd-row sd-sel' : 'sd-row',
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: opts?.indent ? '4px 6px 4px 22px' : '4px 6px 4px 10px',
              cursor: 'pointer',
              minHeight: 32,
            },
            onClick: () => toggle(s.id),
          },
          [
            h('input', {
              key: 'c',
              type: 'checkbox',
              className: 'sd-check',
              checked: selected.has(s.id),
              onChange: () => toggle(s.id),
              onClick: (e) => e.stopPropagation(),
              style: { accentColor: T.brand, cursor: 'pointer' },
            }),
            h(
              'span',
              { key: 't', style: { fontSize: 13, color: T.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }, title: `${s.title ?? '未命名'}\n${s.id}\n${s.cwd ?? ''}` },
              s.title || `未命名 · ${shortId(s.id)}`,
            ),
            s.running ? h('span', { key: 'r', style: tagStyle(T.err) }, '运行中') : null,
            s.live && !s.running ? h('span', { key: 'lv', style: tagStyle(T.brand) }, '打开中') : null,
            s.origin === 'subagent' ? h('span', { key: 'sa', style: tagStyle(T.warn) }, '子代理') : null,
            h('span', { key: 'm', title: fmtDate(s.mtimeMs), style: { fontSize: 11, color: T.secondary, flexShrink: 0, width: 64, textAlign: 'right' } }, fmtAgo(s.mtimeMs)),
            h('span', { key: 's', style: { fontSize: 11, color: T.secondary, flexShrink: 0, width: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, fmtSize(s.sizeBytes)),
            opts?.restore
              ? h(
                  'span',
                  { key: 'rw', onClick: (e) => e.stopPropagation(), style: { display: 'inline-flex', flexShrink: 0 } },
                  h('button', {
                    className: 'sd-btn',
                    style: { ...smallBtn, borderColor: `color-mix(in srgb, ${T.brand} 45%, ${T.border})`, color: T.brand },
                    disabled: busy,
                    title: '解除归档：会话立即回到侧栏原分组',
                    onClick: () => fireSingleUnarchive(s.id),
                  }, '还原'),
                )
              : null,
            opts?.singleDelete
              ? h(
                  'span',
                  { key: 'dw', onClick: (e) => e.stopPropagation(), style: { display: 'inline-flex', flexShrink: 0 } },
                  h(ArmDeleteButton, {
                    armed: arm === s.id,
                    onArm: () => setArm(s.id),
                    onFire: () => fireSingleDelete(s.id),
                    busy,
                    hint: '删除后移入回收站并保持侧栏隐藏，可在「回收站」页签还原',
                  }),
                )
              : null,
            opts?.permanentDelete
              ? h(
                  'span',
                  { key: 'pw', onClick: (e) => e.stopPropagation(), style: { display: 'inline-flex', flexShrink: 0 } },
                  h(ArmDeleteButton, {
                    armed: arm === `p:${s.id}`,
                    onArm: () => setArm(`p:${s.id}`),
                    onFire: () => fireSinglePermanentDelete(s.id),
                    busy,
                    label: '永久删除',
                    armedLabel: '确认永久删除',
                    hint: '直接彻底抹除全部本地记录，不经回收站、不可恢复',
                  }),
                )
              : null,
          ].filter(Boolean),
        )
      }

      /** 回收站行：与会话行同款多选交互（整行点击选中，按钮阻止冒泡）。
       * 主文本优先显示会话名（删除时随 meta.json 带入），旧条目无标题回退 id。 */
      const trashRow = (it) => {
        const isSel = selected.has(it.entry)
        return h(
          'div',
          {
            key: it.entry,
            className: isSel ? 'sd-row sd-sel' : 'sd-row',
            style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px 5px 10px', minHeight: 32, cursor: 'pointer' },
            onClick: () => toggle(it.entry),
          },
          [
            h('input', {
              key: 'c',
              type: 'checkbox',
              className: 'sd-check',
              checked: isSel,
              onChange: () => toggle(it.entry),
              onClick: (e) => e.stopPropagation(),
              style: { accentColor: T.brand, cursor: 'pointer' },
            }),
            h(
              'span',
              { key: 't', style: { fontSize: 13, color: T.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }, title: `${it.title ?? ''}\n${it.id}\n${it.cwd ?? ''}` },
              it.title || it.id,
            ),
            h('span', { key: 'm', title: it.trashedAt ?? '', style: { fontSize: 11, color: T.secondary, flexShrink: 0, width: 64, textAlign: 'right' } }, fmtAgo(it.trashedAt ? Date.parse(it.trashedAt) : 0)),
            h('span', { key: 's', style: { fontSize: 11, color: T.secondary, flexShrink: 0, width: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, fmtSize(it.sizeBytes)),
            h(
              'span',
              { key: 'rw', onClick: (e) => e.stopPropagation(), style: { display: 'inline-flex', flexShrink: 0 } },
              h('button', { className: 'sd-btn', style: { ...smallBtn, borderColor: `color-mix(in srgb, ${T.brand} 45%, ${T.border})`, color: T.brand }, disabled: busy, onClick: () => fireRestore(it.entry) }, '还原'),
            ),
            h(
              'span',
              { key: 'pw', onClick: (e) => e.stopPropagation(), style: { display: 'inline-flex', flexShrink: 0 } },
              h(ArmDeleteButton, {
                armed: arm === `t:${it.entry}`,
                onArm: () => setArm(`t:${it.entry}`),
                onFire: () => firePurge(it.entry),
                busy,
                label: '彻底删除',
              }),
            ),
          ],
        )
      }

      // ---------- 页签内容（仅滚动列表区） ----------
      /**
       * 首次加载的居中过渡动画：在滚动区（flex:1 定高）内水平垂直居中。
       * spinner 下方显示主文案，流式清单再下方显示真实进度「已加载 N / M 个会话」。
       */
      function CenterLoading({ label, count, total }) {
        return h(
          'div',
          { style: { height: '100%', minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 } },
          [
            h('span', { key: 'i', className: 'sd-spin', style: { fontSize: 24, lineHeight: 1, color: T.secondary } }, '↻'),
            h('div', { key: 't', style: { fontSize: 13, color: T.secondary } }, label),
            count !== undefined && count !== null
              ? h(
                  'div',
                  { key: 'c', style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))', fontVariantNumeric: 'tabular-nums' } },
                  `已加载 ${count}${typeof total === 'number' ? ` / ${total}` : ''} 个会话`,
                )
              : null,
          ],
        )
      }

      /** fork：自动归档配置卡片（zcodex 一比一：仅「自动归档开关」与「归档保留时长」两行）。 */
      function AutoArchiveCard() {
        const cfg = aaConfig
        const disabled = cfg === null || aaBusy || busy
        const enabled = cfg?.enabled === true
        const selectStyle = { ...inputStyle, width: 280, height: 34, cursor: 'pointer' }
        const rowTitleStyle = { fontSize: 15, fontWeight: 600, color: T.label, lineHeight: '22px' }
        const rowDescStyle = { fontSize: 13, color: T.secondary, lineHeight: '20px', marginTop: 4, maxWidth: 460 }
        const divider = { borderTop: `1px solid ${T.border}`, margin: '0' }
        const rows = [
          {
            key: 'auto',
            title: '自动归档旧会话',
            desc: '定时扫描，将最后活动时间超过保留期的会话自动归档；置顶和运行中的会话不受影响。',
            control: h('button', {
              key: 'sw',
              role: 'switch',
              'aria-checked': enabled,
              disabled,
              title: enabled ? '自动归档已开启，点击关闭' : '自动归档已关闭，点击开启',
              onClick: () => fireSaveConfig({ enabled: !enabled }),
              style: {
                width: 44,
                height: 24,
                borderRadius: 12,
                flexShrink: 0,
                cursor: disabled ? 'default' : 'pointer',
                border: `1px solid ${enabled ? T.brand : T.border2}`,
                background: enabled ? T.brand : 'transparent',
                position: 'relative',
                transition: 'background .15s ease, border-color .15s ease',
                opacity: disabled ? 0.55 : 1,
              },
            }, h('span', { style: { position: 'absolute', top: 2, left: enabled ? 22 : 2, width: 18, height: 18, borderRadius: '50%', background: enabled ? '#fff' : T.secondary, transition: 'left .15s ease' } })),
          },
          {
            key: 'retention',
            title: '归档保留时长',
            desc: '会话最后更新时间早于该时长后，才会进入自动归档候选。',
            control: h('select', {
              key: 'days',
              value: String(cfg?.retentionDays ?? 7),
              disabled,
              onChange: (e) => fireSaveConfig({ retentionDays: Number(e.target.value) }),
              style: selectStyle,
            }, [1, 3, 7, 14, 30, 90].map((d) => h('option', { key: d, value: String(d) }, `${d} 天后归档`))),
          },
        ]
        return h(
          'div',
          { key: 'aa', style: { border: `1px solid ${T.border}`, borderRadius: 12, padding: '4px 20px', flex: 'none', background: T.layer1 } },
          rows.flatMap((row, index) => [
            index > 0 ? h('div', { key: `dv-${row.key}`, style: divider }) : null,
            h('div', { key: row.key, style: { display: 'flex', alignItems: 'center', gap: 16, padding: '18px 0' } }, [
              h('div', { key: 'txt', style: { flex: 1, minWidth: 0 } }, [
                h('div', { key: 't', style: rowTitleStyle }, row.title),
                h('div', { key: 'd', style: rowDescStyle }, row.desc),
              ]),
              row.control,
            ]),
          ]),
        )
      }

      function toggleGroupOpen(key) {
        setOpenGroups((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      /** 归档管理页签（默认，zcodex 版式）：标题行 + 全部永久删除 + 搜索/排序/项目筛选 + 折叠分组清单。 */
      function ArchivedTab() {
        if (listLoading && list === null) return h(CenterLoading, { label: '正在读取会话数据', count: listProgress?.count, total: listProgress?.total })
        const seenProjects = new Set()
        const projectOptions = []
        for (const s of archivedSessions) {
          const key = s.cwd ?? '(无目录)'
          if (seenProjects.has(key)) continue
          seenProjects.add(key)
          projectOptions.push({ key, name: groupMeta(key).name })
        }
        const visibleGroups = [...archivedGroups].filter(([key]) => projectFilter === '' || groupMeta(key).name === projectFilter)
        const purgeDisabled = busy || archivedSessions.length === 0
        return h('div', null, [
          h(AutoArchiveCard, { key: 'aa' }),
          h('div', { key: 'hdr', style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 22, flex: 'none' } }, [
            h('div', { key: 't', style: { fontSize: 17, fontWeight: 700, color: T.label } }, '已归档的会话'),
            h('span', { key: 'sp', style: { flex: 1 } }),
            h('button', {
              key: 'purge',
              className: 'sd-btn',
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 32,
                padding: '0 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: purgeDisabled ? 'default' : 'pointer',
                background: purgeArchArmed ? T.err : `color-mix(in srgb, ${T.err} 14%, transparent)`,
                border: `1px solid ${purgeArchArmed ? T.err : `color-mix(in srgb, ${T.err} 45%, transparent)`}`,
                color: purgeArchArmed ? '#fff' : T.err,
                opacity: purgeDisabled ? 0.55 : 1,
              },
              disabled: purgeDisabled,
              title: '把全部已归档会话直接彻底抹除（不经回收站、不可恢复；运行中的会话自动跳过）',
              onClick: () => (purgeArchArmed ? firePurgeArchivedAll() : setPurgeArchArmed(true)),
            }, [
              h('span', { key: 'i', style: { display: 'inline-flex' } }, svgEl(ICON_PATH_TRASH, 14)),
              h('span', { key: 't' }, purgeArchArmed ? `确认永久删除 (${archivedSessions.length})` : '全部永久删除'),
            ]),
          ]),
          h('div', { key: 'ft', style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flex: 'none', flexWrap: 'nowrap' } }, [
            h('input', { key: 'q', className: 'sd-search', style: { ...inputStyle, flex: 1, minWidth: 140, height: 34 }, placeholder: '搜索已归档会话', value: query, onChange: (e) => setQuery(e.target.value) }),
            h('span', { key: 'sl', style: { fontSize: 13, color: T.secondary, flexShrink: 0 } }, '排序方式'),
            h('select', {
              key: 'sort',
              value: sortBy,
              onChange: (e) => setSortBy(e.target.value),
              style: { ...inputStyle, width: 116, height: 34, cursor: 'pointer', flexShrink: 0 },
            }, [
              h('option', { key: 'mtime', value: 'mtime' }, '更新时间'),
              h('option', { key: 'createdAt', value: 'createdAt' }, '创建时间'),
              h('option', { key: 'size', value: 'size' }, '占用体积'),
            ]),
            h('select', {
              key: 'proj',
              value: projectFilter,
              onChange: (e) => {
                const next = e.target.value
                setProjectFilter(next)
                // 筛选遥测：上报选中值与全部分组名，离线核对过滤逻辑
                debugNote('project filter changed', {
                  value: next,
                  groupNames: [...archivedGroups].map(([k]) => groupMeta(k).name),
                })
              },
              style: { ...inputStyle, width: 150, height: 34, cursor: 'pointer', flexShrink: 0 },
            }, [
              h('option', { key: 'all', value: '' }, '所有项目'),
              ...projectOptions.map((p) => h('option', { key: p.key, value: p.name }, p.name)),
            ]),
          ]),
          h('div', { key: 'lr', style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flex: 'none' } }, [
            h('span', { key: 'txt', style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))' } },
              lastRun
                ? `成功 ${lastRun.archived ?? 0} 项，失败 ${lastRun.failed ?? 0} 项，跳过 ${(lastRun.skippedRunning ?? 0) + (lastRun.skippedPinned ?? 0)} 项`
                : '尚未运行过扫描。'),
            h('button', {
              key: 'scan',
              className: 'sd-btn',
              style: { border: 'none', background: 'transparent', color: T.brand, fontSize: 12, cursor: aaBusy || busy ? 'default' : 'pointer', padding: 0, opacity: aaBusy || busy ? 0.6 : 1 },
              disabled: aaBusy || busy,
              title: '立即按当前保留期扫描并归档',
              onClick: fireRunScan,
            }, aaBusy ? '扫描中…' : '立即扫描'),
            h('button', {
              key: 'reload',
              className: 'sd-btn',
              style: { border: 'none', background: 'transparent', color: T.secondary, fontSize: 12, cursor: listLoading || busy ? 'default' : 'pointer', padding: 0, opacity: listLoading || busy ? 0.6 : 1 },
              disabled: listLoading || busy,
              title: '重新加载会话清单',
              onClick: loadList,
            }, '刷新'),
          ]),
          archivedSessions.length === 0
            ? h('div', { key: 'empty', style: { fontSize: 13, color: T.secondary, padding: '10px 0', lineHeight: '20px' } }, [
                h('div', { key: 'a' }, '没有已归档的会话。'),
                h('div', { key: 'b', style: { marginTop: 4 } }, '在侧栏会话上右键「归档会话」，或开启上方「自动归档旧会话」后，可在此处管理或永久删除。'),
              ])
            : visibleGroups.length === 0
              ? h('div', { key: 'noq', style: { fontSize: 13, color: T.secondary, padding: '10px 0' } }, '当前搜索/筛选条件下没有已归档会话')
              : h('div', { key: 'list', style: { marginTop: 4 } }, visibleGroups.map(([key, groupSessions]) => {
                  const meta = groupMeta(key)
                  // 选中项目筛选或正在搜索时自动展开，会话直接可见（zcodex 行为）
                  const open = openGroups.has(key) || projectFilter !== '' || q !== ''
                  return h('div', { key: `g:${key}` }, [
                    h('div', { key: 'h', className: 'sd-grouphd', onClick: () => toggleGroupOpen(key), title: open ? '点击折叠' : '点击展开' }, [
                      h('span', { key: 'ch', className: 'sd-chev', style: { transform: open ? 'rotate(90deg)' : 'none' } }, svgEl(ICON_PATH_CHEVRON, 14)),
                      h('span', { key: 'fo', style: { display: 'inline-flex', color: T.secondary } }, svgEl(ICON_PATH_FOLDER, 15)),
                      h('span', { key: 'n', style: { fontSize: 13, fontWeight: 600, color: T.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: meta.path }, meta.name),
                      h('span', { key: 'sp', style: { flex: 1 } }),
                      h('span', { key: 'i', style: { fontSize: 13, color: T.secondary, flexShrink: 0, fontVariantNumeric: 'tabular-nums' } }, `${groupSessions.length} 个会话`),
                    ]),
                    ...(open ? groupSessions.map((s) => sessionRow(s, { indent: true, singleDelete: true, restore: unarchiveSupported, permanentDelete: true })) : []),
                  ])
                })),
          h('div', { key: 'nav', style: { marginTop: 28, paddingTop: 12, borderTop: `1px solid ${T.border}`, flex: 'none', display: 'flex', alignItems: 'center', gap: 14 } }, [
            h('button', {
              key: 'trash-link',
              className: 'sd-btn',
              style: { border: 'none', background: 'transparent', color: T.secondary, fontSize: 12, cursor: 'pointer', padding: 0 },
              title: '查看回收站：还原或彻底删除已删除的会话',
              onClick: () => {
                setTab('trash')
                if (trash === null) loadTrash()
              },
            }, trash !== null ? `回收站 (${trash.length})` : '回收站'),
          ]),
        ])
      }

      function AllTab() {
        if (listLoading && list === null) return h(CenterLoading, { label: '正在读取会话数据', count: listProgress?.count, total: listProgress?.total })
        if (sessions.length === 0) return h('div', { style: { fontSize: 13, color: T.secondary, padding: '8px 0' } }, '没有可列出的会话')
        return h(
          'div',
          null,
          groups.size === 0
            ? h('div', { key: 'e', style: { fontSize: 13, color: T.secondary, padding: '8px 0' } }, '当前过滤条件下没有会话')
            : [...groups].map(([key, groupSessions]) => {
                const meta = groupMeta(key)
                return h(
                  'div',
                  { key: `g:${key}` },
                  [
                    h('div', {
                      key: 'h',
                      className: 'sd-grouphd',
                      onClick: () => toggleGroup(groupSessions),
                    }, [
                      h('input', {
                        key: 'c',
                        type: 'checkbox',
                        className: 'sd-check',
                        checked: groupSessions.every((s) => selected.has(s.id)),
                        onChange: () => toggleGroup(groupSessions),
                        onClick: (e) => e.stopPropagation(),
                        style: { accentColor: T.brand, cursor: 'pointer' },
                      }),
                      h('span', { key: 'n', style: { fontSize: 12, fontWeight: 600, color: T.secondary, letterSpacing: 0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: meta.path }, meta.name),
                      h('span', { key: 'i', style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))', flexShrink: 0 } }, `${groupSessions.length} 会话 · ${fmtSize(groupSessions.reduce((a, s) => a + (s.sizeBytes ?? 0), 0))}`),
                    ]),
                    ...groupSessions.map((s) => sessionRow(s, { indent: true, singleDelete: true, restore: s.archived && unarchiveSupported })),
                  ],
                )
              }),
        )
      }

      function TrashTab() {
        if (trashLoading && trash === null) return h(CenterLoading, { label: '正在读取回收站' })
        const items = trash ?? []
        return h('div', null, [
          h('div', { key: 'back', style: { marginBottom: 12 } }, [
            h('button', {
              className: 'sd-btn',
              style: { border: 'none', background: 'transparent', color: T.brand, fontSize: 12, cursor: 'pointer', padding: 0 },
              onClick: () => setTab('archived'),
            }, '← 返回归档管理'),
          ]),
          items.length === 0
            ? h('div', { key: 'e', style: { fontSize: 13, color: T.secondary, padding: '8px 0' } }, '回收站为空')
            : items.map((it) => trashRow(it)),
        ])
      }

      // ---------- 底部操作条 ----------
      function Footer() {
        if (tab === 'trash') {
          const items = trash ?? []
          if (items.length === 0) return null
          const selItems = items.filter((i) => selected.has(i.entry))
          const allSelected = items.every((i) => selected.has(i.entry))
          const purgeSelArmed = arm === 'trash-sel'
          return h(
            'div',
            { style: { borderTop: `1px solid ${T.border}`, paddingTop: 8, marginTop: 8, flex: 'none' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
              h(
                'span',
                { key: 'n', style: { fontSize: 12, color: T.secondary } },
                busy
                  ? `${progress?.label ?? '处理中'} ${progress?.done ?? 0}/${progress?.total ?? 0}`
                  : selected.size > 0
                    ? `已选 ${selected.size} 项 · ${fmtSize(selItems.reduce((a, i) => a + (i.sizeBytes ?? 0), 0))}`
                    : `${items.length} 项 · ${fmtSize(items.reduce((a, i) => a + (i.sizeBytes ?? 0), 0))}`,
              ),
              h(
                'button',
                { key: 'all', className: 'sd-btn', style: smallBtn, disabled: busy || trashLoading, onClick: () => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.entry))) },
                allSelected ? '取消全选' : `全选 (${items.length})`,
              ),
              selected.size > 0
                ? h('button', { key: 'c', className: 'sd-btn', style: smallBtn, disabled: busy, onClick: () => setSelected(new Set()) }, '清除')
                : null,
              h(
                'button',
                {
                  key: 'r',
                  className: 'sd-btn',
                  style: { ...smallBtn, borderColor: `color-mix(in srgb, ${T.brand} 45%, ${T.border})`, color: T.brand, fontWeight: 600 },
                  disabled: busy || selected.size === 0,
                  title: '还原所选：文件归位并解除归档',
                  onClick: () => fireBatchRestore([...selected]),
                },
                `还原所选 (${selected.size})`,
              ),
              h(
                'button',
                {
                  key: 'ps',
                  className: 'sd-btn',
                  style: { ...smallBtn, marginLeft: 'auto', background: purgeSelArmed ? T.err : 'transparent', borderColor: purgeSelArmed ? T.err : T.border, color: purgeSelArmed ? '#fff' : T.err, fontWeight: 600 },
                  disabled: busy || selected.size === 0,
                  onClick: () => (purgeSelArmed ? fireBatchPurgeSelected() : setArm('trash-sel')),
                },
                purgeSelArmed ? `确认彻底删除 (${selected.size})` : `彻底删除所选 (${selected.size})`,
              ),
              h(
                'button',
                {
                  key: 'p',
                  className: 'sd-btn',
                  style: { ...smallBtn, background: purgeAllArmed ? T.err : 'transparent', borderColor: purgeAllArmed ? T.err : T.border, color: purgeAllArmed ? '#fff' : T.err, fontWeight: 600 },
                  disabled: busy,
                  onClick: () => (purgeAllArmed ? firePurgeAll() : setPurgeAllArmed(true)),
                },
                purgeAllArmed ? '确认清空（不可恢复）' : '清空回收站',
              ),
            ]),
          )
        }
        const rows = tab === 'archived' ? archivedFiltered : filteredAll
        if (rows.length === 0) return null
        // 全选切换：作用于当前页签的可见行（归档页=全部归档；全部会话页=过滤+搜索后）
        const allSelected = rows.every((s) => selected.has(s.id))
        const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((s) => s.id)))
        const showRestore = tab === 'archived' && unarchiveSupported
        // 批量删除与行内单删/回收站清空同款两步确认：第一次点击武装（4 秒有效），
        // 再点执行——误触不会一次删掉整组会话。改选集/切页签会自动解除武装。
        const batchDelArmed = arm === 'sel:del'
        return h('div', { style: { borderTop: `1px solid ${T.border}`, paddingTop: 8, marginTop: 8, flex: 'none' } }, [
          h('div', { key: 'b', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
            h('span', { key: 'n', style: { fontSize: 12, color: T.secondary } }, busy ? `${progress?.label ?? '删除中'} ${progress?.done ?? 0}/${progress?.total ?? 0}` : `已选 ${selected.size} 项 · ${fmtSize(selectedBytes(rows))}`),
            h(
              'button',
              { key: 'all', className: 'sd-btn', style: smallBtn, disabled: busy || listLoading, onClick: toggleSelectAll, title: allSelected ? '取消选择当前列表的全部会话' : '选中当前列表的全部会话（跟随过滤与搜索）' },
              allSelected ? '取消全选' : `全选 (${rows.length})`,
            ),
            selected.size > 0
              ? h('button', { key: 'c', className: 'sd-btn', style: smallBtn, disabled: busy, onClick: () => setSelected(new Set()) }, '清除')
              : null,
            showRestore
              ? h(
                  'button',
                  {
                    key: 'rs',
                    className: 'sd-btn',
                    style: { ...smallBtn, marginLeft: 'auto', borderColor: `color-mix(in srgb, ${T.brand} 45%, ${T.border})`, color: T.brand, fontWeight: 600 },
                    disabled: busy || selected.size === 0,
                    title: '解除所选会话的归档：侧栏原分组立即可见',
                    onClick: () => fireBatchUnarchive([...selected]),
                  },
                  `还原所选 (${selected.size})`,
                )
              : null,
            h(
              'button',
              {
                key: 'd',
                className: 'sd-btn',
                style: { ...smallBtn, marginLeft: showRestore ? 0 : 'auto', background: selected.size > 0 ? T.err : 'transparent', borderColor: selected.size > 0 ? T.err : T.border, color: selected.size > 0 ? '#fff' : T.label, fontWeight: 600 },
                disabled: busy || selected.size === 0,
                title: '删除后移入回收站，可在「回收站」页签还原',
                onClick: () => (batchDelArmed ? fireBatchDelete([...selected]) : setArm('sel:del')),
              },
              busy ? h('span', { className: 'sd-spin' }, '↻') : null,
              batchDelArmed ? `确认删除 (${selected.size})` : `删除所选 (${selected.size})`,
            ),
          ]),
        ])
      }

      // ---------- 固定工具区（不随列表滚动） ----------
      function Toolbar() {
        if (tab === 'all' && list !== null && sessions.length > 0) {
          const filterBtn = (id, label) =>
            h(
              'button',
              { key: id, className: 'sd-btn', style: { ...smallBtn, borderColor: filter === id ? T.brand : T.border, color: filter === id ? T.brand : T.secondary, fontWeight: filter === id ? 600 : 400 }, onClick: () => { setFilter(id); setSelected(new Set()); setArm(null) } },
              label,
            )
          return h(
            'div',
            { key: 'tb-all', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '10px 0 0', flex: 'none' } },
            [
              h('input', { key: 'q', style: { ...inputStyle, width: 160 }, placeholder: '搜索标题 / id', value: query, onChange: (e) => setQuery(e.target.value) }),
              filterBtn('active', '未归档'),
              filterBtn('stale30', '30 天未动'),
              filterBtn('archived', '已归档'),
              filterBtn('all', '全部'),
              h('span', { key: 'n', style: { fontSize: 12, color: T.secondary, marginLeft: 'auto' } }, `${filteredAll.length} / ${sessions.length}`),
            ],
          )
        }
        return null
      }

      // ---------- 页面：zcodex 版式，无页签 ----------
      return h(
        'div',
        { className: 'sd-page', style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        [
          h('div', { key: 'title', style: { flex: 'none' } },
            h('div', { style: { fontSize: 22, fontWeight: 700, color: T.label, lineHeight: '30px' } }, '归档管理'),
          ),
          h(Toolbar, { key: 'tb' }),
          (tab === 'trash' ? trashError : listError) ? h('div', { key: 'err', style: { fontSize: 13, color: T.err, padding: '8px 0', flex: 'none' } }, tab === 'trash' ? trashError : listError) : null,
          h(NoticeBanner, { key: 'notice', notice, onClose: () => setNotice(null) }),
          h(
            'div',
            { key: 'body', style: { overflowY: 'auto', flex: 1, minHeight: 0, marginTop: 8 } },
            tab === 'archived' ? h(ArchivedTab) : tab === 'all' ? h(AllTab) : h(TrashTab),
          ),
          h(Footer, { key: 'ft' }),
        ],
      )
    }

    // =========================================================================
    // 注册壳：恒定 hooks + 自有错误边界 + nav 图标 retag
    // =========================================================================

    /** 设置面板 nav 行的显示文本（与注册 label 一致）。fork：仿 zcodex 改名。 */
    const NAV_LABEL = '归档管理'

    /**
     * 给设置面板 nav 行打 data-sd-nav 标记（幂等）。
     * 官方面板按 section id 硬编码 nav 图标（models/agent-presets/plugins），
     * 其余 id 一律回退为与设置入口相同的齿轮；注册协议没有 icon 字段。
     * 判定条件：按钮的直接子 span 文本 === NAV_LABEL 且按钮有 svg 直接子节点
     * （nav 行图标是 svg；本插件页签里的同名文本按钮没有 svg，不会误伤）。
     * 标记后由 CSS 隐藏齿轮、以 currentColor mask 画 16px 线性垃圾桶。
     */
    function tagNavButtons(root) {
      if (typeof document === 'undefined') return
      try {
        const scope = root ?? document
        const buttons = scope.querySelectorAll ? scope.querySelectorAll('button') : []
        for (const btn of buttons) {
          if (btn.hasAttribute('data-sd-nav')) continue
          const span = btn.querySelector(':scope > span')
          if (span && span.textContent === NAV_LABEL && btn.querySelector(':scope > svg')) {
            btn.setAttribute('data-sd-nav', '1')
          }
        }
      } catch {
        /* retag 失败只影响图标，不影响功能 */
      }
    }

    /** 渲染错误兜底：把「一片空白」变成可见的错误信息（SlotErrorBoundary 只渲染空 div）。 */
    class SectionErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        console.error('[dsh-archive-manager] 设置页渲染失败:', error)
      }
      render() {
        if (this.state.error !== null) {
          return h(
            'div',
            { style: { fontSize: 13, color: T.err, lineHeight: '20px', padding: '12px 0' } },
            [
              h('div', { key: 't', style: { fontWeight: 600 } }, '「归档会话」页渲染失败'),
              h('div', { key: 'm', style: { color: T.secondary } }, String(this.state.error?.message ?? this.state.error)),
              h(
                'button',
                {
                  key: 'r',
                  className: 'sd-btn',
                  style: { ...btnBase, marginTop: 8 },
                  onClick: () => this.setState({ error: null }),
                },
                '重试',
              ),
            ],
          )
        }
        return this.props.children
      }
    }

    /**
     * 注册进 settings.section 的组件：
     * - 恒定调用 useSessions（不用条件式 hook，遵守 hooks 规则）；
     * - 自有 ErrorBoundary 兜底渲染错误。
     */
    function ArchiveSettingsSection(props) {
      const useSessionsHook = props?.useSessions ?? ((selector) => selector(undefined))
      const currentId = useSessionsHook((s) => s?.current)
      return h(SectionErrorBoundary, null, h(SettingsPage, { close: props?.close, currentId }))
    }

    // ---------- 注册 ----------
    function apply(ctx) {
      workspacesService = ctx.workspaces
      clientCtx = ctx
      ctx.effect(() => {
        const el = document.createElement('style')
        el.id = 'dsh-archive-manager-styles'
        el.textContent = CSS
        document.head.appendChild(el)
        return () => el.remove()
      })
      // 常驻 nav 图标 retag：设置面板每次打开/切换 section 都会重建 nav 行 DOM，
      // 依赖组件渲染时机调度会漏（未选中本页时组件根本不渲染）。观察 DOM 变化，
      // 按钮一出现就打标——开销极小（只查新增节点里的 button）。
      ctx.effect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== 1) continue
              if (node.tagName === 'BUTTON') tagNavButtons(node)
              else if (node.querySelectorAll) tagNavButtons(node)
            }
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
        tagNavButtons()
        return () => observer.disconnect()
      })
      ctx.effect(() =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: 'session-delete', order: 20, label: () => NAV_LABEL }, ArchiveSettingsSection),
        ),
      )
      // fork：侧边栏「永久删除」入口 = DOM 注入（置于「归档会话」之下、常规
      // 配色）；确认框 = shell.overlay 官方槽位 + 官方 Modal/Button 原语。
      const langId = (() => {
        try {
          const locale = ctx.get('locale')
          const snapshot = locale !== undefined && typeof locale.getLocale === 'function' ? locale.getLocale() : undefined
          const id =
            typeof snapshot === 'string' ? snapshot : snapshot !== null && snapshot !== undefined && typeof snapshot.id === 'string' ? snapshot.id : ''
          return id.toLowerCase().indexOf('en') === 0 ? 'en' : 'zh'
        } catch {
          return 'zh'
        }
      })()
      try {
        ctx.effect(() => startSidebarMenuHook(langId), 'session-delete: sidebar menu dom hook')
      } catch (error) {
        console.warn('[dsh-archive-manager] sidebar hook failed:', error)
      }
      const overlayReady = primitives !== null && primitives.Modal !== undefined && primitives.Button !== undefined
      if (!overlayReady) {
        console.warn('[dsh-archive-manager] Modal/Button primitives unavailable, confirm dialog disabled')
      } else {
        try {
          ctx.effect(() => ctx.locale.register(SD_NS, MENU_DICTS), 'session-delete: menu locale')
        } catch (error) {
          console.warn('[dsh-archive-manager] locale register failed:', error)
        }
        try {
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'session-delete-confirm', locale: SD_NS }, PermanentDeleteOverlay),
          )
          ctx.effect(
            () => () => {
              setPendingDelete(null)
            },
            'session-delete: pending cleanup',
          )
        } catch (error) {
          console.warn('[dsh-archive-manager] overlay register failed:', error)
        }
      }
    }

    exports.apply = apply
    exports.inject = ['slots', 'workspaces', 'locale']
    exports.SettingsPage = SettingsPage
    exports.ArchiveSettingsSection = ArchiveSettingsSection
    return module.exports
  },
})
