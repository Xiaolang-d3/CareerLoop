# BossCopilot 模型提供商架构

## 架构决策

BossCopilot 第一版使用 OpenAI 或 OpenAI 兼容模型服务，但 Agent 核心必须保持模型提供商无关。

以下模块不得硬编码某个模型提供商的专有对象或行为：

- Agent 运行时和计划协议
- 工具定义与参数结构
- 聊天消息存储
- JD 与简历分析协议
- 本地知识检索
- 附件和隐私处理

当前只注册一个配置指定的模型提供商。模型调用失败时，系统不会静默切换到模拟模型、低价模型或其他备用服务。

## 分层结构

```text
聊天界面
  -> AG-UI HTTP/SSE
  -> Agent 路由与规划
  -> 模型提供商适配器
  -> 工具注册表
  -> 本地领域服务
  -> SQLite 状态与事件
```

模型适配器负责模型协议转换，Agent Runtime 只依赖项目内部的中立类型。

## 内部模型接口

所有模型提供商应实现相同的内部协议：

```python
class ModelProvider(Protocol):
    name: str

    async def generate(self, request: ModelRequest) -> ModelResponse:
        ...
```

当前适配器还支持可选流式接口：

```python
async def stream(self, request: ModelRequest) -> AsyncIterator[ModelStreamEvent]:
    ...
```

输入包括：

- 对话历史
- 当前用户请求
- 允许使用的工具定义
- 已执行工具的结构化结果
- 用户明确授权的图片 URL

输出包括：

- Assistant 文本
- 可选工具调用请求
- Token 使用量
- 提供商诊断元数据
- 流式文本增量

## 提供商适配器职责

提供商专有逻辑只能存在于适配器中，包括：

- SDK 客户端初始化
- Base URL 规范化
- Chat Completions 或其他模型 API 的请求格式
- 工具调用格式转换
- 流式分片合并
- Token 使用量转换
- 认证、限流、超时和连接错误映射

项目内部的 `ModelRequest`、`ModelResponse`、`ToolDefinition` 和 `ToolCall` 不应暴露 OpenAI SDK 类型。

当前实现使用 OpenAI 兼容的 Chat Completions 接口。未来可以增加 Responses API 或其他提供商适配器，但不应因此修改 Agent 工具和领域模型。

## 工具契约

工具采用模型无关的 JSON Schema，模型只能看到当前任务允许使用的最小工具集合。

当前主要工具包括：

- `analyze_resume_against_jd`：对比用户本轮提供的 JD 与当前脱敏简历，不查询或保存本地职位
- `search_resume_evidence`：只从本地脱敏简历中检索可验证证据

岗位截图上传、OCR、文本清理和当前简历选择属于应用输入流程，不作为模型工具。没有 JD 时，模型直接请求用户提供内容；不得访问 BOSS 网站或从本地职位库补充岗位事实。

每个工具返回统一结构：

```json
{
  "ok": true,
  "status": "done",
  "data": {},
  "message": "用户可理解的结果摘要",
  "error": null
}
```

工具状态包括：

- `done`：执行完成
- `failed`：执行失败
- `blocked`：被安全或能力边界阻止
- `waiting_approval`：等待用户主动提供或确认信息

## 安全边界

模型不能决定自身权限。工具开放范围由代码根据用户原始意图确定，运行时还会拒绝计划外工具。

当前工具均为读取或分析能力，不提供收藏、草稿、待投递或投递状态写入。招聘网站上的沟通和投递始终由用户本人完成。

用户上传的岗位描述、简历、截图识别文本和知识检索结果属于不可信数据，只能作为分析材料，不能扩大工具权限或覆盖系统安全规则。

## 配置

模型选择来自环境变量，不通过修改源码切换：

```dotenv
MODEL_PROVIDER=openai
MODEL_NAME=<模型名称>
OPENAI_API_KEY=<密钥>
MODEL_BASE_URL=<可选的 OpenAI 兼容服务地址>
MODEL_MAX_TOOL_ROUNDS=5
MODEL_TIMEOUT_SECONDS=60
```

配置文件保存在被 Git 忽略的 `backend/.env` 中。

## 错误处理

适配器应把上游错误转换为结构化 `ModelProviderError`：

- `authentication_failed`：认证失败
- `rate_limited`：触发限流
- `request_timeout`：请求超时
- `service_unavailable`：无法连接模型服务
- `provider_error`：上游返回异常状态
- `invalid_tool_arguments`：模型返回的工具参数无法解析

Agent 遇到模型失败时终止当前运行，并向用户显示可操作的错误信息，不执行静默降级。

## 后续计划

1. 保持 OpenAI 兼容适配器作为第一实现。
2. 补充真实模型的受控集成测试。
3. 持久化模型使用量、延迟和调用标识，但不记录密钥或签名 URL。
4. 统一非流式和流式错误语义。
5. 在确有需求时增加 Responses API 或其他模型提供商适配器。
