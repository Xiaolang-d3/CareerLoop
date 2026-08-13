# BossCopilot Agent 工具领域化重构设计

日期：2026-07-18
状态：已获用户方向批准，等待书面规格复核

## 1. 背景

BossCopilot 当前注册了 11 个模型可调用工具，覆盖候选人资料读取、岗位读取与分析、本地证据检索、岗位筛选、沟通草稿、待投递队列和真实求职进展记录。

现有实现已经具备工具白名单、风险分类、Pydantic 参数校验、统一 `ToolResult`、计划外工具拦截和用户原始意图路由，但工具层仍混合了模型适配、业务规则、SQL、实体解析和状态写入，导致以下问题：

- `rank_jobs` 已注册并有单元测试，但任务路由不会开放它，正常 Agent 对话不可达。
- `rank_jobs` 要求模型重新传入完整岗位数组，而不是从本地职位库读取权威数据。
- `get_job_detail` 同时承担模糊搜索和详情读取；多个结果时静默选择最近一条。
- `search_local_knowledge` 声明支持尚未实现录入链路的 `note`，且自然的“找证据”表达不能稳定触发。
- `update_job_status` 实际表达岗位初筛决策，却与投递进展状态名称混淆。
- 前端“加入候选清单”的实际提示词不会开放 `update_job_status`。
- `update_application_status` 要求模型提供无法通过现有工具可靠获取的 `application_id`。
- `analyze_job` 被分类为分析工具，但实际会写入 `match_results`。
- 多个分析工具会再次读取画像和岗位，使固定的 `get_* -> analyze_*` 链路产生重复查询和上下文。
- `ToolContext` 已包含 `conversation_id` 和 `task_id`，但核心工具没有充分使用它们限定范围和记录审计上下文。
- 明确的前端按钮仍通过自然语言、模型和关键词路由完成确定性本地操作。

本设计将现有“工具直接实现业务”的结构调整为“领域服务实现业务，REST API 和 Agent 工具作为薄适配器”。

## 2. 目标

本次重构必须实现以下目标：

1. 本地职位库、候选人画像和求职记录继续作为权威数据源。
2. 模型只提供用户意图、稳定实体 ID 和必要用户文本，不重新提供系统已经持有的完整业务对象。
3. 模糊实体搜索与确定性读取、分析或写入分离。
4. REST API 与 Agent 工具共享同一套领域服务、验证和状态转换规则。
5. 前端确定性按钮不再依赖模型和关键词路由。
6. 用户自然语言操作继续经过工具白名单、计划校验和代码风险门。
7. 工具输入、输出、错误、幂等性和审计语义保持一致。
8. 当前后端测试在迁移期间持续通过，并增加领域服务、路由可达性、前端和端到端保护。
9. 采用分阶段兼容迁移，避免一次性破坏现有数据库、对话和核心求职闭环。

## 3. 非目标

本次重构不包含：

- 自动访问、读取或控制招聘网站。
- 自动发送招聘消息、简历或职位申请。
- 新增多用户、多租户、团队空间或计费。
- 新增远程浏览器、招聘平台适配器或验证码处理。
- 将当前模块化单体改造成微服务。
- 在本次重构中引入远程向量数据库或远程 embedding 服务。
- 在本次重构中实现本地笔记产品功能。
- 大规模重做前端视觉设计。
- 将工具权限判定完全交给模型。

## 4. 核心架构决策

### 4.1 领域服务是唯一业务实现

目标调用关系：

```text
前端按钮或表单 -> REST API -------\
                                  -> 领域服务 -> Repository -> SQLite / sqlite-vec / 附件存储
Agent Runtime -> Tool Adapter ----/
```

REST API 和 Agent 工具不得分别实现同一业务规则。工具适配器只负责：

- 声明模型可见名称、描述和 JSON Schema。
- 验证模型参数。
- 从 `ToolContext` 读取系统上下文。
- 调用领域服务。
- 将领域结果或异常转换为 `ToolResult`。

