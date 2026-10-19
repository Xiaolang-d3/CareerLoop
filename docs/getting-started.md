# 快速开始

本文介绍如何在本地运行灯灯。如果你是第一次使用，按以下步骤操作即可。

## 1. 获取项目并准备配置

```bash
git clone https://github.com/Xiaolang-d3/CareerLoop.git
cd CareerLoop
cd backend
cp .env.example .env
cd ..
```

## 2. 启动本地服务

在项目根目录执行：

```bash
./scripts/dev.sh
```

`scripts/dev.sh` 会自动创建后端虚拟环境、安装 Python 依赖，并在缺少 `node_modules` 时安装前端依赖。

- 前端：http://127.0.0.1:5173
- 后端：http://127.0.0.1:8000

停止服务：

```bash
./scripts/stop-dev.sh
```

## 3. 创建账户，连接模型

首次打开前端后创建本地账户，在 **设置 → 连接与模型** 中添加服务地址、密钥和模型，保存后进入 AI 工作区开始对话。也可通过 `backend/.env` 配置初始模型，变量说明见 [`backend/.env.example`](../backend/.env.example)。

联网研究需另外[启用搜索服务](web-search.md)。

同一实例支持多个相互隔离的本地账户。账户与会话规则见[账户说明](account-auth.md)。服务默认只监听本机；局域网、附件存储、MinIO、向量检索与可选服务配置见 [`backend/.env.example`](../backend/.env.example)。

无需登录即可访问 `http://127.0.0.1:5173/#/about` 查看产品介绍与示例交互演示。

## 分别启动前后端

如果需要单独控制前后端进程，可以分别启动。

### 后端

后端可以单独作为 PyCharm 项目打开，工作目录设为 `backend/`，解释器选择 `backend/.venv/bin/python`。先安装依赖，再以 Python 模块方式启动：

```bash
cd backend
scripts/install_deps.sh .venv dev
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

PyCharm 的运行配置使用模块 `uvicorn`，参数为 `app.main:app --host 127.0.0.1 --port 8000`。

### 前端

```bash
cd frontend
npm ci
npm run dev
```

手动启动时，分别在对应终端停止进程即可。

## 运行要求

- Python 3.11+
- Node.js 24 LTS 与 npm（与 CI 使用的版本一致）
- 使用一键启动脚本时需要 `zsh`、`lsof`、`screen`；也可分别启动前后端
