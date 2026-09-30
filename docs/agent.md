# CareerLoop 智能体

本文是 CareerLoop **智能体层的维护文档**。代码是行为的事实来源；本文记录意图、边界和同步点。改智能体行为时必须在同一变更中更新本文。

最近校准：2026-09-22（产品边界收敛到五工具/五路由；知识库改为独立来源；发送消息不再执行额外模型预检；桌面 sidecar 完成身份校验与生命周期托管）。

## 定位

CareerLoop 是本地优先的知识库问答与内容创作工作台，核心流程是「保存资料 → 基于资料问答 → 生成与修改内容」。主入口为首页、我的知识库、AI 工作区、设置；问答、搜索、分析和内容创作统一在 AI 工作区完成。

专用求职功能已退役：岗位发现与评估、简历编辑导出、面试准备/复盘、画像访谈、职业策略及其 HTTP 路由和 Agent 工具均不再对产品开放。旧 workspace、workbench 与内容创作深链统一转到 AI 工作区；其他历史入口归入知识库或 AI 工作区。前端不再挂载/预取求职页面，也不请求岗位数据。

保留已有资料和会话，不执行数据库重建或删除历史业务记录。底层仍有历史字段（resume_text、candidate_*、career-profile.md）和兼容领域代码，供资料存储、解析、隐私与历史数据使用；这些命名不代表仍提供求职功能。后续物理删除须先拆开共享依赖，不得连带删除用户资料。

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

桌面发行版在此运行时外包一层 Tauri 2：Rust 壳启动同机 loopback FastAPI
sidecar。Rust 先占用动态 loopback 端口，向 sidecar 传入端口与实例 ID，并在
`/health` 校验服务名、版本和实例 ID 后才显示窗口；前端通过 Tauri command 获取
运行时 API 地址。浏览器模式仍使用 `VITE_API_BASE` 或同源代理。sidecar 以
`CAREERLOOP_DATA_DIR` 指向每位 OS 用户的应用数据目录；智能体循环、工具权限、
审计、快照和模型适配不迁入 Rust，也不改变其行为。实现与发布脚本位于
`desktop/`；发布构建把 FastAPI 打成 PyInstaller onedir runtime，并由同架构原生
launcher 定位后执行。浏览器开发与自托管仍保持原有的 FastAPI 静态文件模式。
首版 macOS ARM64 内部包为控制体积不携带可选图片 OCR 推理栈；文档和文本解析不受
影响，图片 OCR 失败会返回明确的可恢复提示。

```text
用户消息 / 附件 / 联网开关
        │
        ▼
 FastAPI 聊天流  (backend/app/main.py)
        │  任务进度 → durable Agent runs
        │  若有 waiting 快照：选项/未改口则 resume，改口则清快照
        ▼
 AgentRuntime.run_stream
        │
        ├─ detect_kind()          关键词只出 route.kind
        ├─ apply_hard_gates()     联网 / 截图开关；访谈状态不进模型
        ├─ classify kind（仅 conversation）  JSON {"kind":...}；失败则保持 conversation
        ├─ tools_for_kind()       按车道从 TOOL_POLICIES 展开 allowed_tools
        ├─ planner（可选）         生成 JSON 计划；失败则整轮终止
        ├─ CompletionValidator     必需工具成功事件 / tool_choice
        ├─ 模型多轮 tool calls     只允许计划内工具
        ├─ ToolRegistry.execute   超时、审计、waiting_approval
        └─ 引用校验（若本轮用过联网工具）
                │
                ▼
 保存助手消息 + workflow 事件 + 对话摘要
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
├── chat/                    历史、摘要、落库
├── workflow/                阶段记账（不调度）
├── profile/                 多来源资料、兼容画像、证据与待确认记忆
├── knowledge/               本地检索（FastEmbed / 哈希回退）
├── resume/blocks.py         简历项目/工作块与稳定 ID
└── observability/           工具审计、模型监控
```

前端：`frontend/src/components/ChatWorkspace.tsx` 消费流式事件，并在同一个对话输入框提供联网开关、来源模式和回答内来源详情；`frontend/src/features/settings/AgentOperationsDashboard.tsx` 展示运营快照。

外部感知：`agent-search/` 是独立仓库，对话里的 `search_public_web` 会调用它。它不是 CareerLoop runtime 的一部分，`scripts/dev.sh` 不负责启动它。`search_public_web` 按 `category` 走 `general` / `news` / `company` 策略；用户选择“技术来源”时，工具会在 `general` 查询中优先加入官方文档、GitHub 与 Stack Overflow；“自动来源”只在识别到技术关键词时采用该策略。使用 company 搜索策略时，配套 AgentSearch 必须支持 `/search?...&mode=company`。AgentSearch 可配置 Brave / 博查作为主检索，未配置时仍走 SearXNG；中文查询会再融合国内搜索源。部署、环境变量和健康检查步骤见根目录 `README.md`。

