# BossCopilot 技术架构

## 1. 目标与范围

BossCopilot 是一个本地优先、面向个人用户的可扩展求职 Agent。当前内置版本帮助用户管理求职画像和用户主动保存的岗位项目，并将真实 JD 与脱敏简历进行即时分析；平台访问、公开岗位源、沟通和投递等能力可以继续通过适配器与工具接入。

第一版采用模块化单体架构：模块边界需要清楚，但暂不引入微服务、Redis、PostgreSQL 或远程任务执行器。

## 2. 架构原则

1. **本地优先**：简历、聊天记录和分析事件默认保存在本机。
2. **显式授权外部行为**：账号、发送和提交类工具必须定义清楚的用户确认与审计方式。
3. **模型提供商无关**：Agent 核心依赖内部模型协议，不依赖某个 SDK 对象。
4. **工具是执行边界**：模型只能调用代码允许的结构化工具。
5. **最小权限**：每个任务只向模型开放完成该任务所需的最小工具集合。
6. **不可信内容隔离**：岗位描述、简历、附件 OCR 和知识片段不能扩大工具权限。
7. **隐私默认脱敏**：向模型提供简历时默认使用脱敏文本，视觉上传必须按轮授权。
8. **失败显式可见**：模型、工具、存储和解析错误不得静默降级或伪装成功。
9. **可恢复和可审计**：对话、工具结果、工作流状态和用户确认需要持久化。
10. **删除语义完整**：删除记录时同步处理数据库、知识索引和附件对象。

## 3. 系统上下文

```text
React Web 工作台
  -> FastAPI HTTP API
  -> AG-UI HTTP/SSE
  -> Agent Runtime
       -> 任务路由与计划
       -> 模型提供商注册表
            -> OpenAI 兼容适配器
       -> 工具注册表
            -> JD 与简历分析工具
            -> 候选人画像与证据工具
            -> 岗位评估与机会发现工具
            -> 公开信息研究工具
       -> 工作流状态投影
       -> SQLite 仓储
  -> 本地附件目录或 MinIO
  -> 本地文档解析和隐私脱敏
```

## 4. 前端

前端使用 React、TypeScript 和 Vite，主要职责包括：

- 多对话和聊天消息展示
- AG-UI 流式事件消费
- Agent 推理摘要和工具状态展示
- 消息发送、停止、编辑、复制、重试和重新生成
- 候选人画像和求职偏好编辑
- 简历上传、解析、隐私扫描和脱敏确认
- 当前 JD 粘贴和岗位截图上传
- Agent 人设、记忆和上下文设置
- 附件上传以及单轮图片直传授权

聊天交互使用 `@assistant-ui/react` 的 External Store Runtime。AG-UI 只负责运行事件传输，不替代本地 SQLite 中的权威消息记录。

前端不应持有 MinIO 密钥、模型 API Key 或附件对象存储路径。

## 5. API 层

FastAPI API 负责：

- HTTP 请求校验
- 对话和资源存在性检查
- 响应结构转换
- 文件上传
- SSE 和 AG-UI 事件编码
- 调用领域服务、Agent Runtime 和存储服务
- 把领域错误转换为明确的 HTTP 错误

目标状态下，API 层不应包含主要业务 SQL、模型提示词或复杂业务决策。当前部分旧接口仍直接访问 SQLite，后续应迁移到服务层和仓储层。

本地模式默认只应监听 `127.0.0.1`。超出本机访问时必须经过 `backend/app/auth.py` 的管理员口令认证；远程访问由 `scripts/start-remote.sh` 通过 Cloudflare Tunnel 提供 HTTPS，后端本身不在路由器上开放端口。不能把 CORS 当作安全边界。

## 6. Agent Runtime

Agent Runtime 负责模型与工具循环：

1. 接收用户原始指令和权威对话历史。
2. 根据用户原始意图选择任务路由。
3. 为复杂任务生成结构化计划。
4. 只向模型提供计划允许的工具。
5. 校验模型返回的工具名称和参数。
6. 执行本地工具并记录结构化结果。
7. 在失败、阻塞、等待用户、取消或达到轮数上限时停止。
8. 生成最终回答并持久化运行结果。

