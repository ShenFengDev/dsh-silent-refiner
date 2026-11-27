# dsh-silent-refiner

把 [prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) 的优化策略搬进 DeepSeek Harness（DSH）：**用对话中当前选中的模型**优化你的提示词，**结果只显示在右侧栏**，可一键复制。

> 插件名 `dsh-silent-refiner` 取自它最核心的差异化能力——**静默优化**（发送前无感把提示词换成优化版，输入框保持不变）。内部 HTTP 路由固定为 `/dsh-prompt-optimizer/*`、tab key 为 `dsh-prompt-optimizer`，都与包名解耦，是稳定标识，下面的接口/排障里的路径都按这个来。从旧包名 `dsh-prompt-optimizer-shenfeng` 迁移的用户需要重新安装一次。

- 宿主半边：暴露只读 GET 接口 + 注册 `agent/pre-step` 钩子做静默优化，模型调用一律走 DSH 的 `ctx.llm`（凭据在宿主侧，插件不接触 apiKey）。
- 浏览器半边：输入框右侧「✦ 优化」入口（点它弹出上拉选择窗 → 右侧栏结果 tab）。「静默优化提示词」是选择窗里的一个可选项，不占独立按钮。
- 不写文件、不落库、不向任何第三方转发提示词；不使用 iframe，不碰宿主 DOM 结构。

## 交互

只有一条线、一个按钮：

```
输入框写提示词  →  点输入框右侧「✦ 优化」  →  上拉窗里选一项  →  …  →  「复制」
```

点「✦ 优化」会先弹出一个上拉窗口（portal 到 `document.body`，落在按钮上方，类似 DSH 选模型），分三块：

- **优化类型**（5 项）：通用 / 分析式 / 输出格式 / 对话消息 / 结构化。选一项 → 立刻用菜单里选定的模型优化，结果输出到右侧栏，可复制。
- **静默优化提示词**（toggle 开关）：左右滑动开关，拨一下开启/关闭，不改输入框、不立刻发优化请求。开启后你正常发送消息时，实际送给模型的提示词会被自动替换成「按你最后选的优化类型优化后的版本」；输入框内容始终不变。
- **优化模型**：默认是「跟随对话模型」（即用输入框上方那个模型选择器选中的模型），也列出 DSH 已导入的全部供应商/模型可临时切换；点某个模型若支持思考程度，会就地展开 effort 子行供挑选（默认取该模型的 `defaultEffort`）。**这里选模型只影响本次优化，绝不会改动你对话框里选中的模型。**
- **中断优化**：优化进行中再点「✦ 优化」，菜单底部会出现「中断优化」，点一下立即中断请求（侧边栏显示「已中断优化」）。

```
手动：输入框写 → 点「✦ 优化」→（可选：换优化模型/思考程度）→ 选类型 → 侧边栏看结果 / 复制
静默：点「✦ 优化」→ 选「静默优化提示词」开启 → 再点「✦ 优化」选一次类型（决定规则）→ 正常发送消息 → 模型收到优化后的提示词
中断：优化中点「✦ 优化」→ 选「中断优化」→ 请求立即中止
```

没有标题栏按钮、没有独立静默开关按钮、没有「填入输入框」、没有「重新优化」。

## 功能