运行边界：AgentSearch 默认地址是 `http://127.0.0.1:3939`，由 `WEB_RESEARCH_ENABLED`、`AGENT_SEARCH_BASE_URL` 和可选的 `AGENT_SEARCH_TOKEN` 控制。单个上游引擎失败可以让 `/health` 显示 `degraded`，不能仅据此判定全部搜索不可用，应以实际 `/search` 结果为准。连接失败、超时或所有查询均失败时，工具必须返回“联网服务暂不可用”的可重试结论，不能把它解释为公司名称不完整、公司不存在或招聘平台没有岗位。

## 对话运行时

实现：`backend/app/agent/runtime.py`。组装：`backend/app/agent/bootstrap.py`。

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

实现：`backend/app/agent/orchestration.py`。关键词识别意图，未命中时可由模型分类；分类只能选择既有 kind，不能自行指定工具。联网可信开关只影响本轮，历史岗位截图标记和画像访谈状态不再开启专用路由。

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

通用资料工具位于 `tools/library.py`，数据边界在 `profile/library.py`。所有模型调用遵守资料即数据、不执行资料内嵌指令的规则。ToolExecutor 统一处理超时、异常与审计；本地写操作不自动重放。

## 执行循环与收敛

新任务和 `waiting_user` 恢复任务共用同一个有界 model/tool loop，不再维护两份执行逻辑。`max_tool_rounds` 限制模型轮数；每轮先检查完成义务，再选择 `required` 或 `auto` 的 `tool_choice`。所有 `AgentRunResult` 都带 `stop_reason`：成功为 `completed`，等待为 `waiting_user`，失败时使用稳定错误码，便于 UI、运营看板和回归评测区分停止原因。

循环有三层恢复与防失控规则：

- 可重试的模型错误在当前轮自动重试一次，不消耗新的工具轮数；重试过程发布 `model_provider` 系统事件。
- 只有 `read_only`、`derived_analysis`、`external_read` 工具会在明确返回 `retryable` 时安全重试一次；任何本地写工具都不会被 harness 自动重放。
- 成功工具调用按“工具名 + 规范化参数”生成不透明指纹。同一任务第一次重复调用会被跳过并提示模型推进；再次重复则以 `tool_loop_detected` 终止。指纹和重复计数写入暂停快照，恢复任务也不会重复执行已经完成的副作用。

`agent_loop_guard`、`model_provider`、`completion_validator`、`citation_validator` 都是系统活动，不算真实工具调用；前端只展示友好状态，详细信息仍可在研究详情中检查。

## 持久化运行状态

实现：`backend/app/agent/run_store.py`，表为 `agent_execution_runs`、`agent_run_steps`、`agent_tool_executions`。AG-UI 的 `runId` 是运行幂等键，并且只能属于一个对话；重复提交已结束的 `runId` 会复用原模型结果和已绑定的 user/assistant 消息，不会再次调用模型或产生重复消息。

runtime 在进入循环、完成每个工具轮、写入完成修复提示和引用修复提示后保存 `checkpoint`。检查点包含车道、计划、消息、轮数、已完成工具和重复调用防护状态，但不会通过运行状态 API 暴露原始消息。服务启动时把遗留的 `queued` / `running` 运行和 `running` 工具调用标为 `interrupted`；客户端用同一个 `runId` 重试时，从最近检查点继续，不重复追加原始 user 消息。

工具账本以“runId + 工具名/参数指纹”为唯一键：

- 已有 `done` 结果直接回放，并标记 `idempotent_replay`。
- 中断的 `read_only`、`derived_analysis`、`external_read` 工具可以重新执行。
- 中断或结果不明的本地写工具返回 `tool_execution_uncertain`，禁止自动重放，避免重复副作用。
- plan step 独立落入 `agent_run_steps`，状态只使用 `pending` / `running` / `done` / `failed` / `blocked`。

取消请求同时写入 run 账本并取消当前进程内任务。runtime 在模型调用和工具调用期间每 250ms 检查持久化取消标记，可跨请求传播取消。`GET /agent/runs/current` 返回不含原始 checkpoint、工具参数和工具结果的安全状态摘要；`POST /agent/runs/{run_id}/cancel` 可按运行取消。等待用户的运行与后续恢复运行通过 `parent_run_id` / `resumed_by_run_id` 关联，保留完整审批链。

