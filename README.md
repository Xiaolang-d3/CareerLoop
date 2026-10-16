<p align="center">
  <img src="frontend/public/dengdeng-mark-v1.png" alt="灯灯 Logo" width="88" height="88" />
</p>

# 灯灯 · 个人 AI 协作工作台

**一起想清楚，一步步做好。**

[![CI](https://github.com/Xiaolang-d3/CareerLoop/actions/workflows/ci.yml/badge.svg)](https://github.com/Xiaolang-d3/CareerLoop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Xiaolang-d3/CareerLoop?color=blue)](LICENSE)
[![Community Standards](https://img.shields.io/badge/Community-Standards-blue)](https://github.com/Xiaolang-d3/CareerLoop/community)

灯灯是一个开源、本地优先的个人 AI 协作工作台。把问题、文件和想法带进对话，结合已有资料与公开来源完成研究、分析、起草和修改，再把有用的内容保存下来，留给下一次任务继续使用。

你可以选择自己的模型服务，决定哪些资料只存档、哪些允许长期参考，以及每轮对话是否联网。资料、会话和任务记录保存在本机；使用外部模型或搜索服务时，相关上下文或查询会发送至你配置的服务，**本地存储不等于全程离线**。

当前版本：**2.0.0 开发预览版**。支持浏览器本地运行，桌面版基于 Tauri 2，目前面向 macOS ARM64 内部测试。

[快速开始](#快速开始) · [桌面版](#桌面安装包当前macos-arm64-内部测试) · [智能体架构](docs/agent.md) · [贡献指南](CONTRIBUTING.md) · [问题反馈](https://github.com/Xiaolang-d3/CareerLoop/issues/new/choose)

## 核心能力

| 能力 | 可以做什么 |
| --- | --- |
| **持续对话** | 围绕同一任务继续提问、分析、起草和修改；流式展示回答与执行进度，支持停止、重试和任务中断恢复。 |
| **联网研究** | 按需搜索公开信息，在回答中引用来源，并从参考来源面板打开原网页核对；支持 Tavily 或独立部署的 AgentSearch。 |
| **文件库与知识** | 导入 PDF、DOCX、TXT、Markdown 或粘贴文本，按文件夹和主题集合整理；预览原件、校正提取文字，选择一次对话使用或长期参考。 |
| **成果保存与复用** | 将对话中的有用内容存档，继续用于后续任务；推导出的知识先进入待确认队列，确认后再复用。配置兼容的生图模型后，也可在对话中生成、预览和下载图片。 |
| **多模型连接** | 管理多个模型服务和模型档案，在对话中切换；支持 OpenAI 兼容接口、Responses、Anthropic、Gemini、Ollama，以及备用模型策略。 |
| **开发者资讯首页** | 浏览 AI / Agent 动态、GitHub 日榜与周榜、关注仓库的 Releases 和工程实践；收藏线索，或带入对话继续分析。 |

界面提供 **首页、AI 工作区、文件库、设置** 四个入口，支持浅色、深色和跟随系统外观。项目沿用 `CareerLoop` 仓库名，当前产品定位与功能以灯灯为准。

## 从这些任务开始

- **查清一个问题**：「搜索最近的 Agent 应用进展，按方向归纳，并给出可核对的来源。」
- **读懂一份材料**：「总结这份 PDF 的主要结论，列出依据、不确定点和需要继续确认的问题。」
- **写出一份初稿**：「结合我提供的资料，起草一篇文章，再按我的反馈逐段修改。」
- **积累可用上下文**：把资料按主题整理，明确开启长期使用；把确认过的知识留给后续对话。

文件库界面新导入的资料默认**仅存档**，不会因上传就自动成为长期依据。“用于对话”带入当时的文本快照；“长期使用”允许后续检索参考。校正提取文字会更新检索依据，不改写上传原件。详见[文件库说明](docs/file-library-architecture.md)。

模型协议、能力与备用策略见[模型层说明](docs/model-layer.md)，图片生成配置见[生图接入说明](docs/image-generation.md)。功能是否可用取决于所选模型、服务权限与本地可选依赖。

## 技术栈

- 前端：React 19、TypeScript、Vite、Vitest、Playwright
- 后端：Python 3.11+、FastAPI、Pydantic、LiteLLM SDK 与原生模型适配器
- 桌面：Tauri 2、Rust、FastAPI sidecar
- 数据：SQLite、sqlite-vec、本地检索（可选 FastEmbed 向量）、本地附件；可选 MinIO
- 可选联网搜索：[Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search) API 或独立部署的 [AgentSearch](https://github.com/brcrusoe72/agent-search) 服务

## 运行要求

- Python 3.11+
- Node.js 24 LTS 与 npm（与 CI 使用的版本一致）
- 使用一键启动脚本时需要 `zsh`、`lsof`、`screen`；也可分别启动前后端

`scripts/dev.sh` 会自动创建后端虚拟环境、安装 Python 依赖，并在缺少 `node_modules` 时安装前端依赖。

## 项目结构

```text
CareerLoop/
├── backend/
│   ├── app/            # API 路由、资料库、聊天、Agent、解析及持久化
│   ├── tests/
│   ├── data/           # 本地 SQLite 与附件（不提交）
│   ├── .env.example
│   ├── requirements-dev.txt
│   ├── requirements.txt
│   ├── requirements-lock.txt # 运行时依赖的哈希锁定文件；开发用 requirements-dev-lock.txt，桌面构建加 requirements-build-lock.txt（见 docs/model-layer.md）
│   └── requirements-optional.txt # 增强解析、语义向量与 OCR
├── frontend/
│   ├── src/
│   ├── e2e/
│   └── package.json
├── desktop/            # Tauri 壳、sidecar 打包与桌面冒烟测试
├── docs/
│   ├── agent.md        # 智能体层维护文档
│   ├── model-layer.md  # 模型连接、协议与备用策略
│   └── file-library-architecture.md
├── evals/              # 离线评测
├── .github/workflows/  # GitHub Actions
├── CHANGELOG.md
└── scripts/            # 本地启动与停止
```

## 快速开始

### 1. 获取项目并准备配置

```bash
git clone https://github.com/Xiaolang-d3/CareerLoop.git
cd CareerLoop
cd backend
cp .env.example .env
cd ..
```

### 2. 启动本地服务

在项目根目录执行：

```bash
./scripts/dev.sh
```

- 前端：http://127.0.0.1:5173
- 后端：http://127.0.0.1:8000

### 3. 创建账户，连接模型

首次打开前端后创建本地账户，在 **设置 → 连接与模型** 中添加服务地址、密钥和模型，保存后进入 AI 工作区开始对话。也可通过 `backend/.env` 配置初始模型，变量说明见 [`.env.example`](backend/.env.example)。联网研究需另外[启用搜索服务](#可选启用联网搜索)。

同一实例支持多个相互隔离的本地账户。账户与会话规则见[账户说明](docs/account-auth.md)。服务默认只监听本机；局域网、附件存储、MinIO、向量检索与可选服务配置见 [`.env.example`](backend/.env.example)。

无需登录即可访问 `http://127.0.0.1:5173/#/about` 查看产品介绍与示例交互演示。

停止服务：

```bash
./scripts/stop-dev.sh
```

### 分别启动前后端 / PyCharm

后端可以单独作为 PyCharm 项目打开，工作目录设为 `backend/`，解释器选择 `backend/.venv/bin/python`。先安装依赖，再以 Python 模块方式启动：

```bash
cd backend
scripts/install_deps.sh .venv dev
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

PyCharm 的运行配置使用模块 `uvicorn`，参数为 `app.main:app --host 127.0.0.1 --port 8000`。在另一个终端启动前端：

```bash
cd frontend
npm ci
npm run dev
```

手动启动时，分别在对应终端停止进程即可。

## 桌面安装包（当前：macOS ARM64 内部测试）

桌面版使用 Tauri 2：React 前端仍复用 `frontend/`，FastAPI 以受限的
loopback sidecar 运行；每次启动使用动态端口，并在显示窗口前校验服务名、版本和
实例 ID。退出应用时会终止并等待 sidecar，SQLite、附件和工作区写入操作系统的
用户级应用数据目录，不会写入应用安装目录。浏览器开发模式和 `scripts/dev.sh`
不受影响。

在每个目标系统的发布构建机上执行：

```bash
cd desktop
npm install
../backend/scripts/install_deps.sh ../backend/.venv dev   # 运行时 + 测试依赖，按哈希安装
npm run package-sidecar
../backend/.venv/bin/python scripts/smoke-sidecar.py
npm run build
```

桌面 CI 生成临时签名、未公证的 macOS ARM64 `.app` / `.dmg` 内部制品。Tauri
要求 sidecar 带目标三元组后缀，不要把本机生成的二进制复制到其他系统或架构。
Python 后端以 PyInstaller onedir runtime 放入应用资源目录，Tauri 通过同架构的原生
launcher 启动它；开发桌面壳可运行 `npm run dev`，但仍需要先生成当前平台的真实
sidecar，不能用占位脚本构建。为控制内部包体积，首版桌面包不包含可选的图片 OCR
推理栈；PDF、DOCX、纯文本和粘贴文本仍可正常导入，图片 OCR 在安装可选依赖的浏览器开发环境可用。

## 数据与架构边界

后端按 `api/`、`documents/`、`library/`、`chat/`、`agent/`、`persistence/` 划分职责；`main.py` 只组装应用。前端 `main.tsx` 负责启动，`app/` 管理壳与认证，资料库和聊天各自管理业务状态，样式放在对应功能目录。

数据库当前版本为 **31**。旧工作区按版本升级，升级前在工作区 `.upgrade-backups/` 保存一致性备份，保留已有资料、会话与附件；未知格式或来自更新版本的数据库会拒绝修改。备份含原始资料，应与工作区一起保管。智能体、账号隔离与迁移边界见[智能体维护文档](docs/agent.md)。

默认安装支持 PDF、DOCX、TXT、Markdown 和粘贴文本，可直接使用资料库。增强解析、语义向量和图片 OCR 使用独立的可选依赖：

```bash
cd backend
.venv/bin/python -m pip install -r requirements-optional.txt
```

未安装增强解析时可回退快速解析；未安装 OCR 时会提示可恢复的安装说明。测试不下载模型，也不要求真实模型或搜索服务。升级范围、兼容白名单和实际验证结果见 [`docs/refactoring-plan.md`](docs/refactoring-plan.md)。

## 可选：启用联网搜索

灯灯默认不依赖联网搜索即可运行。启用后，可直接使用 Tavily API，也可连接独立部署的 AgentSearch。

使用 Tavily 时，在本地 `backend/.env` 配置并重启后端：

```dotenv
WEB_RESEARCH_ENABLED=true
WEB_SEARCH_PROVIDER=auto
TAVILY_API_KEY=你的搜索密钥
```

`auto` 会在配置了 `TAVILY_API_KEY` 时选择 Tavily，无需启动本地 AgentSearch。也可用 `WEB_SEARCH_PROVIDER=tavily` / `agent_search` 显式指定服务；指定 Tavily 却没有密钥时会提示配置错误。模型 API Key 与搜索 API Key 分开使用。密钥只由本地后端读取，不返回浏览器。网络、鉴权或额度错误不会自动切换到另一个服务。

对话输入框可以开关联网，并选择自动、通用、新闻或金融类别，以及技术资料来源偏好。可用选项随搜索服务能力变化；Tavily 使用 basic 搜索，自动类别交给服务判断。优先读取搜索返回的正文，缺失时按预算补充提取；提取失败保留摘要并标明原因，回答仍须引用来源。

选择 AgentSearch 时，需要单独启动它；`scripts/dev.sh` 不会自动启动它。

AgentSearch 适配器使用 `general`、`news` 和 `company` 搜索策略，目前不支持金融类别或技术资料软偏好，对应选项会禁用并说明原因。启用前请确认所部署的 AgentSearch 版本支持：

```bash
curl "http://127.0.0.1:3939/health"
curl "http://127.0.0.1:3939/search?q=OpenAI&count=2&mode=company"
```

如果第二个请求返回 `Unknown search strategy mode`，该版本与灯灯不兼容，不能仅通过重新构建旧镜像解决；请先升级到明确支持 `company` 策略的版本。

确认兼容后，在 `backend/.env` 中启用集成并重启后端：

```dotenv
AGENT_SEARCH_BASE_URL=http://127.0.0.1:3939
WEB_SEARCH_PROVIDER=agent_search
# AGENT_SEARCH_TOKEN=
WEB_RESEARCH_ENABLED=true
```

`/health` 可能因单个上游引擎超时或验证码显示 `degraded`。应以实际 `/search` 请求能否返回结果为准。

## 验证

首次运行测试时安装开发依赖：

```bash
cd backend
scripts/install_deps.sh .venv dev   # 运行时 + 测试依赖，按哈希安装（部署用 runtime，只装运行时锁）
```

```bash
cd backend
.venv/bin/python -m pytest tests -q
```

```bash
cd frontend
npm run test
npm run build
```

端到端测试需要先构建前端，并提供 Playwright 浏览器和后端 Python 环境；默认使用 `backend/.venv/bin/python`，CI 可用 `E2E_PYTHON` 指定。测试以临时工作区启动真实 API，只替换模型生成，同时保留快速 UI mock 与响应式截图回归：

```bash
cd frontend
npm run build
npm run test:e2e
```

同一组 62 条离线评测已纳入后端 pytest；也可独立运行 Promptfoo（无需模型请求或浏览器下载）：

```bash
cd evals
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
PROMPTFOO_CONFIG_DIR=.promptfoo PROMPTFOO_DISABLE_TELEMETRY=1 npm run eval
```

## 持续集成与发布

- 推送 `main` 或打开 PR 时运行 [CI](.github/workflows/ci.yml)：`backend-tests`、`frontend-unit`、`frontend-e2e`，由 `ci-gate` 汇总。E2E 在 Linux/macOS 执行，macOS 检查固定截图，Linux 检查几何尺寸和真实交互。PR 改动智能体相关代码时额外检查 `docs/agent.md`。
- 本地优先架构没有远程部署目标。推送 `v*` 标签时运行 [Release](.github/workflows/release.yml)：复用 CI，打包前端 `dist`，并创建 GitHub Release。

## 协作与变更记录

- 贡献、分支、提交与验证规则：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 版本与里程碑摘要：[`CHANGELOG.md`](CHANGELOG.md)
- 智能体维护边界：[`docs/agent.md`](docs/agent.md)
- 社区行为准则：[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- 安全漏洞报告：[`SECURITY.md`](SECURITY.md)；请使用私密报告渠道。
- 问题反馈、功能建议与使用咨询：[创建 Issue](https://github.com/Xiaolang-d3/CareerLoop/issues/new/choose)

## 许可证

本项目采用 [MIT License](LICENSE)。使用、修改或分发代码时请保留许可证与版权声明。项目中单独注明许可证的第三方代码与依赖继续遵循各自的授权条款，例如 [`backend/app/password_policy-LICENSE.txt`](backend/app/password_policy-LICENSE.txt)。
