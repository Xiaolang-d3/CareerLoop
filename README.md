# CareerLoop

个人求职助手Agent。帮助整理简历与岗位材料，完成匹配分析、定制简历和面试准备。

## 技术栈

- 前端：React 19、TypeScript、Vite
- 后端：Python 3.11+、FastAPI、Pydantic、OpenAI Python SDK
- 数据：SQLite、sqlite-vec、本地附件

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