领域服务负责：

- 权威数据读取。
- 实体解析。
- 业务规则。
- 状态转换。
- 幂等性。
- 事务。
- 派生分析持久化。
- 返回前后状态和可审计结果。

Repository 负责持久化细节，API 和工具适配器不得新增主要业务 SQL。

### 4.2 模型使用稳定领域 ID

所有模型可见的本地岗位标识统一命名为 `job_id`。新工具不再使用：

- `local_id`
- `external_id`
- 模型可控制的 `conversation_id`
- 模型可控制的 `task_id`
- 模型可控制的 `platform`

当前单用户 MVP 中，模型也不需要提供 `profile_id`。活动画像由系统上下文和领域服务解析。未来若支持多份简历，应引入用户可理解的 `resume_version_id`，而不是让模型选择底层画像记录。

### 4.3 搜索和执行分离

模糊用户表达先通过 `search_local_jobs` 返回候选岗位及稳定 `job_id`。

- 0 个候选：返回需要用户导入岗位的恢复路径。
- 1 个候选：后续读取、分析或写入使用该 `job_id`。
- 多个候选：返回 `waiting_approval` 和候选列表，禁止静默选择。

`get_job_detail`、分析工具和写入工具只接受确定的 `job_id`。

### 4.4 前端确定性操作绕过模型

下列明确按钮直接调用 REST API，并由 API 调用领域服务：

- 加入或取消候选。
- 跳过或恢复岗位。
- 加入本地待投递队列。
- 更新已投递、已沟通、面试等明确进展。
- 修改备注。
- 删除岗位。

下列操作继续通过 Agent：

- 深度岗位分析。
- 简历差距分析。
- 多岗位带解释比较。
- 本地证据检索和归纳。
- 生成沟通话术。

聊天中的自然语言写入仍通过 Agent 工具执行；API 与工具必须共享领域服务。

## 5. 应用服务边界

### 5.1 JobQueryService

职责：

- 搜索本地职位库。
- 根据 `job_id` 获取岗位详情。
- 列出当前对话关联岗位或全部本地岗位。
- 返回多结果歧义，不替用户静默选择。

接口：

```python
search_jobs(query, conversation_id, limit) -> JobSearchResult
get_job(job_id) -> JobDetail
list_jobs(conversation_id=None, job_ids=None) -> list[JobSummary]
```

搜索默认优先当前对话关联岗位；只有明确请求全局职位库时才扩展到全部本地岗位。

### 5.2 JobAnalysisService

职责：

- 对多个本地岗位进行确定性初步排序。
- 对一个岗位执行综合匹配分析。
- 对一个岗位执行简历差距分析。
- 读取当前活动画像、脱敏简历和偏好。
- 持久化可重新生成的派生分析结果。
- 返回分析版本、可信度、理由、风险和证据。

接口：

```python
rank_jobs(profile_id, job_ids, limit) -> RankedJobs
analyze_match(profile_id, job_id) -> JobMatchAnalysis
analyze_resume_gap(profile_id, job_id) -> ResumeGapAnalysis
```

分析工具内部读取权威岗位和画像，不要求模型先调用 `get_candidate_context` 和 `get_job_detail`。读取工具只在用户需要查看原始上下文、解析岗位引用或生成自由文本时使用。

### 5.3 EvidenceSearchService

职责：

- 检索脱敏简历和已确认岗位的相关文本片段。
- 支持按来源类型、当前对话和指定岗位限定范围。
- 返回适合引用的标题、来源、摘录、相似度和检索模式。
- 向调用方显式报告 `local_vector` 或 `text_fallback`。

接口：

```python
search(query, source_types, conversation_id, job_ids, limit) -> EvidenceSearchResult
```

本次重构只支持 `resume` 和 `job` 来源。`note` 在真正实现笔记录入和生命周期管理前不得出现在模型 Schema 和用户文案中。

### 5.4 JobTriageService