| 能力 | 说明 |
| --- | --- |
| 入口 | 只有一个：`conversation.input.right`（list 槽），贴着输入框。**不能**用 `conversation.session.header.corner`——那是 single 槽，已被 `ui-sidebar-right` 的展开按钮占满，注册进去不会渲染。 |
| 类型选择 | 点「✦ 优化」先弹上拉窗（原生 DOM + portal 到 body，零新增依赖），列出 5 种优化类型 + 1 个「静默优化提示词」开关项 + 优化模型区。选类型后把 `templateId` 随请求带上并立即优化；拨「静默优化提示词」开关只切状态。**输入框为空时点「✦ 优化」也会弹菜单**（静默开关/模型随时可切）；此时若选了某个优化类型，才在侧边栏给出「输入为空」的错误态，不发优化请求。 |
| 优化模型选择 | 菜单里「优化模型」区默认「跟随对话模型」；列出 DSH 已导入的全部 provider/model（只读 `ModelDirectory.groups`，**不调 `directory.select()`，不改对话框选中模型**），可临时选一个用于本次优化；支持思考程度的模型就地展开 effort 子行（默认 `defaultEffort`）。`provider/model/reasoningEffort` 随优化请求带上，宿主侧 `ctx.llm.listProviders()/listModels()` 复核可路由性，不可路由才回落部署默认。**任何路径都不会硬编码模型名。** |
| 可中断 | 每次优化用 `AbortController`，同一会话再次发起先中断上一次；运行中菜单底部出现「中断优化」，点击即 `abort()`，浏览器断开 fetch 会连带触发宿主 `res.on('close')` 的 abort，两端一起停；侧边栏显示「已中断优化」。 |
| 结果落点 | `ctx.sidebarRight.openContent('promptOptimizer', payload, { key: 'result' })`，同一 key 复用同一个 tab，重复优化只刷新内容。**侧边栏被关掉时会先 `layout.openRightbar(true, false)` 重新打开容器、再点展开按钮，然后最多重试 2 秒**——优化进行中/输出时关掉侧边栏，结果出来也会自动重新打开，而不是报错。全失败才弹提示，不再静默失败。 |
| 可复制 | 面板顶栏「复制」按钮（`navigator.clipboard` + `execCommand` 兜底）。 |
| 原始输入 | 折叠区（`<details>`），默认收起，便于对照。 |
| 静默优化 | 「✦ 优化」上拉窗里的「静默优化提示词」可选项（再点一次关闭，主按钮点亮表示开启）。开启后输入框原文不变，发送时由宿主 `agent/pre-step` 把用户消息正文替换为按**所选类型**优化后的文本。开关状态按会话存在宿主内存（`GET /dsh-prompt-optimizer/silent`），切回来仍在；仅替换第一步的纯文本用户消息，含附件/图片/后续 tool 轮次一律跳过，优化失败自动降级原文，绝不阻塞对话。 |
| 气泡对照 | 静默替换后的消息在 `source.optimizer` 上带 `originalText` / `optimizedText`（保留 `kind:'user'`）；浏览器半边注册 `conversation.chat.user.before` chain 槽，在用户气泡上方以折叠块显示「原文 / 实际发送给模型」，可展开逐字核对。纯展示、不影响模型输入。 |
| 手动调试 | `GET /dsh-prompt-optimizer/optimize?q=<base64url(JSON)>` 直接可用，不依赖浏览器。 |

5 种优化类型（照 prompt-optimizer 与结构化提示词仓库的策略移植，见 `lib/prompts.js`）：

