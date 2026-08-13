# BossCopilot 通用浏览器能力基础层方案

> 日期：2026-07-30  
> 状态：待实施  
> 首个使用场景：浏览器辅助岗位导入  
> 关联方案：`docs/browser-assisted-job-import-plan.md`

## 1. 决策

浏览器能力应当建设为 BossCopilot 的通用 Agent 工具基础层，而不是写成 BOSS 直聘专用脚本。

基础层负责浏览器连接、标签页管理、页面观察、受控交互、权限确认、结果回传和审计。岗位导入、公司研究、表单辅助、面试日程等业务通过上层适配器和工作流使用这些能力。

第一阶段只交付“观察型能力”，即读取当前页面和有限导航；岗位导入是第一个验收场景。点击、填写和提交能力分阶段开放，避免一次性把高风险浏览器操作暴露给模型。

```text
Agent Runtime
  └─ Browser Tool Adapters
       └─ Browser Capability Service
            ├─ Session / Tab Manager
            ├─ Command Broker
            ├─ Policy Gate
            ├─ Observation Normalizer
            └─ Audit Events
                  ↕
            React Browser Bridge
                  ↕
            BossCopilot Chrome Extension
                  ↕
            User Chrome Tabs
```

## 2. 为什么需要独立基础层

后续浏览器需求通常会共享以下能力：

- 查找、选择或打开标签页。
- 导航到用户指定 URL。
- 读取当前页面的标题、URL、可见正文和结构。
- 定位页面中的可操作元素。
- 滚动、等待页面变化和重新观察。
- 填写表单但暂不提交。
- 在用户确认后执行提交、发送或保存。
- 识别登录页、验证码、安全验证和页面失效。
- 将执行过程作为 Agent 事件展示和审计。

如果每个业务场景分别开发：

- 标签页匹配、消息协议和权限控制会重复。
- 不同功能可能采用不同确认规则。
- 模型容易获得不必要的低层浏览器权限。
- 页面变化后难以统一恢复和诊断。

因此浏览器层应提供稳定的结构化能力，业务层只描述“为什么使用”和“允许使用哪些动作”。

## 3. 分层架构

### 3.1 Chrome Extension

职责：

- 连接 BossCopilot 本地页面。
- 在用户授权的域名上注入通用 page runtime。
- 执行结构化浏览器命令。
- 返回经过边界限制的页面观察。
- 不直接调用模型或数据库。

### 3.2 React Browser Bridge

职责：

- 发现扩展和版本。
- 接收后端发出的 browser command。
- 调用扩展并回传 command result。
- 在动作需要确认时展示用户界面。
- 维护当前任务的连接状态。

React 不负责判断工具是否允许执行；它只执行后端策略门已经允许、且用户已经确认的命令。

### 3.3 Browser Command Broker

后端新增命令代理：

```text
backend/app/browser/
  broker.py
  commands.py
  policy.py
  observations.py
  sessions.py
  errors.py
```

职责：

- 为每次命令生成不可猜测的 `command_id`。
- 将命令作为流式事件发给当前前端。
- 等待前端通过 REST 回传结果。
- 校验 conversation、run、session 和 command 是否一致。
- 处理超时、取消、重复响应和客户端断开。

第一版使用内存中的 `asyncio.Future`，适合当前单进程、本地单用户架构。未来需要多进程时再引入持久化命令队列。

### 3.4 Browser Capability Service

职责：

- 对模型隐藏扩展消息细节。
- 将模型工具调用转换为 browser command。
- 规范化浏览器 observation。
- 维护页面 revision 和短期 element reference。
- 在执行前调用 Policy Gate。

### 3.5 Browser Tool Adapters

模型只看到当前任务需要的最小工具集合。通用浏览器基础层可以注册多个工具，但路由只开放必要工具。

业务适配器示例：

```text
Job Import Adapter
  -> browser_find_tab
  -> browser_observe_page

Company Research Adapter
  -> browser_open_url
  -> browser_observe_page
  -> browser_scroll

Form Assistant Adapter
  -> browser_observe_page
  -> browser_fill
  -> browser_click

Application Adapter
  -> browser_fill
  -> browser_submit（必须确认）
```

## 4. 浏览器工具集合

### 4.1 第一阶段：观察型工具

