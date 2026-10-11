# 联网搜索类别实施计划

制定日期：2026-10-11。实施日期：2026-10-11。状态：功能已实施，自动化验证通过；浏览器视觉和真实联网验收未完成。范围为 CareerLoop 对话内联网搜索；按当前已接入 Tavily、保留 AgentSearch 的代码制定。

## 交付目标

输入框展示「联网 · 自动 ▾」，开启联网后可以选择自动、通用、新闻、金融。用户选择与实际搜索请求一致；技术资料属于来源偏好，放在当前模块的搜索设置中。默认自动，日常只需开启联网即可发送。

本次实施包括参数统一、Tavily 原生类别、服务能力声明、重试和恢复、输入框交互与回归验证。时间范围、自定义域名列表、图片搜索、搜索深度开关、独立搜索设置页面不属于本次交付，后续按需求补齐。现有来源引用、正文提取、错误处理和单一过程折叠区继续使用。

## 官方依据与实施前差距

已核对 [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) 和 [官方搜索实践](https://docs.tavily.com/documentation/best-practices/best-practices-search)。

| 官方能力 | 本次采用方式 |
| --- | --- |
| `topic` 支持 `general / news / finance` | 用户可手动选择对应类别 |
| `auto_parameters` 按问题配置参数，显式参数优先 | 自动模式开启；省略 `topic`，显式固定 `search_depth=basic` |
| `include_domains` 与 `include_domains_mode=prefer` | 技术来源偏好使用结构化域名参数，允许其他相关网站进入结果 |
| `time_range`、起止日期 | 首期不新增时间限制；新闻类别不等于只查过去 24 小时 |

官方自动参数可能选择 advanced 搜索深度。本次固定 basic 以控制搜索调用成本；正文 Extract 是额外调用，不能将一轮研究宣称为只消耗一次搜索额度。

实施前代码存在三组不同含义：

- 输入框和请求使用 `web_search_mode=auto / technical / general`。
- Agent 工具使用 `category=general / news / company`，仅 general 会应用输入框模式。
- Tavily adapter 仅将 news 映射为 news，其余强制 general；`auto_parameters=False`。

此外，AgentSearch 不支持原生 finance，未知 mode 会静默变为 general；运行快照尚未记录联网开关和模式，确认追问、重新生成及恢复链路必须一起审查。只替换下拉选项无法完成本次目标。

## 参数与执行规则

### 统一本轮配置

定义版本化的 `WebSearchOptions`，同一轮发送后保持稳定：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `enabled` | 布尔值 | 用户是否允许本轮联网 |
| `topic` | `auto / general / news / finance` | 搜索类别 |
| `source_preference` | `none / technical` | 来源偏好，默认不限来源 |
| `version` | `1` | 兼容与恢复解析版本 |

内部 `ChatMessageIn` 保留 `web_search`，增加 `web_search_topic` 和 `web_search_source_preference`；AG-UI 对应 `webSearch`、`webSearchTopic`、`webSearchSourcePreference`。当前发送入口是 `POST /ag-ui`，不另建重复的 REST 发送接口。入口统一归一化后传给 runtime 和 ToolContext，不在各层重复判定。搜索服务标识在运行绑定时记录；重试、编辑与重新生成通过可选 `web_search_provider`／`webSearchProvider` 校验原服务，实际使用服务端配置，客户端不能选择服务。API Key 继续走现有凭证链路，不进入配置快照、消息或日志。

模型可决定检索问题和研究任务线索。用户的联网许可、手动类别、来源偏好由可信上下文确定，不提供给模型修改。

### 类别优先级

| 用户选择 | Tavily 请求 | AgentSearch 请求 |
| --- | --- | --- |
| 自动 | `auto_parameters=true`，省略 `topic`，固定 basic | 根据工具任务线索选择 general、news 或 company |
| 通用 | `topic=general`，自动参数关闭 | general |
| 新闻 | `topic=news`，自动参数关闭 | news |
| 金融 | `topic=finance`，自动参数关闭 | 明确返回不支持，不发起搜索 |

用户手动选择优先于 Agent 工具的 category。Tavily 自动模式将类别判断交给服务，工具 category 仅保留任务语义，不重新固定 topic；公司研究通常属于通用研究场景，不增加「公司」类别入口。金融类别只有声明支持的服务才可选，不自动换服务或静默降为通用。

各请求继续明确 `include_answer=false`、`include_raw_content=markdown`、`include_images=false`，沿用结果数量上限与正文提取上限。暂不开放 advanced，不用类别切换增加模型预检或额外探测请求。

### 技术来源偏好

输入框类别菜单中的「搜索设置」展开模块内的来源偏好：不限来源、优先技术资料。首期沿用当前 GitHub、Stack Overflow、MDN、Python 文档四个域名，以小范围配置起步。

Tavily 使用 `include_domains` 和 `include_domains_mode=prefer`，查询文本不再追加 `site:`。偏好可与新闻等类别组合；不能将其说成严格白名单或保证只返回官方文档。AgentSearch 当前接口没有等价的结构化软偏好，能力声明标记不支持；界面禁用并说明，后端也明确拒绝。扩展 agent-search 仓库的软偏好接口作为独立后续任务，不在本次偷偷用硬限制代替偏好。

### 保存、恢复与兼容

- 新发送将归一化配置写入用户消息 payload，并写入 AgentRunSnapshot／运行绑定。各轮工具调用读取同一配置；同 runId 恢复使用原配置，不能接受当前输入框值覆盖。
- 断连、失败重试保留该轮配置；用户修改输入框类别只影响新发送。重新生成沿用原轮配置，并在实际执行前校验服务能力。
- `ask_user` 追问默认继承待确认任务配置。界面需表达继承状态；用户明确关闭联网或更改类别时，必须使用新 runId，新执行采用新配置并重算工具权限，不能继续使用旧快照中的联网 allowed_tools。
- 配置字段要区分「未提供」与「明确关闭／选择自动」，使用内部 DTO 字段存在性及 AG-UI forwardedProps 键存在性处理，避免默认值覆盖继承值。
- 旧快照先从绑定的原始用户消息补齐配置；无法证明原联网许可时禁止新增搜索，保留已有结果并提示重新发起。恢复时如果搜索服务发生变化，不悄悄改用其他 provider，保留内容并要求按当前服务重新发送。
- 保留旧 `web_search_mode` 输入兼容：旧 technical 映射为通用类别与技术来源偏好，旧 general 映射为通用与不限来源，旧 auto 映射为自动与不限来源。新字段存在时优先新字段；同一契约接受的非法值返回 422。
- 旧 technical 在 AgentSearch 下恢复时显示不支持该软偏好的原因，不假装等价执行；用户可选择不限来源后新发起。已有历史消息只读取，不重写、不重新联网。
- 使用现有 JSON 消息／快照保存字段，优先避免新增 SQLite 列。旧记录可读、有明确默认值；如果实现确需表结构变化，单独提供有测试的版本迁移，不能直接重建数据库。

## 分阶段实施

按下面顺序完成，前后端兼容接口先于新入口发布。每阶段形成内聚代码提交，智能体文档和更新日志按仓库规范同步。

| 阶段 | 实施内容 | 主要文件 | 阶段验收 |
| --- | --- | --- | --- |
| 1. 统一契约与恢复 | WebSearchOptions、入口校验与旧字段转换；贯穿 runtime、消息 payload、快照和恢复；明确权限及配置优先级 | `backend/app/chat/contracts.py`、`api/chat.py`、`chat/execution.py`、`tools/base.py`、`domain/agent.py`、`agent/runtime.py`、`agent/run_store.py`、`agent/snapshots.py`；前端 `features/chat/types.ts`、`useChatRun.ts`、`durable-agent-run.ts` | 内部契约／AG-UI 同义；同轮配置固定；重试、断连及追问不漂移；关闭联网不能继续调用搜索 |
| 2. 服务请求与能力 | 统一 SearchRequest／SearchResponse；Tavily 原生类别和自动参数；结构化域名偏好；AgentSearch 明确能力限制 | `backend/app/research/search.py`、`research/tavily.py`、`research/web.py`、`tools/search_public_web.py`、`agent/bootstrap.py` | 四种类别按约定映射；用户类别不被 Agent 覆盖；不支持的选项拒绝而非降级 |
| 3. 输入框交互 | 类别改为自动／通用／新闻／金融；来源偏好移入模块内搜索设置；按能力禁用；保留紧凑布局 | `frontend/src/components/ChatWorkspace.tsx`、`ChatWorkspace.css`、`types.ts`、`features/chat/types.ts`、`useChatRun.ts`、`app/App.tsx` | 开启联网后出现类别；运行时锁定；停止后恢复；原始重试保留配置；键盘与窄屏可用 |
| 4. 结果说明与验收 | 真实类别元数据、缺失值规则、回归验证、文档与发布检查 | 上述文件、相邻前端测试、`backend/tests/`、`docs/agent.md`、`CHANGELOG.md` | 显式请求及自动实际类别可核对；错误和过程不重复；完整测试与构建通过 |

### 第 2 阶段接口细节

`PublicSearchClient.search` 不再用一个 mode 字符串表达所有含义，统一接收类别、来源偏好和必要的任务线索。返回值除了来源列表，增加经过验证的 provider、请求类别、服务实际类别、来源偏好与警告，避免在工具入口丢失自动分类信息。

Tavily 实际类别优先读取响应 `auto_parameters.topic`；自动模式缺少该字段时记录未知，不根据结果标题猜测成功分类。显式类别记录发送的 topic，和服务返回的实际类别分别保存。SearchResponse 元数据通过工具结果进入既有来源详情／折叠详情，不在输入框上方增加状态条。

能力接口扩展现有 `web_research`，提供 `supported_topics`、`supports_auto_parameters`、`supports_technical_preference`。这些表示适配器已支持的功能，不冒充实时连接成功；服务启用、密钥、网络和鉴权错误继续由现有状态和实际请求报告。

### 第 3 阶段交互细节

- 联网关闭：只显示联网入口，不自动触发请求；同一草稿保留所选类别和来源偏好，再开启时恢复。
- 联网开启：紧凑展示「联网 · 自动 ▾」，类别无障碍名称为「搜索类别」。当前选择有标识，键盘可操作，关闭后焦点回到触发控件。
- 新对话默认自动与不限来源；当前账号当前对话的草稿保留选项，跨账号不继承，不保存密钥。
- 运行中锁定开关、类别及来源偏好；停止请求完成或运行终结后恢复操作。
- 服务不支持的金融／技术偏好显示不可用及原因。服务能力读取失败时提供重试，不伪装为已经可用；前端能力限制之外，后端还须独立校验。
- 编辑重发、重新生成、确认追问和普通新发送分别使用明确配置规则；保留原有删除后续消息的行为说明，不在每条消息下增加常驻文字。
- 检查 320、375、746 px 和桌面宽度，确保模型名称、附件、类别、发送／停止按钮不互相遮挡；沿用全局主题，不新增侧边栏层级。

## 回归与验收矩阵

所有自动化验证模拟搜索和模型，不依赖真实 API Key、不消耗真实服务额度。

| 验证面 | 必测场景 |
| --- | --- |
| 契约 | 内部 DTO／AG-UI 新字段一致；非法值 422；缺省值、新旧字段冲突和明确关闭均有确定规则 |
| 选择优先级 | 通用 + Agent 新闻仍为通用；新闻 + Agent 通用仍为新闻；金融 + Agent 公司仍为金融；Tavily 自动不固定 topic |
| 原生请求 | 自动参数开启同时 basic 固定；三个手动 topic 准确；技术偏好用 include_domains + prefer，无 site 拼接；未设时间范围不擅自限制日期 |
| 服务能力 | AgentSearch 不支持金融／技术软偏好时明确拒绝；不换 provider；缺密钥、鉴权、额度和网络错误仍有单一原因 |
| 运行恢复 | 同 runId 读取原配置；失败草稿、中断重连、重新生成与 ask_user 继承正确；确认追问改配置须新 runId；用户关闭联网后旧快照不能授予搜索权限 |
| 历史兼容 | 旧 auto／technical／general 和缺字段消息正常读取；无可核验联网许可的旧快照不新增搜索；多账号及对话配置隔离 |
| 结果证据 | 返回实际类别时准确记录；未返回时标为未知；来源引用、URL 校验、摘要和正文分离、Extract 部分失败均保留现有行为 |
| 界面 | 开关和类别联动；不支持项说明；运行／停止状态；键盘、焦点、窄屏、主题；不增加重复过程及错误提示 |

重点扩展 `backend/tests/test_tavily_search.py`、`test_web_research.py`、`test_chat_streaming.py`、`test_agent_capabilities.py`、`test_agent_durable_runtime.py`、`test_agent_run_store.py` 和 runtime 相关测试；前端扩展 `ChatWorkspace.test.tsx`、`useChatRun.test.ts`、`durable-agent-run.test.ts`。必要时新增统一选项解析与 adapter 契约测试。

验证命令：

```bash
cd backend && .venv/bin/python -m pytest tests -q
cd frontend && npm run test && npm run build
```

最后进行可用浏览器下的实际交互验收：切换类别、查看请求、重试／恢复、窄屏和深色模式。真实服务仅使用已授权的现有配置进行最少必要冒烟测试；浏览器或服务不可用时记录未验证项，不宣称视觉或联网验收完成。

## 完成标准与发布边界

交付完成需同时满足：界面选择确实传递到服务、用户选择不被模型覆盖、恢复不丢配置、能力限制明确、来源证据链未回退，以及测试与构建通过。只完成选项文案或 Tavily payload 修改不算完成。

上线按兼容接口 → adapter／能力 → 界面的顺序；本地应用以一个完整版本交付。服务参数被拒绝时报告对应错误，不用偷偷删除用户筛选来换取成功。回退应部署对应完整旧版本；回退前保留本机工作区数据快照，核验新快照字段对旧版本的兼容，不直接修改用户历史记录。

实施后更新 `docs/agent.md` 的外部感知与运行恢复规则、`CHANGELOG.md` 的用户可见变更。计划文档在各阶段记录实际完成状态与验证结果。

## 实施记录（2026-10-11）

四阶段功能均已完成：冻结的联网配置贯穿 AG-UI、用户消息、运行绑定和快照；搜索 adapter 接入 Tavily 原生类别与技术来源偏好；输入框改为四类别菜单，搜索设置位于模块内；元数据进入现有来源和回答详情。运行绑定复用现有 `checkpoint_json`，无需 SQLite 列迁移或新增凭证。

补充修复了实施审查发现的恢复边界：旧快照不能继承后续消息的许可；禁止执行的工具台账记为 blocked；已提交结果但未保存回答消息时允许零网络补写；失败重试、编辑和重新生成先核验原搜索服务及能力，再回退消息。客户端携带的 provider 仅作期望校验，服务选择仍以服务端配置为准；同 runId 不接受客户端更改配置。

验证结果：

- 后端全量：698 项测试、68 个子测试通过。
- 前端全量：438 项测试、47 个文件通过。随后补充非法旧模式的安全读取回归，相关 26 项测试、3 个文件再次通过；当前用例总数为 439。最终生产构建成功。
- 回归覆盖原生参数、用户选择优先级、能力拒绝、字段校验、旧记录安全读取、确认追问、恢复、失败草稿、编辑与重新生成、账号／对话隔离、菜单键盘与视口边界。
- 本地后端已重新启动，`/health` 返回正常；现有前端返回 HTTP 200。
- 所有自动化验证模拟模型与搜索，没有调用真实 Tavily。浏览器视觉验收未执行，窄屏和深色主题的实际效果仍需在可操作浏览器中复核；不能将单元测试视为视觉或真实联网验收。

维护说明已同步至 `docs/agent.md` 和 `CHANGELOG.md`。后端代码提交为 `a4fce60`，前端代码提交为 `d9da501`；代码与文档分别提交，本地工作区历史数据保持原格式可读。
