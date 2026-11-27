/**
 * 提示词优化插件 —— 浏览器半边。
 *
 * 三块注册：
 * 1. 右侧栏 tab 类型 `promptOptimizer`（kind），结果面板 + 标题；
 * 2. 输入框右侧的唯一入口按钮（conversation.input.right）；
 * 3. 结果面板里的「复制」按钮。
 *
 * 所有状态通过 `sidebarRight.openContent` 的 params 传递，因此刷新同一 key
 * 只是更新 navigation.params，不会新建 tab。
 */
window.__ModuleLoader__.load({
  id: 'dsh-silent-refiner',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var jsxRuntime = require('react/jsx-runtime')
    var h = React.createElement
    var jsx = jsxRuntime.jsx
    var Fragment = React.Fragment

    /** 右侧栏 tab kind。 */
    var KIND = 'promptOptimizer'
    /** tab / 插槽 key，必须与 kind 注册里的 id 一致。 */
    var TAB_ID = 'dsh-prompt-optimizer'
    /** 结果 tab 的固定 key：复用同一个 tab。 */
    var CONTENT_KEY = 'result'
    /** 后端路由前缀。 */
    var API = '/dsh-prompt-optimizer'
    /** i18n 命名空间。 */
    var NS = 'promptOptimizer'

    /**
     * 可选的优化类型。id 必须与 lib/prompts.js 的模板 id 完全一致，
     * 否则后端 resolveTemplate 会回落到默认模板。
     * name/desc 走 locale key，模板规则照 prompt-optimizer 与结构化提示词仓库移植。
     */
    var DEFAULT_TEMPLATE = 'general-optimize'
    // 静默优化用的模板 = 用户在类型菜单里最后选的那个；切会话时从 host 恢复。
    var lastTemplateId = DEFAULT_TEMPLATE
    var TEMPLATE_CHOICES = [
      { id: 'general-optimize', nameKey: 'templateGeneral', descKey: 'templateGeneralDesc' },
      { id: 'analytical-optimize', nameKey: 'templateAnalytical', descKey: 'templateAnalyticalDesc' },
      { id: 'output-format-optimize', nameKey: 'templateFormat', descKey: 'templateFormatDesc' },
      { id: 'message-optimize', nameKey: 'templateMessage', descKey: 'templateMessageDesc' },
      { id: 'structured-optimize', nameKey: 'templateStructured', descKey: 'templateStructuredDesc' },
    ]

    // ------------------------------- 样式 ---------------------------------

    function cssText() {
      return [
      '.dpo-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13)}',
      '.dpo-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none}',
      '.dpo-spacer{flex:1 1 auto}',
      '.dpo-model{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.dpo-body{flex:1 1 auto;min-height:0;overflow:auto;padding:12px}',
      '.dpo-pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font-family:inherit;margin:0;line-height:1.65;user-select:text}',
      '.dpo-original{padding:10px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);max-height:220px;overflow:auto;margin-bottom:14px}',
      '.dpo-label{color:var(--dsw-alias-label-tertiary);margin-bottom:6px;font-size:12px}',
      '.dpo-note{margin-top:12px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-secondary)}',
      '.dpo-error{color:var(--dsw-alias-label-error);white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dpo-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;font-size:12px;line-height:18px;border-radius:var(--dsw-radius-sm);border:none;cursor:pointer;background:0 0;color:var(--dsw-alias-label-primary);font-family:inherit}',
      '.dpo-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dpo-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.dpo-btn:disabled{cursor:not-allowed;opacity:.4}',
      '.dpo-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.dpo-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.dpo-btn-icon{width:28px;padding:0}',
      '.dpo-composer-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l2);cursor:pointer;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;white-space:nowrap}',
      '.dpo-composer-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dpo-composer-btn:disabled{cursor:not-allowed;opacity:.4}',
      '.dpo-spark{font-size:11px;line-height:1}',
      '.dpo-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}',
      '.dpo-details{margin-bottom:12px}',
      '.dpo-details>summary{cursor:pointer;list-style:none;user-select:none}',
      '.dpo-details>summary::-webkit-details-marker{display:none}',
      '.dpo-details>summary::before{content:"▸ ";color:var(--dsw-alias-label-tertiary)}',
      '.dpo-details[open]>summary::before{content:"▾ "}',
      // 优化类型上拉菜单：portal 到 document.body，避开 composer 的 containing block。
      '.dpo-menu{position:fixed;z-index:2147483000;box-sizing:border-box;min-width:260px;max-width:min(360px,calc(100vw - 24px));max-height:60vh;overflow:auto;padding:6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 28px rgba(0,0,0,.24);font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary)}',
      '.dpo-menu-title{padding:6px 10px 8px;color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.dpo-menu-item{display:flex;flex-direction:column;gap:3px;box-sizing:border-box;width:100%;padding:8px 10px;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dpo-menu-item:hover:not(:disabled),.dpo-menu-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}',
      '.dpo-menu-item:disabled{cursor:default;opacity:.6}',
      '.dpo-menu-name{font-size:13px;font-weight:500;line-height:1.3}',
      '.dpo-menu-desc{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary)}',
      // 静默优化：作为类型菜单里的一个可选项；主按钮在开启时给视觉反馈。
      '.dpo-menu-silent-on .dpo-menu-name:after{content:" ✓";color:var(--dsw-alias-button-primary-fill)}',
      '.dpo-composer-btn-silent{border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-button-primary-fill)}',
      // 静默优化对照：conversation.chat.user.before 槽，气泡上方显示原文/优化后。
      '.dpo-compare{box-sizing:border-box;display:block;margin:2px 0 6px;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5;max-width:100%}',
      '.dpo-compare>summary{cursor:pointer;list-style:none;user-select:none}',
      '.dpo-compare>summary::-webkit-details-marker{display:none}',
      '.dpo-compare>summary::before{content:"✦ ";color:var(--dsw-alias-button-primary-fill)}',
      '.dpo-compare-row{margin-top:6px}',
      '.dpo-compare-row b{display:block;color:var(--dsw-alias-label-tertiary);font-weight:500;margin-bottom:2px}',
      '.dpo-compare-row pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;max-height:120px;overflow:auto;font:inherit;user-select:text}',
      ].join('')
    }

    var CSS = cssText()

    var COPY = {
      zh: {
        title: '提示词优化',
        open: '优化提示词',
        optimize: '优化',
        optimizing: '优化中…',
        copy: '复制',
        copied: '已复制',
        original: '原始输入',
        empty: '在输入框里写好提示词，点输入框右侧的「✦ 优化」。',
        noDraft: '输入框是空的：请先在输入框里写好要优化的提示词。',
        failed: '优化失败',
        defaultModel: '默认模型',
        chooseType: '选择优化类型',
        templateGeneral: '通用优化',
        templateGeneralDesc: '按标准角色卡结构重组角色、技能与规则，适合大多数系统提示词。',
        templateAnalytical: '分析式结构优化',
        templateAnalyticalDesc: '深度分析意图与缺口，输出 Background/Attention/Goals 等完整结构，适合复杂业务场景。',
        templateFormat: '输出格式强化',
        templateFormatDesc: '在通用结构基础上补充 OutputFormat 小节，适合对返回格式有硬性要求的提示词。',
        templateMessage: '对话消息优化',
        templateMessageDesc: '优化你即将发送的一条消息本身，保持原有角色与语气，不替你生成回复。',
        templateStructured: '结构化提示词',
        templateStructuredDesc: '按身份/目标/硬性规则/工具策略/输出格式/数据不足时/示例 7 段结构重组。',
        silent: '静默优化提示词',
        silentDesc: '开关：输入框内容不变，发送时自动替换为按当前所选类型优化后的提示词。再点一次关闭。',
        silentOn: '静默优化已开：输入框内容不变，发送时自动替换为按所选类型优化后的提示词。',
        silentOff: '静默优化已关。',
        compareLabel: '已按静默优化改写',
        compareOriginal: '原文',
        compareOptimized: '实际发送给模型',
      },
      en: {
        title: 'Prompt Optimizer',
        open: 'Optimize prompt',
        optimize: 'Optimize',
        optimizing: 'Optimizing…',
        copy: 'Copy',
        copied: 'Copied',
        original: 'Original',
        empty: 'Write a prompt in the composer, then click "✦ Optimize" on its right.',
        noDraft: 'The composer is empty. Write the prompt first.',
        failed: 'Optimization failed',
        defaultModel: 'default model',
        chooseType: 'Choose optimization type',
        templateGeneral: 'General',
        templateGeneralDesc: 'Restructure into the standard role/skills/rules card. Best for most system prompts.',
        templateAnalytical: 'Analytical structure',
        templateAnalyticalDesc: 'Deep intent analysis with Background/Attention/Goals sections for complex scenarios.',
        templateFormat: 'Output format',
        templateFormatDesc: 'Adds an OutputFormat section on top of the general structure for strict output contracts.',
        templateMessage: 'Message polish',
        templateMessageDesc: 'Polishes the single message you are about to send, keeping role and tone.',
        templateStructured: 'Structured prompt',
        templateStructuredDesc: 'Restructure into 7 sections: identity/goals/hard rules/tool policy/output format/fallback/examples.',
        silent: 'Silent prompt optimization',
        silentDesc: 'Toggle: the composer stays unchanged; on send, the prompt is replaced by the optimization of the selected type. Click again to turn off.',
        silentOn: 'Silent optimize on: the composer stays unchanged; on send, the prompt is replaced by the optimization of the selected type.',
        silentOff: 'Silent optimize off.',
        compareLabel: 'Rewritten by silent optimize',
        compareOriginal: 'Original',
        compareOptimized: 'Sent to the model',
      },
    }

    // ------------------------------- 工具 ---------------------------------

    /**
     * 读当前会话输入框草稿。
     *
     * 优先用 `useInput` 拿到的实时状态；拿不到就回落 localStorage
     * （ui-conversation 把草稿持久化在 `dsh.conversation.<sessionId>`）。
     * @param input - useInput() 的返回值，可能为 undefined。
     * @param sessionId - 会话 id。
     * @returns 草稿文本，可能为空串。
     */
    function readDraft(input, sessionId) {
      var snapshot = input === undefined || input === null ? undefined : input.getSnapshot === undefined ? input : input.getSnapshot()
      var draft = snapshot === undefined || snapshot === null ? undefined : snapshot.draft
      if (typeof draft === 'string' && draft.trim() !== '') return draft
      if (typeof sessionId === 'string') {
        try {
          var raw = window.localStorage.getItem('dsh.conversation.' + sessionId)
          if (raw !== null) {
            var parsed = JSON.parse(raw)
            var value = parsed === null || parsed === undefined ? undefined : parsed.draft
            if (typeof value === 'string') return value
            if (value !== null && typeof value === 'object' && typeof value.text === 'string') return value.text
          }
        } catch (error) { /* 草稿不可读就当空 */ }
      }
      return ''
    }

    /**
     * 取当前会话选中的模型。先走 modelDirectories，再回落 projection。
     * @param ctx - 客户端 Context。
     * @param sessionId - 会话 id。
     * @returns `{ provider, model, reasoningEffort?, label }` 或 undefined。
     */
    function currentSelection(ctx, sessionId) {
      try {
        var resolver = ctx.modelDirectories
        if (resolver !== undefined && resolver !== null && typeof resolver.directoryFor === 'function') {
          var directory = resolver.directoryFor(sessionId)
          var state = directory === undefined || directory === null ? undefined : directory.store.getSnapshot()
          var selection = state === undefined || state === null ? undefined : state.current
          if (selection !== undefined && selection !== null && typeof selection.provider === 'string') {
            var label = selection.provider + ' / ' + selection.model
            var groups = Array.isArray(state.groups) ? state.groups : []
            for (var i = 0; i < groups.length; i += 1) {
              var group = groups[i]
              if (group === null || group === undefined || group.id !== selection.provider) continue
              var models = Array.isArray(group.models) ? group.models : []
              for (var j = 0; j < models.length; j += 1) {
                var model = models[j]
                if (model !== null && model !== undefined && model.id === selection.model && typeof model.name === 'string') {
                  label = (typeof group.name === 'string' ? group.name : group.id) + ' / ' + model.name
                }
              }
            }
            return {
              provider: selection.provider,
              model: selection.model,
              reasoningEffort: typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort : undefined,
              label: label,
            }
          }
        }
      } catch (error) { /* 落到下面的兜底 */ }
      try {
        var binding = ctx.sessions.binding(sessionId)
        var face = binding.session.projections.faceOf('modelSelection')
        var projected = face === undefined || face === null ? undefined : face.getSnapshot()
        var picked = projected === undefined || projected === null ? undefined : projected.next !== undefined && projected.next !== null ? projected.next : projected.lastUsed
        if (picked !== undefined && picked !== null && typeof picked.provider === 'string') {
          return {
            provider: picked.provider,
            model: picked.model,
            reasoningEffort: typeof picked.reasoningEffort === 'string' ? picked.reasoningEffort : undefined,
            label: picked.provider + ' / ' + picked.model,
          }
        }
      } catch (error) { /* 无会话绑定 */ }
      return undefined
    }

    /**
     * 把请求压成 base64url(deflate-raw(json))。
     *
     * 后端只能收 GET（webServer 的 resource 路由不读 body），而 GET 只能带 query，
     * 所以这里把 JSON 压一遍再 base64，长提示词才不会撞上 URL 长度上限。
     * 用原生 `CompressionStream('deflate-raw')`，与服务端 `inflateRawSync` 对齐；
     * 浏览器不支持时退回明文 base64（服务端解码失败会按明文 JSON 再试一次）。
     * @param payload - 待发送的对象。
     * @returns 可直接放进 `?q=` 的字符串。
     */
    function packQuery(payload) {
      // 宿主 webserver 的路由只吃 GET/HEAD（不改读 body），所以请求体只能进 query。
      // 这里用 base64url 传明文 JSON：宿主侧 decodePayload 先试 inflate，失败回落 utf8，
      // 两条路径都能解。不引 CompressionStream，避免把整条同步调用链改成 Promise。
      return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
    }

    /**
     * 字节数组 → base64url（无填充）。
     * @param bytes - Uint8Array。
     * @returns base64url 字符串。
     */
    function toBase64Url(bytes) {
      // 分块 apply：长提示词逐字符 += 会触发多次字符串重建，8192 一块把开销降到 O(n/8192)。
      var parts = []
      var CHUNK = 8192
      for (var i = 0; i < bytes.length; i += CHUNK) {
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)))
      }
      var binary = parts.join('')
      return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }

    /**
     * 点一下右侧栏自带的「展开」按钮。
     *
     * `layout.openRightbar(track, fullscreen)` 只是向布局**报告**呈现状态，
     * 并不会把右侧栏拉开（从外部调用还会让布局与实际状态不一致），
     * 真正改状态的只有 ui-sidebar-right 自己那个 `data-sidebar-right-expand`
     * 按钮（onClick = actions.setExpanded(sessionId, true)）。
     * 该按钮在已展开时返回 null，所以能点到就说明确实收起着。
     * @returns 是否点到了按钮。
     */
    function clickExpandButton() {
      try {
        if (typeof document === 'undefined') return false
        var button = document.querySelector('[data-sidebar-right-expand]')
        if (button === null || button === undefined) return false
        if (button.disabled === true) return false
        button.click()
        return true
      } catch (error) { return false }
    }

    /**
     * 打开（或刷新）结果 tab，带重试；侧边栏被关掉时自动重新打开。
     *
     * 「关掉侧边栏」有两种，必须分别恢复：
     *  1) 整个右侧栏容器被关（layout.rightbarShown = false）：rightbar seat 卸载、
     *     adopt 释放，sidebarRight 的 require() 会抛 "no session surface is
     *     mounted"。此时必须先用 layout.openRightbar(true, false) 让容器重新
     *     挂载（ui-layout 的 stores.ts 里它确实把 rightbarShown 置为 true），
     *     等 seat 重新渲染、重新 adopt 后 openContent 才能成功。
     *  2) 只是列被折叠到 rail（sidebarRight.expanded = false）：点 ExpandButton
     *     （data-sidebar-right-expand，onClick = actions.setExpanded(sessionId,true)）。
     *
     * 注意 layout.openRightbar「不改变 expanded state」说的是上面的第 2 种列折叠
     * 状态，而不是容器显示状态；它不会与 sidebarRight 自己的展开相互干扰，
     * seat 重新渲染后还会用 syncPresentation 把呈现参数同步回正确值。
     *
     * 每次 push（running/done/error）都会走这里：即便用户在优化进行中把侧边栏
     * 关掉，结果出来时也会自动重新打开，而不是报错。失败循环最多 2 秒，
     * 全失败才把错误暴露出来（之前这里是空 catch，表现为「点击没反应」）。
     * @param ctx - 客户端 Context。
     * @param payload - 结果面板状态。
     * @param sessionId - 会话 id，仅用于诊断。
     */
    function openPanel(ctx, payload, sessionId) {
      var layout = undefined
      try { layout = typeof ctx.get === 'function' ? ctx.get('layout') : ctx.layout } catch (ignored) { }
      var ensureContainer = function () {
        try {
          if (layout !== undefined && typeof layout.openRightbar === 'function') layout.openRightbar(true, false)
        } catch (ignored) { }
      }
      // 容器若被整个关掉，先把容器重新挂载；再走正常的 openContent。
      ensureContainer()
      var attempts = 0
      var maxAttempts = 40
      var attempt = function () {
        attempts += 1
        try {
          ctx.sidebarRight.openContent(KIND, payload, { key: CONTENT_KEY, destination: 'sidebar' })
          return
        } catch (error) {
          if (attempts < maxAttempts) {
            // 每次失败都重新确保容器显示：用户可能在等待优化时又把它关掉。
            ensureContainer()
            // 列折叠时点展开按钮；容器重挂后该按钮会重新出现，多试几次。
            if (attempts <= 3) clickExpandButton()
            window.setTimeout(attempt, 50)
            return
          }
          var detail = error instanceof Error ? error.message : String(error)
          try { console.error('[prompt-optimizer] 打开侧边栏失败:', error, { sessionId: sessionId }) } catch (ignored) { }
          try {
            window.alert('提示词优化：没能打开右侧栏（' + detail + '）。\n请手动展开右侧栏面板后再点「✦ 优化」。')
          } catch (ignored) { }
        }
      }
      attempt()
    }

    /** sessionId -> 最新请求 id，用来丢弃同一会话的过期响应（按会话隔离）。 */
    var latestRequestId = new Map()

    /**
     * 请求后端优化。所有状态变化都会同步到侧边栏 tab。
     * @param ctx - 客户端 Context。
     * @param sessionId - 会话 id。
     * @param options - `{ prompt, templateId }`。
     */
    function runOptimize(ctx, sessionId, options) {
      // 所有状态推送都经这里：openPanel 自己保证右侧栏已展开并可重试。
      var push = function (payload) { openPanel(ctx, payload, sessionId) }
      var prompt = typeof options.prompt === 'string' ? options.prompt.trim() : ''
      if (prompt === '') {
        push({ status: 'error', error: 'noDraft', prompt: '', templateId: options.templateId })
        return
      }
      var selection = currentSelection(ctx, sessionId)
      var packed = packQuery({
        prompt: prompt,
        template: typeof options.templateId === 'string' ? options.templateId : undefined,
        provider: selection === undefined ? undefined : selection.provider,
        model: selection === undefined ? undefined : selection.model,
        reasoningEffort: selection === undefined ? undefined : selection.reasoningEffort,
      })
      push({
        status: 'running',
        prompt: prompt,
        templateId: options.templateId,
        modelLabel: selection === undefined ? undefined : selection.label,
      })
      var requestId = String(Date.now()) + '-' + Math.random().toString(36).slice(2)
      // 按会话隔离「最新请求 id」：同会话连点只认最后一次，跨会话互不误取消。
      // 之前用 ctx.__dpoRequestId 单值，A 会话发请求会被 B 会话覆盖后丢弃。
      var key = String(sessionId)
      latestRequestId.set(key, requestId)
      fetch(API + '/optimize?q=' + encodeURIComponent(packed), { method: 'GET', headers: { accept: 'application/json' } })
        .then(function (response) {
          if (response.status === 401) throw new Error('未通过宿主认证：请从 DSH 窗口内使用本插件')
          return response.json()
        })
        .then(function (payload) {
          if (latestRequestId.get(key) !== requestId) return
          if (payload !== null && payload.ok === true && typeof payload.result === 'string') {
            push({
              status: 'done',
              prompt: prompt,
              result: payload.result,
              templateId: options.templateId,
              modelLabel: selection === undefined ? undefined : selection.label,
              modelSource: payload.modelSource,
              usage: payload.usage === null || payload.usage === undefined ? undefined : payload.usage,
            })
            return
          }
          push({
            status: 'error',
            prompt: prompt,
            templateId: options.templateId,
            modelLabel: selection === undefined ? undefined : selection.label,
            error: payload !== null && typeof payload.error === 'string' ? payload.error : 'unknown',
          })
        })
        .catch(function (error) {
          if (latestRequestId.get(key) !== requestId) return
          push({
            status: 'error',
            prompt: prompt,
            templateId: options.templateId,
            modelLabel: selection === undefined ? undefined : selection.label,
            error: error instanceof Error ? error.message : String(error),
          })
        })
    }

    /**
     * 复制到剪贴板，带 execCommand 兜底。
     * @param text - 要复制的文本。
     * @returns 成功与否。
     */
    function copyText(text) {
      var write = navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function'
        ? navigator.clipboard.writeText(text).then(function () { return true }, function () { return false })
        : Promise.resolve(false)
      return write.then(function (ok) {
        if (ok) return true
        try {
          var area = document.createElement('textarea')
          area.value = text
          area.setAttribute('readonly', '')
          area.style.position = 'fixed'
          area.style.left = '-9999px'
          document.body.appendChild(area)
          area.select()
          var done = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
          document.body.removeChild(area)
          return done === true
        } catch (error) { return false }
      })
    }

    // --------------------------- 类型选择上拉菜单 ---------------------------

    /** 当前打开的类型菜单（全局单例，打开新的会先关掉旧的）。 */
    var activeTypeMenu = null

    /** 关闭当前类型菜单。 */
    function closeTypeMenu() {
      var menu = activeTypeMenu
      activeTypeMenu = null
      if (menu === null || menu === undefined) return
      try {
        if (menu._dpoOnDocDown) document.removeEventListener('pointerdown', menu._dpoOnDocDown, true)
      } catch (error) { /* ignore */ }
      try {
        if (menu.parentNode !== null && menu.parentNode !== undefined) menu.parentNode.removeChild(menu)
      } catch (error) { /* ignore */ }
    }

    /**
     * 在按钮上方弹出「选择优化类型」菜单，portal 到 document.body。
     *
     * 用原生 DOM 构建而不依赖 react-dom 的 createPortal，也不引入任何新模块：
     * composer 是 docked 容器（可能带 transform/overflow），position:fixed 会被
     * 困在里面，所以菜单必须挂到 body；之前「点优化没反应」正是模块/hook 踩坑，
     * 这里刻意保持零依赖。
     *
     * @param t - locale 绑定函数。
     * @param anchorEl - 触发按钮的 DOM 节点，用来定位。
     * @param onPick - 选中模板 id 后的回调（'__silent__' 表示静默优化开关）。
     * @param silentOn - 静默优化当前是否开启，用来给选项打勾。
     */
    function openTypeMenu(t, anchorEl, onPick, silentOn) {
      closeTypeMenu()
      try {
        var menu = document.createElement('div')
        menu.className = 'dpo-menu'
        menu.setAttribute('data-dpo-menu', '')
        var title = document.createElement('div')
        title.className = 'dpo-menu-title'
        title.textContent = t('chooseType')
        menu.appendChild(title)
        TEMPLATE_CHOICES.forEach(function (choice) {
          var item = document.createElement('button')
          item.type = 'button'
          item.className = 'dpo-menu-item'
          item.setAttribute('data-dpo-template', choice.id)
          var name = document.createElement('span')
          name.className = 'dpo-menu-name'
          name.textContent = t(choice.nameKey)
          var desc = document.createElement('span')
          desc.className = 'dpo-menu-desc'
          desc.textContent = t(choice.descKey)
          item.appendChild(name)
          item.appendChild(desc)
          item.addEventListener('click', function (e) {
            e.stopPropagation()
            closeTypeMenu()
            onPick(choice.id)
          })
          menu.appendChild(item)
        })
        // 静默优化：菜单里的一个可选项，不占独立按钮。
        var silentItem = document.createElement('button')
        silentItem.type = 'button'
        silentItem.className = 'dpo-menu-item' + (silentOn === true ? ' dpo-menu-silent-on' : '')
        silentItem.setAttribute('data-dpo-template', '__silent__')
        var silentName = document.createElement('span')
        silentName.className = 'dpo-menu-name'
        silentName.textContent = t('silent')
        var silentDesc = document.createElement('span')
        silentDesc.className = 'dpo-menu-desc'
        silentDesc.textContent = t('silentDesc')
        silentItem.appendChild(silentName)
        silentItem.appendChild(silentDesc)
        silentItem.addEventListener('click', function (e) {
          e.stopPropagation()
          closeTypeMenu()
          onPick('__silent__')
        })
        menu.appendChild(silentItem)
        document.body.appendChild(menu)

        // 定位：优先在按钮上方（上拉），上方空间不够时改到下方。
        var rect = anchorEl !== null && anchorEl !== undefined && typeof anchorEl.getBoundingClientRect === 'function'
          ? anchorEl.getBoundingClientRect()
          : null
        var mh = menu.offsetHeight || 0
        var mw = menu.offsetWidth || 0
        var vw = window.innerWidth || 1024
        var vh = window.innerHeight || 768
        var left = rect === null ? 8 : Math.min(Math.max(8, rect.left), Math.max(8, vw - mw - 8))
        var top = rect === null ? 8 : rect.top - mh - 8
        if (top < 8) top = rect === null ? 8 : Math.min(rect.bottom + 8, Math.max(8, vh - mh - 8))
        menu.style.left = Math.max(8, left) + 'px'
        menu.style.top = Math.max(8, top) + 'px'

        // 点菜单和按钮之外的地方关闭。
        var onDocDown = function (e) {
          try {
            if (menu.contains(e.target)) return
            if (anchorEl !== null && anchorEl !== undefined && anchorEl.contains(e.target)) return
          } catch (error) { /* ignore */ }
          closeTypeMenu()
        }
        menu._dpoOnDocDown = onDocDown
        document.addEventListener('pointerdown', onDocDown, true)
        activeTypeMenu = menu
      } catch (error) {
        closeTypeMenu()
        try { console.error('[prompt-optimizer] 打开类型菜单失败:', error) } catch (ignored) { }
        // 菜单彻底打不开时回落到默认模板，保证入口仍可用。
        onPick(DEFAULT_TEMPLATE)
      }
    }

    /**
     * 读写 host 侧的静默优化开关。
     * 开关状态存在 host 内存的 silentState（按 sessionId），
     * 浏览器半边只负责发请求 + 更新自己的 UI。
     */
    function silentRequest(sessionId, patch) {
      var qs = 'sid=' + encodeURIComponent(sessionId)
      if (patch !== undefined) {
        qs += '&on=' + (patch.on === true ? '1' : '0') + '&tpl=' + encodeURIComponent(patch.templateId || DEFAULT_TEMPLATE)
      }
      return fetch(API + '/silent?' + qs, { method: 'GET', headers: { accept: 'application/json' } })
        .then(function (r) { return r.json() })
        .catch(function (error) {
          if (patch !== undefined) {
            try { console.error('[prompt-optimizer] 静默开关写入失败:', error) } catch (ignored) { }
          }
          return null
        })
    }
    /** 写开关（带 tpl）。 */
    function writeSilent(sessionId, on, templateId) {
      return silentRequest(sessionId, { on, templateId })
    }
    /** 只读查当前状态（切回会话时恢复 UI）。 */
    function readSilent(sessionId) {
      return silentRequest(sessionId)
    }

    // ------------------------------ 组件 ---------------------------------

    /** 小按钮。 */
    function Btn(props) {
      var className = 'dpo-btn' + (props.primary === true ? ' dpo-btn-primary' : '') + (props.icon === true ? ' dpo-btn-icon' : '')
      return h('button', {
        type: 'button',
        className: className + (props.className === undefined ? '' : ' ' + props.className),
        disabled: props.disabled === true,
        title: props.title,
        onClick: props.onClick,
      }, props.children)
    }

    /**
     * 结果面板（sidebar.right.pane.tab）。
     *
     * 面板只负责呈现：「复制」是唯一的按钮。
     * 发起优化一律走输入框那个入口，面板里不再重复放操作按钮。
     */
    function ResultPanel(props) {
      var t = props.t
      var info = props.useTabInfo()
      var params = (info.tab.navigation !== undefined && info.tab.navigation.params) || {}
      var state = params
      var copyState = React.useState(false)
      var copied = copyState[0]
      var setCopied = copyState[1]

      React.useEffect(function () {
        if (!copied) return undefined
        var timer = window.setTimeout(function () { setCopied(false) }, 1200)
        return function () { window.clearTimeout(timer) }
      }, [copied])

      var status = typeof state.status === 'string' ? state.status : 'empty'
      var result = typeof state.result === 'string' ? state.result : ''
      var errorText = typeof state.error === 'string' ? state.error : ''
      if (errorText === 'noDraft') errorText = t('noDraft')
      var prompt = typeof state.prompt === 'string' ? state.prompt : ''
      var modelLabel = typeof state.modelLabel === 'string' ? state.modelLabel : ''

      var onCopy = function () {
        if (result === '') return
        copyText(result).then(function (ok) { if (ok) setCopied(true) })
      }

      var body
      if (status === 'running') {
        body = h('div', { className: 'dpo-note' }, t('optimizing'))
      } else if (status === 'error') {
        body = h('div', { className: 'dpo-error' }, t('failed') + '：' + errorText)
      } else if (status === 'done') {
        body = h('pre', { className: 'dpo-pre' }, result)
      } else {
        body = h('div', { className: 'dpo-note' }, t('empty'))
      }

      return h('div', { className: 'dpo-root' }, [
        h('div', { className: 'dpo-bar', key: 'bar' }, [
          h('span', {
            className: 'dpo-model',
            key: 'model',
            title: modelLabel === '' ? t('defaultModel') : modelLabel,
          }, modelLabel === '' ? t('defaultModel') : modelLabel),
          h('span', { className: 'dpo-spacer', key: 'spacer' }),
          result !== ''
            ? h(Btn, { key: 'copy', onClick: onCopy, title: t('copy') }, copied ? t('copied') : t('copy'))
            : null,
        ]),
        h('div', { className: 'dpo-body', key: 'body' }, [
          prompt !== ''
            ? h('details', { className: 'dpo-details', key: 'original' }, [
              h('summary', { className: 'dpo-label', key: 'label' }, t('original')),
              h('div', { className: 'dpo-original', key: 'text' }, h('pre', { className: 'dpo-pre' }, prompt)),
            ])
            : null,
          h('div', { key: 'result' }, body),
        ]),
      ])
    }

    /**
     * tab 标题（sidebar.right.pane.tab.title）。
     *
     * 不订阅 useTabInfo：标题是静态文案，订阅会让它随每次 navigation.params 推送
     * 多渲染一轮，而渲染结果完全不变。
     */
    function PanelTitle(props) {
      return h(Fragment, null, h('span', { className: 'dpo-dot' }), props.t('title'))
    }

    /**
     * 静默优化对照（conversation.chat.user.before chain 槽）。
     *
     * host 侧改写用户消息 content 时把原文/优化版挂到 source.optimizer，
     * 这里从 owner.source 读出来，在用户气泡上方显示“原文 / 实际发送”。
     * 纯展示、无 hook，matched 由槽的 select 计算并传入。
     */
    function PromptNotice(props) {
      var matched = props.matched
      var t = props.t
      var originalText = matched === undefined || matched === null || typeof matched.originalText !== 'string' ? '' : matched.originalText
      var optimizedText = matched === undefined || matched === null || typeof matched.optimizedText !== 'string' ? '' : matched.optimizedText
      return h('details', { className: 'dpo-compare' }, [
        h('summary', { key: 'label' }, t('compareLabel')),
        h('div', { className: 'dpo-compare-row', key: 'original' }, [
          h('b', { key: 'h' }, t('compareOriginal')),
          h('pre', { key: 'v' }, originalText),
        ]),
        h('div', { className: 'dpo-compare-row', key: 'optimized' }, [
          h('b', { key: 'h' }, t('compareOptimized')),
          h('pre', { key: 'v' }, optimizedText),
        ]),
      ])
    }

    /**
     * 输入框右侧入口（conversation.input.right，list 槽）—— 唯一的入口。
     *
     * 读输入框草稿 → 用对话中选中的模型优化 → 结果推到右侧栏。
     */
    /** 读 InputState.draft（string）。提到模块级，避免每次渲染新建闭包。 */
    function selectDraftOf(s) {
      return s === undefined || s === null ? '' : (typeof s.draft === 'string' ? s.draft : '')
    }
    /** props.useInput 缺席时的恒定 fallback：保证 hook 调用数量每次一致。 */
    function useInputFallback(sel) { return sel(undefined) }

    function ComposerEntry(props) {
      var state = React.useState('idle')
      var phase = state[0]
      var setPhase = state[1]
      var ctx = props.ctx
      // useInput 是 React hook（SnapshotSelectorHook = <S>(sel)=>S）：
      // 必须在组件 body 顶层无条件调用、并传 selector。放到 onClick 里调用
      // 会抛 Invalid hook call，整个处理器中断 —— 表现就是「点了没反应」。
      var useInput = typeof props.useInput === 'function' ? props.useInput : useInputFallback
      var draft = useInput(selectDraftOf)
      var draftRef = React.useRef(draft)
      draftRef.current = draft
      var btnRef = React.useRef(null)
      // 静默优化开关：状态以 host 为准（切会话/重启后仍在），这里只做 UI + 发请求。
      var silentStateR = React.useState(false)
      var silentOn = silentStateR[0]
      var setSilentOn = silentStateR[1]
      var silentRef = React.useRef(false)
      silentRef.current = silentOn
      React.useEffect(function () {
        if (props.sessionId === undefined || props.sessionId === null) return undefined
        var alive = true
        readSilent(String(props.sessionId)).then(function (payload) {
          if (!alive || payload === null || payload.ok !== true || payload.enabled !== true) return
          setSilentOn(true)
          if (typeof payload.templateId === 'string' && payload.templateId !== '') lastTemplateId = payload.templateId
        })
        return function () { alive = false }
      }, [props.sessionId])

      // 点按钮本身只负责开关类型菜单；真正发起优化在选中模板后。
      var onToggleMenu = function (e) {
        if (phase === 'running') return
        e.stopPropagation()
        if (activeTypeMenu !== null && activeTypeMenu !== undefined) {
          closeTypeMenu()
          return
        }
        var text = typeof draftRef.current === 'string' ? draftRef.current : ''
        if (text.trim() === '') text = readDraft(undefined, props.sessionId)
        if (text.trim() === '') {
          // 空输入直接给错误态，不弹菜单。
          try {
            runOptimize(ctx, props.sessionId, { prompt: '', templateId: DEFAULT_TEMPLATE })
          } catch (error) {
            try { console.error('[prompt-optimizer] 优化入口异常:', error) } catch (ignored) { }
          }
          return
        }
        var anchor = btnRef.current
        openTypeMenu(props.t, anchor, function (templateId) {
          // 「静默优化提示词」是菜单里的一个可选项：只切换开关，不改输入框、不发优化请求。
          if (templateId === '__silent__') {
            var next = !silentRef.current
            silentRef.current = next
            setSilentOn(next)
            writeSilent(String(props.sessionId), next, lastTemplateId)
            return
          }
          // 「模式以选择的模式为准」：记住这次选的类型，静默优化也用它。
          lastTemplateId = templateId
          if (silentRef.current) writeSilent(String(props.sessionId), true, templateId)
          setPhase('running')
          // 失败立即复位；成功则在 400ms 后复位（给「优化中」态一个可见停留）。
          // 两条路径只走其一，不再 try 里 set 一次、finally 里又定时 set 一次。
          try {
            runOptimize(ctx, props.sessionId, { prompt: text, templateId: templateId })
            window.setTimeout(function () { setPhase('idle') }, 400)
          } catch (error) {
            try { console.error('[prompt-optimizer] 优化入口异常:', error) } catch (ignored) { }
            setPhase('idle')
          }
        }, silentOn)
      }

      // 唯一入口按钮；静默优化作为类型菜单里的一个可选项，不再单独占一个按钮。
      return h('button', {
        type: 'button',
        ref: btnRef,
        className: 'dpo-composer-btn' + (silentOn ? ' dpo-composer-btn-silent' : ''),
        title: props.t(silentOn ? 'silentOn' : 'open'),
        disabled: phase === 'running',
        onClick: onToggleMenu,
      }, [
        h('span', { className: 'dpo-spark', key: 'spark' }, '✦'),
        h('span', { key: 'text' }, phase === 'running' ? props.t('optimizing') : props.t('optimize')),
      ])
    }

    // ------------------------------ 插件 ---------------------------------

    /** 需要的客户端服务。 */
    exports.inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'modelDirectories', 'sessions']

    /**
     * 挂载插件。
     * @param ctx - 客户端 Context。
     */
    exports.apply = function apply(ctx) {
      // 样式自注入：meta() 在 factory 之外执行、拿不到本作用域的 cssText，
      // 因此改由 apply 插入 <style>（主题令牌仍由 --dsw-alias-* 提供）。
      ctx.effect(function () {
        var el = document.createElement('style')
        el.setAttribute('data-dsh-prompt-optimizer', 'style')
        el.textContent = CSS
        document.head.appendChild(el)
        return function () {
          if (el.parentNode !== null) el.parentNode.removeChild(el)
        }
      }, 'dsh-prompt-optimizer.style')

      ctx.effect(function () { return ctx.locale.register(NS, COPY) }, 'dsh-prompt-optimizer.copy')
      var t = ctx.locale.bind(NS)

      ctx.effect(function () {
        return ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          multiple: false,
          priority: 'extension',
          title: function () { return t('title') },
        })
      }, 'dsh-prompt-optimizer.kind')

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            locale: NS,
            inject: function (sessionId) {
              return { ctx: ctx, sessionId: sessionId }
            },
          }, ResultPanel)
        })
      }, 'dsh-prompt-optimizer.body')

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.right.pane.tab.title', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: TAB_ID,
            locale: NS,
          }, PanelTitle)
        })
      }, 'dsh-prompt-optimizer.title')

      // 入口只有一个：输入框右侧（list 槽，贴着 composer）。
      ctx.effect(function () {
        return ctx.slots.inject('conversation.input.right', function () {
          return ctx.slots.register({
            name: 'conversation.input.right',
            id: TAB_ID,
            locale: NS,
            inject: function (sessionId) {
              return { ctx: ctx, sessionId: sessionId }
            },
          }, ComposerEntry)
        })
      }, 'dsh-prompt-optimizer.composer')

      // 静默优化对照：在用户气泡上方显示原文 / 实际发送给模型的优化版。
      // chain 槽，select 从 owner.source.optimizer 读元数据；无元数据返回 null。
      ctx.effect(function () {
        return ctx.slots.inject('conversation.chat.user.before', function () {
          return ctx.slots.register({
            name: 'conversation.chat.user.before',
            locale: NS,
            select: function (owner) {
              if (owner === undefined || owner === null) return null
              var source = owner.source
              if (source === undefined || source === null) return null
              var meta = source.optimizer
              if (meta === undefined || meta === null) return null
              if (typeof meta.originalText !== 'string' || typeof meta.optimizedText !== 'string') return null
              return meta
            },
          }, PromptNotice)
        })
      }, 'dsh-prompt-optimizer.bubble')
    }

    return module.exports
  },
})
