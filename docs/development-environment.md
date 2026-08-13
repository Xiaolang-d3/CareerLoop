# 开发环境与编辑器

## 推荐默认编辑器：Visual Studio Code

当一个编辑器需要同时覆盖 FastAPI 后端和 React/TypeScript 前端时，推荐使用 Visual Studio Code。请把仓库根目录 `bosscopilot/` 作为一个完整工作区打开。

推荐扩展：

- Python
- Pylance
- Python Debugger
- Ruff
- ESLint
- Prettier

VS Code 可以完成 Python 环境选择、运行、调试、测试、TypeScript/React 开发、浏览器调试和 Git 操作，是当前仓库使用成本最低的默认选择。

个人编辑器设置不应提交到仓库。只有在格式化、静态检查和测试命令正式确定后，才应增加团队共享的项目级配置。

## 可选编辑器：PyCharm

如果主要工作是后端重构、Python 类型导航、FastAPI 调试配置和 SQLite 数据检查，可以使用 PyCharm。

也可以采用 JetBrains 双编辑器方案：

- PyCharm：Python、FastAPI 和 SQLite
- WebStorm：React、TypeScript、CSS、Vite 和浏览器调试

该方案的语言支持更深入，但资源占用更高，也需要在多个应用之间切换。

## 当前建议

针对现阶段的本地 MVP：

1. 团队默认使用 VS Code。
2. 允许开发者按个人习惯使用 PyCharm 处理后端工作。
3. 编辑器配置只提供便利，终端验证命令才是项目的权威标准。

## 打开和运行项目

仓库根目录：

```text
/Users/kkxny/BossCopilot/bosscopilot
```

启动全部服务：

```bash
./scripts/dev.sh
```

停止全部服务：

```bash
./scripts/stop-dev.sh
```

仅启动后端：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

仅启动前端：

```bash
cd frontend
npm install
npm run dev
```

## 模型服务配置

BossCopilot 需要一个已配置的 OpenAI 或 OpenAI 兼容模型服务，不会在失败时自动切换到模拟模型、低价模型或其他备用模型。

在被 Git 忽略的 `backend/.env` 中设置：

```dotenv
MODEL_PROVIDER=openai
MODEL_NAME=<模型名称>
OPENAI_API_KEY=<本地密钥>
# MODEL_BASE_URL=<可选的 OpenAI 兼容服务地址>
MODEL_MAX_TOOL_ROUNDS=8
MODEL_TIMEOUT_SECONDS=60
```

认证失败、限流、超时、连接失败和上游异常会转换为结构化 Agent 错误并显示在界面中。禁止提交 `.env` 文件，也不得在日志中输出真实密钥。

## 岗位数据接入

当前内置实现支持以下岗位输入方式：

- 用户主动粘贴岗位文字。
- 用户提交公开 HTTPS 岗位链接，由岗位导入智能体读取和验证。
- 用户上传自己保存的岗位截图，由本机识别文字。
- 用户通过可选 Chrome 扩展读取当前已经打开的岗位页面。
- 用户检查标题、公司、岗位描述和来源信息后明确确认导入。

招聘网站、职位库或其他外部来源可以通过后续平台适配器和结构化工具接入。聊天中的平台操作请求会进入正常 Agent 路由，由运行时根据已注册能力处理，不再被接口层提前拦截。

### 浏览器辅助岗位读取

本地研究模式可以安装仓库中的 Chrome 扩展：

```bash
cd browser-extension
npm test
npm run build
```

在 Chrome 扩展管理页加载 `browser-extension/dist/`，并在 `backend/.env` 中设置：

```dotenv
BROWSER_JOB_IMPORT_ENABLED=true
```

扩展安装或重新构建后需要刷新 BossCopilot 和目标岗位标签页。扩展只读取用户主动请求的匹配岗位页面，不读取 Cookie、密码或浏览历史。

## 附件存储

默认使用本地目录 `backend/data/attachments` 保存附件。需要 MinIO 时，可以启动：

```bash
docker compose -f docker-compose.minio.yml up -d
```

详细配置见[私有附件与 MinIO](attachments-storage.md)。

## 验证基线

后端测试：

```bash
cd backend
.venv/bin/python -m pytest tests -q
```

后端编译检查：

```bash
cd backend
.venv/bin/python -m compileall -q app tests
```

前端单元测试、类型检查和生产构建：

```bash
cd frontend
npm run test
npm run build
```

前端端到端测试（需要本地服务已启动）：

```bash
cd frontend
npm run test:e2e
```

浏览器扩展测试和构建：

```bash
cd browser-extension
npm test
npm run build
```

补丁格式检查：

```bash
git diff --check
```

涉及数据库、附件、隐私或流式协议的修改，还应运行相应测试文件，并进行必要的本地 API 冒烟验证。

## 本地数据注意事项

以下内容只能保存在被 Git 忽略的本地目录中：

- `.env` 和 API Key
- SQLite 数据库
- 简历原文和脱敏文本
- 岗位截图和附件
- 聊天记录和运行日志
- MinIO 数据卷
- 旧版浏览器会话目录

提交前应使用 `git status` 和 `git diff` 检查是否意外包含个人数据或密钥。