职责：

- 管理岗位的初步筛选决定。
- 保证设置同一状态的调用幂等。
- 返回前后状态和 `changed`。
- 使用独立的用户决策更新时间，不修改来源观察时间。

接口：

```python
set_decision(job_id, decision) -> JobTriageChange
```

领域语义：

- `inbox`：待筛选。
- `shortlisted`：候选。
- `dismissed`：已跳过。

为降低迁移风险，本次重构不重命名数据库 `jobs.status` 列，也不改变已有 `new`、`shortlisted`、`skipped` 存储值。领域服务和新工具负责在 API 语义 `inbox`、`shortlisted`、`dismissed` 与现有存储值之间双向映射。数据库列重命名不属于本次重构范围。

### 5.5 ApplicationService

职责：

- 保存沟通草稿。
- 将岗位加入本地待投递队列。
- 根据 `job_id` 和活动画像查找或创建求职记录。
- 根据用户明确陈述的事实更新求职进展。
- 验证状态枚举、用户事实授权和幂等性。

接口：

```python
save_greeting_draft(profile_id, job_id, text, style) -> Draft
queue_application(profile_id, job_id, notes) -> Application
record_progress(profile_id, job_id, status, notes=None) -> ApplicationChange
```

同一 `job_id + profile_id` 在单用户 MVP 中只有一条 application。重复加入待投递不得在已有 `applied` 等记录旁新增第二条 `queued` 记录。

### 5.6 ProfileService

继续负责：

- 解析当前活动画像。
- 读取求职偏好。
- 根据隐私模式返回原文或脱敏简历。
- 执行画像记忆开关。
- 为分析、草稿和队列服务提供安全上下文。

## 6. 目标工具集合

### 6.1 用户输入和实体解析

#### request_manual_job_import

保留。用于本地不存在所需岗位时暂停运行并请求用户主动导入。

#### search_local_jobs

新增。参数：

```json
{
  "query": "示例公司 Agent 工程师",
  "scope": "current_conversation",
  "limit": 5
}
```

`scope` 允许 `current_conversation` 和 `all_local_jobs`。结果必须包含稳定 `job_id` 和 `requires_selection`。

### 6.2 权威数据读取

#### get_candidate_context

保留，移除模型可见的 `profile_id`。读取当前活动画像、隐私处理后的简历、技能、项目和求职偏好。

#### get_job_detail

保留但改为 ID-only：

```json
{"job_id": 12}
```

不再接受模糊 `query`。

### 6.3 分析和派生结果

#### rank_local_jobs

替换 `rank_jobs`。参数：

```json
{
  "scope": "current_conversation",
  "job_ids": [],
  "limit": 10
}
```

工具内部读取活动画像、偏好和本地岗位，不接受完整岗位数组，不接受 `platform`。

#### analyze_job_match

替换 `analyze_job`。参数：

```json
{"job_id": 12}
```

返回匹配分、推荐等级、理由、风险、证据、可信度和分析版本。

#### analyze_resume_gap

保留，参数简化为：

```json
{"job_id": 12}
```

内部读取活动画像和脱敏简历。

#### search_local_evidence

替换 `search_local_knowledge`。参数：

```json
{
  "query": "证明候选人具备 Agent 工作流设计经验",
  "source_types": ["resume"],
  "job_ids": [],
  "limit": 5
}
```

返回必须包含 `retrieval_mode` 和引用友好的证据条目。

### 6.4 可撤销的本地准备

#### set_job_triage

替换 `update_job_status`。参数：

```json
{
  "job_id": 12,
  "decision": "shortlisted"
}
```

允许 `inbox`、`shortlisted`、`dismissed`。返回 previous/current/changed。

#### save_greeting_draft

保留，统一使用 `job_id`，不暴露 `profile_id`。它只保存模型已经生成的草稿，不执行外部发送。

#### queue_application

保留，统一使用 `job_id`，不暴露 `profile_id`，保证 `job_id + 活动画像` 幂等。