| id | 名称 | 说明 |
| --- | --- | --- |
| `general-optimize` | 通用优化 | 补全成结构化角色卡（Role / Profile / Skills / Rules / Workflows） |
| `analytical-optimize` | 分析式结构优化 | 拆解目标、约束、输入、输出格式，重组为分析式结构 |
| `output-format-optimize` | 输出格式强化 | 强化输出格式约定（分区、字段、示例） |
| `message-optimize` | 对话消息优化 | 面向多轮对话的消息结构优化 |
| `structured-optimize` | 结构化提示词 | 按 7 段结构重组（身份/目标/硬性规则/工具策略/输出格式/数据不足时/示例），照 [YuChenLiao/dsh-plugin-structured-prompt](https://github.com/YuChenLiao/dsh-plugin-structured-prompt) 规则移植 |

## 推荐搭配：dsh-claude-preset

[dsh-claude-preset](https://github.com/killher1/dsh-claude-preset) 是一个把 Claude Code 的行为体系（系统提示词、核心工具描述、Plan Mode、多段式上下文压缩）接入 DSH 的智能体预设插件，和本插件正好互补：

- **本插件管"输入"**：把你在输入框写的提示词优化成结构清晰的形态，尤其 `structured-optimize` 的七段式结构。
- **claude-preset 管"执行"**：让 agent 按 Claude Code 的任务拆解与工具使用习惯去理解和执行。

典型叠加用法：打开本插件的「静默优化」并选 `structured-optimize`，同时在新会话的预设下拉里选「Claude Code 预设」——输入被结构化改写，agent 又按 Claude Code 的方式执行，任务边界更清晰、工具调用更稳。

它与本插件相互独立、互不依赖，单独用也能装：DSH 插件界面填 `dsh-claude-preset`，或 CLI `dsh plugin --profile desktop add dsh-claude-preset`。

## 安装（npm 包，推荐）

包名：`dsh-silent-refiner`（npm 上 `dsh-prompt-optimizer` 已被他人占用）。

### 方式一：DSH 图形界面

`Settings / Plugins → Add plugin`，填包名（带精确版本）：

```
dsh-silent-refiner@1.2.0
```

DSH 会用 `pnpm view` 先读音、再 `saveExact` 装进 profile，并自动把 bundle 的 patch 叠加进 loader。装完重启 DeepSeek Harness 让浏览器半边进入 boot 图。

### 方式二：命令行

```powershell
dsh plugin --profile desktop add dsh-silent-refiner@1.2.0
```

### 方式三：本地目录（开发调试）

`Add plugin` 里填本仓库的绝对路径，或让 profile 的 `package.json` 依赖指向它：

1. `package.json` → `dependencies` 有 `"dsh-silent-refiner": "link:F:/WorkSpace/dsh-prompt-optimizer"`，`dsh.profile.bundles` 末尾含该包名。
2. `node_modules/dsh-silent-refiner` 是指向本仓库的 junction。

bundle 的 `cordis.patch.yml` 只插一行，且 `name` 必须与包名一致：

```yaml
- insert:
    - id: prompt-optimizer
      name: dsh-silent-refiner
      config: {}
```

改 profile 配置时**必须**用 UTF-8 写、并保持 YAML 缩进正确；patch 解析失败会让整棵插件树不重载。

### 最小发布时效坑（若装不上）

profile 若开启了 pnpm 的 `minimumReleaseAge`，刚发布 24 小时内的版本会被拒：

```
ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION
```

把精确版本加进 profile 的 `pnpm-workspace.yaml`：

```yaml
minimumReleaseAgeExclude:
  - dsh-silent-refiner@1.2.0
```

## 发布到 npm（维护者）

1. `npm version patch|minor|major`（同步 `package.json.version` 与 git tag）。
2. `npm login`（需 npm 账号 token；本机默认 registry `https://registry.npmjs.org/`）。
3. `npm publish --access public`（作用域包要 `--access public`；本包是非作用域，直接 `npm publish`）。
4. 发完在 DSH 里用 `包名@版本` 安装。发布制品由 `files` 字段决定：`lib/*.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`、`README.md`，共 9 个文件。

## 生效方式（重要）

| 半边 | 生效条件 |
| --- | --- |
| 宿主路由 `/dsh-prompt-optimizer/*` | patch 热加载，追加 row 后约 1 秒即可用 |
| 浏览器半边（输入框按钮 / 结果 tab） | **必须重启 DeepSeek Harness**。`dsh.client` 的 bundle 列表是启动时读的，运行中的实例不会把新 bundle 组合进 boot 图 |

## 使用

手动优化：
1. 在输入框里写好（或粘贴）要优化的提示词。
2. 点输入框右侧的「✦ 优化」→ 弹出上拉窗。默认「跟随对话模型」；想换的话在「优化模型」区选一个 provider/model（支持思考程度的再挑 effort），然后选一种优化类型。
3. 右侧栏打开「提示词优化」tab：顶栏是模型标签 + 「复制」，正文是优化结果，底部可展开看原始输入。
4. 点「复制」拿去用。优化太久想停：再点「✦ 优化」→ 选「中断优化」。

静默优化：
1. 点输入框右侧的「✦ 优化」→ 在上拉窗里选「静默优化提示词」（主按钮点亮表示已开启；再点一次同一项即可关闭）。
2. 再点「✦ 优化」选一次优化类型——这次选择决定静默优化用哪种规则（之后可在任意一次「✦ 优化」里改）。
3. 输入框保持你原来的写法，正常发送消息即可。模型收到的是优化后的版本，聊天气泡里显示的也是优化后的文本（上方折叠块可对照原文）。

标签显示「默认模型」表示浏览器端读不到会话选择（例如新会话还没选过模型），此时宿主用部署默认模型兜底。

## 架构

```
浏览器 (lib/client.js)                    宿主 (lib/host.js)
─────────────────────────────             ──────────────────────────────────
conversation.input.right
  ├ 读 draft + 当前选中模型
  ├ 点「✦ 优化」→ 上拉窗：选 templateId + 优化模型(provider/model/effort)
  │                                  ───────────►  GET /dsh-prompt-optimizer/optimize?q=<base64url(JSON)>
  │  └ AbortController：再次发起/点「中断优化」→ abort fetch → 宿主 res.on('close') 一起停
  └ 上拉窗选「静默优化提示词」→ 写会话状态             ───────────►  GET /dsh-prompt-optimizer/silent?sid=&on=&tpl=
                                                │
sidebar.right.pane.tab (promptOptimizer)        ├ resolveRoute: 会话模型 → 部署默认
  └ 结果 / 复制  ◄───────────────────────────────├ prompts.buildRequest: 模板 → {system, messages}
                                                 └ ctx.llm.stream(...) 流式累加

发送时（静默优化开启的会话）：
  ctx.on('agent/pre-step')  ◄──  next() 拿到将进入模型的 messages
    └ 纯文本用户消息 → optimizeSilent(独立 ctx.llm) → freezeMessage 替换 content
       ├ source.optimizer = {originalText, optimizedText}（保留 kind:'user'）
       └ 失败/附件/后续 step → 原文放行，绝不阻塞对话
  conversation.chat.user.before ◄──  select 读 source.optimizer
    └ 气泡上方折叠显示「原文 / 实际发送给模型」
```

为什么走 GET + query：DSH 的 `webServer` prefix 路由只对 `handler` 形态读请求，`resource` 形态直接对非 GET/HEAD 返回 405，所以请求参数压进 `?q=`（base64url JSON）。

## 性能与可靠性

- **模板模块热取**：`statSync` 走顶层静态 import；模板 mod 按 mtime 缓存，文件没变就复用。`await prompts()` 只在 `/templates` 与 `/optimize` 分支内调用，`/silent` 开关与 404 路径不碰文件系统。
- **模型路由缓存**：provider 列表 + provider 的模型列表都按 ctx 缓存 30 秒（WeakMap 隔离），每次优化省掉 3 次跨进程 IPC；列表变动最多 30 秒后生效。
- **流式累加**：`text-delta` / `reasoning-delta` 用数组 push 最后 `join`，几千次 delta 不再反复重建字符串。
- **请求解码**：`?q=` 先按首字符 `'{'` 判明文 JSON、否则 inflate——明文路径零异常，压缩路径只在 inflate 失败时回落一次（raw deflate 首字节是 BFINAL/BTYPE 位，没有固定魔数，不能靠头字节判定）。
- **长提示词打包**：base64 用 8192 字节分块 `String.fromCharCode.apply`，避免逐字符 `+=` 导致的多次字符串重建。
- **请求竞态隔离**：每个会话独立记录最新请求 id，同会话连点只认最后一次、跨会话互不干扰。
- **可中断优化**：每次请求挂 `AbortController`，重发/点中断即 `abort()`，浏览器断开 fetch 连带宿主 `res.on('close')` abort，两端一起停，不留悬挂请求。
- **静默优化零阻塞**：独立 LLM 通道 + 90 秒超时 + turn 取消信号，失败/超时一律降级原文，绝不卡住对话。
- **UI 渲染减负**：tab 标题不再订阅 `useTabInfo`（静态文案，避免随每次结果推送多渲染一轮）；`selectDraft`/`useInput` fallback 提到模块级不随渲染重建；静默开关读写合并为一个 `silentRequest`；按钮「优化中」态只在成功/失败一条路径上复位，不再双重复位。

## 文件

| 文件 | 作用 |
| --- | --- |
| `lib/host.js` | 宿主半边：路由注册 + 模型解析 + LLM 调用 |
| `lib/prompts.js` | 5 个优化模板（改写自 prompt-optimizer 的 `general-optimize` / `analytical-optimize` / `output-format-optimize` / `context-message-optimize`，外加照 YuChenLiao/dsh-plugin-structured-prompt 移植的 `structured-optimize`），提供 `buildRequest(template, prompt) → {system, messages}` |
| `lib/client.js` | 浏览器半边：tab kind 注册、结果面板、输入框入口、样式自注入 |
| `cordis.patch.yml` | bundle 补丁层（insert 一行，`name` = 包名） |
| `locale/en.json`、`locale/zh.json` | 插件页显示用的标题/描述（不激活插件也能读到） |
| `icon.svg` | 插件图标 |

## 自检

```powershell
node --check lib/client.js
node --check lib/host.js
node F:\WorkSpace\dsh-doctor.mjs        # 五项：manifest / host mount / client export / bundle 注册 / files
node F:\WorkSpace\_verify_client.mjs    # 离线跑 client bundle，核对 slot 注册点（含气泡对照）与 key
node F:\WorkSpace\_verify_menu.mjs      # 模拟点按钮→弹菜单→选模板→带 templateId 发请求 11 项
node F:\WorkSpace\_verify_silent_menu.mjs # 静默项在菜单中：点击只写开关、不发优化请求 6 项
node F:\WorkSpace\_verify_structured.mjs # 结构化模板 7 段结构 + buildRequest 20 项
node F:\WorkSpace\_verify_silent.mjs    # 静默优化：/silent 状态路由 + agent/pre-step 替换 + source.optimizer 20 项
node F:\WorkSpace\_verify_decode.mjs    # 请求解码：deflate-raw 与明文 base64url 两条路径 + 空输入，走真实 host handler
node F:\WorkSpace\_verify_model_menu.mjs # 菜单模型选择：跟随/切换 provider/model/思考程度 + 中断 aborted 12 项
```

## 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 输入框右侧没有「✦ 优化」 | 浏览器半边未组合进 boot 图 | 重启 DeepSeek Harness |
| 点了没弹出右侧栏 | 该会话的 rightbar surface 未挂载（如主面板切到别的 panel，或侧边栏被整个关掉） | 插件会自动重新打开侧边栏并重试 2 秒；仍失败回到对话视图再点 |
| 面板显示「优化失败：模型调用失败：…」 | 上游 provider 报错（如 502） | 换模型或稍后重试；错误原文会透传 |
| 标签是「默认模型」 | 浏览器端读不到会话选中模型 | 在输入框模型选择器里选一次模型，或在「✦ 优化」菜单里手动选一个优化模型 |
| 优化跑太久/想换模型 | 上游慢 | 再点「✦ 优化」→「中断优化」，换模型后重试 |
| 静默优化没生效 | 该会话开关没开 / 消息含附件 / 是后续 tool 轮次 | 确认「✦ 优化」按钮点亮（=静默已开）、选过类型；只替换第一步纯文本用户消息 |
| 静默优化让对话变慢 | 发送前会先跑一次 LLM 优化（独立通道，90 秒超时） | 属预期；失败/超时会自动降级原文，不阻塞 |
| `content.some is not a function` | 传了裸字符串 messages | 已在 `normalizeMessages` 归一化为 block 数组 |
| patch 改了没反应 | ESM 模块缓存 | 宿主代码改动需重启；只有 row 增删支持热加载 |

## 许可

MIT。模板文本改写自 prompt-optimizer（MIT）。