用户上传的附件文本可以作为模型分析材料，但不能参与工具权限判定。工具风险策略由代码维护，不能由模型或附件内容覆盖。

运行结果状态包括：

- `done`：正常完成
- `failed`：模型或工具失败
- `waiting_user`：等待用户主动提供或确认信息
- `cancelled`：用户停止或客户端断开

这些状态必须在 Agent Runtime、SQLite、AG-UI 和前端中保持一致。

## 7. 模型提供商

所有模型提供商实现统一内部协议：

```python
class ModelProvider(Protocol):
    name: str

    async def generate(self, request: ModelRequest) -> ModelResponse:
        ...
```

内部核心类型包括：

- `ModelRequest`：消息、工具定义和模型选项
- `ModelResponse`：文本、工具调用、使用量和诊断元数据
- `ModelStreamEvent`：文本增量和完成事件
- `ToolDefinition`：模型无关的工具名称、描述和 JSON Schema
- `ToolCall`：模型无关的工具调用标识、名称和参数

当前 OpenAI 兼容适配器使用 Chat Completions 接口，并负责：

- 请求和消息格式转换
- 流式分片合并
- 工具调用参数解析
- Base URL 规范化
- Token 使用量转换
- 认证、限流、超时、连接和上游状态错误映射

提供商 SDK 类型不得进入 Agent Runtime、工具或领域模型。

## 8. 工具边界

工具注册表在 `backend/app/agent/bootstrap.py` 中注册，并允许继续注册浏览器、职位库、文件生成或外部操作工具。运行时只把当前任务计划允许的最小工具集合交给模型。当前注册的工具按能力域划分：

### 简历与 JD 分析

- `search_resume_evidence`（只读）
- `analyze_resume_against_jd`
- `generate_tailored_resume_content`
- `generate_interview_advice`

### 候选人画像与访谈

- `get_candidate_context`、`search_candidate_evidence`（只读）
- `propose_candidate_knowledge`
- `start_profile_interview`、`record_profile_interview_answer`、`pause_profile_interview`

### 岗位评估与决策

- `create_job_evaluation`、`get_job_evaluation`、`review_job_evaluation`
- `compare_job_evaluations`、`run_job_deep_research`
- `analyze_job_against_strategy`

### 机会发现与推进

- `discover_companies`、`discover_funded_companies`、`scan_career_sources`
- `process_opportunity_pipeline`

### 材料、面试与联网研究

- `generate_candidate_material`、`record_interview_debrief`
- `research_company`、`search_public_web`（外部只读）

工具定义与注册是两件事：`backend/app/tools/career_os.py` 中的 `record_application_outcome` 已定义但未注册，模型无法调用。新增工具必须同时通过注册表和任务计划两道关卡。

当前内置路径中的 JD 粘贴、岗位截图上传、OCR 和文本清理由 API 与附件服务处理，不进入模型工具集。分析工具读取当前活动画像的脱敏简历，不允许模型选择任意画像 ID。

所有工具返回统一的 `ToolResult`：

```python
class ToolResult(BaseModel):
    ok: bool
    status: Literal["done", "failed", "waiting_approval", "blocked"]
    data: dict = {}
    message: str
    error: ToolError | None = None
```

未知工具、参数错误、能力缺失、超时和策略阻止都应返回结构化失败，不能让运行时崩溃。

本地写工具只能在用户原始指令明确表达对应意图时开放。即使模型要求执行，计划外工具也必须被运行时代码阻止。

## 9. 岗位输入与扩展

当前内置版本支持四种输入方式：

1. 用户提交公开 HTTPS 岗位链接，由岗位导入智能体读取和验证。
2. 用户通过可选 Chrome 扩展读取当前已经显示的匹配岗位页面。
3. 用户粘贴岗位名称、公司、地点、薪资、经验、学历和岗位描述。
4. 用户上传自己保存的岗位截图，由本机提取文字。