### 6.5 用户确认的真实进展

#### record_application_progress

替换 `update_application_status`。参数：

```json
{
  "job_id": 12,
  "status": "applied",
  "notes": "用户确认已在招聘平台完成投递"
}
```

工具内部根据 `job_id` 和活动画像解析 application。它只能根据用户明确陈述的外部事实开放，不得根据模型推测执行。

## 7. 风险分类与权限策略

工具风险调整为：

| 风险 | 含义 | 工具 |
| --- | --- | --- |
| `read_only` | 读取权威本地数据 | `search_local_jobs`、`get_candidate_context`、`get_job_detail`、`search_local_evidence` |
| `derived_analysis` | 执行分析，并可持久化可重新生成的派生结果；不得修改用户权威状态 | `rank_local_jobs`、`analyze_job_match`、`analyze_resume_gap` |
| `reversible_user_write` | 修改可撤销的工作台状态 | `set_job_triage`、`save_greeting_draft`、`queue_application` |
| `factual_record_write` | 记录用户明确陈述的外部事实 | `record_application_progress` |
| `waiting_user` | 请求用户提供或确认数据 | `request_manual_job_import` |

权限继续由用户原始指令决定，附件、岗位文本、知识片段和模型输出不能扩大工具权限。

## 8. 任务路由

任务路由从少量关键词映射改为意图到能力集合的映射：

| 意图 | 允许工具 |
| --- | --- |
| `conversation` | 无工具 |
| `job_import` | `request_manual_job_import` |
| `job_lookup` | `search_local_jobs`、`get_job_detail` |
| `job_compare` | `rank_local_jobs`、可选 `analyze_job_match` |
| `job_analysis` | `search_local_jobs`、`analyze_job_match` |
| `resume_gap_analysis` | `search_local_jobs`、`analyze_resume_gap` |
| `evidence_search` | `search_local_evidence` |
| `job_triage` | `search_local_jobs`、`set_job_triage` |
| `greeting_draft` | `search_local_jobs`、`save_greeting_draft` |
| `application_queue` | `search_local_jobs`、`queue_application` |
| `application_progress` | `search_local_jobs`、`record_application_progress` |

路由仍由代码保守执行。模型可以帮助规划已允许能力中的步骤，但不能自行新增写权限。

路由评估集必须覆盖：

- 同义词。
- UI 实际提示词。
- 否定表达。
- 讨论性表达。
- 复合意图。
- 中英文混合表达。
- 相似但不应写入的请求。

以下当前缺陷必须成为回归测试：

- “加入候选清单”必须开放 `set_job_triage`。
- “从简历中找出证明我有 Agent 经验的证据”必须开放 `search_local_evidence`。
- “比较本地岗位并按优先级排序”必须开放 `rank_local_jobs`。
- “我已经投递某岗位，请记录”必须能够解析岗位并开放 `record_application_progress`。
- “先不要加入候选”不得开放或执行写入。

## 9. ToolContext

`ToolContext` 继续由系统构造，并扩展为领域服务需要的安全上下文：

```python
class ToolContext(BaseModel):
    platform_name: str = "manual"
    conversation_id: int | None = None
    task_id: int | None = None
    active_profile_id: int | None = None
    tool_call_id: str | None = None
```

模型不得设置这些字段。

用途：

- 默认限定当前对话岗位。
- 解析活动画像。
- 关联审计记录。
- 支持前后状态追踪。
- 避免模型跨对话或跨画像选择数据。

## 10. ToolResult 和错误契约

保留统一外形：

```json
{
  "ok": false,
  "status": "waiting_approval",
  "data": {},
  "message": "找到多个相似岗位，请选择一个",
  "error": {
    "code": "job_selection_required",
    "message": "本地职位库中有多个匹配岗位",
    "retryable": true
  }
}
```

稳定错误码包括：