| 工具 | 作用 | 风险 |
| --- | --- | --- |
| `browser_list_tabs` | 系统内部按已批准域名筛选标签页，不向模型暴露无关标签页 | observe |
| `browser_find_tab` | 按 canonical URL 或域名查找标签页 | observe |
| `browser_open_url` | 打开用户或计划绑定的 URL | navigate |
| `browser_observe_page` | 返回 URL、标题、页面类型、可见结构和 element refs | observe |
| `browser_read_page` | 读取指定语义区域的可见文本 | observe |
| `browser_scroll` | 在当前页面有限滚动 | navigate |
| `browser_wait` | 等待页面 URL、标题或元素状态变化 | navigate |

岗位导入第一版只需要：

```text
browser_find_tab
browser_open_url
browser_observe_page
browser_read_page
```

`browser_list_tabs` 不作为普通模型工具开放。它只供 Browser Capability Service 在已绑定域名和 URL 范围内查找候选标签页，不能返回用户其他标签页的标题或 URL。

### 4.2 第二阶段：准备型工具

| 工具 | 作用 | 风险 |
| --- | --- | --- |
| `browser_click` | 点击非提交型控件 | interact |
| `browser_fill` | 填写普通输入框 | prepare |
| `browser_select` | 选择下拉值 | prepare |
| `browser_press` | 发送限定按键 | interact |

准备型工具必须使用最近 observation 返回的 `element_ref`，不允许模型提供任意 CSS、XPath、JavaScript 或屏幕坐标。

### 4.3 第三阶段：提交型工具

| 工具 | 作用 | 风险 |
| --- | --- | --- |
| `browser_submit` | 提交表单 | commit |
| `browser_send_message` | 发送消息 | commit |
| `browser_confirm_action` | 执行保存、投递、删除等最终动作 | commit |

提交型工具默认不开放。只有业务适配器、任务路由和用户确认同时允许时才可执行。

### 4.4 永久禁止能力

- 读取 Cookie、密码、LocalStorage 或浏览器密码库。
- 获取完整浏览历史。
- 执行任意页面 JavaScript。
- 调用招聘平台私有接口。
- 处理或绕过 CAPTCHA。
- 自动修改浏览器安全设置或扩展权限。
- 在用户不知情时后台扫描页面。
- 允许网页内容创建、授权或升级工具。

## 5. 风险模型与确认策略

现有 `ToolRisk` 需要扩展为：

```python
ToolRisk = Literal[
    "read_only",
    "analysis",
    "local_write",
    "user_input",
    "browser_observe",
    "browser_navigate",
    "browser_prepare",
    "browser_commit",
    "restricted",
]
```

建议策略：

| 风险 | 示例 | 默认处理 |
| --- | --- | --- |
| `browser_observe` | 读取当前页面 | 用户已明确请求浏览器任务时允许 |
| `browser_navigate` | 打开指定 URL、滚动 | URL 已绑定在任务中时允许 |
| `browser_prepare` | 填写未提交表单 | 显示将填写的字段；敏感数据需确认 |
| `browser_commit` | 提交、发送、投递 | 动作发生前必须确认 |
| `restricted` | CAPTCHA、Cookie、任意 JS | 始终阻止 |

确认不能由模型自行省略。Policy Gate 根据以下权威信息决定：

- 用户原始请求。
- 当前任务路由。
- 业务适配器声明的能力。
- 目标域名和页面 revision。
- 输入是否包含敏感数据。
- 动作是否产生外部状态变化。

网页文本、OCR、附件和模型生成内容都不能影响权限判定。

## 6. Observation 与 Element Reference

### 6.1 页面观察

通用 observation：

```ts
type BrowserObservation = {
  schema_version: "browser-observation-v1";
  session_id: string;
  tab_id: string;
  page_revision: string;
  url: string;
  title: string;
  page_type:
    | "document"
    | "login"
    | "captcha"
    | "security_challenge"
    | "error"
    | "unknown";
  text_excerpt: string;
  regions: Array<{
    region_ref: string;
    role: string;
    label: string;
    text: string;
  }>;
  elements: Array<{
    element_ref: string;
    role: string;
    name: string;
    state: Record<string, string | boolean>;
  }>;
  captured_at: string;
  truncated: boolean;
};
```

### 6.2 短期引用

`element_ref` 由扩展生成，只在以下条件下有效：

- 同一个 browser session。
- 同一个 tab。
- 同一个 page revision。
- observation 后 60 秒内。

页面 URL、DOM 主体或导航发生变化后 revision 更新，旧引用立即失效。后端必须拒绝 stale element，要求 Agent 重新观察，不能猜测新选择器。

