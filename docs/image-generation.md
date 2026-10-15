# Packy 文生图接入

按 [Packy GPT Image 教程](https://docs.packyapi.ai/docs/paint/GPTImage.html)接入 Images API，保留现有 Grok Responses 生图路径。

## 配置与使用

在设置的「连接与模型」中添加独立连接：

| 配置 | 值 |
| --- | --- |
| Base URL | `https://cf.api.fan/v1`（也可填写 `https://cf.api.fan`） |
| API Key | Packy 控制台创建的 **sora 分组令牌** |
| 首个模型名称 | `gpt-image-2` |
| 接口协议 | 自动匹配，或 OpenAI Images（文生图） |

保存后，在聊天输入框选择该模型，发送明确的生图指令，例如「帮我生成一张图片：一只橘猫抱着水獭，温暖插画风格」。结果沿用聊天中的预览、原图下载、成果存档功能。普通问答请选择聊天模型。

「检测此连接」只验证模型目录可访问且包含当前模型，**不生成测试图片，也不能证明生图权限或额度可用**。若此前手动标记档案不支持生图，需要使用模型档案 PATCH 接口及当前 `expected_revision` 将 `capabilities.image_generation` 改回 `unknown`（严格能力模式需要明确设置为 `supported`）；系统不会擅自覆盖已有能力设置。

## 请求与结果

`models/openai_images.py` 直接调用 `POST /v1/images/generations`，固定参数如下：

```json
{
  "model": "gpt-image-2",
  "prompt": "用户当轮的生图指令",
  "n": 1,
  "size": "auto",
  "quality": "auto",
  "output_format": "png",
  "response_format": "b64_json"
}
```

不发送聊天消息、工具定义、推理强度、文本 token 上限、`stream` 或 `partial_images`。请求等待上限为 300 秒；中间代理仍需允许长连接。当前默认由服务自动选择尺寸和质量，不提供图像编辑和透明背景选项。

Base64 只在模型响应内存中短暂保留，排除序列化和 repr；由账户本地图片存储验证内容、尺寸和大小后保存。SSE 与历史消息仅携带资产引用。要求服务按 `b64_json` 返回；仅返回 URL、HTML 或空结果时明确失败，不下载任意上游 URL。

图片请求在原生和 LiteLLM 两种后端均使用专用适配器，不经过聊天备用路由，不自动重试、换协议或补发请求。运行开始前固定模型版本并记录操作，同一任务完成重放复用资产；超时或结果不确定时阻止同一任务再次扣费。图片模型也不能用作文本聊天的备用模型。

## 验证

- `backend/tests/test_openai_images.py`：模拟 HTTP 验证端点、参数、根地址、协议、诊断、隐私和异常不重试。
- `backend/tests/test_chat_image_generation.py`：验证聊天流程、图片落盘、非流式能力与 SSE 共存、任务重放与超时保护。
- `frontend/src/features/settings/ModelConnectionManager.test.tsx`：验证 Images 配置提交与 sora 令牌提示。

测试不使用真实凭证或付费服务；真实出图仍需用户在应用内配置有效的 Packy sora 令牌。
