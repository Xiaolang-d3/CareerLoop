# 开发与验证

本文描述本地开发验证、测试运行和持续集成流程。

## 安装开发依赖

首次运行测试时安装开发依赖：

```bash
cd backend
scripts/install_deps.sh .venv dev   # 运行时 + 测试依赖，按哈希安装（部署用 runtime，只装运行时锁）
```

## 后端测试

```bash
cd backend
.venv/bin/python -m pytest tests -q
```

## 前端测试

```bash
cd frontend
npm run test
npm run build
```

## 端到端测试

端到端测试需要先构建前端，并提供 Playwright 浏览器和后端 Python 环境；默认使用 `backend/.venv/bin/python`，CI 可用 `E2E_PYTHON` 指定。测试以临时工作区启动真实 API，只替换模型生成，同时保留快速 UI mock 与响应式截图回归：

```bash
cd frontend
npm run build
npm run test:e2e
```

## 离线评测

同一组 62 条离线评测已纳入后端 pytest；也可独立运行 Promptfoo（无需模型请求或浏览器下载）：

```bash
cd evals
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
PROMPTFOO_CONFIG_DIR=.promptfoo PROMPTFOO_DISABLE_TELEMETRY=1 npm run eval
```

## 可选依赖

增强解析、语义向量和图片 OCR 使用独立的可选依赖：

```bash
cd backend
.venv/bin/python -m pip install -r requirements-optional.txt
```

未安装增强解析时可回退快速解析；未安装 OCR 时会提示可恢复的安装说明。测试不下载模型，也不要求真实模型或搜索服务。升级范围、兼容白名单和实际验证结果见 [`docs/refactoring-plan.md`](refactoring-plan.md)。

## 数据与架构边界

后端按 `api/`、`documents/`、`library/`、`chat/`、`agent/`、`persistence/` 划分职责；`main.py` 只组装应用。前端 `main.tsx` 负责启动，`app/` 管理壳与认证，资料库和聊天各自管理业务状态，样式放在对应功能目录。

数据库当前版本为 **31**。旧工作区按版本升级，升级前在工作区 `.upgrade-backups/` 保存一致性备份，保留已有资料、会话与附件；未知格式或来自更新版本的数据库会拒绝修改。备份含原始资料，应与工作区一起保管。智能体、账号隔离与迁移边界见[智能体维护文档](agent.md)。

## 持续集成与发布

- 推送 `main` 或打开 PR 时运行 [CI](../.github/workflows/ci.yml)：`backend-tests`、`frontend-unit`、`frontend-e2e`，由 `ci-gate` 汇总。E2E 在 Linux/macOS 执行，macOS 检查固定截图，Linux 检查几何尺寸和真实交互。PR 改动智能体相关代码时额外检查 `docs/agent.md`。
- `main` 的 push CI 成功后运行 [CD](../.github/workflows/cd.yml)，将同一 SHA 的后端和已验证前端发布为 `deploy-<SHA>` 预发布包；Mac 拉取、校验、隔离冒烟测试后切换应用。需要先完成一次性服务启用，详见[持续部署](continuous-deployment.md)。PR 和失败 CI 不发布，CD 不重建现有 Cloudflare 隧道。
- 推送 `v*` 标签时运行 [Release](../.github/workflows/release.yml)：复用 CI，打包前端 `dist`，并创建 GitHub Release；与网站 CD 的预发布标签分开。

## 贡献流程

贡献、分支、提交与验证规则见 [`CONTRIBUTING.md`](../CONTRIBUTING.md)。