### 6.3 数据边界

- 单次 observation 最大 100 KB。
- 元素最多 200 个。
- 区域最多 30 个。
- 文本按任务范围裁剪。
- 标签页发现只返回与任务 URL 或已批准域名匹配的结果。
- 密码输入框只返回角色和存在性，不返回值。
- 隐藏元素、脚本、样式和完整 HTML 不返回。

## 7. 命令协议

后端向前端发送：

```ts
type BrowserCommand = {
  schema_version: "browser-command-v1";
  command_id: string;
  run_id: string;
  session_id: string;
  action:
    | "list_tabs"
    | "find_tab"
    | "open_url"
    | "observe_page"
    | "read_page"
    | "scroll"
    | "wait"
    | "click"
    | "fill"
    | "select"
    | "press"
    | "submit";
  arguments: Record<string, unknown>;
  risk: string;
  requires_confirmation: boolean;
  expires_at: string;
};
```

前端回传：

```ts
type BrowserCommandResult = {
  schema_version: "browser-command-result-v1";
  command_id: string;
  run_id: string;
  session_id: string;
  status:
    | "done"
    | "blocked"
    | "denied"
    | "timeout"
    | "stale"
    | "failed";
  observation?: BrowserObservation;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  completed_at: string;
};
```

接口：

```text
POST /browser/sessions
POST /browser/commands/{command_id}/result
POST /browser/commands/{command_id}/cancel
GET  /browser/capabilities
```

browser command 通过现有 AG-UI/SSE 或岗位导入 NDJSON 流发送，扩展不需要维护直接连接后端的长期 WebSocket。

## 8. Chrome 扩展权限

基础扩展建议：

```json
{
  "permissions": [
    "activeTab",
    "scripting",
    "tabs"
  ],
  "host_permissions": [
    "http://127.0.0.1:5173/*",
    "http://localhost:5173/*",
    "https://www.zhipin.com/*"
  ],
  "optional_host_permissions": [
    "https://*/*"
  ]
}
```

原则：

- 默认只启用 BossCopilot 本地页面和第一批明确支持的平台。
- 新域名在用户启用对应适配器时申请 optional host permission。
- 不默认申请 `<all_urls>`。
- 不申请 `cookies`、`history`、`webRequest`、`nativeMessaging`。
- 扩展关闭或权限撤销后，BossCopilot 自动回退到非浏览器能力。

## 9. 平台适配器

浏览器基础层只提供页面和操作原语，不理解具体业务。平台差异放在适配器：

```text
browser-extension/src/adapters/
  jobs/
    boss.ts
    generic-job.ts
  research/
    generic-article.ts
  forms/
    generic-form.ts
```

适配器接口：

```ts
type BrowserAdapter = {
  id: string;
  matches(url: URL): boolean;
  classify(document: Document): PageClassification;
  observe(document: Document, scope: ObservationScope): BrowserObservation;
  allowedActions: string[];
};
```

适配器不能：

- 增加 manifest 权限。
- 绕过 Policy Gate。
- 读取 scope 之外的数据。
- 自行发起网络请求。
- 将网页内容作为浏览器命令执行。

## 10. Agent Runtime 集成

### 10.1 工具上下文

`ToolContext` 增加：

```python
class ToolContext(BaseModel):
    platform_name: str
    conversation_id: int | None = None
    task_id: int | None = None
    run_id: str | None = None
    browser_session_id: str | None = None
    browser_capabilities: set[str] = set()
```

### 10.2 路由

新增浏览器任务路由：

```text
browser_read
browser_research
browser_assist
browser_external_action
```

示例最小工具面：

```text
读取当前页面
  -> browser_observe_page
  -> browser_read_page

打开链接并总结
  -> browser_open_url
  -> browser_observe_page
  -> browser_read_page

填写表单但不提交
  -> browser_observe_page
  -> browser_fill

填写并提交
  -> browser_observe_page
  -> browser_fill
  -> browser_submit
```

### 10.3 执行循环

```text
模型选择 browser tool
→ Runtime 校验计划和风险
→ Broker 发布 browser command
→ React 显示状态或确认
→ Extension 执行
→ Frontend 回传 result
→ Broker 恢复 ToolResult
→ Runtime 继续下一轮
```

页面观察内容作为不可信 tool result 进入模型；它可以影响业务判断，但不能改变可用工具集合。

## 11. 审计与隐私

