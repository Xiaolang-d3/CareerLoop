# BossCopilot

BossCopilot 是一个面向个人使用的本地求职助手，帮助用户整理求职画像、导入真实岗位、分析匹配度、准备沟通草稿并记录求职进展。

BossCopilot 不访问、不读取也不控制招聘网站。用户本人负责在招聘平台完成登录、搜索、沟通和投递；系统只处理用户主动粘贴或上传并确认的内容。

## 项目文档

- [技术架构](docs/technical-architecture.md)
- [实施路线](docs/implementation-roadmap.md)
- [开发环境与编辑器](docs/development-environment.md)
- [模型提供商架构](docs/model-provider-architecture.md)
- [AG-UI 集成](docs/ag-ui-integration.md)
- [私有附件与 MinIO](docs/attachments-storage.md)
- [MVP 产品需求文档](docs/bosscopilot-mvp-prd.md)
- [贡献规范与 Git 工作流](CONTRIBUTING.md)
- [变更日志](CHANGELOG.md)

## 本地开发

### 环境配置

复制后端环境变量示例，并填写模型配置：

```bash
cd backend
cp .env.example .env
```

至少需要配置：

```dotenv
MODEL_PROVIDER=openai
MODEL_NAME=<模型名称>
OPENAI_API_KEY=<本地密钥>
# MODEL_BASE_URL=<可选的 OpenAI 兼容服务地址>
```

`backend/.env` 已被 Git 忽略。禁止提交或在日志中打印真实密钥。

### 一键启动

```bash
./scripts/dev.sh
```

脚本会在后台启动前后端服务，并把日志写入 `logs/`。

停止服务：

```bash
./scripts/stop-dev.sh
```

### 单独启动后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

后端地址为 `http://127.0.0.1:8000`，健康检查地址为 `http://127.0.0.1:8000/health`。

本项目保存简历、聊天和求职记录等个人数据。默认只建议从本机访问；如果需要开放到局域网，应先增加访问认证和相应的网络保护。

### 单独启动前端

```bash
cd frontend
npm install
npm run dev
```

前端地址为 `http://127.0.0.1:5173`。

## 验证命令

运行后端测试：

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -v
```

执行 Python 编译检查：

```bash
cd backend
.venv/bin/python -m compileall -q app tests
```

执行前端类型检查和生产构建：

```bash
cd frontend
npm run build
```

检查补丁格式：

```bash
git diff --check
```

## 岗位导入

BossCopilot 只接收用户主动提供的岗位内容：

- 在岗位工作台粘贴岗位名称、公司、岗位描述和来源链接。
- 上传用户自己保存的岗位截图，由本机提取文字。
- 用户检查提取结果并明确确认后，岗位才会写入本地数据库。

系统不会通过浏览器、插件或自动化脚本读取招聘网站页面。

## 当前 MVP 范围

- 候选人画像、简历和求职偏好管理
- 简历本地解析、隐私扫描和脱敏
- 用户确认的岗位文字或截图导入
- 本地岗位库和去重保存
- 确定性匹配评分、岗位分析和简历差距分析
- 本地知识检索
- 沟通草稿和待投递队列
- 投递状态与备注记录
- 多对话、上下文记忆和 Agent 设置
- AG-UI 流式聊天、工具状态、停止、编辑和重新生成
- 本地附件或 MinIO 私有对象存储

当前没有任何招聘网站外部写入能力。保存草稿、加入待投递队列或更新投递状态，只会修改本地记录。
