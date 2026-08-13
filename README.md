# BossCopilot

## 技术栈

- 前端：React 19、TypeScript、Vite、Vitest、Playwright、assistant-ui、AG-UI。
- 后端：Python 3.11+、FastAPI、Pydantic、OpenAI Python SDK。
- 数据与文件：SQLite、sqlite-vec、本地附件存储；可选 MinIO。
- 文档处理：Docling、python-docx、pypdf、ReportLab、Presidio。
- 可选联网研究：自托管 AgentSearch。

开发环境需要 Python 3.11+、Node.js 20 LTS+ 与 npm。`scripts/dev.sh` 还依赖 `lsof` 和 `screen`。

## 项目目录

```text
bosscopilot/
├── backend/
│   ├── app/                 # FastAPI、Agent、领域服务、Repository 与工作流
│   ├── tests/               # 后端测试
│   ├── data/                # 本地 SQLite 与附件运行数据（不提交）
│   ├── .env.example         # 环境变量示例
│   └── requirements.txt     # Python 依赖
├── frontend/
│   ├── src/                 # React 前端源码
│   ├── e2e/                 # Playwright 端到端测试
│   └── package.json         # 前端命令与依赖
├── browser-extension/       # Chrome 浏览器助手
├── docs/                    # 架构、设计和开发文档
├── scripts/                 # 本地启动与停止脚本
├── CONTRIBUTING.md          # 贡献与 Git 规范
└── CHANGELOG.md             # 版本变更记录
```

## 启动方法

### 一键启动

在项目根目录执行：

```bash
./scripts/dev.sh
```

脚本会在本机启动后端 `http://127.0.0.1:8000` 和前端 `http://127.0.0.1:5173`。日志位于 `logs/backend.log` 与 `logs/frontend.log`。停止服务：

```bash
./scripts/stop-dev.sh
```

### 任意网络的安全远程访问（HTTPS）

`start-remote.sh` 构建前端，并由后端在同一个来源托管页面和 API；随后通过 Cloudflare Quick Tunnel 发布一个 HTTPS 地址。后端仅监听 `127.0.0.1`，不会在路由器上开放端口。

```bash
./scripts/start-remote.sh
```

脚本输出的 `https://…trycloudflare.com` 即为手机蜂窝网络、外网或其他设备的访问地址。该地址是临时地址：服务、Tunnel 或 Mac 重启后会改变；Mac 必须保持开机。停止远程服务：

```bash
./scripts/stop-remote.sh
```

Quick Tunnel 提供 HTTPS，但公开 URL 知道即可尝试登录。使用至少 16 位的管理员密码，避免在不可信设备登录；长期稳定使用应改用自有域名 Cloudflare Tunnel，并配置 Cloudflare Access。

### 手动启动

先配置后端：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

编辑 `backend/.env`，至少配置：

```dotenv
MODEL_PROVIDER=openai
MODEL_NAME=gpt-5.5
OPENAI_API_KEY=<你的密钥>
```

启动后端：

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

启动前端：

```bash
cd frontend
npm install
npm run dev
```

后端健康检查地址为 `http://127.0.0.1:8000/health`。不要提交 `backend/.env` 或真实密钥。