记录：

- run、command、tool、risk、域名。
- 用户是否确认。
- 开始、完成、超时和错误状态。
- observation 字符数、元素数和 page revision。

默认不记录：

- 页面正文。
- 输入框值。
- Cookie 和浏览器存储。
- 用户浏览历史。
- 密码、验证码和身份认证数据。

只有业务明确需要且用户确认时，最终提取的结构化结果才进入业务表，例如岗位标题和 JD。

## 12. 实施阶段

### 阶段 0：协议与策略

- [ ] 定义 command、result、observation 和 error schema。
- [ ] 扩展 `ToolRisk` 与 Policy Gate。
- [ ] 定义 session、tab、revision 和 element ref 生命周期。
- [ ] 为禁止能力编写负面测试。

### 阶段 1：观察型浏览器基础层

- [ ] 创建通用 Chrome 扩展骨架。
- [ ] 实现扩展发现和本地 bridge。
- [ ] 实现 list/find/open/observe/read。
- [ ] 实现 Browser Command Broker。
- [ ] 将命令作为流式事件展示。
- [ ] 完成 BOSS 岗位导入适配器。

交付结果：能够完成当前浏览器岗位读取，也可以支持“读取并总结当前网页”等通用任务。

### 阶段 2：有限交互

- [ ] 实现 page revision 和 element refs。
- [ ] 实现 scroll、wait、click、fill、select、press。
- [ ] 增加敏感字段检测。
- [ ] 增加准备型动作确认界面。
- [ ] 增加 stale element 恢复。

交付结果：能够协助填写页面，但不自动提交。

### 阶段 3：外部状态变更

- [ ] 实现 browser commit 风险门。
- [ ] 实现动作前确认和拒绝。
- [ ] 实现提交结果验证。
- [ ] 为每个业务场景建立专用适配器。
- [ ] 增加取消、恢复和审计页面。

交付结果：只在用户明确确认后执行发送、保存或提交。

## 13. 第一阶段文件图

### 新增

```text
browser-extension/
backend/app/browser/
backend/app/tools/browser_find_tab.py
backend/app/tools/browser_open_url.py
backend/app/tools/browser_observe_page.py
backend/app/tools/browser_read_page.py
frontend/src/features/browser/
backend/tests/test_browser_broker.py
backend/tests/test_browser_policy.py
frontend/src/features/browser/*.test.ts
```

### 修改

```text
backend/app/domain/agent.py
backend/app/tools/base.py
backend/app/agent/orchestration.py
backend/app/agent/runtime.py
backend/app/agent/bootstrap.py
backend/app/api/resources.py
backend/app/api/schemas.py
frontend/src/main.tsx
frontend/src/types.ts
frontend/src/constants.ts
docs/technical-architecture.md
docs/current-project-overview.md
```

## 14. 第一阶段验收

- [ ] 扩展未安装时，现有功能正常运行。
- [ ] 用户可以显式连接和断开浏览器能力。
- [ ] Agent 可以读取当前页面并返回结构化 observation。
- [ ] Agent 只能操作任务绑定的 URL 和 tab。
- [ ] 页面导航后旧 element ref 失效。
- [ ] 页面内容不能扩大 Agent 权限。
- [ ] 扩展没有 Cookie、历史和网络拦截权限。
- [ ] 当前 BOSS 示例岗位可以通过岗位适配器导入。
- [ ] 安全验证页会停止，不会自动处理。
- [ ] 所有 browser command 都有可见事件和审计记录。
- [ ] 后端、前端和扩展测试全部通过。

## 15. 与岗位导入方案的关系

`browser-assisted-job-import-plan.md` 是第一个业务适配器方案：

- 通用扩展、bridge、command broker、policy、session 和 observation 使用本方案。
- BOSS DOM 提取、岗位字段、`browser_required` 和岗位质量门使用岗位导入方案。
- 不在岗位模块中重复实现标签页管理和消息协议。
- 后续浏览器任务直接复用基础层，只新增业务路由、适配器和风险声明。

## 16. 最终边界

浏览器能力层是 BossCopilot 的执行基础设施，不等于给模型完整控制浏览器。

模型只能调用经过注册、路由限制和风险门检查的结构化工具；浏览器扩展只执行有效、未过期、作用域明确的命令；涉及外部状态变化的动作必须由用户确认。这样可以支持后续浏览器操作需求，同时避免把任意页面控制能力一次性暴露给 Agent。
