# CareerLoop 智能体

本文是 CareerLoop **智能体层的维护文档**。代码是行为的事实来源；本文记录意图、边界和同步点。改智能体行为时必须在同一变更中更新本文。

最近校准：2026-08-24（联网搜索按语言走 general/news/company 策略；工具失败允许一次同车道重规划）。

## 定位

CareerLoop 是受控的求职领域智能体运行时，不是通用 Agent OS。

它具备：感知（简历、画像、网页、搜索）、决策（路由 + 计划 + 模型选工具）、行动（注册工具）、约束（风险等级、计划门、引用校验、失败即停）、反馈（流式事件、审计、运营快照）。

它目前没有：子智能体、图编排、跨车道或多次全局重规划、按阶段主动派任务、跨会话情景记忆。工具 `failed` 时只允许一次同车道重规划；关键词未命中时会多一次只输出 `kind` 的分类，不会让模型自选工具面。

产品核心是对话智能体（`AgentRuntime`）：画像、证据、匹配、材料、面试、复盘。岗位是可选上下文，不是先决条件；系统提示也写明对话不要求预先提供 JD。

岗位可以来自粘贴 JD、聊天截图或机会中心队列。不提供从岗位 URL 抓取页面的导入循环；岗位记录上的 `source_url` 只是可选出处，不会去拉网页。对话不再提供融资公司发现、ATS 识别或独立深度研究工具。

## 维护约定

改动触及下列任一处，必须同步本文对应章节；列表类变更以代码为准，正文只写差异和意图。