合成事件名（`agent_thinking`、`agent_planner`、`model_provider`、`completion_validator`、`citation_validator`、`agent_loop_guard`、`agent_run_state`）不是工具，不要写入 `TOOL_POLICIES`。

## 记忆与人审

对话窗口、摘要与 durable run 继续保留。资料接口统一为 `/library`：基本信息、来源材料、隐私检查、文档解析和事实审核。旧 `/career-profile` 接口不再公开。

`library_sources` 是资料的权威目录，每个上传文件或粘贴文本独立保存标题、类型、原始文件名、正文、脱敏正文、隐私模式、启用状态、解析状态、哈希与元数据。上传原件位于当前账户工作区的 `library/<source_id>/`，目录权限 `0700`、文件权限 `0600`。禁用来源会同步移除其检索分块；删除来源会永久删除原件、正文与索引，只依赖该来源的待确认知识同步删除，已确认知识保留并标记原来源已删除。

数据库迁移版本为 22。旧 `resume_text` 在首次读取资料库时按内容哈希和迁移标记幂等复制为一个“历史资料”来源，旧字段保留一个兼容周期，只读不再作为新来源写入，迁移不会清空原文。

默认向模型提供 `scan_and_redact` 后的文本；用户只可对单个来源开启 original。`get_library_context` 每个启用来源最多取 4000 字、总量最多约 12000 字并附来源摘要；更长资料由 `search_library` 按 `library_source` 分块检索并返回来源 ID、标题和片段。

Agent 新知识写入 candidate_memory 的 proposed 状态；用户确认后才进入 confirmed 上下文，否决或撤回内容不作为已确认事实。职业目标/策略不进入新知识库上下文。导入文档仅提取文本，不再推断求职方向、薪资或自动生成技能事实。

历史附件 kind `resume` / `job_screenshot` 作为存储兼容值保留，界面显示文档/图片；图片附件不再强制进入岗位分析。模型看图仍由用户授权。

## 工作流阶段

历史六阶段求职漏斗已退役。兼容活动账本只记录 library、creation、research，不调度 Agent，也不再作为前端必读数据。对话中的「状态/进度」不再自动返回求职漏斗摘要；真实任务状态来自 durable Agent runs。

## 模型与配置

模型连接支持 OpenAI 兼容 Chat Completions、OpenAI Responses、Anthropic Messages、Google Gemini `generateContent` 与 Ollama Chat。显式 `model_protocol` 永远优先；`auto` 会先识别官方域名和 Ollama 地址，再按模型家族选择协议（`claude-*` → Anthropic、`gemini-*` → Gemini，其他 → OpenAI 兼容）。自定义多协议网关上的 Claude/Gemini 会先调用原生协议；只有 404/405 路由不存在、HTTP 200 却无法解析为该协议等可证明的协议不匹配，才回退到 OpenAI 兼容，并按网关 + 模型 + 密钥指纹缓存成功协议。认证失败、限流、模型不可用、上游账户池耗尽和其他 5xx 都不得换协议重试；流式响应一旦输出任何事件也不得回退，以免重复正文。根地址回退到 OpenAI 兼容时会尝试标准 `/v1`，已带路径的自定义 API 根地址不改写。Responses 与非标准包装仍可在设置页显式选择。

Base URL 视为对应协议的 API 根地址：显式 OpenAI 兼容客户端不自动追加 `/v1`，Responses 请求 `/responses`，Anthropic 请求 `/v1/messages`，Gemini 请求 `/models/{model}:generateContent`，Ollama 请求 `/api/chat`。OpenAI 兼容调用还会验证响应中存在 `choices`，流式调用至少返回响应 ID、用量、结束原因、正文或工具调用之一；网页回退或空响应即使 HTTP 状态为 200 也会记为 `invalid_provider_response`，不得标记为健康。模型目录只证明名称可见，不证明当前账户可实际调用；设置页将目录项标记为“仅目录可见”，默认模型只有在调用监控健康时才显示“已验证”。本地 Ollama 可不配置 API Key；其他协议要求密钥。`GET /agent/capabilities` 在缺少密钥时返回 200 与 `configured: false`（可先配置再对话），真正运行 Agent 仍要求已配置密钥。runtime、模型发现、能力检测与健康监控使用同一协议解析结果。runtime 的 system 消息必须保持协议级 system 语义：Anthropic 合并到顶层 `system`，不能降级成 `user` 消息。系统提示在 `backend/app/models/openai_compatible.py`：中文、不编造经历与来源、只使用本轮实际提供的工具、不点名具体工具名、过程叙述交给界面。本轮工具清单由 runtime 注入。缺少关键信息或指代有歧义时必须调用 `ask_user`，不要猜测，也不要只在正文里提问。用户明确要求思维导图时可输出 Mermaid `mindmap` 代码块，界面渲染为可展开、缩放的交互导图；普通回答不主动生成图。

