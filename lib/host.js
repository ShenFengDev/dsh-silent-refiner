/**
 * 提示词优化插件的宿主半边。
 *
 * 职责边界（与工作流一致）：
 * 1. 向浏览器暴露一个只读的 GET 接口：`/dsh-prompt-optimizer/optimize`，
 *    用「对话中当前选中的模型」跑一次优化，把结果 JSON 回给侧边栏。
 * 2. 不写文件、不落库、不向任何第三方转发提示词内容；模型凭据由 DSH 的
 *    llm 服务统一持有，插件本身不接触 apiKey。
 *
 * 三条硬纪律（来自 DSH 插件实践）：
 * - `apply()` 绝不抛同步异常，否则该 fiber 失败、启动审计报错；
 * - `inject` 只声明确实存在的服务，声明不存在的服务会让 fiber 卡在 PENDING；
 * - 不打日志噪音。
 */

import { inflateRawSync } from 'node:zlib'
import { statSync } from 'node:fs'

/**
 * 模板模块的**热取**入口。
 *
 * 宿主对 profile patch 的增删会热加载 plugin row，但已 import 的 ESM 模块会
 * 一直留在模块缓存里 —— 改了 `prompts.js` 不重启就看不到效果。为了能边改边验，
 * 这里每次都用带 `?v=<mtime>` 的说明符重新 import，只有 mtime 变化时才换新。
 * `statSync` 走顶层静态 import：每次优化都会调它，动态 import 的额外 await 是纯开销。
 */
let promptsCache = { stamp: 0, mod: undefined }
const PROMPTS_URL = new URL('./prompts.js', import.meta.url)

async function prompts() {
  let stamp = 0
  try {
    stamp = statSync(PROMPTS_URL).mtimeMs
  }
  catch {
    stamp = 0
  }
  if (promptsCache.mod !== undefined && promptsCache.stamp === stamp) return promptsCache.mod
  const mod = await import(stamp === 0 ? PROMPTS_URL.href : `${PROMPTS_URL.href}?v=${stamp}`)
  promptsCache = { stamp, mod }
  return mod
}

/** 路由前缀。与 client 半边的 fetch 地址必须保持一致。 */
const ROUTE_PATH = '/dsh-prompt-optimizer'

/** 静默优化未指定模板时的默认模板 id。 */
const DEFAULT_TEMPLATE_ID = 'general-optimize'

/** 请求放进 query 的最大字节数（deflate 压缩后 base64url）。 */
const MAX_QUERY_CHARS = 32_000

/** 单次优化的输出上限，防止模板把上万个 token 全吐出来。 */
const MAX_OUTPUT_TOKENS = 8192

/** 请求超时。优化是交互式动作，不让侧边栏一直转。 */
const TIMEOUT_MS = 180_000

/** 输入长度上限（字符）。 */
const MAX_PROMPT_CHARS = 60_000

/**
 * 静默优化：sessionId -> { enabled, templateId }。
 * 浏览器半边通过 `GET /dsh-prompt-optimizer/silent` 写入；`agent/pre-step`
 * 读取它，对本轮的用户消息做无感替换（输入框原文不动）。
 */
const silentState = new Map()

/** 静默优化单独的上限，避免一次 LLM 调用拖住整个 turn。 */
const SILENT_TIMEOUT_MS = 90_000

/**
 * 本地 deepFreeze，避免为了 freezeMessage 引入额外 import 依赖。
 * DSH 的 session.append 期待不可变消息，故替换后的消息需冻结。
 * @param message - 消息对象。
 * @returns 冻结后的新对象。
 */
function freezeMessageLocal(message) {
  function deepFreeze(value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value)
      for (const key of Object.keys(value)) deepFreeze(value[key])
    }
    return value
  }
  let copy
  try {
    copy = typeof structuredClone === 'function' ? structuredClone(message) : { ...message }
  } catch {
    copy = { ...message }
  }
  return deepFreeze(copy)
}

