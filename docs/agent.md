# 灯灯智能体

本文是灯灯**智能体层的维护文档**。代码是行为的事实来源；本文记录意图、边界和同步点。改智能体行为时必须在同一变更中更新本文。

最近校准：2026-10-09（多连接、会话选模与阶段模型路由；全局外观设置；开发者资讯首页与显式文件库/对话联动；灯灯品牌与公共产品演示；持久化运行 JSON 容错；资料库与持久化独立；数据库版本 27）。

## 定位

灯灯是从对话开始的个人 AI 协作助手，优先理解意图、接续上下文、协助分析和生成可修改的成果。资料库是按需带入依据与复用知识的支撑能力。主入口为首页、文件库、AI 工作区、设置；问答、搜索、分析和内容创作统一在 AI 工作区完成。

首页保留实时本地时间与欢迎语，按开发者定稿展示 AI / Agent 官方动态、GitHub 日榜/周榜、关注仓库 Releases 和工程实践；“简洁”改为密集信息列表，仍读取资讯。全局导航保持首页、文件库、AI 工作区、设置四个平级入口，保留灯灯品牌。首页通用路由数据依赖仍为空，由 `features/home/useHomeFeed.ts` 独立加载资讯；不预取资料、会话、模型能力或附件配置。

全局外观入口为 `#/settings/appearance`，放在设置模块内，不新增侧栏子导航。`features/appearance/ThemeProvider.tsx` 在应用入口包裹认证与业务页面，解析浅色、深色或跟随系统偏好，在文档根节点设置 `data-theme` 与 `color-scheme`。偏好仅保存到当前设备浏览器的 `careerloop-theme`，跨标签页同步；未保存全局偏好时迁移当前账号旧首页主题，不覆盖已有全局选择。该前端路由无需 API 数据，不增加 Agent 路由、工具或权限。验证记录见 [global-theme-qa.md](global-theme-qa.md)。

`api/home.py` 提供 `GET /home/feed`、`POST /home/feed/refresh`、`PUT /home/preferences` 与 `PATCH /home/feed/items/{id}/state`。`feeds/` 只读取允许列表内的公开来源，不执行 Agent 工具或模型调用；主题与公开仓库关注由用户显式配置，不读取私人资料作推荐。快照、偏好、隐藏状态与收藏保存在账号工作区 `home-feed.json`，原子写入；后台线程显式绑定工作区，进程内锁合并刷新，来源失败保留旧快照。数据库版本仍为 25。

收藏保留当时的内容快照，资讯移出榜单、超过动态窗口或取消仓库关注后仍可在首页收藏弹窗访问，不自动加入模型记忆。存入文件库由用户确认可编辑的标题、摘要和原文链接后调用既有 `/library/sources`，默认 `privacy_mode=redacted`；保存的是摘要与来源元数据，不代表已获取全文。

“交给 AI 分析”通过既有 `/conversations` 创建新对话，将标题、来源、日期、链接与摘要放入可编辑草稿；不发送消息、不启动模型、不声称已读取原文。草稿只导入对应对话；输入框已有文本时保留输入，由用户选择替换或保留。详情及当前未实现项见 [developer-home-plan.md](developer-home-plan.md)。

品牌为“灯灯”，Logo 使用基于火字旁的四笔结构。默认助手名与系统提示中的名称同步为灯灯；读取设置时，旧内置助手名会改写为灯灯，用户自定义名称保留。桌面应用标识和数据目录环境变量保持不变。本轮未增加工具、路由或自主执行权限。品牌定义见 [brand.md](brand.md)。

产品介绍使用独立公共入口 `#/about`，由 `app/Bootstrap.tsx` 处理，在本地服务启动失败时也能展示静态介绍。登录页以账户表单为主；认证页右上角「关于灯灯」和设置首页「了解灯灯」提供介绍入口。认证页加载和连接失败状态也保留公共导航。公共页不进入业务路由或 Agent 执行，切换期间保持认证组件挂载并保留会话，返回原页面；业务路由监听器跳过公共 hash，避免将其重写为聊天入口。

专用求职功能已退役：岗位发现与评估、简历编辑导出、面试准备/复盘、画像访谈、职业策略及其 HTTP 路由和 Agent 工具均不再对产品开放。前端不再识别旧 workspace、workbench、机会、面试、项目和知识深链，未知 hash 打开首页并改写为 `#/home`，不挂载旧页面，也不请求岗位数据。

保留已有资料和会话，不执行数据库重建或删除历史业务记录。新库只创建当前产品表；旧字段与原始 Markdown 只由 compatibility/ 中的一次性版本升级读取，日常读写不再依赖历史求职数据。升级前生成 SQLite 一致性备份并复制历史 Markdown；旧业务记录保留在旧库中。

## 维护约定

改动触及下列任一处，必须同步本文对应章节；列表类变更以代码为准，正文只写差异和意图。

