# dsh-prompt-optimizer

把 [prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) 的优化策略搬进 DeepSeek Harness（DSH）：**用对话中当前选中的模型**优化你的提示词，**结果只显示在右侧栏**，可一键复制。

- 宿主半边：只暴露两个只读 GET 接口，模型调用一律走 DSH 的 `ctx.llm`（凭据在宿主侧，插件不接触 apiKey）。
- 浏览器半边：输入框右侧一个「✦ 优化」入口 → 点它弹出上拉类型选择窗 → 右侧栏结果 tab（只有「复制」按钮）。**除此之外没有别的按钮。**
- 不写文件、不落库、不向任何第三方转发提示词；不使用 iframe，不碰宿主 DOM 结构。

## 交互

只有一条线：

```
输入框写提示词  →  点输入框右侧「✦ 优化」  →  上拉窗选优化类型  →  右侧栏输出优化结果  →  「复制」
```

点「✦ 优化」会先弹出一个上拉窗口（portal 到 `document.body`，落在按钮上方，类似 DSH 选模型），列出 4 种优化类型；选中后才发起优化。没有标题栏按钮、没有「填入输入框」、没有「重新优化」。

## 功能

| 能力 | 说明 |
| --- | --- |
| 入口 | 只有一个：`conversation.input.right`（list 槽），贴着输入框。**不能**用 `conversation.session.header.corner`——那是 single 槽，已被 `ui-sidebar-right` 的展开按钮占满，注册进去不会渲染。 |
| 类型选择 | 点「✦ 优化」先弹上拉窗（原生 DOM + portal 到 body，零新增依赖），选 4 种优化类型之一；选中后把 `templateId` 随请求带上。输入框为空时不弹窗，直接给错误态。 |
| 模型来源 | 读 `ctx.modelDirectories.directoryFor(sessionId)` 的 `current`（即输入框上方那个模型选择器），把 `provider/model/reasoningEffort` 随请求带上；宿主侧还会用 `ctx.llm.listProviders()/listModels()` 复核可路由性，不可路由才回落部署默认模型。**任何路径都不会硬编码模型名。** |
| 结果落点 | `ctx.sidebarRight.openContent('promptOptimizer', payload, { key: 'result' })`，同一 key 复用同一个 tab，重复优化只刷新内容。**侧边栏被关掉时会先 `layout.openRightbar(true, false)` 重新打开容器、再点展开按钮，然后最多重试 2 秒**——优化进行中/输出时关掉侧边栏，结果出来也会自动重新打开，而不是报错。全失败才弹提示，不再静默失败。 |
| 可复制 | 面板顶栏「复制」按钮（`navigator.clipboard` + `execCommand` 兜底）。 |
| 原始输入 | 折叠区（`<details>`），默认收起，便于对照。 |
| 手动调试 | `GET /dsh-prompt-optimizer/optimize?q=<base64url(JSON)>` 直接可用，不依赖浏览器。 |

4 种优化类型（照 prompt-optimizer 的策略移植，见 `lib/prompts.js`）：

| id | 名称 | 说明 |
| --- | --- | --- |
| `general-optimize` | 通用优化 | 补全成结构化角色卡（Role / Profile / Skills / Rules / Workflows） |
| `analytical-optimize` | 分析式结构优化 | 拆解目标、约束、输入、输出格式，重组为分析式结构 |
| `output-format-optimize` | 输出格式强化 | 强化输出格式约定（分区、字段、示例） |
| `message-optimize` | 对话消息优化 | 面向多轮对话的消息结构优化 |

## 安装

插件已登记进 `C:\Users\wddsf\.dsh\profiles\desktop`：

1. `package.json` → `dependencies` 有 `"dsh-prompt-optimizer": "link:F:/WorkSpace/dsh-prompt-optimizer"`，`dsh.profile.bundles` 末尾含 `dsh-prompt-optimizer`。
2. `node_modules/dsh-prompt-optimizer` 是指向本仓库的 junction。
3. `cordis.patch.yml` 末尾有一条 insert row：

