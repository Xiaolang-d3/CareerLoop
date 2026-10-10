# 灯灯

灯灯是从对话开始的个人 AI 协作助手。一起想清楚，一步步做好。

[![CI](https://github.com/Xiaolang-d3/CareerLoop/actions/workflows/ci.yml/badge.svg)](https://github.com/Xiaolang-d3/CareerLoop/actions/workflows/ci.yml)

本地优先、由个人资料驱动的 AI 协作工作台：沉淀可复用上下文，通过可恢复 Agent 完成搜索、分析与内容生成。资料与对话持续保存在本地，任务支持中断恢复。产品聚焦知识库、AI 问答和内容创作，不再提供专用求职功能。

当前版本为 **2.0.0 开发预览版**，尚未发布稳定的 GitHub Release。

## 核心能力

- **资料库**：逐份上传或粘贴资料，支持预览、重命名、校正提取文字、下载原文件、停用和删除；校正文字会更新问答索引，但不改写上传的原文件。所有推导信息先进入待确认队列，确认后才进入可复用上下文。
- **问答与创作**：基于资料完成问答、总结、改写、文章和 PPT 大纲创作；结果在对话中展示和继续修改。没有专用简历导出、岗位匹配或面试入口。

界面模块与产品文案以 [`frontend/src/constants.ts`](frontend/src/constants.ts) 为准；智能体架构、工具、路由与维护约定见 [`docs/agent.md`](docs/agent.md)。

## 技术栈

- 前端：React 19、TypeScript、Vite、Vitest、Playwright
- 后端：Python 3.11+、FastAPI、Pydantic、OpenAI Python SDK
- 数据：SQLite、sqlite-vec、本地检索（可选 FastEmbed 向量）、本地附件；可选 MinIO
- 可选联网搜索：独立部署的 [AgentSearch](https://github.com/brcrusoe72/agent-search) 服务

## 运行要求

- Python 3.11+
- Node.js 20 LTS+ 与 npm
- `zsh`、`lsof`、`screen`

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
│   ├── requirements-litellm.txt # LiteLLM 模型层（精确版本 + 哈希，见 docs/model-layer.md）
│   └── requirements-optional.txt # 增强解析、语义向量与 OCR
├── frontend/
│   ├── src/
│   ├── e2e/
│   └── package.json
├── docs/
│   └── agent.md        # 智能体层维护文档
├── .github/workflows/  # GitHub Actions
├── CHANGELOG.md
└── scripts/            # 本地启动与停止
```

## 本地启动

```bash
cd backend
cp .env.example .env
```

编辑 `backend/.env`，填入 OpenAI 或兼容网关配置：

```dotenv
MODEL_PROVIDER=openai
MODEL_NAME=gpt-5.5
OPENAI_API_KEY=
# MODEL_BASE_URL=
```

回到项目根目录启动：

```bash
./scripts/dev.sh
```

- 前端：http://127.0.0.1:5173
- 后端：http://127.0.0.1:8000

首次打开时在登录页创建本地账户，同一实例可使用多个相互隔离的账户。注册、登录、保持登录、退出撤销和改密规则见 [`docs/account-auth.md`](docs/account-auth.md)。默认只监听本机；局域网访问、安全选项、附件、MinIO、向量检索和外部服务配置见 [`backend/.env.example`](backend/.env.example)。

登录页以居中的账户表单为主，右上角「关于灯灯」和设置首页的「了解灯灯」可进入独立产品介绍页 `#/about`；该页面无需登录，提供返回登录或应用的入口。

停止服务：

```bash
./scripts/stop-dev.sh
```

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
../backend/.venv/bin/pip install -r ../backend/requirements-dev.txt
../backend/.venv/bin/pip install --require-hashes -r ../backend/requirements-litellm.txt
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

数据库版本为 **24**。新账户只创建当前表；版本 1–23 的旧工作区通过版本升级转换，升级前在工作区 `.upgrade-backups/before-library-v23/` 保存一致的 SQLite 和历史 Markdown 副本。旧资料、知识审核状态、证据、会话及附件保留，旧岗位等记录留在历史表中；日常业务不读写这些表。迁移失败会保留旧版本号，可修复后重试。备份含原始资料，应与工作区一起保管。

默认安装支持 PDF、DOCX、TXT、Markdown 和粘贴文本，可直接使用资料库。增强解析、语义向量和图片 OCR 使用独立的可选依赖：

```bash
cd backend
.venv/bin/python -m pip install -r requirements-optional.txt
```

未安装增强解析时可回退快速解析；未安装 OCR 时会提示可恢复的安装说明。测试不下载模型，也不要求真实模型或搜索服务。升级范围、兼容白名单和实际验证结果见 [`docs/refactoring-plan.md`](docs/refactoring-plan.md)。

## 可选：启用联网搜索

灯灯默认不依赖联网搜索即可运行。对话中的公司研究和公开网页搜索需要额外部署 AgentSearch；`scripts/dev.sh` 不会自动启动它。

灯灯会使用 `general`、`news` 和 `company` 搜索策略。对话输入框可在“自动来源”“技术来源”和“通用来源”之间选择；技术来源会优先检索官方文档、GitHub 与 Stack Overflow。启用前请确认所部署的 AgentSearch 版本支持：

```bash
curl "http://127.0.0.1:3939/health"
curl "http://127.0.0.1:3939/search?q=OpenAI&count=2&mode=company"
```

如果第二个请求返回 `Unknown search strategy mode`，该版本与灯灯不兼容，不能仅通过重新构建旧镜像解决；请先升级到明确支持 `company` 策略的版本。

确认兼容后，在 `backend/.env` 中启用集成并重启后端：

```dotenv
AGENT_SEARCH_BASE_URL=http://127.0.0.1:3939
# AGENT_SEARCH_TOKEN=
WEB_RESEARCH_ENABLED=true
```

`/health` 可能因单个上游引擎超时或验证码显示 `degraded`。应以实际 `/search` 请求能否返回结果为准。

## 验证

首次运行测试时安装开发依赖：

```bash
cd backend
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pip install --require-hashes -r requirements-litellm.txt
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