| 改动 | 必须更新 |
| --- | --- |
| 新增/删除/改名工具 | [工具目录](#工具目录)、`TOOL_POLICIES`、`bootstrap` 注册、`TOOL_STAGES` |
| 新增/删除/改名路由 | [路由](#路由与计划)、`ROUTE_LABELS`、`ROUTE_STAGES`、前端运营看板标签 |
| 改变循环、失败策略、计划门、引用校验 | [运行时](#对话运行时) |
| 改变记忆、待确认写入、人审 | [记忆与人审](#记忆与人审) |
| 改变兼容活动记账 | [工作流阶段](#工作流阶段) |
| 改变模型协议或系统提示原则 | [模型与配置](#模型与配置) |

机械一致性由当前路由、工具注册和 `test_agent_runtime.py` / `test_library_product.py` 共同守护。测试通过不代表本文已更新。

## 架构总览

聊天和工具请求在进入工作区前校验本地账户的签名与 `auth_sessions` 会话指纹；退出撤销当前会话，改密使该用户旧会话全部失效。认证 401 会让前端退出当前账户，临时断连则保留状态并重试。旧有效凭据按原有效期兼容登记；会话迁移只增建 `auth.db` 表，不改变业务工作区或 Agent 快照。升级前单账户资料按首个账户 ID 确定归属，后注册账户即使先初始化工作区也不能接管。账户接口与恢复规则详见 [本地账户与会话](account-auth.md)。

桌面发行版在此运行时外包一层 Tauri 2：Rust 壳启动同机 loopback FastAPI
sidecar。Rust 先占用动态 loopback 端口，向 sidecar 传入端口与实例 ID，并在
`/health` 校验服务名、版本和实例 ID 后才显示窗口；前端通过 Tauri command 获取
运行时 API 地址。浏览器模式仍使用 `VITE_API_BASE` 或同源代理。sidecar 以
`CAREERLOOP_DATA_DIR` 指向每位 OS 用户的应用数据目录；智能体循环、工具权限、
审计、快照和模型适配不迁入 Rust，也不改变其行为。实现与发布脚本位于
`desktop/`；发布构建把 FastAPI 打成 PyInstaller onedir runtime，并由同架构原生
launcher 定位后执行。浏览器开发与自托管仍保持原有的 FastAPI 静态文件模式。
macOS 打包 CI 使用支持 SQLite 扩展加载的 Homebrew Python 3.11 创建隔离虚拟环境，并在测试与打包前验证 sqlite-vec 可加载，保证知识库向量索引与本地开发行为一致。
首版 macOS ARM64 内部包为控制体积不携带可选图片 OCR 推理栈；文档和文本解析不受
影响，图片 OCR 失败会返回明确的可恢复提示。

```text
用户消息 / 附件 / 联网开关
        │
        ▼
 FastAPI 聊天流  (api/chat.py → chat/execution.py)
        │  任务进度 → durable Agent runs
        │  若有 waiting 快照：选项/未改口则 resume，改口则清快照
        ▼
 AgentRuntime.run_stream
        │
        ├─ detect_kind()          关键词只出 route.kind
        ├─ apply_hard_gates()     联网开关
        ├─ classify kind（仅 conversation）  JSON {"kind":...}；失败则保持 conversation
        ├─ tools_for_kind()       按车道从 TOOL_POLICIES 展开 allowed_tools
        ├─ planner（可选）         生成 JSON 计划；失败则整轮终止
        ├─ CompletionValidator     必需工具成功事件 / tool_choice
        ├─ 模型多轮 tool calls     只允许计划内工具
        ├─ ToolRegistry.execute   超时、审计、waiting_approval
        └─ 引用校验（若本轮用过联网工具）
                │
                ▼
 保存助手消息 + durable run 状态 + 对话摘要
```

关键目录：

```text
backend/app/
├── domain/agent.py          协议：消息、工具、计划、流式事件
├── agent/
│   ├── runtime.py           对话循环
│   ├── completion.py        完成义务与强制工具选择
│   ├── tool_executor.py     工具超时、结果归一化与审计边界
│   ├── orchestration.py     路由、风险、规划
│   ├── bootstrap.py         组装模型 + 工具
│   ├── settings.py          人设、记忆开关、模型连接
│   ├── operations.py        运营快照
│   ├── snapshots.py         waiting_user 恢复快照
│   ├── resume_policy.py     等待确认后恢复或放弃快照
│   └── model_capabilities.py
├── models/                  模型协议、OpenAI 兼容与 Anthropic Messages 实现
├── tooling/specs.py         工具风险、能力标签、阶段与超时元数据
├── tools/                   对话工具
├── api/                     按职责划分的 HTTP 路由
├── chat/                    协议、历史、运行协调、AG-UI 编码与落库
├── library/                 独立来源、模型上下文与待确认知识
├── feeds/                   公开资讯适配、账号快照与后台刷新
├── documents/               共享文档提取与可选 OCR
├── persistence/             当前表与版本升级
├── compatibility/           仅供旧库升级读取的冻结历史格式
├── knowledge/               本地检索（FastEmbed / 哈希回退）
└── observability/           工具审计、模型监控
```

前端：`frontend/src/components/ChatWorkspace.tsx` 消费流式事件，并在同一个对话输入框提供联网开关、搜索类别与来源偏好和回答内来源详情；`frontend/src/features/settings/AgentOperationsDashboard.tsx` 展示运营快照。

输入框按内容自动增高，超过视口约 30% 或 240px 后内部滚动；桌面 Enter 发送、Shift+Enter 换行，触摸设备 Enter 换行、点击发送。单条输入上限与聊天 API 一致为 200000 字，附件处理中阻止按钮与表单发送。文字与联网配置草稿按账号、对话保存在当前 App 内存，切换对话或离开工作区再返回可恢复；刷新、退出或关闭应用不持久保存。附件仍按原规则在切换对话时重置，草稿恢复不自动发送或重新上传资料。

待发送附件卡片与历史消息中的附件均可打开同一个预览弹窗，不触发发送或模型请求。当前选择的文件在浏览器内直接读取；历史附件通过带账号鉴权的 `GET /attachments/{id}/file` 读取原件，DOCX 摘要缺少正文时先用 `GET /attachments/{id}` 补齐元数据。后端按当前账户数据库与本地附件目录读取，拒绝越出目录的路径或符号链接，原件响应禁用缓存。PDF 复用文件库的本地 PDF.js 阅读器并按需加载；PNG/JPG/WEBP 支持缩放，TXT 支持 UTF-8 与 GB18030，Markdown 支持表格并忽略内嵌 HTML，DOCX 显示提取文字并说明排版需下载原文件查看。关闭或切换对话取消读取并释放预览 URL，键盘关闭恢复原焦点；下载保留完整文件名。原件不存在时提供明确错误与重试入口，不修改消息和附件记录。

编辑区从 40px 起自适应高度，底部用固定发送列与可换行工具列，模型选择、图标附件入口和联网开关不会挤占正文。快捷键以键帽提示，编辑区或工具区聚焦时显示，空闲及生成期间淡出并保留提示行高度，避免界面跳动；输入仍有持续的无障碍说明。接近上限（180000 字）时计数始终可见，不依赖焦点。触摸设备显示回车换行与点击发送提示，并扩大工具和发送按钮。

生成和窄屏时保留工具栏模型名称与联网文字，不再通过隐藏所有按钮内的 span 压缩工具栏；联网开关与搜索类别共享一个控件，开启后可选择自动、通用、新闻、金融，技术来源偏好收进模块内的搜索设置。运行中锁定这些选项，关闭联网后同一草稿保留选择。停止按钮使用中性样式，停止请求中禁用并显示“正在停止生成”。

对话滚动由 `useConversationScroll` 统一管理，靠近底部时跟随输出，向上阅读时保留位置并提示新内容；加载更早消息补偿高度，切换对话定位末尾。思考与执行过程只在当前助手消息正文前的 `RunProcess` 折叠区展示，取消输入框上方状态条、回答下“查看过程”入口和来源侧栏中的过程列表。运行时默认展开，阶段标题只出现一次；真实返回的思考文本按段落、工具活动按紧凑图标行显示，过滤本地路由概要，不展示原始参数对象或工具指纹。用户手动折叠后，流式更新不强制展开；终态自动收起、去掉加载动画，用同一标题行显示用时及“生成失败”“已停止”“等待确认”。终态以运行 status 为准，已恢复的单个工具失败不标记整个回答失败，缺少工具事件的失败仍有结果说明，保留已生成内容。停止按钮仍在输入框内。Markdown 代码块完整复制、超过 24 行可折叠，流式期间不折叠；Mermaid 图形继续使用专用渲染，宽表格在独立容器中滚动。

「回到最新」入口位于消息区域的悬浮层，与实际滚动容器互为同层元素，不随消息内容滚走，也不占用输入框的一行。消息区域和输入框继续使用各自的网格行；输入框增高时，悬浮入口随消息区域底部移动。完整页和浮动面板共享同一布局，保留离开底部时暂停跟随、新内容提醒和点击恢复跟随的规则。

用时来自 `AgentRunStore` 的真实运行起止时间。新运行记录 UTC 毫秒 `started_at`，结束时写入 `completed_at` 和非负 `duration_ms`，同一结果同时用于持久化及最终助手消息；重复回放不重新计时。AG-UI 在首条文本前发布 `careerloop.run_timing`，前端只接收当前 runId 的起点；运行时按该起点显示经过时间，终态及历史只使用已保存时长，不用页面挂载或消息创建时间估算。缺少时间的旧消息省略用时。

`useChatRun` 在发送时同时创建用户消息和唯一助手占位，首 token 前也在对话内显示进度；服务端回填用户消息保留原位置。标准 reasoning 事件的 `reasoning:` 前缀映射回 CareerLoop 活动 ID，与自定义事件按 `tool_call_id` 原位合并，保持首次出现顺序，结束更新不会追加重复过程。只有当前运行、当前对话可更新流式消息；终态快照只接收一次，之后的正文、过程和用户消息事件不再创建临时消息。终态已落库后 SDK 再报错不会覆盖消息或重试目标，重试从该轮用户消息重新生成；未收到终态的断连仍使用原 `runId` 恢复。发送错误、重试和保留草稿合并为输入区的一条提示，不再额外发布同一发送错误的全局提示。

引用详情打开时暂停自动跟随，关闭恢复打开前的滚动位置及触发引用焦点；来源列表标题可查看完整提示，选中来源摘要优先展示。侧栏仅展示来源，有公开来源时才显示“来源”入口，普通问候及无来源回答不展示空侧栏入口。消息操作使用图标，桌面悬停或键盘聚焦时显示，触摸设备持续可见；历史生成模型及路由信息收进同排的“回答详情”，支持 Escape 关闭并恢复焦点。当前待发送模型仍在输入框内切换。错误正文已包含的原因不在过程区再次显示。

消息复制只复制用户文本或助手结果正文，复制反馈通过按钮提示和状态播报提供。编辑输入上限与新消息相同；编辑重发/重新生成继续沿用既有删除消息尾部再发送的协议，会替换本轮及后续消息，影响说明放在操作提示和无障碍描述中，不再常驻每条消息下方；联网配置沿用原轮，编辑资料仍按现有规则重新选择。对话记录仅在已加载列表内搜索标题/摘要，不额外请求服务端或读取消息全文。

外部感知：对话里的 `search_public_web` 通过 `research/search.py` 选择搜索服务。`WEB_SEARCH_PROVIDER=auto` 时，有 `TAVILY_API_KEY` 就直接调用 Tavily 官方 HTTPS API，否则使用 AgentSearch；也可显式指定 `tavily` / `agent_search`。能力接口和工具结果报告实际配置的 provider，联网按钮提示当前服务，不返回密钥。显式选择 Tavily 却未配置密钥时返回 `tavily_not_configured`，鉴权、额度、超时或其他失败不得偷偷改用另一服务。

每轮联网许可与偏好使用冻结的 `WebSearchOptions`：`enabled`、`topic=auto/general/news/finance`、`source_preference=none/technical`、版本及搜索服务标识。AG-UI 使用 `webSearchTopic` 和 `webSearchSourcePreference`，入口统一归一化后传递；旧 `webSearchMode` 兼容转换为类别与来源偏好，新字段优先。重试、编辑与重新生成携带 `webSearchProvider` 作为原服务的期望绑定，仅用于一致性校验，不能据此选择服务。用户显式类别不能被模型工具的 category 覆盖，模型仍可选择查询文本及研究任务线索。`company` 是任务场景，不是 Tavily 类别。

Tavily 自动模式开启 `auto_parameters` 并省略 `topic`，显式固定 `search_depth=basic`；手动类别按 general、news、finance 原值发送并关闭自动参数。所有模式关闭服务端答案生成和图片返回，保留 Markdown 正文与已有数量上限。技术偏好通过 `include_domains` 加 `include_domains_mode=prefer` 优先查 GitHub、Stack Overflow、MDN 和 Python 文档，不再拼接 `site:`，也不宣称严格白名单。新闻不自动限制为过去 24 小时。结果保存请求类别、发送类别及服务返回的实际类别；实际类别只读取响应的 `auto_parameters.topic`，手动或自动模式缺少有效值时均为未知，不推断或伪造。元数据仅放入既有来源／回答详情，不增加重复进度区。

将搜索摘要 `content` 与正文 `raw_content` 分开归一化；优先复用已返回正文，只为前四个结果中缺失正文的公开 URL 批量调用 Extract。结果过滤私有/本机地址、去重并限制数量，单次响应上限 3 MB、正文上限 5000 字符。HTTP 200 中的单页提取失败或提取请求失败均保留摘要并返回警告，不宣称正文已读取；不得将上游错误正文暴露为错误提示。网页及摘要仍是不可信外部内容，沿用同一证据分级、引用和工具权限边界。搜索鉴权、额度、限流、超时及网络错误分别返回 `tavily_*` 错误码；只有限流、服务端及网络错误可重试。basic 限制控制搜索调用深度，不代表 Extract 或整轮研究没有额外调用。

`agent-search/` 是独立仓库，不是灯灯 runtime 的一部分，`scripts/dev.sh` 不负责启动它。选择 AgentSearch 后，自动类别按工具 `category` 走 general／news／company，手动通用或新闻优先，类别元数据记录实际发送的 `mode`；不支持金融及技术资料软偏好，前端禁用并说明，后端在请求前明确拒绝，不静默改为通用或换服务。使用 company 策略时，配套 AgentSearch 必须支持 `/search?...&mode=company`。AgentSearch 可配置 Brave / 博查作为主检索，未配置时仍走 SearXNG；中文查询会再融合国内搜索源。`web_research` 能力声明提供支持的类别、自动参数和技术偏好，表示适配器支持而非实时连接成功。部署、环境变量和健康检查步骤见根目录 `README.md`。

用户消息 payload 和运行快照保存完整联网配置；首个正式检查点前，运行绑定也保存该配置。同 runId 的恢复使用原配置，不由当前输入框覆盖；断线恢复、失败重试和重新生成沿用原轮。等待确认默认继承原任务配置，用户明确改变时用新 runId 并重算路由与工具权限；关闭联网不能继续使用旧 allowed_tools。旧快照从原消息安全补齐，无可核验许可时不新增搜索，可重放已有结果。搜索服务变更时保留内容并明确要求重新发送，不悄悄切换 provider。密钥不进入消息或快照，无需新增 SQLite 列。

运行边界：`WEB_RESEARCH_ENABLED` 控制是否允许联网；`WEB_SEARCH_PROVIDER` 控制服务选择，`TAVILY_API_KEY` 只用于 Tavily。AgentSearch 默认地址是 `http://127.0.0.1:3939`，其地址与令牌由 `AGENT_SEARCH_BASE_URL` 和可选的 `AGENT_SEARCH_TOKEN` 控制。单个上游引擎失败可以让 AgentSearch `/health` 显示 `degraded`，不能仅据此判定全部搜索不可用，应以实际 `/search` 结果为准。连接失败、超时或所有查询均失败时，工具必须返回“联网服务暂不可用”的可重试结论，不能把它解释为公司名称不完整、公司不存在或招聘平台没有岗位。

## 对话运行时

实现：`backend/app/agent/runtime.py`。组装：`backend/app/agent/bootstrap.py`。HTTP 路由在 `api/` 按认证、系统、资料库、会话、附件、模型、聊天及首页资讯划分；首页采集独立于 Agent 循环。`main.py` 只组装服务、中间件和静态资源。`chat/execution.py` 管理任务幂等、恢复、并发、取消与保存，`chat/ag_ui.py` 将单一内部事件队列编码为 AG-UI SSE，不再混在入口中。业务模块不导入 main.py 的可变状态。

默认上限：`MODEL_MAX_TOOL_ROUNDS=8`，单次工具超时 `TOOL_EXECUTION_TIMEOUT_SECONDS=60`，模型与安全工具重试预算分别为 `MODEL_RETRY_ATTEMPTS=1`、`TOOL_RETRY_ATTEMPTS=1`。同一对话同时只允许一个运行中的任务（HTTP 409）。

每轮顺序：

1. `route_task()`：关键词 `detect_kind` + 硬开关，得到 `kind`。关键词未命中且仍为 `conversation` 时，额外一次模型调用只分类 `kind`（`ROUTE_LABELS` 之一）；`hello`、`你好`、`test` 等确定性的简单问候/连通性测试直接走对话，不花一次分类调用。解析失败或输出工具名则保持 `conversation`。`allowed_tools` 始终由 `tools_for_kind` / `TOOL_POLICIES` 计算，分类器不能点名工具。
2. 需要计划时，另一次模型调用生成 JSON；解析失败则用路由允许工具做兜底计划；规划调用本身失败则整轮 `failed`。
3. 把计划写入 system 消息，并把模型可见的 tool definitions 裁成计划内工具。另注入一条「本轮实际可用工具」清单（`visible_tools_prompt`），只列出 `executable_tools`。全局 `SYSTEM_PROMPT` 不点名具体工具。
4. 每次模型生成前，`CompletionValidator` 用成功的工具事件核对 `REQUIRED_CAPABILITIES_BY_ROUTE` 编译出的 `route.required_tools`。仍有义务时，OpenAI Chat / Responses 使用 `tool_choice=required`，Anthropic 使用 `any`，Gemini 使用 `ANY`；Ollama 以 system 约束补足原生协议缺少 `tool_choice` 的差异。
5. 循环：模型生成 → 若有 tool_calls 则逐个执行 → 结果以 `role=tool` 回写。模型在义务未完成时只返回正文或空响应，runtime 会丢弃该终态并追加一次纠正提示；同一未完成集合再次出现则 `completion_obligations_unmet`，不能保存为成功回答。义务集合因工具成功而缩小时，可以继续下一步。
6. 工具 `failed`：同一轮只允许一次同车道重规划（`replan_prompt` + `parse_plan`），新计划仍受当前 `allowed_tools` 约束，不能换车道或补联网工具。重规划成功后清空本轮错误，最终正文标 `done`。第二次失败、`blocked`、超时或规划调用失败则整轮终止。
7. 完成义务满足且无 tool_calls、有正文：若本轮用过联网工具，则校验 Markdown 链接必须来自本轮工具返回的 URL；失败会自动重写一次，再失败则标记 `citation_validation_failed`。
8. 达到轮数上限 → `round_limit_reached`。
9. `waiting_user` 会把 `route` / `plan` / 完整 `messages` / `clarification` 写入 `agent_run_snapshots`。下一轮若有快照，先判定是否仍在回答暂停时的问题：命中选项原文，或手输未改口，则 `resume` 同一条 run（跳过分类与规划，不换车道）。手输明显改口（改口词，或 `detect_kind` 落到另一条非 `conversation` 车道）则清快照并重新路由。取消、回退、重置上下文或非 `local_router` 的终态会清快照。历史退役工具快照不会恢复。

硬约束（不要在改 runtime 时悄悄放宽，除非同步改本文和测试）：

- 计划外工具立即 `blocked` / `tool_not_planned`。`ask_user` 是例外：它不进车道计划，但始终对模型可见，调用后以 `waiting_user` 交回界面。
- `REQUIRED_CAPABILITIES_BY_ROUTE` 不只是规划提示，也是完成契约；路由会把 capability 解析成当前工具面的 `required_tools`，没有对应工具的 `done` 事件时，模型正文不能结束任务。
- 工具 `failed`：先同车道重规划一次；`blocked` / 超时仍立即终止。
- `waiting_approval`：状态 `waiting_user`，把确认权交回界面。若 `data.clarification` 带有 `question` / `options`，输入框上方渲染选项。点选选项，或手输仍是在回答（选项原文、补充指代），则恢复原计划。手输明显换题则清快照并重新路由。
- 联网回答必须引用本轮来源；不得把未检索到的经历写成事实。

流式事件类型：`run_started`、`text_reset`、`text_delta`、`agent_event`、`waiting_user`、`completed`、`cancelled`、`error`。过程叙述走 `agent_event`，最终回答只保留对用户有用的结论。

聊天入口还会注入：最近对话里解析出的公司全称、用户上传附件的本地解析文本。路由文本与模型可见文本分开：`web_search` 开关只进入 `routing_content`，避免用户把系统可信标记写进正文。

## 路由与计划

实现：`backend/app/agent/orchestration.py`。关键词识别意图，未命中时可由模型分类；分类只能选择既有 kind，不能自行指定工具。联网可信开关只影响本轮，路由不接受岗位截图或画像访谈状态参数。

| kind | 作用 | 可用能力 |
| --- | --- | --- |
| conversation | 日常问答 | ask_user 中断询问 |
| library_search | 知识库问答 | library.read、library.search |
| library_update | 补充知识 | library.read、library.propose |
| content_creation | 总结、改写、文章和大纲 | library.read、library.search |
| web_search | 公开检索 | web.search.generic |

工具面来自当前注册表的 capability 与 priority；规划器只能选 allowed_tools。知识库问答/创作必须先读取知识库，写知识必须生成待确认条目，联网必须真正调用检索工具。历史 checkpoint 含退役路由、工具或计划步骤时不恢复，重新按当前请求路由。

## 工具目录

工具实现、bootstrap 注册与 ToolSpec 必须一致；无元数据的工具不能注册。`/agent/capabilities` 只返回以下五个工具：

| 工具 | 风险 | 作用 |
| --- | --- | --- |
| get_library_context | read_only | 读取来源材料和已确认知识，尊重隐私模式 |
| search_library | read_only | 检索脱敏来源片段和已确认知识，不检索岗位 |
| propose_library_knowledge | local_pending_write | 仅生成待确认知识，不自动确认 |
| search_public_web | external_read | 带来源的公开搜索，受联网开关与配置约束 |
| ask_user | read_only | 提问并等待用户选择 |

通用资料工具位于 `tools/library.py`，数据边界在 `library/service.py`。`tools` 包只导出当前工具与基础协议，不加载退役工具；当前工具的参数校验和错误处理位于独立的 `tools/errors.py`。资料来源和聊天附件共用 `documents/parser.py` 与可选的 `documents/ocr.py`，不通过岗位模块执行解析。所有模型调用遵守资料即数据、不执行资料内嵌指令的规则。ToolExecutor 统一处理超时、异常与审计；本地写操作不自动重放。

## 执行循环与收敛

新任务和 `waiting_user` 恢复任务共用同一个有界 model/tool loop，不再维护两份执行逻辑。`max_tool_rounds` 限制模型轮数；每轮先检查完成义务，再选择 `required` 或 `auto` 的 `tool_choice`。所有 `AgentRunResult` 都带 `stop_reason`：成功为 `completed`，等待为 `waiting_user`，失败时使用稳定错误码，便于 UI、运营看板和回归评测区分停止原因。

循环有三层恢复与防失控规则：

- 可重试的模型错误在当前轮自动重试一次，不消耗新的工具轮数；重试过程发布 `model_provider` 系统事件。
- 只有 `read_only`、`derived_analysis`、`external_read` 工具会在明确返回 `retryable` 时安全重试一次；任何本地写工具都不会被 harness 自动重放。
- 成功工具调用按“工具名 + 规范化参数”生成不透明指纹。同一任务第一次重复调用会被跳过并提示模型推进；再次重复则以 `tool_loop_detected` 终止。指纹和重复计数写入暂停快照，恢复任务也不会重复执行已经完成的副作用。

`agent_loop_guard`、`model_provider`、`completion_validator`、`citation_validator` 都是系统活动，不算真实工具调用；前端只展示友好状态，过程简述集中在对话内折叠区。

## 持久化运行状态

实现：`backend/app/agent/run_store.py`，表为 `agent_execution_runs`、`agent_run_steps`、`agent_tool_executions`。AG-UI 的 `runId` 是运行幂等键，并且只能属于一个对话；重复提交已结束的 `runId` 会复用原模型结果和已绑定的 user/assistant 消息，不会再次调用模型或产生重复消息。

runtime 在进入循环、完成每个工具轮、写入完成修复提示和引用修复提示后保存 `checkpoint`。检查点包含车道、计划、消息、轮数、已完成工具和重复调用防护状态，但不会通过运行状态 API 暴露原始消息。服务启动时把遗留的 `queued` / `running` 运行和 `running` 工具调用标为 `interrupted`；客户端用同一个 `runId` 重试时，从最近检查点继续，不重复追加原始 user 消息。

工具账本以“runId + 工具名/参数指纹”为唯一键：

- 已有 `done` 结果直接回放，并标记 `idempotent_replay`。
- 中断的 `read_only`、`derived_analysis`、`external_read` 工具可以重新执行。
- 中断或结果不明的本地写工具返回 `tool_execution_uncertain`，禁止自动重放，避免重复副作用。
- plan step 独立落入 `agent_run_steps`，状态只使用 `pending` / `running` / `done` / `failed` / `blocked`。

读取运行、步骤与工具执行账本时，对损坏或过期的 JSON 做容错解码；无法校验的 checkpoint/result 返回空值并标记 invalid，`GET /agent/runs/current` 仍可返回安全摘要。不可校验的检查点不能恢复；无效工具结果不会作为成功结果重放，原始记录保留。

取消请求同时写入 run 账本并取消当前进程内任务。runtime 在模型调用和工具调用期间每 250ms 检查持久化取消标记，可跨请求传播取消。`GET /agent/runs/current` 返回不含原始 checkpoint、工具参数和工具结果的安全状态摘要；`POST /agent/runs/{run_id}/cancel` 可按运行取消。等待用户的运行与后续恢复运行通过 `parent_run_id` / `resumed_by_run_id` 关联，保留完整审批链。

合成事件名（`agent_thinking`、`agent_planner`、`model_provider`、`completion_validator`、`citation_validator`、`agent_loop_guard`、`agent_run_state`）不是工具，不要写入 `TOOL_POLICIES`。

## 记忆与人审

对话窗口、摘要与 durable run 继续保留。资料接口统一为 `/library`：基本信息、来源材料、隐私检查、文档解析和事实审核。旧 `/career-profile` 接口不再公开。

`library_sources` 是资料的权威目录，每个上传文件或粘贴文本独立保存标题、类型、原始文件名、正文、脱敏正文、隐私模式、启用状态、解析状态、哈希与元数据。上传原件位于当前账户工作区的 `library/<source_id>/`，目录权限 `0700`、文件权限 `0600`。禁用来源会同步移除其检索分块；删除来源会永久删除原件、正文与索引，只依赖该来源的待确认知识同步删除，已确认知识保留并标记原来源已删除。

当前版本为 25。`persistence/schema.py` 管理当前表，`persistence/upgrades.py` 串行执行版本升级；`compatibility/` 仅在旧库升级时加载。版本 1–23 先备份到 `.upgrade-backups/before-library-v23/`，再将旧 Markdown/画像基础资料、旧知识审核状态和证据导入独立资料表。历史公开知识标识保留；旧求职业务表和原始文件不删除。已有启用/禁用来源保持，完成升级后不再从旧原文补来源，已删除来源不会复活。来源导入和索引成功后记录当前版本；失败可重试且不会重复导入。

称呼可留空，不影响文件库的可用状态。文件库采用扁平主导航，分类（全部、最近、收藏、回收站）和文件夹在模块内。数据库 v25 新增账户内 `library_folders`；来源的文件夹、收藏、打开时间及回收站时间写入 `metadata.organization`，合并时保留解析元数据。v24 升级只扩展表及重建可恢复索引，不改来源 ID、原件或启用状态。`PATCH /library/sources/{id}/organization` 管理组织状态，回收站移除通用上下文和检索分块，恢复按原启用状态重新索引；原 `DELETE` 保持永久删除语义，前端只在回收站二次确认后调用。组织操作不会更改文件修改时间。上传解析失败仍保存原件并标记 failed，正文补充后可恢复 ready；PDF/图片直接读取鉴权原件（PDF 使用本地打包的 PDF.js worker、字体与 CMap，支持翻页/缩放），文本原件与校正的 AI 文字分别展示，DOCX 可下载原件或查看提取文字。`GET /library/sources?q=` 支持文件名与正文搜索。

`POST /library/conversations` 将最多 10 个选中文件复制为新会话的待发送 document 附件，不启动模型请求。每份快照使用来源当前隐私模式（默认脱敏），去重并拒绝回收站或无文字来源；附件创建失败清理本次会话与附件。前端一次性消费待发送附件，用户仍需填写消息并发送。该动作不限制 Agent 现有的资料记忆范围，其他启用资料仍按原记忆规则读取；之后校正、删除来源或改变隐私模式不会追溯改写已有会话快照。

默认向模型提供 `scan_and_redact` 后的文本；用户只可对单个来源开启 original。`get_library_context` 每个启用来源最多取 4000 字、总量最多约 12000 字并附来源摘要；更长资料由 `search_library` 按 `library_source` 分块检索并返回来源 ID、标题和片段。

Agent 新知识写入 library_knowledge 的 pending 状态；用户确认后才进入 confirmed 上下文，否决或撤回内容不作为已确认事实。职业目标/策略不进入新知识库上下文。导入文档仅提取文本，不再推断求职方向、薪资或自动生成技能事实。

当前附件 kind 使用 `document` / `image`，资料记忆开关使用 `library_memory_enabled`。升级将旧附件行、历史消息中的附件元数据和 `profile_memory_enabled` 设置转换到通用字段，保留原值语义。图片附件不强制进入岗位分析，模型看图仍由用户授权。短文本笔记不再沿用简历最低字数限制；删除原文件失败会回滚来源、证据和索引。知识写入工具成功后前端刷新待确认条目。前端资料库由 `features/library/useLibrary.ts` 管理来源及基本信息；聊天协议在 `features/chat/types.ts`，任务订阅与重试/取消在 `useChatRun.ts`，Markdown、对话过程和来源详情由 `MessagePresentation.tsx` 呈现。

## 工作流阶段

历史六阶段求职漏斗已退役。当前入口不再维护旧 workflow 表；活动由 durable Agent runs、步骤和工具事件记录。对话中的「状态/进度」不再自动返回求职漏斗摘要；真实任务状态来自 durable Agent runs。

## 模型与配置

多连接和模型档案分别保存在 `model_connections` / `model_profiles`，稳定 ID 区分同协议、同名模型；独立目录和诊断使用所属连接凭证。会话可选择档案，发送时固定连接及档案版本，重试和恢复读取历史版本。运行与快照只保存引用和不可逆凭证指纹；环境密钥更换会使新调用使用新缓存，旧任务拒绝静默换用新密钥。历史明文迁移建立不可变凭证别名，替换或切换默认前必须保留旧凭证引用；安全存储不可用时保留原配置。

输入框打开模型菜单时，`useComposerModelDiscovery` 使用当前会话档案所属连接（跟随默认时使用实际执行档案）的 `/agent/model-connections/{id}/discover`，合并目录模型与已保存档案，支持搜索和手动刷新。目录只读且不做逐模型调用；缓存按账号、连接 ID 和连接版本隔离，旧请求取消并屏蔽迟到结果。目录失败保留已知列表和已保存模型，目录可见不代表已验证权限或能力。已停用且没有同名启用档案的模型从服务选项中过滤。

选择尚未保存的目录模型先通过 `POST /agent/model-connections/{id}/profiles/ensure` 以 `model_name` 和连接的 `expected_revision` 创建或复用启用档案，再 PATCH 当前会话的 `model_profile_id`；不切换全局默认，不复制其他模型参数或能力声明。工作区锁和事务保证重复选择复用同一档案，连接版本冲突返回 409，已停用档案不会被此接口重新启用。保存/绑定期间阻止发送；创建失败或切换会话后不继续绑定，发送仍走已有档案与阶段版本固定逻辑。

档案的 `temperature` 和 `max_output_tokens` 映射到五种协议实际请求，生成与流式共用映射；请求只能缩小已绑定的输出上限。连接检查与图片探测保持独立的小额诊断参数。协议或模型不接受温度等参数时由服务返回真实错误，不静默丢弃配置。

`agent/model_router.py` 独立选择模型，不参与 TaskRoute 的工具白名单或人工确认。`GET/PUT /agent/model-routing` 管理带版本的策略：`classify`（意图识别）、`plan`（规划和重规划）、`execute`（工具循环与回答）。新任务执行模型按会话明确选择 → 执行角色 → 账号默认决定；识别和规划按阶段角色 → 账号默认决定。配置入口在模型设置的高级区域，不增加侧栏子导航；主表单仍只有地址、密钥和模型。PUT 要求 `expected_version`，冲突返回 409，草稿保留，用户可重新读取。

发送前在工作区配置锁内固定三个阶段的连接、档案版本、凭证指纹、策略版本和严格能力开关。每轮执行及重规划沿用已绑定角色，不自动换模型；恢复时读取版本表和原阶段绑定，不读取新策略。启用过阶段路由却丢失绑定的运行拒绝恢复；升级前没有阶段绑定的运行保留原单模型行为。消息模型详情显示阶段、模型、策略版本及选择原因，没有发生调用的阶段明确标记；监控按实际阶段身份记账。

每次调用前检查图片、工具和流式需求。档案能力明确不支持时拒绝；未知默认允许尝试并记为 `unverified`，严格检查时拒绝未知能力。目录可见、客户端支持或模型名字推断均不自动成为已验证能力。当前严格检查依赖档案已登记的状态，尚未自动将所有诊断或调用证据归并到档案；因此新档案默认均为未知，严格模式会阻止未登记的工具或流式请求。

配置文本上下文上限时，以序列化输入、工具定义、系统提示和人设的 UTF-8 字节作保守输入估算，并预留明确配置的输出长度；没有输出上限或包含无法可靠估算的图片时明确拒绝。此估算不是精确 Token 计费，也不声称已经实现金额预算。备用模型切换、健康冷却、预算及并行分析仍属后续 B4/B5，当前没有自动故障转移或并行写工具执行。

模型连接支持 OpenAI 兼容 Chat Completions、OpenAI Responses、Anthropic Messages、Google Gemini `generateContent` 与 Ollama Chat。显式 `model_protocol` 永远优先；`auto` 会先识别官方域名和 Ollama 地址，再按模型家族选择协议（`claude-*` → Anthropic、`gemini-*` → Gemini，其他 → OpenAI 兼容）。自定义多协议网关上的 Claude/Gemini 会先调用原生协议；只有 404/405 路由不存在、HTTP 200 却无法解析为该协议等可证明的协议不匹配，才回退到 OpenAI 兼容，并按网关 + 模型 + 密钥指纹缓存成功协议。认证失败、限流、模型不可用、上游账户池耗尽和其他 5xx 都不得换协议重试；流式响应一旦输出任何事件也不得回退，以免重复正文。根地址回退到 OpenAI 兼容时会尝试标准 `/v1`，已带路径的自定义 API 根地址不改写。Responses 与非标准包装仍可在设置页显式选择。

模型能力主动检测分为图片、流式、工具三项，分别使用诊断总预算的三分之一，单项失败不跳过其他项。流式需要非空文本增量和正常完成结果；工具检测要求返回指定无副作用工具的名称与随机参数，仅验证返回值、不执行工具。错误/超时或未取得有效证据保留 unknown，逐项记录实际协议，避免把不同协议的探测结果误认为单一协议能力；GET 仍只做静态推断，探测结果未自动写入模型档案的路由能力声明。

自动模式在提供 API 根地址且首选 Chat Completions 时，增加同根地址的 Responses 候选。明确的协议拒绝（包括 400 中英文“不支持 chat completions”）、缺失路由或无效响应允许回退；认证、限流、额度、普通参数错误不触发回退。流式事件已输出后不回退，成功协议按地址、模型与密钥指纹缓存在进程中；显式协议保持单一候选。该机制不能推断服务商未公开或不兼容的任意协议。

Base URL 视为对应协议的 API 根地址：显式 OpenAI 兼容客户端不自动追加 `/v1`，Responses 请求 `/responses`，Anthropic 请求 `/v1/messages`，Gemini 请求 `/models/{model}:generateContent`，Ollama 请求 `/api/chat`。OpenAI 兼容调用还会验证响应中存在 `choices`，流式调用至少返回响应 ID、用量、结束原因、正文或工具调用之一；网页回退或空响应即使 HTTP 状态为 200 也会记为 `invalid_provider_response`，不得标记为健康。模型目录只证明名称可见，不证明当前账户可实际调用；设置页提示是否可用以连接检测为准，诊断区展示已保存连接的调用结果。本地 Ollama 可不配置 API Key；其他协议要求密钥。`GET /agent/capabilities` 在缺少密钥时返回 200 与 `configured: false`（可先配置再对话），真正运行 Agent 仍要求已配置密钥。runtime、模型发现、能力检测与健康监控使用同一协议解析结果。runtime 的 system 消息必须保持协议级 system 语义：Anthropic 合并到顶层 `system`，不能降级成 `user` 消息。系统提示在 `backend/app/models/openai_compatible.py`：中文、不编造经历与来源、只使用本轮实际提供的工具、不点名具体工具名、过程叙述交给界面。本轮工具清单由 runtime 注入。缺少关键信息或指代有歧义时必须调用 `ask_user`，不要猜测，也不要只在正文里提问。用户明确要求思维导图时可输出 Mermaid `mindmap` 代码块，界面渲染为可展开、缩放的交互导图；普通回答不主动生成图。

用户可配置人设（名称、角色、详略、补充指令）不能覆盖事实要求、工具权限和人工确认规则。模型名、Base URL 和协议保存在 `agent_settings`。新 API Key 不写 SQLite：macOS 单机网页和桌面默认使用 Keychain，与 `BIND_HOST` 监听地址无关；仅显式 `CAREERLOOP_DEPLOYMENT_MODE=hosted` 或 `CAREERLOOP_SECRET_BACKEND` 覆盖改变该选择。其他环境根据可写凭证服务能力处理；环境密钥只绑定环境提供的连接，不能用于用户修改后的任意地址。密钥采用不可变版本引用，数据库事务一次切换连接配置和引用，失败保留完整旧连接。发现历史明文密钥时仅在成功迁移后清空原字段；不同环境 Key 不代表迁移完成，失败保留旧值并告警。

模型设置主界面仅显示 Base URL、API Key 与模型名称，支持目录选择及手动填写，字段无需先解锁；首次读取完整配置后才展示表单。修改为草稿，单次点击“保存并应用”才保存，并从下一次模型调用生效。保存期间禁用字段及取消操作，空密钥继续沿用已保存密钥；配置保存成功与连接检测失败分别反馈。接口协议、额度、能力探测及调用监控保留在默认折叠的高级设置，已有显式协议不被自动重置，能力读取/探测仅使用已保存连接。`features/settings/useModelDiscovery.ts` 取消旧请求并用序号屏蔽迟到结果；更改地址、密钥或协议清空目录，更改模型名称保留已加载目录并使旧请求失效。目录失败可重试，具体错误只在高级设置展示。详情见 [model-settings-qa.md](model-settings-qa.md)。

联网研究默认关闭（`WEB_RESEARCH_ENABLED`）。即使服务端开启，`search_public_web` 仍要求本轮用户打开联网开关。

## 可观测性

| 信号 | 位置 | 注意 |
| --- | --- | --- |
| 工具审计 | `observability/tool_call_audit.py` | 只记元数据（名称、状态、延迟、错误码），不存参数和结果；保留 30 天 |
| 模型监控 | `observability/model_monitor.py` | 调用成败与用量 |
| 运营快照 | `agent/operations.py` + 设置页看板 | 路由分布、工具成功率、延迟 |
| 运行事件 | `agent_execution_runs` / `agent_run_steps` | 任务、计划步骤与工具完成 |

前端运营看板的路由中文标签必须能覆盖 `ROUTE_LABELS`。不要在前端保留已经消失的 kind。

## 已知边界

这些是现状，不是待办清单里的默认目标：

- 关键词命中仍走规则；未命中会再分类一次 `kind`，分类器不能选工具。已命中的关键词车道换一种说法仍可能进错。
- 工具失败只允许一次同车道重规划；`blocked` / 超时仍立即停。
- 任务进度由持久化运行账本展示。等待中的下一条消息默认恢复原 run；手输改口会清快照。无改口词且仍落在 `conversation` 的闲聊可能继续锁在旧任务，可点结束任务。
- 记忆是业务账本，不是「上次同类任务怎么走」的策略记忆。
- 输入框确认条只在工具返回 `data.clarification` 时出现；模型若只在正文里提问，界面不会自动抽出选项。
- 未配置模型密钥时仍可登录并浏览资料库/工作台/首页；对话发送会引导到 `#/settings/model`。

旧库领域表仅保留原始记录，退役求职实现和测试已删除；当前解析位于 documents/，活跃产品契约由 `test_agent_runtime.py`、`test_library_product.py`、`test_library_sources.py`、流式聊天测试和当前前端路由测试覆盖。

## 验证

智能体行为变更应补确定性测试，并模拟网络与模型：

```bash
cd backend && .venv/bin/python -m pytest tests -q
```

路由、工具面、引用校验、模型重试、写工具不重放与 `ask_user` 均使用模拟模型和网络结果，不调用真实模型。离线评测保留退役请求作为负向契约，确保不会恢复旧工具；当前路由、计划、事实和 ask_user 契约纳入后端测试。可选仍可用 Promptfoo 做人工对比：

```bash
cd evals && PROMPTFOO_PYTHON=../backend/.venv/bin/python npx --yes promptfoo@0.118.0 eval --no-cache
```

涉及聊天流或运营看板时，再跑对应前端测试。

### 对话展示方式

普通页面不再显示常驻对话栏或右下角悬浮按钮；内容创作通过 AI 工作区中的起草入口完成。`#/chat` 使用完整主内容区域，仅显示对话自身的标题，不再增加重复的模块标题与欢迎语；浮动面板保留面板页头和关闭、独立页面入口。同一 ChatWorkspace 保持挂载，收起不清空草稿、不取消任务，两种展示共享当前会话。

首次启动尚无账号时，只初始化认证库，跳过业务任务恢复；创建用户工作区后才初始化业务表，后续启动按用户工作区恢复中断任务。

### 问答模型可用性检查

`PUT /agent/settings` 只表示配置已保存；设置页保存后会额外调用一次 `POST /agent/model-monitor/check`，分别显示连接成功、连接失败或未完成检测。问答发送前不做真实模型预检，直接发起正式请求，避免一次用户操作产生两次模型调用。正式请求失败时，界面保留输入、附件和联网选项，并展示稳定错误码对应原因。`GET /agent/capabilities` 失败必须显示后端服务不可用，不能伪装为未配置密钥。

macOS 单机网页和桌面的新密钥写入 Keychain；环境模式只读管理员提供的密钥，不能向用户草稿的新地址自动发送。新密钥不写 SQLite，保存采用独立凭证版本与数据库原子引用切换。发现旧明文密钥时，只在成功迁移并绑定引用后清空旧字段；失败保留旧值并返回迁移警告。日志、健康接口和错误响应不得出现密钥。

## 架构收敛进度

当前资料库的基础资料、知识审核和来源管理位于 `library/`，只使用 `library_metadata`、`library_knowledge`、`library_evidence` 与 `library_sources`。确认知识不再改写画像 Markdown 或技能小节。`/library`、`/library/sources`、`/library/facts` URL 保持；文档解析不再返回退役求职推断字段。历史存储只在一次性兼容升级中读取，当前入口不再写旧工作流。完整实施范围与验收见 `docs/refactoring-plan.md`。

## 兼容白名单与验证边界

- `compatibility/schema_v22.py`、`profile_document.py`、`library_v23.py` 只供版本 1–22 的升级及合成迁移测试使用；版本 23–25 的业务不重新解析旧画像。升级入口统一在 `persistence/upgrades.py`，版本号完成后才标记迁移成功。
- `career-profile.md`、`bosscopilot.db` 等历史文件名只用于工作区认领、备份及迁移；旧表保留原记录，当前业务无写入。新工作区没有这些表。
- 历史附件 `resume/job_screenshot` 与设置 `profile_memory_enabled` 只在升级转换；新协议只写 `document/image` 和 `library_memory_enabled`。`/library` 的 `profile`、`facts` JSON 键保留接口兼容，内部对应通用元数据和知识条目。
- 前端 `routing.ts` 只识别当前入口；未知 hash 打开首页。旧品牌本地存储键由应用入口读取；历史 `research_company` 事件只作为来源展示，不注册或执行旧工具。快照恢复必须符合当前路由与工具白名单。
- `resume_policy.py`、`resume_mode` 和 `can_resume` 表示继续执行任务；`candidate` 在模型候选项、文件路径等位置是普通变量名。通用清洗保留已有文档的标题与联系方式格式，不推断职业字段。
- 当前评测与测试使用合成资料并模拟外部模型/搜索。真实后端 E2E 保留账户、API、SQLite、五工具与 runtime 执行，只替换模型生成。桌面 smoke 使用打包可执行文件与临时数据；原生窗口交互、真实模型质量、外部搜索服务和未验证平台仍需发布验证。

这些兼容项的退役条件记录在 `docs/refactoring-plan.md`；删除历史数据或结束旧版本升级支持需另行明确范围。

### v28 模型运行绑定迁移

曾有 v27 工作区在模型绑定字段引入前已标记升级完成。v28 显式重新执行幂等的增量字段/表迁移，补齐 `agent_execution_runs.model_selection_json` 等模型元数据。旧运行的模型绑定默认为空 JSON，不虚构历史模型；v27 升级不重建资料索引，历史消息和运行记录保留。版本号必须随持久化结构变更递增。

### 聊天成果归档边界

`chat/artifacts.py` 提供持久化回答、闭合代码围栏和原附件的只读清单，以及用户主动调用的 `save-to-library` 接口。它不注册 Agent 工具，保留 classify/plan/execute 角色与旧恢复快照；Grok 文字生图通过下述独立分支接入。存档默认 enabled=false，只在用户勾选且有可读正文时索引脱敏文本，生成来源和未完成状态保存在 metadata 中；不自动确认知识。保存验证账户、终态、消息/资源快照与原件哈希，归档副本不随聊天回退/删除而删除。接口和验证见 [实施记录](chat-results-implementation.md)。

### v29 Grok 文字生图

明确的当轮文字生图指令进入 Grok 4.7 原生 Responses 分支，只使用冻结 execute 模型；文档、旧消息和询问生图原理不授权原生工具。非 Grok 4.7 或手动选择其他协议时在请求前失败，不能把文字回答当成已生图。`ModelRequest.image_generation` 与 function tools 分开，原生请求仅允许 action=generate；不改变三个模型阶段，不与本地搜索工具混用。

`ModelResponse.images` 中 Base64 是排除序列化且隐藏 repr 的 SecretStr；`output_blocks` 保留文本/图片顺序。最终图片由 `chat/image_assets.py` 校验并存入账户本地目录，运行/消息/SSE 只返回资产引用；没有文字的图片结果仍为合法完成。过程使用 image_generation 事件，输入框不新增重复状态区。

v29 新增 chat_image_operations/chat_image_assets，保留旧表、消息与索引。操作以 runId 固定模型档案/连接版本，请求前提交 started；同操作完成重放复用结果，未知执行状态阻止自动重发，取消/超时/协议不支持不自动切换协议或重试。消息和图片关联在一个事务内保存；回退清理已绑定图片但保留尝试标记，删对话清理聊天资源，文件库图片副本独立保留。真实服务需要开放 image_generation；目录识别、vision 和客户端工具能力不证明生图可用。首期不支持图像编辑、联网后生图或落盘失败后的结果找回，详见 [实施记录](chat-results-implementation.md)。

### 生图能力与执行错误隔离

模型档案的 `capabilities.image_generation` 独立于 vision、tools、streaming，旧档案默认 unknown。冻结 execute 路由在发起请求、写入生图尝试标记前检查该项；明确 unsupported 时直接返回 `image_generation_unsupported`，不调用外部模型，普通文本任务不检查该能力。PATCH 模型档案可更新能力状态（需要 expected_revision），部分能力更新保留其他项。更换 API Key、网关地址、协议或模型 ID 后，旧生图状态恢复 unknown，并保存新档案版本；旧运行恢复仍读取其原版本。这里没有通过目录名称推断或自动计费探测生图能力。

未被阻止的原生请求使用独立生图提示词、唯一 image_generation/action=generate 工具及 tool_choice=required。服务只返回文字时报告 `image_generation_not_executed`，保留真实 token 用量与响应 ID，不自动补发或切换接口；图片落盘之前不在消息区展示可能错误地声称成功的流式文字。

持久化终态负责对话内的错误和重试入口。前端收到终态后忽略后续重复 RunError，不再创建输入框错误横幅，也不把生图/搜索错误当作整个模型不可用；没有持久化终态的连接中断仍保留输入、附件、搜索选项和同一 runId 重放入口。纯错误文字不提供成果清单；失败任务确有部分正文或图片时仍可存档并注明未完成。
