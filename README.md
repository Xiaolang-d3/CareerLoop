# CareerLoop

[![CI](https://github.com/Xiaolang-d3/CareerLoop/actions/workflows/ci.yml/badge.svg)](https://github.com/Xiaolang-d3/CareerLoop/actions/workflows/ci.yml)

本地优先、由个人资料驱动的 AI 协作工作台：沉淀可复用上下文，通过可恢复 Agent 完成搜索、分析与内容生成。结果可追踪、可恢复，并持续保留在工作台；求职是当前最成熟的专业场景，但不是产品边界。

当前版本为 **2.0.0 开发预览版**，尚未发布稳定的 GitHub Release。

## 核心能力

- **资料库**：维护个人资料、来源内容与已确认事实；所有推导信息先进入待确认队列，确认后才进入可复用上下文。
- **工作台与对话**：基于资料完成搜索、分析、生成、编辑和导出。求职相关的简历、岗位分析和面试辅助作为专业能力保留在同一套对话与工作台中，不再形成独立产品入口。

界面模块与产品文案以 [`frontend/src/constants.ts`](frontend/src/constants.ts) 为准；智能体架构、工具、路由与维护约定见 [`docs/agent.md`](docs/agent.md)。

## 技术栈

- 前端：React 19、TypeScript、Vite、Vitest、Playwright
- 后端：Python 3.11+、FastAPI、Pydantic、OpenAI Python SDK
- 数据：SQLite、sqlite-vec、FastEmbed 本地向量、本地附件；可选 MinIO
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
│   ├── app/            # FastAPI、Agent、领域服务与工作流
│   ├── tests/
│   ├── data/           # 本地 SQLite 与附件（不提交）
│   ├── .env.example
│   ├── requirements-dev.txt
│   └── requirements.txt
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

首次打开时在登录页创建本地管理员账户。默认只监听本机；局域网访问、安全选项、附件、MinIO、向量检索和外部服务配置见 [`backend/.env.example`](backend/.env.example)。

停止服务：

```bash
./scripts/stop-dev.sh
```

## 可选：启用联网搜索

CareerLoop 默认不依赖联网搜索即可运行。对话中的公司研究和公开网页搜索需要额外部署 AgentSearch；`scripts/dev.sh` 不会自动启动它。

CareerLoop 会使用 `general`、`news` 和 `company` 搜索策略。对话输入框可在“自动来源”“技术来源”和“通用来源”之间选择；技术来源会优先检索官方文档、GitHub 与 Stack Overflow。启用前请确认所部署的 AgentSearch 版本支持：

```bash
curl "http://127.0.0.1:3939/health"
curl "http://127.0.0.1:3939/search?q=OpenAI&count=2&mode=company"
```

如果第二个请求返回 `Unknown search strategy mode`，该版本与 CareerLoop 不兼容，不能仅通过重新构建旧镜像解决；请先升级到明确支持 `company` 策略的版本。

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

端到端测试需要 Playwright 浏览器环境：

```bash
cd frontend
npm run test:e2e
```

## 协作与变更记录

- 贡献、分支、提交与验证规则：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 版本与里程碑摘要：[`CHANGELOG.md`](CHANGELOG.md)
- 智能体维护边界：[`docs/agent.md`](docs/agent.md)