/**
 * 需要 llm 与 webServer；两者都由 dsh-base / dsh-web 提供。
 *
 * `agentDefaultModel` **不**写进 inject：它是可选的兜底来源，插件在浏览器
 * 总会带上「对话中选中的模型」，硬声明反而会在该服务缺席时把 fiber 卡在
 * PENDING。兜底读取走 `ctx.get(...)` 软引用（见 `defaultSelection`）。
 */
export const inject = ['llm', 'webServer']

/**
 * 软读取部署默认模型。
 * @param ctx - 宿主 Context。
 * @returns `{ provider, model, reasoningEffort? } | undefined`。
 */
function defaultSelection(ctx) {
  try {
    const service = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined
    const selection = service?.currentSelection?.()
    if (selection !== undefined && selection !== null
      && typeof selection.provider === 'string' && typeof selection.model === 'string') {
      return selection
    }
  }
  catch {
    // 服务缺席或读取失败都按「无兜底」处理，不让插件因此抛错。
  }
  return undefined
}

/** 可路由性缓存有效期：模型列表不常变，30 秒内复用避免每次优化两次 IPC。 */
const ROUTABLE_TTL_MS = 30_000
/** 按 ctx 隔离（WeakMap 不阻止回收），每个 ctx 一张 provider→{models,at} 表。 */
const routableCache = new WeakMap()

/**
 * 判断某个 provider/model 组合是否真的可路由。
 * provider 的模型列表按 ctx 缓存 30 秒；provider 本身的存在性也随该缓存一起判定，
 * 避免每轮优化都跑两次跨进程 IPC。
 * @param ctx - 宿主 Context。
 * @param provider - provider id。
 * @param model - model id。
 * @returns 可路由返回 true。
 */
async function isRoutable(ctx, provider, model) {
  try {
    let cache = routableCache.get(ctx)
    if (cache === undefined) {
      cache = new Map()
      routableCache.set(ctx, cache)
    }
    const providers = ctx.llm.listProviders()
    if (!providers.some(entry => entry.id === provider)) return false
    let entry = cache.get(provider)
    const now = Date.now()
    if (entry === undefined || now - entry.at > ROUTABLE_TTL_MS) {
      entry = { models: await ctx.llm.listModels(provider), at: now }
      cache.set(provider, entry)
    }
    return entry.models.some(entryModel => entryModel.id === model)
  } catch {
    return false
  }
}

/**
 * 解析本次调用要用的模型。
 *
 * 顺序：请求里显式携带的（浏览器读到的「对话中选中模型」）→ 部署默认。
 * 永远不会退化成硬编码模型名：两条来源都为空时直接报错。
 * @param ctx - 宿主 Context。
 * @param requested - 请求声明的模型。
 * @returns `{ provider, model, reasoningEffort? }`。
 */
async function resolveRoute(ctx, requested) {
  if (typeof requested?.provider === 'string' && typeof requested.model === 'string'
    && requested.provider !== '' && requested.model !== '') {
    const route = {
      provider: requested.provider,
      model: requested.model,
      ...(typeof requested.reasoningEffort === 'string' && requested.reasoningEffort !== ''
        ? { reasoningEffort: requested.reasoningEffort }
        : {}),
    }
    if (await isRoutable(ctx, route.provider, route.model)) return { route, source: 'conversation' }
  }
  const fallback = defaultSelection(ctx)
  if (fallback === undefined) {
    throw new Error('没有可用的模型：当前会话未选中模型，且部署默认模型未配置')
  }
  return {
    route: {
      provider: fallback.provider,
      model: fallback.model,
      ...(fallback.reasoningEffort === undefined ? {} : { reasoningEffort: fallback.reasoningEffort }),
    },
    source: 'default',
  }
}