```yaml
- insert:
    - id: prompt-optimizer
      name: dsh-prompt-optimizer
      config: {}
```

改 profile 配置时**必须**用 UTF-8 写、并保持 YAML 缩进正确；patch 解析失败会让整棵插件树不重载。

## 生效方式（重要）

| 半边 | 生效条件 |
| --- | --- |
| 宿主路由 `/dsh-prompt-optimizer/*` | patch 热加载，追加 row 后约 1 秒即可用 |
| 浏览器半边（输入框按钮 / 结果 tab） | **必须重启 DeepSeek Harness**。`dsh.client` 的 bundle 列表是启动时读的，运行中的实例不会把新 bundle 组合进 boot 图 |

## 使用

1. 在输入框里写好（或粘贴）要优化的提示词。
2. 点输入框右侧的「✦ 优化」→ 弹出上拉窗，选一种优化类型。
3. 右侧栏打开「提示词优化」tab：顶栏是模型标签 + 「复制」，正文是优化结果，底部可展开看原始输入。
4. 点「复制」拿去用。

标签显示「默认模型」表示浏览器端读不到会话选择（例如新会话还没选过模型），此时宿主用部署默认模型兜底。

## 架构

```
浏览器 (lib/client.js)                    宿主 (lib/host.js)
─────────────────────────────             ──────────────────────────────────
conversation.input.right
  ├ 读 draft + 当前选中模型
  └ 点「✦ 优化」→ 上拉窗选 templateId  ───────────►  GET /dsh-prompt-optimizer/optimize?q=<base64url(JSON)>
                                                │
sidebar.right.pane.tab (promptOptimizer)        ├ resolveRoute: 会话模型 → 部署默认
  └ 结果 / 复制  ◄───────────────────────────────├ prompts.buildRequest: 模板 → {system, messages}
                                                 └ ctx.llm.stream(...) 流式累加
```

为什么走 GET + query：DSH 的 `webServer` prefix 路由只对 `handler` 形态读请求，`resource` 形态直接对非 GET/HEAD 返回 405，所以请求参数压进 `?q=`（base64url JSON）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `lib/host.js` | 宿主半边：路由注册 + 模型解析 + LLM 调用 |
| `lib/prompts.js` | 4 个优化模板（改写自 prompt-optimizer 的 `general-optimize` / `analytical-optimize` / `output-format-optimize` / `context-message-optimize`），提供 `buildRequest(template, prompt) → {system, messages}` |
| `lib/client.js` | 浏览器半边：tab kind 注册、结果面板、输入框入口、样式自注入 |
| `cordis.patch.yml` | bundle 补丁层（insert 一行） |
| `icon.svg` | 插件图标 |

## 自检

```powershell
node --check lib/client.js
node --check lib/host.js
node F:\WorkSpace\dsh-doctor.mjs        # 五项：manifest / host mount / client export / bundle 注册 / files
node F:\WorkSpace\_verify_client.mjs    # 离线跑 client bundle，核对 3 个 slot 注册点与 key
node F:\WorkSpace\_verify_menu.mjs      # 模拟点按钮→弹菜单→选模板→带 templateId 发请求
```

## 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 输入框右侧没有「✦ 优化」 | 浏览器半边未组合进 boot 图 | 重启 DeepSeek Harness |
| 点了没弹出右侧栏 | 该会话的 rightbar surface 未挂载（如主面板切到别的 panel，或侧边栏被整个关掉） | 插件会自动重新打开侧边栏并重试 2 秒；仍失败回到对话视图再点 |
| 面板显示「优化失败：模型调用失败：…」 | 上游 provider 报错（如 502） | 换模型或稍后重试；错误原文会透传 |
| 标签是「默认模型」 | 浏览器端读不到会话选中模型 | 在输入框模型选择器里选一次模型 |
| `content.some is not a function` | 传了裸字符串 messages | 已在 `normalizeMessages` 归一化为 block 数组 |
| patch 改了没反应 | ESM 模块缓存 | 宿主代码改动需重启；只有 row 增删支持热加载 |

## 许可

MIT。模板文本改写自 prompt-optimizer（MIT）。