- `job_not_found`
- `job_selection_required`
- `candidate_profile_missing`
- `profile_memory_disabled`
- `knowledge_memory_disabled`
- `application_not_found`
- `user_fact_required`
- `manual_job_import_required`
- `already_in_state`
- `tool_not_planned`

幂等写入已经处于目标状态时返回 `ok=true`、`status=done`、`changed=false`，不视为失败。

写入结果返回：

- 实体类型和 ID。
- previous。
- current。
- changed。

读取结果只返回完成用户任务所需的安全字段。写入工具不重复返回完整 JD 或简历。

## 11. 数据模型调整

### 11.1 jobs

本次重构保留现有 `status` 列和值，新增：

- `updated_at`
- `triage_updated_at`

`set_job_triage` 不再修改 `last_seen_at`。领域层执行以下固定映射：

- `new -> inbox`
- `shortlisted -> shortlisted`
- `skipped -> dismissed`

### 11.2 match_results

新增：

- `analysis_version`
- `updated_at`

数据库迁移为 `match_results` 增加 `analysis_version` 和 `updated_at`。现有记录统一标记为 `job-match-v1`；同一 `job_id + profile_id + analysis_version` 有多条记录时保留 ID 最大的一条并删除更早的派生记录，然后创建 `UNIQUE(job_id, profile_id, analysis_version)`。这些结果可由权威画像和岗位重新生成，因此删除旧的同版本派生记录不删除用户权威数据。同一分析版本重复执行使用 upsert 更新当前结果，不新增第二条当前结果。

如果未来需要保存分析历史，应使用独立历史或事件记录，不让当前结果表同时承担最新状态和完整历史。

### 11.3 applications

单用户 MVP 中，同一 `job_id + profile_id` 只有一条当前 application。数据库迁移在确认现有数据不存在同键冲突后创建 `UNIQUE(job_id, profile_id)`；若检测到冲突，迁移必须停止并报告冲突记录，不得静默删除用户求职进展。队列和进展记录更新同一行。

application 状态枚举保持：

```text
queued
applied
contacted
interview
rejected
no_response
```

重复设置同一状态为幂等。用户可以通过明确事实陈述将任何已有状态修正为另一个合法状态；模型不得根据推测执行前进、回退或终态恢复。状态枚举之外的值返回 `invalid_arguments`。进入 `applied` 时设置尚未存在的 `applied_at`；进入 `contacted` 或 `interview` 时更新 `last_contact_at`；状态修正不清除已有事实时间。

## 12. 前端行为

岗位工作台已经知道选中岗位的 `job_id`。重构后：

- 深度分析和差距分析将 `job_id` 作为结构化 Agent 上下文或明确提示参数。
- 加入候选、取消候选和跳过直接调用岗位决策 API。
- 加入待投递直接调用 application API，并显示“尚未执行外部操作”。
- 更新真实进展直接调用进展 API，并要求用户明确选择状态或确认事实。
- 沟通草稿仍可通过 Agent 生成；只有用户要求保存时调用保存工具。

前端工具中心显示新工具名、数据范围、控制级别和本地操作边界。旧工具名不同时暴露给模型，避免重复能力导致选择混乱。

## 13. 兼容迁移

迁移分六个阶段：

### 阶段 1：抽取领域服务

- 新增应用服务和必要 Repository 方法。
- 现有工具改为调用服务，保持名称和参数兼容。
- 不改前端行为和模型提示词。
- 现有后端测试全部通过。

### 阶段 2：稳定岗位 ID 和实体解析

- 新增 `search_local_jobs`。
- `get_job_detail` 新接口改为 ID-only。
- 前端和 Agent 上下文传递 `job_id`。
- 多匹配结果进入 `waiting_user`。

### 阶段 3：排序和证据工具

- 新增并路由 `rank_local_jobs`。
- 新增 `search_local_evidence`。
- 移除模型可见的完整岗位数组输入。
- 暂停暴露 `rank_jobs` 和 `search_local_knowledge` 旧定义。

### 阶段 4：写入工具