/**
 * 把消息归一化成 DSH 适配器要求的强类型形状。
 *
 * `@deepseek-ai/dsh-llm` 及其 pi-ai 适配器对 `messages[].content` 做
 * `content.some(...)` / `for...of` 遍历，只接受 **block 数组**；收到裸字符串会抛
 * `content.some is not a function`。这里做一次无副作用归一化，让模板层与
 * 适配器层解耦，任何一层的形状变化都不会打到调用方。
 * @param messages - 可能松散的消列表。
 * @returns 归一化后的消息列表。
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages.map((message) => {
    const content = message?.content
    if (Array.isArray(content)) return { role: message.role, content }
    if (typeof content === 'string') {
      return { role: message.role, content: [{ type: 'text', text: content }] }
    }
    return { role: message.role, content: [] }
  })
}

/**
 * 跑一次优化调用，返回拼好的纯文本。
 * @param ctx - 宿主 Context。
 * @param route - 已解析的模型路由。
 * @param system - 请求级 system 文本（模板正文）。
 * @param messages - 强类型历史消息（content 为 block 数组）。
 * @param signal - 取消信号。
 * @returns `{ text, usage }`。
 */
async function callModel(ctx, route, system, messages, signal) {
  const normalized = normalizeMessages(messages)
  const options = {
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
    messages: normalized,
    ...(system === '' ? {} : { system }),
    maxTokens: MAX_OUTPUT_TOKENS,
    signal,
    purpose: 'prompt-optimize',
  }
  let text = ''
  let reasoning = ''
  let usage
  let failure
  try {
    for await (const chunk of ctx.llm.stream(options)) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'reasoning-delta') {
        // 部分路由（如 deepseek-v4.1-flash）先写思维链再写正文；思维链不计入结果，
        // 但若正文为空，退化用思维链兜底，避免侧边栏一片空白。
        reasoning += chunk.text ?? ''
      }
      else if (chunk.type === 'usage') usage = chunk.usage
      else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') failure = chunk.reason.failure
    }
  }
  catch (error) {
    const detail = error?.message ?? String(error)
    throw new Error(`模型调用失败：${detail}`)
  }
  if (failure !== undefined) {
    const detail = failure?.message ?? failure?.detail ?? String(failure)
    throw new Error(`模型调用失败：${detail}`)
  }
  return { text: text.trim() === '' ? reasoning : text, usage }
}

/**
 * 解码 `?q=` 里的压缩 JSON。浏览器侧用 deflate-raw + base64url 打包，
 * 避免长提示词撞上 URL 长度上限。
 * @param raw - base64url 文本。
 * @returns 解析后的对象。
 */
function decodePayload(raw) {
  if (raw.length > MAX_QUERY_CHARS) throw new Error('请求过大：请缩短提示词')
  const buffer = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  let text
  try {
    text = inflateRawSync(buffer).toString('utf8')
  } catch {
    text = buffer.toString('utf8')
  }
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求格式错误')
  }
  return parsed
}

/**
 * 读取并校验请求参数。两种形态都支持：
 * - `?q=<base64url(deflate-raw(json))>` —— 客户端默认走这条；
 * - 平铺 query（`prompt`/`template`/`provider`/`model`）—— 方便手工调试。
 * @param url - 请求 URL。
 * @returns 解析后的请求。
 */
function parseRequest(url) {
  const packed = url.searchParams.get('q')
  const source = packed === null || packed === '' ? {
    prompt: url.searchParams.get('prompt') ?? '',
    template: url.searchParams.get('template') ?? undefined,
    provider: url.searchParams.get('provider') ?? undefined,
    model: url.searchParams.get('model') ?? undefined,
    reasoningEffort: url.searchParams.get('reasoningEffort') ?? undefined,
  } : decodePayload(packed)

  const prompt = typeof source.prompt === 'string' ? source.prompt.trim() : ''
  if (prompt === '') throw new Error('输入为空：请先在输入框写好要优化的提示词')
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error(`输入过长：最多 ${MAX_PROMPT_CHARS} 字符`)
  const route = {
    provider: typeof source.provider === 'string' ? source.provider : undefined,
    model: typeof source.model === 'string' ? source.model : undefined,
    reasoningEffort: typeof source.reasoningEffort === 'string' ? source.reasoningEffort : undefined,
  }
  return { prompt, templateId: typeof source.template === 'string' ? source.template : undefined, route }
}