新的招聘平台或公开岗位源可以通过平台适配器和结构化工具接入。当前本地岗位项目只接受用户主动输入，岗位来源必须随记录或工具结果保留，不能由模型猜测。

浏览器辅助路径由通用扩展、React bridge 和后端 capture validator 组成。扩展只返回岗位区域可见文本，不读取 Cookie、密码或浏览历史；后端校验 capture 新鲜度、原始 URL 绑定、页面类型和内容长度，再启动受限的第二段岗位导入 Agent。浏览器页面内容仍是不可信工具结果，不能扩大 Agent 权限。

输入流程：

```text
用户提供岗位内容
  -> 本地解析或 OCR
  -> 用户明确保存为岗位项目，或作为当前消息上下文
  -> 本地证据引擎拆分要求并对比当前脱敏简历
  -> 保存结构化匹配、偏好冲突、投递建议和用户纠正
  -> 创建引用该分析快照的定制简历版本
  -> 逐项接受、拒绝或编辑证据化修改
  -> 本地导出 DOCX/PDF，或创建证据化面试准备包
  -> 记录准备清单、面试轮次、结果和岗位时间线
```

定制简历生成时会校验 JD 与脱敏简历指纹。任一来源在岗位分析后发生变化，旧分析不能继续创建新版本，必须重新分析。版本只复制当前隐私模式允许的简历文本，不写回 `profiles` 主简历。

## 10. 附件与隐私

附件类型包括：

- `resume`：PDF、DOCX、TXT 和 Markdown 简历
- `job_screenshot`：PNG、JPG、JPEG 和 WebP 岗位截图

默认处理方式：

- 原始附件保存在本地目录或私有 MinIO 桶。
- 简历在本机解析，并扫描邮箱、手机号和身份证号。
- 简历提供给模型时默认使用脱敏文本。
- 岗位截图默认只向模型提供本地 OCR 文本。
- 用户勾选“模型看图”后，才为当前一轮生成短期签名 URL。
- 简历不支持视觉直传。
- 签名 URL 不写入数据库、聊天记录或日志。

附件 API 返回安全元数据，不返回对象存储路径或密钥。

删除对话或附件时，应同步删除数据库记录和底层对象。删除失败需要可重试，避免产生无法定位的敏感文件。

## 11. 本地知识检索

知识检索范围只包括当前活动画像的脱敏简历。

文本先分块，再使用本机确定性哈希向量建立 `sqlite-vec` 索引。该机制不调用远程嵌入模型，适合本地初步检索。

如果原生向量扩展不可用，可以回退到 SQLite 文本匹配，但回退状态应对用户或诊断信息可见。

删除或更新原始资料时，必须同步更新 `knowledge_chunks` 和向量表，避免检索到已删除或过期内容。

## 12. 对话、记忆与工作流

对话由以下数据组成：

- `jobs`：用户主动保存的岗位项目，每个项目可关联一段独立对话
- `job_evaluations` 及其 section、dimension、requirement、source、risk、review 子表：不可变岗位决策快照和独立人工审核
- `resume_versions`：岗位简历版本、来源画像/分析引用和当前渲染文本
- `resume_changes`：修改前后内容、证据、接受/拒绝决策和用户编辑标记
- `interview_kits`、`interview_tasks`：面试准备包、问题材料和行动清单
- `interview_rounds`：面试安排、联系人、地点、状态与结果
- `job_events`：岗位状态、面试和人工进展的统一时间线
- `conversations`：对话标题、归档状态、摘要和上下文截断点
- `conversation_tasks`：当前任务状态
- `chat_messages`：权威用户和 Assistant 消息
- `workflow_runs`、`workflow_nodes`、`workflow_events`：工作台状态和审计事件

上下文由以下内容组合：

- 最近若干条用户和 Assistant 消息
- 可选的早期对话摘要
- 当前用户消息
- 用户本轮主动附加的脱敏资料

重置上下文不会删除历史消息，只会移动上下文读取起点。

当前 LangGraph 用于根据数据库状态计算和同步工作台节点，尚未承担完整的 Agent 工具编排。后续可以选择：

