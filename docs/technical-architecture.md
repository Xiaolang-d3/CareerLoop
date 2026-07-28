# BossCopilot 技术架构

## 1. 目标与范围

BossCopilot 是一个本地优先、面向个人用户的求职 Agent。当前版本帮助用户管理求职画像，并将当前提供的真实 JD 与脱敏简历进行即时分析。

当前版本不访问、不读取也不控制招聘网站。用户本人负责在招聘平台完成登录、搜索、沟通和投递；系统只处理用户主动提供的当前 JD、简历和聊天记录。

第一版采用模块化单体架构：模块边界需要清楚，但暂不引入微服务、Redis、PostgreSQL 或远程任务执行器。

## 2. 架构原则

1. **本地优先**：简历、聊天记录和分析事件默认保存在本机。
2. **用户控制外部行为**：系统不代表用户在招聘网站执行任何写操作。
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
            -> 简历证据检索工具
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

本地模式默认只应监听 `127.0.0.1`。如果开放到局域网，必须增加访问认证，不能把 CORS 当作安全边界。

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

工具只暴露当前 JD 与简历分析能力，而不是浏览器动作或本地职位库操作。

### 只读工具

- `search_resume_evidence`

### 分析工具

- `analyze_resume_against_jd`

用户粘贴 JD、岗位截图上传、OCR 和文本清理由 API 与附件服务处理，不进入模型工具集。分析工具读取当前活动画像的脱敏简历，不允许模型选择任意画像 ID，也不会把 JD 保存为职位记录。

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

## 9. 岗位输入边界

BossCopilot 不直接从招聘网站采集岗位。

支持两种输入方式：

1. 用户粘贴岗位名称、公司、地点、薪资、经验、学历和岗位描述。
2. 用户上传自己保存的岗位截图，由本机提取文字。

输入流程：

```text
用户提供岗位内容
  -> 本地解析或 OCR
  -> 作为当前消息的上下文
  -> Agent 对比当前脱敏简历
  -> 返回匹配结果与简历证据
```

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

当前使用 SQLite，主要表包括：

- `profiles`
- `preferences`
- `conversations`
- `conversation_tasks`
- `chat_messages`
- `attachments`
- `knowledge_chunks`
- `agent_settings`
- `workflow_runs`
- `workflow_nodes`
- `workflow_events`

SQLite 连接应由真正的上下文管理器关闭，并为本地并发场景配置 WAL 和 busy timeout。

在发布前需要引入 schema 版本和可重复执行的迁移机制。`CREATE TABLE IF NOT EXISTS` 和临时 `ALTER TABLE` 只能作为早期本地兼容手段。

## 14. 配置

配置来自环境变量或被 Git 忽略的 `backend/.env`：

```dotenv
MODEL_PROVIDER=openai
MODEL_NAME=<模型名称>
OPENAI_API_KEY=<密钥>
MODEL_BASE_URL=<可选的 OpenAI 兼容服务地址>
MODEL_MAX_TOOL_ROUNDS=5
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

如果本轮没有 JD，Agent 直接请求用户粘贴文字或上传自己保存的岗位截图，不能自行访问招聘网站，也不能从本地职位记录补充数据。

## 16. 暂缓架构

第一版本暂不实现：

- 多租户账号和计费
- 云端共享数据库
- 远程浏览器或浏览器集群
- 自动招聘网站采集
- 自动发送消息、简历或申请
- 验证码处理和风控对抗
- 微服务和分布式队列
- 多招聘平台自动适配
- 长时间无人监督的自主任务