/**
 * 静默优化：用当前模型 + 指定模板，把一段文本优化成发给模型的版本。
 *
 * 走独立的 `ctx.llm.stream`（底层模型调用，不经过 agent loop），因此不会
 * 递归触发 `agent/pre-step`。失败由调用方降级为原文。
 * @param ctx - 宿主 Context。
 * @param text - 原始用户文本。
 * @param templateId - 优化模板 id。
 * @param selection - 本轮选中的模型路由。
 * @param signal - turn 取消信号。
 * @returns 优化后的文本。
 */
async function optimizeSilent(ctx, text, templateId, selection, signal) {
  const t = await prompts()
  const template = t.resolveTemplate(templateId)
  const { system, messages } = t.buildRequest(template, text)
  const route = {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
  }
  // turn 取消信号 + 独立超时，任何一个触发都中止优化，避免拖住用户对话。
  const timer = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(SILENT_TIMEOUT_MS) : undefined
  let combined = signal
  if (timer !== undefined && signal !== undefined && signal !== null && typeof AbortSignal.any === 'function') {
    combined = AbortSignal.any([signal, timer])
  } else if (combined === undefined || combined === null) {
    combined = timer
  }
  const { text: result } = await callModel(ctx, route, system, messages, combined)
  return result.trim()
}

/**
 * 把用户消息里的纯文本块替换成优化文本；非文本块/附件原样保留。
 * @returns 替换后的消息数组（不可变）。
 */
async function prepareSilentMessages(ctx, messages, cfg, payload) {
  return Promise.all(messages.map(async (message) => {
    if (message === null || message === undefined || message.role !== 'user') return message
    if (message.source !== undefined && message.source.kind !== 'user') return message
    const blocks = Array.isArray(message.content) ? message.content : []
    if (blocks.length === 0) return message
    const textBlocks = blocks.filter(block => block !== null && block !== undefined && block.type === 'text')
    // 只处理纯文本消息：含附件/图片的消息不改写，避免破坏多模态块。
    if (textBlocks.length === 0 || textBlocks.length !== blocks.length) return message
    const original = textBlocks.map(block => block.text ?? '').join('\n')
    if (original.trim() === '') return message
    try {
      const optimized = await optimizeSilent(ctx, original, cfg.templateId, payload.modelSelection, payload.signal)
      if (optimized === '' || optimized === original) return message
      const content = [{ type: 'text', text: optimized }]
      // 把原文/优化版挂到 source 的自定义字段，供客户端 conversation.chat.user.before
      // 槽在用户气泡旁显示对照。务必保留 kind:'user'，否则消息会被归到 context/notice
      // 而不是用户气泡（见 dsh-client-ui-chat/conversation-nodes/message.ts）。
      const source = {
        ...(message.source !== null && typeof message.source === 'object' ? message.source : {}),
        kind: 'user',
        optimizer: { originalText: original, optimizedText: optimized },
      }
      return freezeMessageLocal({ ...message, content, source })
    } catch (error) {
      // 静默优化失败一律降级为原文，绝不阻塞正常对话。
      try {
        ctx.logger?.warn?.(`prompt-optimizer: 静默优化失败，使用原文 ${error instanceof Error ? error.message : String(error)}`)
      } catch (ignored) { }
      return message
    }
  }))
}

/**
 * 统一的 JSON 响应。
 * @param res - HTTP 响应。
 * @param status - 状态码。
 * @param body - 载荷。
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * 注册路由并跑优化。
 * @param ctx - 宿主 Context。
 * @param req - HTTP 请求。
 * @param res - HTTP 响应。
 */