用户可配置人设（名称、角色、详略、补充指令）不能覆盖事实要求、工具权限和人工确认规则。模型名、Base URL 和协议保存在 `agent_settings`。新 API Key 不写 SQLite：macOS 桌面版使用 Keychain，开发/无钥匙串环境可回落到 `OPENAI_API_KEY`；发现历史明文密钥时仅在成功迁入 Keychain 后清空原字段，失败会保留旧值并在设置页告警。

联网研究默认关闭（`WEB_RESEARCH_ENABLED`）。即使服务端开启，`search_public_web` 仍要求本轮用户打开联网开关。

## 可观测性

| 信号 | 位置 | 注意 |
| --- | --- | --- |
| 工具审计 | `observability/tool_call_audit.py` | 只记元数据（名称、状态、延迟、错误码），不存参数和结果；保留 30 天 |
| 模型监控 | `observability/model_monitor.py` | 调用成败与用量 |
| 运营快照 | `agent/operations.py` + 设置页看板 | 路由分布、工具成功率、延迟 |
| 工作流事件 | `workflow_events` | 计划创建、阶段进入、工具完成 |

前端运营看板的路由中文标签必须能覆盖 `ROUTE_LABELS`。不要在前端保留已经消失的 kind。

## 已知边界

这些是现状，不是待办清单里的默认目标：

- 关键词命中仍走规则；未命中会再分类一次 `kind`，分类器不能选工具。已命中的关键词车道换一种说法仍可能进错。
- 工具失败只允许一次同车道重规划；`blocked` / 超时仍立即停。
- 工作流只展示触达进度，不调度下一阶段。等待中的下一条消息默认恢复原 run；手输改口会清快照。无改口词且仍落在 `conversation` 的闲聊可能继续锁在旧任务，可点结束任务。
- 记忆是业务账本，不是「上次同类任务怎么走」的策略记忆。
- 输入框确认条只在工具返回 `data.clarification` 时出现；模型若只在正文里提问，界面不会自动抽出选项。
- 未配置模型密钥时仍可登录并浏览资料库/工作台/首页；对话发送会引导到 `#/settings/model`。

当前仍保留旧领域表和少量共享解析模块作为数据兼容层；退役求职测试已删除，活跃产品契约由 `test_agent_runtime.py`、`test_library_product.py`、`test_library_sources.py`、流式聊天测试和当前前端路由测试覆盖。

## 验证

智能体行为变更应补确定性测试，并模拟网络与模型：

```bash
cd backend && .venv/bin/python -m pytest tests -q
```

路由、工具面、引用校验、模型重试、写工具不重放与 `ask_user` 均使用模拟模型和网络结果，不调用真实模型。旧求职评测数据集只作历史资料，不再属于 CI 契约。可选仍可用 Promptfoo 做人工对比：

```bash
cd evals && PROMPTFOO_PYTHON=../backend/.venv/bin/python npx --yes promptfoo@0.118.0 eval --no-cache
```

涉及聊天流或运营看板时，再跑对应前端测试。

### 对话展示方式

普通页面不再显示常驻对话栏或右下角悬浮按钮；内容创作通过 AI 工作区中的起草入口完成。`#/chat` 使用完整主内容区域。同一 ChatWorkspace 保持挂载，收起不清空草稿、不取消任务，两种展示共享当前会话。

首次启动尚无账号时，只初始化认证库，跳过业务任务恢复；创建用户工作区后才初始化业务表，后续启动按用户工作区恢复中断任务。

### 问答模型可用性检查

`PUT /agent/settings` 只表示配置已保存；设置页保存后会额外调用一次 `POST /agent/model-monitor/check`，分别显示连接成功、连接失败或未完成检测。问答发送前不做真实模型预检，直接发起正式请求，避免一次用户操作产生两次模型调用。正式请求失败时，界面保留输入、附件和联网选项，并展示稳定错误码对应原因。`GET /agent/capabilities` 失败必须显示后端服务不可用，不能伪装为未配置密钥。

macOS 桌面版的新密钥写入 Keychain；开发和无钥匙串环境可读取 `OPENAI_API_KEY`。新密钥不写 SQLite。发现旧明文密钥时，只在 Keychain 写入成功后清空旧字段；失败则保留旧值并返回迁移警告。日志、健康接口和错误响应不得出现密钥。