- 新增 `set_job_triage`。
- 新增 `record_application_progress`。
- 统一 `job_id`。
- 增加 previous/current/changed。
- 修正时间字段和 application 幂等性。

### 阶段 5：前端确定性操作

- 候选、跳过、待投和进展按钮直接调用 API。
- Agent 自然语言操作继续调用新工具。
- 两条入口使用同一领域服务。

### 阶段 6：删除旧兼容层

- 新工具对模型可见。
- 旧工具名可作为内部兼容适配器短期保留，但不出现在模型工具定义中。
- 更新系统提示词、前端工具中心和文档。
- 确认无运行时调用后删除旧实现。

## 14. 测试策略

### 14.1 领域服务测试

覆盖：

- 岗位搜索 0、1、多结果。
- 当前对话范围和全部职位库范围。
- 排序条件、屏蔽条件和稳定顺序。
- 匹配分析 upsert。
- 脱敏简历差距分析。
- 证据检索来源过滤和回退模式。
- triage 前后状态和幂等性。
- application 单记录、合法状态更新和幂等性。
- 用户明确修正状态、无事实授权和非法枚举。

### 14.2 工具契约测试

每个工具覆盖：

- JSON Schema。
- 正常结果。
- 无效参数。
- 实体不存在。
- 记忆开关关闭。
- 幂等重试。
- 安全返回字段。
- `ToolContext` 范围。

### 14.3 路由评估测试

每个意图至少包含：

- 3 个正例。
- 2 个反例。
- 1 个否定表达。
- 1 个 UI 实际用语。
- 必要时 1 个复合意图。

### 14.4 Agent Runtime 测试

继续保护：

- 计划外工具被阻止。
- 附件或知识内容不能扩大权限。
- 多候选实体进入 `waiting_user`。
- 可撤销写入需要明确用户意图。
- 真实进展写入需要明确事实陈述。
- 取消、失败和流式状态一致。

### 14.5 前端与端到端测试

覆盖：

- 候选按钮不再发送自然语言给 Agent。
- 深度分析仍使用 Agent。
- API 与 Agent 工具产生一致的岗位状态。
- 多个相似岗位不会修改错误记录。
- 加入待投不显示为已投递。
- 刷新后状态恢复。
- 完整画像、导入、分析、草稿、待投和进展闭环。

## 15. 验收标准

重构完成时必须满足：

1. 所有模型可见岗位工具统一使用 `job_id`。
2. 模型不再向排序工具传完整岗位数组。
3. `rank_local_jobs` 对正常“比较本地岗位”请求可达。
4. “加入候选清单”可以正确写入候选状态。
5. “从简历找证据”可以正确调用证据检索。
6. 用户可以按岗位而不是内部 application ID 记录已投递等进展。
7. 多个模糊岗位候选不会被静默选中。
8. 前端确定性按钮不经过模型。
9. API 和 Agent 工具共享领域服务，不复制业务规则。
10. triage 操作不修改 `last_seen_at`。
11. 同一版本的岗位分析不会无条件产生重复当前结果。
12. 同一岗位和活动画像不会产生相互冲突的重复 application。
13. `ToolContext` 被用于当前对话范围、活动画像和审计关联。
14. 旧工具名不与新工具同时暴露给模型。
15. 现有后端测试继续通过，新增领域、路由、前端和端到端测试通过。
16. 前端生产构建通过。
17. `git diff --check` 通过。

## 16. 已批准的设计选择

本规格采用以下已批准方向：

- 选择领域工具重构，不采用仅修关键词的最小修补方案。
- 不采用少数粗粒度大工具替代全部领域工具。
- 保留透明、细粒度、可审计的工具体系。
- 领域服务负责业务，REST API 和 Agent 工具作为适配器。
- 前端确定性操作直接调用 API。
- Agent 权限继续由代码根据用户原始意图控制。
- 采用分阶段兼容迁移，不一次性破坏当前闭环。