async function handle(ctx, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const templates = await prompts()
  if (url.pathname === `${ROUTE_PATH}/templates`) {
    sendJson(res, 200, { ok: true, templates: templates.TEMPLATE_OPTIONS })
    return
  }
  // 静默优化开关：浏览器半边每次切换时写一次，host 侧 pre-step 读取。
  // GET 只能带 query：sid=会话id / on=1|0 / tpl=模板id。
  if (url.pathname === `${ROUTE_PATH}/silent`) {
    const sid = url.searchParams.get('sid')
    const onParam = url.searchParams.get('on')
    if (sid === null || sid === '') {
      sendJson(res, 200, { ok: false, error: 'missing sid' })
      return
    }
    // 不带 on = 只读查询当前状态（切回会话时恢复开关 UI）。
    if (onParam === null) {
      const cfg = silentState.get(sid)
      const enabled = cfg !== undefined && cfg.enabled === true
      sendJson(res, 200, { ok: true, enabled, templateId: enabled ? cfg.templateId : null })
      return
    }
    const on = onParam === '1'
    const tpl = url.searchParams.get('tpl') ?? DEFAULT_TEMPLATE_ID
    if (on) silentState.set(sid, { enabled: true, templateId: tpl })
    else silentState.delete(sid)
    sendJson(res, 200, { ok: true, enabled: on, templateId: on ? tpl : null })
    return
  }
  if (url.pathname !== `${ROUTE_PATH}/optimize`) {
    sendJson(res, 404, { ok: false, error: 'not found' })
    return
  }
  if (req.method === 'HEAD') {
    sendJson(res, 200, { ok: true })
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, TIMEOUT_MS)
  res.on('close', () => {
    clearTimeout(timer)
    if (!res.writableEnded) controller.abort()
  })

  try {
    const request = parseRequest(url)
    const template = templates.resolveTemplate(request.templateId)
    const { route, source } = await resolveRoute(ctx, request.route)
    const { system, messages } = templates.buildRequest(template, request.prompt)
    const { text, usage } = await callModel(ctx, route, system, messages, controller.signal)
    const result = text.trim()
    if (result === '') throw new Error('模型返回了空内容')
    clearTimeout(timer)
    sendJson(res, 200, {
      ok: true,
      result,
      model: { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort ?? null },
      modelSource: source,
      template: { id: template.id, name: template.name },
      usage: usage ?? null,
    })
  } catch (error) {
    clearTimeout(timer)
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 200, { ok: false, error: message })
  }
}

/**
 * 挂载插件。
 * @param ctx - 宿主 Context。
 */
export function apply(ctx) {
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PATH,
      auth: 'anonymous',
      handler: (req, res) => handle(ctx, req, res),
    }), 'prompt-optimizer.route')
  } catch (error) {
    ctx.logger?.warn?.(`prompt-optimizer: 路由注册失败 ${error instanceof Error ? error.message : String(error)}`)
  }

  // 静默优化：agent/pre-step 是唯一能在消息进入模型前替换正文的官方扩展点。
  // 只对「当前会话开了静默开关 + 第一步 + 纯文本用户消息」生效；失败一律降级原文。
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next()
        if (decision.kind === 'reject') return decision
        if (payload.step !== undefined && payload.step !== 1) return decision
        const agent = payload.agent
        const sessionId = agent?.session?.id
        if (sessionId === undefined || sessionId === null) return decision
        const cfg = silentState.get(String(sessionId))
        if (cfg === undefined || cfg.enabled !== true) return decision
        const messages = await prepareSilentMessages(ctx, decision.messages, cfg, payload)
        return { ...decision, messages }
      }, { prepend: true })
    }
  } catch (error) {
    ctx.logger?.warn?.(`prompt-optimizer: 静默优化注册失败 ${error instanceof Error ? error.message : String(error)}`)
  }
}

export default { inject, apply }