- 扩展为真正的可恢复任务状态机；或
- 保持轻量状态投影，把业务编排留在 Agent Runtime 和服务层。

两种方向只能选择一种作为正式架构，避免重复状态来源。

## 13. 数据与持久化

当前使用 SQLite。表按领域划分，完整清单见 `backend/app/db.py`，主要领域包括：

- 账号与画像：`users`、`profiles`、`preferences`、`profile_interview_sessions`
- 岗位与评估：`jobs`、`job_evaluations` 及其 section/dimension/requirement/source/risk/review 子表、`job_comparisons`、`job_comparison_entries`
- 材料与面试：`resume_versions`、`resume_changes`、`interview_kits`、`interview_tasks`、`interview_rounds`、`interview_debriefs`、`interview_preparation_state`、`interview_question_bank`
- 机会发现：`companies`、`company_signals`、`opportunity_sources`、`opportunity_scan_runs`、`discovered_jobs`、`discovery_runs`
- 候选人记忆与叙事：`candidate_memory_items`、`candidate_stories`、`candidate_narratives`、`career_strategies`、`voice_profiles`
- 对话与运行：`conversations`、`conversation_tasks`、`chat_messages`、`agent_settings`、`agent_tool_calls`、`model_service_events`
- 附件与知识：`attachments`、`job_capture_snapshots`、`knowledge_chunks`
- 工作流与缓存：`workflow_runs`、`workflow_nodes`、`workflow_events`、`company_research_cache`、`job_research_cache`
- 迁移：`schema_migrations`

SQLite 连接应由真正的上下文管理器关闭，并为本地并发场景配置 WAL 和 busy timeout。

建表仍以 `CREATE TABLE IF NOT EXISTS` 为主，增量结构变更走 `db._apply_migrations()` 的编号事务迁移，并记录在 `schema_migrations` 中。当前迁移只支持追加，不支持回滚；破坏性变更仍需要单独的升级方案。

## 14. 配置

配置来自环境变量或被 Git 忽略的 `backend/.env`：

```dotenv
MODEL_PROVIDER=openai
MODEL_NAME=<模型名称>
OPENAI_API_KEY=<密钥>
MODEL_BASE_URL=<可选的 OpenAI 兼容服务地址>
MODEL_MAX_TOOL_ROUNDS=8
MODEL_TIMEOUT_SECONDS=60

ATTACHMENT_STORAGE=local
MINIO_ENDPOINT=127.0.0.1:9000
MINIO_ACCESS_KEY=<本地用户名>
MINIO_SECRET_KEY=<本地密钥>
MINIO_BUCKET=bosscopilot-attachments
MINIO_SECURE=false
MINIO_PUBLIC_ENDPOINT=<可选的 HTTPS 公网地址>
ATTACHMENT_VISION_ENABLED=false
ATTACHMENT_VISION_URL_TTL_SECONDS=300
```

密钥、数据库、简历、附件、日志和其他个人数据禁止提交到 Git。

## 15. 典型请求流程

```text
用户提出岗位分析请求
  -> API 加载对话和本轮附件
  -> 只根据用户原始指令选择任务路由
  -> Agent 生成受限执行计划
  -> 使用用户本轮粘贴的 JD 或岗位截图 OCR 文本
  -> 读取当前活动画像的脱敏简历
  -> 执行 JD 与简历的结构化分析
  -> 模型生成有依据的最终回答
  -> AG-UI 流式返回文本、工具和状态事件
  -> SQLite 持久化权威消息与工作流状态
```

如果本轮没有 JD，Agent 先使用当前任务已经注册的岗位来源工具；没有对应工具或有效结果时，再请求用户提供文字、截图、链接或其他来源。

## 16. 暂缓架构

以下能力不属于第一版交付基线，但可以在后续版本通过适配器或工具接入：

- 多租户账号和计费
- 云端共享数据库
- 远程浏览器或浏览器集群
- 自动招聘网站采集
- 自动发送消息、简历或申请
- 验证码处理和风控对抗
- 微服务和分布式队列
- 多招聘平台自动适配
- 长时间无人监督的自主任务
