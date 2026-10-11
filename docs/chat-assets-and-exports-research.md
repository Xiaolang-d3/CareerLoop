# 聊天图片、附件与成果保存导出调研

调研日期：2026-10-11。代码基线：`50e1edb`。本文为实施前调研和建议；没有修改应用逻辑，也没有调用计费模型接口验证用户网关。

实施进度（2026-10-11）：常见附件预览与原件读取已落地；本轮补齐阶段 A 的回答独立阅读、MD/TXT、代码及导图下载、历史缩略图和多图切换，并实现阶段 B 的文本/源码/原附件归档。详见 [实施与验收记录](chat-results-implementation.md)。阶段 C 的模型生图、输出资产及图文回答资源打包仍待接入，不能由当前附件预览能力推断为已支持。

## 1. 结论与范围

本次补齐两项能力：图片与附件展示、成果保存与导出。当前已经有本地文件存储、账户隔离、图片预览、PDF 阅读器和原文件下载，可以复用。需要新增的是聊天历史中的资源读取、模型图片输出链路，以及将回答保存成文件库成果的入口。

建议采用“消息内展示 + 按需打开预览 + 保存到现有文件库”的方式。预览位于聊天模块内，不增加全局侧边栏子项。首期以只读成果为主，覆盖图片、文档、代码和导图源文件；编辑与版本管理单独规划。

| 内容 | 聊天中展示 | 独立打开 | 首期下载/保存 |
| --- | --- | --- | --- |
| 用户上传图片 | 历史缩略图、文件名、大小 | 大图、缩放、切换多图 | 下载原图；保存到文件库 |
| 模型生成图片 | 图文按返回顺序展示，多图卡片 | 共用图片查看器 | 下载原图；保存到文件库 |
| PDF 附件 | 文件卡片、解析状态 | 复用 PDF 阅读器 | 下载原文件；保存独立副本 |
| TXT / Markdown 附件 | 文件卡片 | 原文/Markdown 阅读 | 下载原文件；保存独立副本 |
| DOCX 附件 | 文件卡片 | 提取文字 | 下载 Word 原文件查看排版 |
| 模型文本回答 | 现有 Markdown | 共享渲染器阅读长文 | `.md` / `.txt`；保存为 Markdown 文件 |
| 代码块 | 现有代码块和折叠 | 只读源码 | 按语言下载文件；保存源文件 |
| 图表与思维导图 | 保留现有交互 | 放大阅读 | Mermaid 源码；普通 Mermaid 可下载 SVG |

DOCX/PDF 成果导出、思维导图 PNG/SVG 和离线图文打包作为后续扩展，不影响首期基本保存与下载。模型生成图片的完整接入属于本次图片能力范围，需要在资源基础完成后补齐。

## 2. 当前实现与缺口

| 层次 | 已有实现 | 实际缺口与代码位置 |
| --- | --- | --- |
| 上传文件 | 账户工作区的本地目录保存原文件，附件表记录 MIME、大小和哈希 | `backend/app/attachments/service.py:155` 使用本地 store；`backend/app/workspace.py:142` 解析账户目录。无需另建云存储才能查看图片 |
| 附件 API | 列表、上传、解析、删除 | `backend/app/api/attachments.py:18` 起没有原文件/缩略图读取接口 |
| 发送前预览 | 临时 Blob URL、缩略图和大图弹层 | `frontend/src/components/ChatWorkspace.tsx:630`；临时 URL 不适合历史持久化 |
| 历史附件 | 消息 payload 留存附件 ID 和摘要 | `backend/app/chat/service.py:162`；`frontend/src/features/chat/MessagePresentation.tsx:873` 仅显示图标和名称 |
| Markdown 图片 | 默认 Markdown 渲染可显示部分公开图片链接 | `MessagePresentation.tsx:243` 没有自定义图片组件；缺尺寸控制、放大、失败占位和下载；不能依赖正文内 Base64 解决生成图片 |
| 文件库阅读 | 图片、TXT 和 PDF 原文件预览 | `frontend/src/features/library/FilePreview.tsx:21`；已有本地 PDF.js 资源，见 `PdfReader.tsx:8`，不必引入第二套 PDF 阅读库 |
| 文件库下载 | Bearer 鉴权读取原文件，再下载 Blob | `frontend/src/features/library/useLibrary.ts:183` 和 `:197`；后端 `backend/app/api/library.py:162` |
| 长文预览 | 聊天里有 Markdown 渲染和引用跳转 | `MessagePresentation.tsx:250` 的渲染器为私有组件；文件库 Markdown 原文件仅用 `<pre>` 展示，需抽取共享阅读组件 |
| 回答操作 | 复制、重新生成、模型详情 | `MessagePresentation.tsx:859`；缺独立打开、导出、保存到文件库 |
| 文件库写入 | 创建文本、导入原文件、目录管理 | `backend/app/library/sources.py:156` 创建文本时默认启用并立即索引；无成果专用保存入口 |
| 原文件与解析 | 提取失败仍保存原文件 | `sources.py:195`；`:239` 将没有文本的文件记为解析失败，不适合生成图片或源代码 |
| 模型输出 | 文本和 function tool calls | `backend/app/domain/agent.py:59`、`:66` 没有图片块；Responses 和 Gemini 的图片结果会被跳过 |
| 运行完成 | 非空文本作为有效最终回答 | `backend/app/agent/runtime.py:894`、`:985`；纯图片结果可能被判为空回复 |

