# CareerLoop

个人求职助手Agent。帮助整理简历与岗位材料，完成匹配分析、定制简历和面试准备。

智能体层的架构、工具、路由与维护约定见 [docs/agent.md](docs/agent.md)。改智能体行为时必须同步更新该文档。

## 技术栈

- 前端：React 19、TypeScript、Vite
- 后端：Python 3.11+、FastAPI、Pydantic、OpenAI Python SDK
- 数据：SQLite、sqlite-vec、FastEmbed 本地向量、本地附件
- 可选联网搜索：独立部署的 [AgentSearch](https://github.com/brcrusoe72/agent-search) 服务

开发需要 Python 3.11+、Node.js 20 LTS+ 与 npm。`scripts/dev.sh` 还依赖 `lsof` 和 `screen`。

## 项目结构

```text
CareerLoop/
├── backend/
│   ├── app/            # FastAPI、Agent、领域服务与工作流
│   ├── tests/
│   ├── data/           # 本地 SQLite 与附件（不提交）
│   ├── .env.example
│   └── requirements.txt
├── frontend/
│   ├── src/
│   ├── e2e/
│   └── package.json
├── docs/
│   └── agent.md        # 智能体层维护文档
└── scripts/            # 本地启动与停止
```

## 启动

```bash
cd backend
cp .env.example .env
```

编辑 `backend/.env`，填入模型配置：

```dotenv
MODEL_PROVIDER=openai
MODEL_NAME=gpt-5.5
OPENAI_API_KEY=
```

回到项目根目录启动：

```bash
./scripts/dev.sh
```

前端：http://127.0.0.1:5173  
后端：http://127.0.0.1:8000

首次打开时在登录页创建本地管理员账户。停止服务：

```bash
./scripts/stop-dev.sh
```

## 可选：启用联网搜索

CareerLoop 默认不依赖联网搜索即可运行。公司研究和公开网页搜索需要额外启动独立的
[AgentSearch](https://github.com/brcrusoe72/agent-search) 服务；它不属于 CareerLoop 后端，
`scripts/dev.sh` 也不会自动启动它。

AgentSearch 的 Docker 部署同时启动搜索 API 和 SearXNG。首次安装时，在 CareerLoop 仓库之外执行：

```bash
git clone https://github.com/brcrusoe72/agent-search.git
cd agent-search
./scripts/prepare-searxng.sh
docker compose up -d --build
```

确认 API 可以访问：

```bash
curl "http://127.0.0.1:3939/health"
curl "http://127.0.0.1:3939/search?q=OpenAI&count=2"
```

然后在 `backend/.env` 中启用集成，并重启 CareerLoop 后端：

```dotenv
WEB_RESEARCH_ENABLED=true
AGENT_SEARCH_BASE_URL=http://127.0.0.1:3939
# 仅在 AgentSearch 启用了 Bearer Token 时填写，且两边必须一致。
# AGENT_SEARCH_TOKEN=
```

当前公司研究会使用 AgentSearch 的 `company` 搜索策略。所用 AgentSearch 版本必须支持
`/search?...&mode=company`；如果接口返回 `Unknown search strategy mode`，说明正在运行旧镜像，
请同步兼容版本后执行 `docker compose up -d --build api` 重新构建。

`/health` 可能因单个上游搜索引擎超时或验证码返回 `degraded`。只要实际 `/search` 请求仍能
返回结果，CareerLoop 可以继续使用其余可用来源。若 CareerLoop 提示“无法连接 AgentSearch”，
应先检查 Docker 和 AgentSearch 服务状态；这不是公司名称不完整，服务恢复后可以直接重试。

停止 AgentSearch：

```bash
docker compose down
```