| 改动 | 必须更新 |
| --- | --- |
| 新增/删除/改名工具 | [工具目录](#工具目录)、`TOOL_POLICIES`、`bootstrap` 注册、`TOOL_STAGES` |
| 新增/删除/改名路由 | [路由](#路由与计划)、`ROUTE_LABELS`、`ROUTE_STAGES`、前端运营看板标签 |
| 改变循环、失败策略、计划门、引用校验 | [运行时](#对话运行时) |
| 改变记忆、待确认写入、人审 | [记忆与人审](#记忆与人审) |
| 改变求职阶段 | [工作流阶段](#工作流阶段) |
| 改变模型协议或系统提示原则 | [模型与配置](#模型与配置) |

机械一致性由 `backend/tests/test_workflow_stages.py` 守护：`ROUTE_LABELS` ≡ `ROUTE_STAGES`，`TOOL_POLICIES` ≡ `TOOL_STAGES`。测试通过不代表本文已更新。

## 架构总览

```text
用户消息 / 附件 / 联网开关
        │
        ▼
 FastAPI 聊天流  (backend/app/main.py)
        │  工作流进度问句 → 本地摘要，不进模型
        │  若有 waiting 快照：选项/未改口则 resume，改口则清快照
        ▼
 AgentRuntime.run_stream
        │
        ├─ detect_kind()          关键词只出 route.kind
        ├─ apply_hard_gates()     联网 / 截图开关；访谈状态不进模型
        ├─ classify kind（仅 conversation）  JSON {"kind":...}；失败则保持 conversation
        ├─ tools_for_kind()       按车道从 TOOL_POLICIES 展开 allowed_tools
        ├─ planner（可选）         生成 JSON 计划；失败则整轮终止
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
│   ├── orchestration.py     路由、风险、规划
│   ├── bootstrap.py         组装模型 + 工具
│   ├── settings.py          人设、记忆开关、模型连接
│   ├── operations.py        运营快照
│   ├── snapshots.py         waiting_user 恢复快照
│   ├── resume_policy.py     等待确认后恢复或放弃快照
│   └── model_capabilities.py
├── models/                  模型协议与 OpenAI 兼容实现
├── tools/                   对话工具
├── chat/                    历史、摘要、落库
├── workflow/                阶段记账（不调度）
├── profile/                 画像、证据、待确认记忆
├── knowledge/               本地检索（FastEmbed / 哈希回退）
├── resume/blocks.py         简历项目/工作块与稳定 ID
└── observability/           工具审计、模型监控
```

前端：`frontend/src/components/ChatWorkspace.tsx` 消费流式事件；`frontend/src/features/settings/AgentOperationsDashboard.tsx` 展示运营快照。

外部感知：`agent-search/` 是独立仓库，对话里的 `research_company` / `search_public_web` 会调用它。它不是 CareerLoop runtime 的一部分，`scripts/dev.sh` 不负责启动它。`search_public_web` 按 `category` 走 `general` / `news` / `company` 策略；`research_company` 与岗位评估走 `company` 策略，因此配套 AgentSearch 必须支持 `/search?...&mode=company`。AgentSearch 可配置 Brave / 博查作为主检索，未配置时仍走 SearXNG；中文查询会再融合国内搜索源。部署、环境变量和健康检查步骤见根目录 `README.md`。

运行边界：AgentSearch 默认地址是 `http://127.0.0.1:3939`，由 `WEB_RESEARCH_ENABLED`、`AGENT_SEARCH_BASE_URL` 和可选的 `AGENT_SEARCH_TOKEN` 控制。单个上游引擎失败可以让 `/health` 显示 `degraded`，不能仅据此判定全部搜索不可用，应以实际 `/search` 结果为准。连接失败、超时或所有查询均失败时，工具必须返回“联网服务暂不可用”的可重试结论，不能把它解释为公司名称不完整、公司不存在或招聘平台没有岗位。

## 对话运行时

实现：`backend/app/agent/runtime.py`。组装：`backend/app/agent/bootstrap.py`。

默认上限：`MODEL_MAX_TOOL_ROUNDS=8`，单次工具超时 `TOOL_EXECUTION_TIMEOUT_SECONDS=60`。同一对话同时只允许一个运行中的任务（HTTP 409）。

每轮顺序：

1. `route_task()`：关键词 `detect_kind` + 硬开关，得到 `kind`。关键词未命中且仍为 `conversation` 时，额外一次模型调用只分类 `kind`（`ROUTE_LABELS` 之一）；解析失败或输出工具名则保持 `conversation`。`allowed_tools` 始终由 `tools_for_kind` / `TOOL_POLICIES` 计算，分类器不能点名工具。
2. 需要计划时，另一次模型调用生成 JSON；解析失败则用路由允许工具做兜底计划；规划调用本身失败则整轮 `failed`。
3. 把计划写入 system 消息，并把模型可见的 tool definitions 裁成计划内工具。另注入一条「本轮实际可用工具」清单（`visible_tools_prompt`），只列出 `executable_tools`。全局 `SYSTEM_PROMPT` 不点名具体工具。
4. 循环：模型生成 → 若有 tool_calls 则逐个执行 → 结果以 `role=tool` 回写。
5. 工具 `failed`：同一轮只允许一次同车道重规划（`replan_prompt` + `parse_plan`），新计划仍受当前 `allowed_tools` 约束，不能换车道或补联网工具。重规划成功后清空本轮错误，最终正文标 `done`。第二次失败、`blocked`、超时或规划调用失败则整轮终止。
6. 无 tool_calls 且有正文：若本轮用过联网工具，则校验 Markdown 链接必须来自本轮工具返回的 URL；失败会自动重写一次，再失败则标记 `citation_validation_failed`。
7. 达到轮数上限 → `round_limit_reached`。
8. `waiting_user` 会把 `route` / `plan` / 完整 `messages` / `clarification` 写入 `agent_run_snapshots`。下一轮若有快照，先判定是否仍在回答暂停时的问题：命中选项原文，或手输未改口，则 `resume` 同一条 run（跳过分类与规划，不换车道）。手输明显改口（改口词，或 `detect_kind` 落到另一条非 `conversation` 车道）则清快照并重新路由。取消、回退、重置上下文或非 `local_router` 的终态会清快照。等待中问「进度」走本地摘要，不清快照。

硬约束（不要在改 runtime 时悄悄放宽，除非同步改本文和测试）：

- 计划外工具立即 `blocked` / `tool_not_planned`。`ask_user` 是例外：它不进车道计划，但始终对模型可见，调用后以 `waiting_user` 交回界面。
- 工具 `failed`：先同车道重规划一次；`blocked` / 超时仍立即终止。
- `waiting_approval`：状态 `waiting_user`，把确认权交回界面。若 `data.clarification` 带有 `question` / `options`，输入框上方渲染选项。点选选项，或手输仍是在回答（选项原文、补充指代），则恢复原计划。手输明显换题则清快照并重新路由。
- 联网回答必须引用本轮来源；不得把未检索到的经历写成事实。

流式事件类型：`run_started`、`text_reset`、`text_delta`、`agent_event`、`waiting_user`、`completed`、`cancelled`、`error`。过程叙述走 `agent_event`，最终回答只保留对用户有用的结论。

聊天入口还会注入：进行中的画像访谈状态、最近对话里解析出的公司全称、用户上传附件的本地解析文本。路由文本与模型可见文本分开：`web_search` 开关和岗位截图确认只进入 `routing_content`，避免用户把系统可信标记写进正文。

## 路由与计划

实现：`backend/app/agent/orchestration.py`。

编译器分成两段，解释器仍是 `AgentRuntime`：

1. **识别意图**：`detect_kind(content)` 只用关键词，只输出已有 `ROUTE_LABELS` 的 `kind`。系统标记会先被剥掉，避免把可信开关读成用户原文。
2. **硬开关**：`apply_hard_gates` 处理联网开关与岗位截图确认。进行中的画像访谈由 `build_task_route(..., profile_interview_active=True)` 处理。这些规则不交给分类器。
3. **按 kind 展开工具**：`tools_for_kind` 按车道从已注册工具里取出最小集合；车道内细分（比较岗位 / 审核评估等）仍看原文，但不改 `kind`。
4. **关键词未命中**：runtime 在发布 `agent_thinking` 之前可调用一次分类器。提示词只列出车道名；`parse_classified_kind` 拒绝未知值和工具名。分类成功后仍走 `tools_for_kind`，不能扩大工具面。

`route_task()` 是关键词 + 硬开关的同步快路径，不调用模型。未命中则为 `conversation`，不调用工具，直到分类器（若启用）给出另一条车道。进行中的画像访谈会把访谈工具留在桌面上，由模型判断本轮是不是在答题。

当前车道（标签来自 `ROUTE_LABELS`）：

| kind | 含义 | 典型工具 |
| --- | --- | --- |
| `conversation` | 普通求职咨询 | 无（`ask_user` 仍对模型可见，但不计入 `allowed_tools`） |
| `jd_analysis` | JD 与简历匹配 | `analyze_resume_against_jd` / `analyze_job_against_strategy`，证据检索 |
| `resume_evidence` | 简历证据检索 | `search_resume_evidence` |
| `profile_analysis` | 人物画像与竞争力 | 证据检索 |
| `project_story` | 项目经历与面试表达 | `get_candidate_context`，证据检索 |
| `tailored_resume` | 高匹配简历内容 | 分析 + 证据 + 生成简历内容 |
| `interview_preparation` | 面试准备 | 分析 + 证据 + 面试建议 |
| `career_package` | 完整求职准备 | 简历内容 + 面试建议 |
| `company_research` | 公司公开信息 | `research_company` |
| `job_due_diligence` | 岗位匹配与公司尽调 | 分析 + 证据 + `research_company` |
| `web_search` | 单轮联网搜索 | `search_public_web` |
| `profile_onboarding` | 对话式画像初始化 | 访谈工具 + `propose_candidate_knowledge` |
| `profile_enrichment` | 候选人知识补充 | 访谈工具 + 知识提议 |
| `career_strategy` | 多职业策略维护 | 上下文 + 知识提议 |
| `interview_debrief` | 面试复盘 | `record_interview_debrief` |
| `skill_growth` | 能力成长分析 | 上下文 + 证据 |
| `job_evaluation` | 岗位决策与评估 | `create/get/review/compare_job_evaluation` |

规划器只允许从当前车道的 `allowed_tools` 里选步骤，按依赖排序，不必用完全部工具。部分车道会把关键工具补进计划（`REQUIRED_BY_ROUTE` 别名组，注入 `allowed_tools` 里的第一个，与 `add_preferred` 对齐）。含 `confirmed_local_write` 的计划会标 `requires_confirmation`。

工具风险（`ToolPolicy.risk`）：

| 风险 | 含义 |
| --- | --- |
| `read_only` | 只读本地已确认资料 |
| `derived_analysis` | 基于已有资料生成分析或草稿 |
| `local_pending_write` | 写入待确认记录，不直接变成正式事实 |
| `confirmed_local_write` | 改变已确认本地状态，需要明确指令 |
| `external_read` | 访问公开网络 |

旧风险值 `analysis` / `local_write` / `user_input` 仅为历史记录兼容，新工具不要再用。

## 工具目录

对话工具必须同时满足：实现类、`bootstrap.py` 注册、`TOOL_POLICIES`、`TOOL_STAGES`。缺一不可。

| 工具 | 风险 | 作用 |
| --- | --- | --- |
| `analyze_resume_against_jd` | derived_analysis | 对比 JD 与当前脱敏简历 |
| `search_resume_evidence` | read_only | 检索本地脱敏简历证据 |
| `generate_tailored_resume_content` | derived_analysis | 生成可复制的高匹配简历文本 |
| `generate_interview_advice` | derived_analysis | 生成个人化面试建议上下文 |
| `research_company` | external_read | 核验指定公司的公开资料，走 AgentSearch `company` 策略 |
| `search_public_web` | external_read | 本轮用户打开联网开关后的公开搜索；`news` / `company` 会换对应策略 |
| `get_candidate_context` | read_only | 按任务装配最小已确认上下文 |
| `search_candidate_evidence` | read_only | 检索已确认事实与摘录 |
| `propose_candidate_knowledge` | local_pending_write | 创建待确认知识，不自动确认 |
| `start_profile_interview` | local_pending_write | 开始或恢复一次一问的画像访谈 |
| `record_profile_interview_answer` | local_pending_write | 记录回答并推进下一题 |
| `pause_profile_interview` | local_pending_write | 暂停访谈 |
| `analyze_job_against_strategy` | derived_analysis | 按职业策略分析岗位 |
| `generate_candidate_material` | derived_analysis | 为简历/自我介绍/面试草稿提供可信上下文 |
| `record_interview_debrief` | local_pending_write | 记录面试复盘，只生成待确认建议 |
| `create_job_evaluation` | external_read | 生成完整 A–G 决策报告 |
| `get_job_evaluation` | read_only | 读取岗位决策报告 |
| `review_job_evaluation` | confirmed_local_write | 按用户明确指令审核报告 |
| `compare_job_evaluations` | derived_analysis | 比较同一策略下的完整评估 |
| `ask_user` | read_only | 信息不明确时列出选项并暂停，等用户点选或输入 |

许多工具是整段技能，不是原子动作。智能体当前是在选技能，而不是组合底层步骤。新增工具时先问：它是可复用原语，还是应留在领域服务里被现有工具调用。

协议：`ToolHandler.definition` + `async execute(arguments, ToolContext) -> ToolResult`。`ToolResult.status` 为 `done` / `failed` / `waiting_approval` / `blocked`。参数用 Pydantic 校验；统一错误边界见 `tools/local_data.py`。

合成事件名（`agent_thinking`、`agent_planner`、`model_provider`、`citation_validator`）不是工具，不要写入 `TOOL_POLICIES`。

## 记忆与人审

三层记忆，均可在设置里关闭：

| 层 | 开关 | 行为 |
| --- | --- | --- |
| 对话窗口 | `conversation_memory_enabled` | 最近 `context_message_limit`（默认 12）条 user/assistant |
| 对话摘要 | `summary_enabled` | 窗口之外的本地短摘要，注入 system |
| 画像/知识 | `profile_memory_enabled` / `knowledge_memory_enabled` | 简历、已确认事实、本地检索 |

本地检索默认用 FastEmbed `BAAI/bge-small-zh-v1.5`（512 维）写入 sqlite-vec，不经过模型 API。`EMBEDDING_BACKEND=hash` 回退到确定性哈希向量（测试默认）。模型、后端或维度变化时，下次索引/检索会按 `knowledge_chunks` 原文重建 `vec_knowledge`。向量扩展不可用时仍回退 `LIKE`。

简历结构化由 `resume/blocks.py` 按章节和标题打分切成带稳定 ID 的 `project` / `work` / `education` 块（OpenResume 思路的独立实现，不引入 AGPL）。有这类块时，证据索引按块写入并带上 `block_id`；面试准备的项目经历也使用同一套 ID。没有章节结构的短文本仍按段落切分。

候选人知识账本（`profile/candidate_memory.py`）把 Agent 推导出的内容与用户可读的画像文档分开。文档正文是已确认画像；记忆是待审账本和屏蔽名单。新知识默认 `proposed`，确认后才能进入正式材料。状态：`proposed` / `confirmed` / `rejected` / `retracted` / `superseded`。

首页「待确认」是人审闸门，只处理会改变下游的断言：

- **确认**：技能以短标签写入 `career-profile.md` 的 `## 技能`，成果写入 `## 成果`；记忆标为 `confirmed`。之后首页技能、`analyze_resume` / `/quick-match`、`get_candidate_context("match")` 都能读到，即使简历原文没有这句。
- **不是**：记忆标为 `rejected`（撤回为 `retracted`）。`blocked_claims` 同时收录这两类，按规范名（`skill:{name}` / 同一句成果）阻止下次 ingest 再提议。被屏蔽的技能会从首页 chips、`/career-profile/skill-tags`、`extract_skills` / `extract_skill_tags` 的分析与机会技能列表、以及 `confirmed_facts` 匹配中去掉；简历里仍写着 Redis，点「不是」后首页也不再把它当技能。
- **收件箱**：不把简历里已有的词典技能（Python / Redis 这类）当成待办——它们已经在 chips 里。只提示文档小节里还没有的新标签和成果。展示短标签、确认后的写入位置，以及简历原句或提议出处；句子和「具备 … 相关经验」套话不进收件箱。主 CTA 用真实剩余条数；列表先显示 3 条，其余可展开。空则整块隐藏。无法解析成短标签的技能提议也不进收件箱。
- **评估**：`## 技能` 里已有标签时，即使记忆账本是空的，A–G / 机会分流也不再因「没有已确认事实」硬失败。

原则：工具可以提议，不能把未确认内容写成「你具备某项能力」。生成材料只使用已确认事实；`verify_candidate_material` 会拦截 `blocked_claims` 里的撤回/否决声明。

人审入口：首页待确认；工具返回 `waiting_approval`；`confirmed_local_write` 必须来自用户明确指令；画像访谈一次一问。

附件：简历用脱敏文本；岗位截图默认不抽文本，需用户勾选「模型看图」。隐私模式默认 `redacted`。

## 工作流阶段

实现：`backend/app/workflow/`。这是工作区级进度账本，**不会按阶段驱动智能体**。对话和工作台写入同一条 `name=default` 的 run；`conversation_id` 只进 event payload。

有序阶段：

1. `candidate_knowledge` 候选人画像与知识
2. `opportunity_discovery` 机会发现（仅工作台记账：岗位队列与来源备忘；无对话车道或发现工具）
3. `job_evaluation` 岗位评估与决策
4. `material_preparation` 求职材料准备
5. `interview_preparation` 面试准备
6. `outcome_tracking` 结果与复盘

节点语义是触达，不是完成：`stage_engaged` 或 `tool_completed` 后状态为 `running`，detail 为「已触达 N 次」。一次工具不会把阶段标成 `done`，run 保持 `in_progress`。

阶段归属优先看 `route.kind`，工具名用于累计次数。工作台 HTTP 成功路径调用 `record_stage_activity`（简历解析/事实确认、机会中心队列与来源、评估创建与审核、简历版本、面试准备分析、面试复盘），不挂共享 domain，避免与对话工具双计。用户问「进度/状态」时走本地摘要，不消耗模型轮次。

## 模型与配置

当前只支持 OpenAI 兼容 Chat Completions（`MODEL_PROVIDER=openai`）。系统提示在 `backend/app/models/openai_compatible.py`：中文、不编造经历与来源、只使用本轮实际提供的工具、不点名具体工具名、过程叙述交给界面。本轮工具清单由 runtime 注入。缺少关键信息或指代有歧义时必须调用 `ask_user`，不要猜测，也不要只在正文里提问。用户明确要求思维导图时可输出 Mermaid `mindmap` 代码块，界面渲染为可展开、缩放的交互导图；普通回答不主动生成图。

用户可配置人设（名称、角色、详略、补充指令）不能覆盖事实要求、工具权限和人工确认规则。模型名、Base URL、API Key 存在 `agent_settings`，缺省回落到环境变量。

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

若要加厚智能体能力，下一步是给项目块补用户编辑/隐藏，并在现有面试包上加打分回练。可以在现有 runtime 上长，不必推翻协议。

## 验证

智能体行为变更应补确定性测试，并模拟网络与模型：

```bash
cd backend && .venv/bin/python -m pytest tests/test_agent_runtime.py tests/test_agent_settings.py tests/test_agent_operations.py tests/test_workflow_stages.py tests/test_required_tools.py tests/test_openai_compatible.py tests/test_tool_call_audit.py tests/test_eval_datasets.py tests/test_knowledge.py tests/test_resume_blocks.py tests/test_interview_preparation.py -q
```

路由、工具面、引用校验和模型行为（分类器、规划器丢弃计划外工具、未检索经历、ask_user）的数据集在 `evals/cases/`，由 `tests/test_eval_datasets.py` 直接跑，不调用真实模型。可选再用 Promptfoo 看同一批用例：

```bash
cd evals && PROMPTFOO_PYTHON=../backend/.venv/bin/python npx --yes promptfoo@0.118.0 eval --no-cache
```

涉及聊天流或运营看板时，再跑对应前端测试。