这些问题横跨资源接口、渲染和模型结果契约。仅增加 `<img>` 或一个“下载”按钮无法完成历史恢复和本地成果保存。

## 3. 官方资料与成熟交互参考

Claude Artifacts 将可独立使用的成果放在对话旁的窗口，提供查看、复制和导出入口。CareerLoop 可以借鉴按需打开成果的交互，并复用自己的文件库作为归档位置。该建议是结合本项目的设计取舍，不表示需要实现 Claude 的完整编辑器。[Claude Artifacts 官方说明](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)

模型生图输出并不总是一个 Markdown 图片链接。不同服务需要在后端适配为统一文件资源：

| 官方接口 | 已核对的结果形式 | 对本项目的影响 |
| --- | --- | --- |
| OpenAI Responses 原生生图工具 | `image_generation_call.result` 为 Base64；部分模型/请求可返回 partial image 事件 | 解析最终图片项；partial 只作为临时预览，不作为最终成果。[官方工具说明](https://developers.openai.com/api/docs/guides/tools-image-generation) |
| OpenAI Images API | `data[].b64_json`；返回类型保留 `url` 字段，但当前 GPT Image 模型返回 Base64 | 支持 Base64 入库；兼容服务若返回 URL，需要按供应商契约处理，不能假设所有参数可用。[官方 Images API](https://developers.openai.com/api/reference/resources/images/methods/generate) |
| xAI Responses 生图工具 | `image_generation_call.result` 为 Base64；流式发送进度和最终 `output_item.done`，不提供 partial 图 | 与 Responses 的资产解析共享基础，但能力、请求参数和流事件需区分。[xAI 工具说明](https://docs.x.ai/developers/tools/image-generation) |
| xAI Images API | 可返回临时 URL 或请求 Base64 | 优先获取可持久化字节，避免历史图片依赖临时链接。[xAI 图片接口说明](https://docs.x.ai/developers/model-capabilities/images/generation) |
| Gemini generateContent 生图 | 有序的文字与 `inlineData` 图像块；可包含 `thought` 中间图 | 保留图文顺序，中间图不进入最终成果。多轮编辑还需要保留签名/续接数据。[Google 官方说明](https://ai.google.dev/gemini-api/docs/generate-content/image-generation) |

上述是供应商官方接口能力。用户所连接的兼容网关是否转发这些接口、当前密钥是否有权限，本轮没有实测。`/models` 中能发现模型、模型支持看图，都不能证明当前连接可以生图。

浏览器预览可继续用“授权请求 → Blob → 临时 URL”的既有路径，关闭预览时释放 URL；下载使用正确 MIME 和中文文件名。临时 Blob URL 仅供当前页面使用，数据库保存资产 ID。[MDN Blob URL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static)、[MDN Content-Disposition](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Disposition)

## 4. 用户交互建议

### 图片与附件

历史图片显示有固定最大高度的缩略图，不撑满聊天页。点击进入共用图片查看器，提供缩放、原图下载和多图切换；加载失败显示文件名和重试入口。上传图片与模型生成图片使用同一套展示组件，通过来源标识区分。

PDF、TXT、Markdown、DOCX 使用紧凑文件卡片，显示类型、名称和大小。点击在模块内打开只读预览。桌面可用侧面板，窄屏用全屏面板；退出后回到原消息与滚动位置。DOCX 首期展示提取文字并提供原文件下载。

“查看附件”与“允许模型读取图片”是两个独立操作。查看本地文件不应要求公网地址或自动上传给模型；历史卡片可提供明确的“重新附加”入口。

### 回答与成果

回答操作保留复制和重新生成，增加一个统一成果菜单：独立打开、下载 Markdown/TXT、保存到文件库。代码块工具栏提供复制和下载源文件。图片和导图在自己的预览工具栏提供对应文件操作，避免在消息下方重复铺按钮。

保存弹窗只需要标题/文件名、文件夹和“作为知识依据使用”选项，默认关闭知识依据。只有存在可读正文时才允许启用该选项；没有可读文字的图片只存档，并说明知识检索尚不可用。完成后显示“已保存”和“打开文件”，同一快照重复点击返回已有文件。用户主动选择保存才生成文件库副本。

生成中不开放最终成果保存。停止后已有文本可以导出，但标为“未完成”；未完成的图片预览不能伪装成最终图片。执行状态仍集中在现有过程区域，预览和输入框不重复展示同一进度。

### 格式与引用

Markdown 导出保留表格、代码和导图源码，并附带本轮来源清单。公网引用导出为可用链接；本地资料引用保留标题和来源 ID，不导出临时令牌或本地绝对路径。

带本地图片的 Markdown 若只下载单个 `.md` 文件，不能宣称图片已离线嵌入。首期清楚提供文字文件及单图下载；完整图文离线导出可后续采用 Markdown + images 目录的 ZIP 包。

## 5. 数据与接口建议

### 输入附件

复用现有附件表和 ID，不为历史缩略图复制一套附件数据。拟新增：

- `GET /attachments/{id}/file`：当前账户原文件读取/下载。
- `GET /attachments/{id}/thumbnail`：当前账户图片缩略图，按需生成。

所有读取先查当前账户数据库，再校验真实文件路径位于账户附件目录。沿用现有 Bearer 鉴权，不把私有文件挂到公共静态目录。旧消息仅有附件 ID 也能读取元信息；已删除附件显示可理解的缺失状态。

### 输出资产

新增本地输出资产记录，二进制存当前账户工作区，例如 `chat-assets/<asset_id>/`。记录关联 conversation、run、message、供应商 output item/index，以及 MIME、大小、宽高、SHA-256、来源、模型/连接版本、状态和相对文件路径。真实路径和供应商 Base64 只在内部使用。

拟新增 `GET /chat-assets/{id}/file`、`GET /chat-assets/{id}/thumbnail`，复用附件读取的底层校验和图像处理。上传附件继续保留原身份，输出资产单独维护生命周期，共用前端资源组件。

消息保留现有 `content` 以兼容历史，再增加有序块与资产引用，例如：

```ts
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "asset"; asset_id: string };

type ImageAsset = {
  id: string;
  kind: "image";
  filename: string;
  mime_type: string;
  size_bytes: number;
  width: number;
  height: number;
  status: "ready" | "failed";
  origin: "generated";
};
```

新的渲染以有序块为准，旧消息回退到 `content`，避免两份文字重复展示。公开 `AgentRunResult`、消息 payload 和终态 snapshot 只带资源引用；大段 Base64 不进入 SQLite JSON、日志或每次历史加载。

资源服务负责验证实际图片格式、体积与像素范围，落盘后才置为 ready。远程供应商结果导入仅接收协议适配器返回的受控地址，限制重定向、超时、体积和目标地址；不增加任意 URL 下载代理。普通外链 Markdown 图片可显示和打开原图，但在未实现受控导入前，不承诺跨域一键下载与永久存档。

### 成果保存

拟新增 `POST /chat/messages/{message_id}/save-to-library`，参数包含成果选择器（整条回答、代码块、资产或导图源码）、标题/文件名、目录、是否启用知识依据和内容快照标识。

后端读取自己保存的消息和资源，校验账户、成果类型、终态及快照是否过期。默认 `enabled=false`，原子保存原文件、内容、目录和来源元数据；失败时清理临时文件。避免“先创建并索引，再禁用”的窗口。

来源至少记录：来源聊天/消息/run、实际生成模型、引用快照、内容哈希、保存时间和 `origin=generated`。用户保存上传附件则记录 `origin=uploaded`。前端预览可从消息派生文本/代码成果，不必为每个可复制代码块预先建立数据库文件。

保存整条图文回答时，连同其引用的本地图片复制到该文件库条目的资源目录，并重写引用为条目内相对资源；来源元数据保留资源清单。预览通过拟新增的鉴权 `GET /library/sources/{source_id}/assets/{asset_id}/file` 读取清单中的资源，不依赖原会话的 `chat-assets`。正文与资源作为一次保存事务处理；单个 Markdown 下载仍遵循前述文字文件/离线图片打包边界。

文件库需分开“原文件就绪”和“文本解析状态”。图片成果是原文件 ready、文本 not_required；源代码直接作为文本保存，不交给 PDF/DOCX 解析器。现有加入对话要求解析就绪且正文非空，见 `backend/app/library/conversations.py:19`，文本索引也依赖正文；图片归档不能仅靠 `enabled=true` 假装具备知识检索。存档成功不会自动使图片可进入模型上下文，也不会把生成结论标为已核验事实。

## 6. 模型生图接入路线

现有工厂提供 Chat Completions、Responses、Anthropic、Gemini 和 Ollama 客户端，见 `backend/app/models/factory.py:20`。不能按客户端数量承诺全部支持图片生成。

补齐输出能力时需要同时修改：

1. `domain/agent.py`：有序输出项和资源引用；流事件容纳资源进度/完成。请求契约另增原生工具和图片选项；现有 `ModelRequest` 工具只容纳 function schema、参数只允许数字，见 `:52`，无法直接表达生图工具或字符串格式选项。
2. 协议适配器：保留图片结果。Responses 当前只发送 function tools，并跳过非 function_call 图片项，见 `openai_responses.py:175`、`:226`；Gemini 当前只读取文字/functionCall，见 `gemini_generate_content.py:327`。
3. runtime：纯图片也可以构成有效回答；保留真实拒绝、无任何结果时的错误语义。
4. run/message 持久化：存资产引用和终态；刷新历史与运行恢复保持一致。
5. AG-UI 与前端：使用已有 custom event 入口传递进度，最终 snapshot 为权威数据，避免实时事件与最终结果重复插图，见 `chat/ag_ui.py:129`、`useChatRun.ts:284`。
6. 模型档案与路由：新增独立 `image_generation` 能力/绑定；当前只检查 vision/tools/streaming，见 `model_catalog.py:18`、`model_router.py:106`。现有恢复校验要求恰好有 classify/plan/execute 三个阶段，见 `model_router.py:69`；图片绑定单独存储并兼容旧快照，不能直接追加阶段破坏恢复。

建议使用独立 `ImageGenerationService/Provider`，复用当前账户的模型连接、密钥和版本管理。兼容 Images endpoint 的服务可通过 `generate_image` 工具使用专门生图模型，避免把图片模型用于分类或规划；支持 Responses 原生生图的连接可使用供应商内置工具，不伪装成普通 function schema。

第一批实现 Responses 生图结果与 Images API 的标准结果适配；具体首先开启哪条路径，以用户现有网关可用的接口为准。第二批扩展现有 Gemini generateContent 的图片输出。没有明确图片输出契约的 Chat Completions 网关扩展不作猜测。

首版可以仅显示“生成中”并在最终完成后展示图片。局部图预览是增量优化，不阻塞可靠的首图展示。生图能力使用静态资料、服务声明或用户主动测试验证，不在普通打开模型设置、模型目录刷新时逐个试生成图片。

本轮范围是首次生成图片的显示/保存。多轮图片编辑后续需保留供应商续接数据；例如 Gemini 的 thought signature、Responses 的相关输出项/引用，不能仅凭保存的一张图片自动声称具备编辑上下文。

## 7. 重试、删除与本地存储

生图可能计费并产生不同结果。当前 `external_read` 会被视为可安全重试，见 `backend/app/agent/run_store.py:466`；生图工具必须定义独立的重放/重试策略，不直接沿用该策略。用 operation ID、冻结的连接/模型版本和供应商输出项构建幂等关联：已完成就重用原资产；落盘失败重试保存，不重新调用模型；请求结果未知时不自动重新生图。

停止后关闭加载状态。若此前已有验证完成的图片，可保留并标明本轮未完成；只有局部图时不开放最终图片保存。终态重放、SSE 重连和历史恢复不能生成重复文件。

现有回退会删除消息但保留附件，见 `backend/app/api/chat.py:55`；删除会话会清理附件，见 `api/conversations.py:54`。新输出资产按消息/run 引用清理。回退、重新生成、会话删除和中断清理必须覆盖无引用资产，不误删仍被使用的文件。

保存到文件库时创建独立副本。删除或重新生成聊天不影响已存档文件；删除文件库副本不影响仍有效的聊天图片。原文件存本机账户目录，不引入新的云端存储依赖。

现有编辑/重新生成明确不自动复用旧附件，见 `frontend/src/features/chat/useChatRun.ts:466`、`:473` 和 `useChatRun.test.ts:117`。首期保持可见的重新附加入口；若后续自动保留，需让用户看到附件将随本轮再次发送，并调整测试。

另发现现有模型看图路径的问题：`create_attachment` 总是使用本地 store，而 `prepare_attachment_vision_url` 的默认 store 调用本地模式不支持的签名 URL，见 `attachments/service.py:125`、`:155`、`:305`。这需要独立修复；本地图片查看/下载应与公网看图路径解耦。本文没有实测或修复该路径。

## 8. 实施拆分与验收

| 阶段 | 交付内容 | 验收结果 |
| --- | --- | --- |
| A：可阅读与下载 | 附件鉴权原文件/缩略图接口；共享预览组件；历史图片和文档；回答独立打开与 MD/TXT 下载；代码下载；导图源码和普通 Mermaid SVG 下载 | 上传图片发送后刷新仍可查看；PDF 可阅读；中文文件名下载正确；长文不依赖滚动聊天；旧消息仍可使用 |
| B：可存档 | 成果保存 API/弹窗；文件库状态分离；来源和引用快照；幂等与独立副本 | 文本、代码、图片可保存到指定目录；默认不进入知识检索；重复保存不重复创建；删除会话后成果仍可读 |
| C：模型生成图片闭环 | 输出资产契约/本地存储；协议解析与能力/路由；纯图完成；流事件与持久化；停止重放规则 | mock 的纯图、图文、多图都能显示、刷新、下载和保存；能力未知不假装支持；实际网关在选定接口上通过明确集成验证 |

阶段 A/B 可以先完成现有内容的闭环；C 复用同一套预览和存档能力。涉及路由、工具、runtime、协议与恢复规则时同步维护 `docs/agent.md`。

后续扩展：DOCX/PDF 成果模板与排版、图文 ZIP、思维导图 SVG/PNG。仓库虽然安装 `python-docx` 和 `pypdf`，当前用于文档读取，不等于已经具备 Markdown 成果导出服务。交互导图是 HTML 树，见 `ChatWorkspaceMindmap.tsx:159`；普通 Mermaid 已有 SVG，见 `ChatWorkspaceMermaid.tsx:49`。导图图片导出需定义“完整树”还是“当前视图”，不能直接下载当前折叠 DOM 当作完整成果。

## 9. 验证清单

以确定性 mock 为主，复用 `test_attachments.py`、`test_file_library.py`、`test_model_protocol_providers.py`、`test_chat_streaming.py`、`FilePreview.test.tsx`、`PdfReader.test.tsx` 和 `useChatRun.test.ts`。

- 资源读取：无登录/跨账户/无效路径不可读；文件丢失、损坏图片、超限体积与像素有受控反馈；原文件字节、MIME 与中文文件名正确。
- 前端预览：刷新历史、切换会话、快速开关、失败重试；撤销 Blob URL、取消旧请求；旧附件 payload 兼容；键盘关闭、焦点恢复、深色主题和窄屏。
- 下载导出：完整代码、未知语言 `.txt`、Markdown 表格/代码/来源清单；局部图不冒充最终图；未完成文本明确标识。
- 文件库存档：默认不索引；无文字图片不开放无效的知识依据开关；原子选择目录；重复保存幂等；重新生成/删除聊天后单图及整条图文回答仍可读取；复合成果依赖复制失败不留下半成品；图片 not_required 状态不显示解析失败。
- 模型协议：纯图、图文交错、多图、拒绝、无输出、损坏 Base64；Gemini thought 图片不进入最终成果；Responses 最终项去重。
- 执行生命周期：停止、断流、恢复、SSE 重连、重复终态、回退和删除；请求结果未知不自动重复生图；保存失败不重新请求模型。

本轮验证为代码与官方资料核对。真实供应商/用户网关的模型权限、计费和流式事件差异需要实施阶段单独验证，不以文档支持代替连接验证。
