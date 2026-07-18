# AG-UI 集成

BossCopilot 前端与 Agent 后端之间采用 AG-UI HTTP/SSE 协议通信。

## 端点

- `POST /ag-ui`：标准端点，接收 `RunAgentInput`，返回 `data: {BaseEvent}\n\n` 形式的 SSE。
- `POST /agent/tasks/current/cancel`：保留 BossCopilot 的持久化取消操作；AG-UI 客户端断开时后端也会取消对应运行。

`threadId` 必须使用本地对话 ID。后端以最后一条用户文本消息作为本次输入，并继续从 SQLite 加载权威会话历史。

## 事件映射

| BossCopilot 语义 | AG-UI 事件 |
| --- | --- |
| 运行开始 | `RUN_STARTED` |
| Assistant 增量文本 | `TEXT_MESSAGE_START`、`TEXT_MESSAGE_CONTENT`、`TEXT_MESSAGE_END` |
| 安全思考摘要 | `REASONING_*` |
| Agent 工具状态 | `TOOL_CALL_START`、`TOOL_CALL_ARGS`、`TOOL_CALL_END`、`TOOL_CALL_RESULT` |
| 最终持久化消息和工作流 | `STATE_SNAPSHOT` |
| 正常完成或用户停止 | `RUN_FINISHED` |
| 执行错误 | `RUN_ERROR` |

`STATE_SNAPSHOT.snapshot.bossCopilot` 包含最终 `userMessage`、`assistantMessage` 和运行状态；这是前端用 SQLite 权威记录替换乐观消息的同步点。

## 消息同步策略

AG-UI 是传输与事件契约，不替代现有 Agent 运行时、工具注册表、SQLite 会话或 assistant-ui External Store Runtime。前端使用官方 `HttpAgent`，界面继续通过 External Store Runtime 映射现有 `ChatMessage`。

旧版自定义 SSE 写入端点已经移除。历史消息读取、消息回退和持久化取消仍使用 BossCopilot 本地 API；所有新消息统一通过 `POST /ag-ui` 运行。
