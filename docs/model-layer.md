# 模型层：LiteLLM SDK

灯灯通过 [LiteLLM](https://github.com/BerriAI/litellm) **Python SDK**（不是 LiteLLM Proxy 服务器）调用模型。灯灯自己的部分仍由灯灯负责：连接与模型档案（SQLite）、「自动」协议协商并持久化 `detected_protocol`、真实图片探测、推理内容回传、调用监控与成功率、按对话选择模型、按档案设置推理强度。LiteLLM 负责各厂商的请求格式、流式解析、参数适配、错误分类、备用模型路由、重试冷却、模型能力和价格数据。

## 架构

```
ChatRuntime ─► ConfiguredModelProvider (档案参数 / 推理强度)
                 └► RoutedModelProvider        ← 仅当配置了备用模型
                      ├► AutoNegotiatingModelProvider (协议协商 + detected_protocol)
                      │     └► LiteLLMProvider × 候选协议
                      └► litellm.Router (主模型 + 备用模型 deployments)
```

| 模块 | 作用 |
| --- | --- |
| `backend/app/models/litellm_core.py` | **唯一** `import litellm` 的模块。导入前写入离线环境变量，懒加载并记录导入耗时，统一配置 `drop_params`、关闭回调、遥测与消息日志。 |
| `backend/app/models/litellm_provider.py` | `LiteLLMProvider`：实现 `generate` / `stream` / `check_connection` / `list_models` / `probe_vision` / `name` / `models_url`，事件语义、错误码与监控 `_record_event` 与原生适配器一致。 |
| `backend/app/models/litellm_errors.py` | LiteLLM 异常 → `ModelProviderError` 现有错误码（中文提示），保留 `protocol_unsupported`，新增 `context_window_exceeded`、`content_policy`。 |
| `backend/app/models/litellm_router.py` | `RoutedModelProvider` + `build_router`：把启用的模型档案组成 `litellm.Router`，记录实际回答的模型与是否发生回退。 |
| `backend/app/agent/model_routing.py` | 备用模型策略与能力记录（SQLite），能力合并优先级。 |
| `backend/app/models/factory.py` | `DENGDENG_MODEL_BACKEND=litellm|native` 选择实现，默认 `litellm`；未安装 LiteLLM 时自动退回 `native`。 |

### 协议映射

| 灯灯协议 | LiteLLM 调用 | 说明 |
| --- | --- | --- |
| `openai` | `acompletion(model="openai/<model>")` | 自定义 Base URL 原样作为 `api_base` |
| `responses` | `aresponses(model="openai/<model>")` | `store=False`，`include=["reasoning.encrypted_content"]`；Router 中使用 `openai/responses/<model>` 桥接 |
| `anthropic` | `acompletion(model="anthropic/<model>")` | Base URL 末尾的 `/v1` 会去掉（LiteLLM 自己拼 `/v1/messages`）；系统提示标记 `cache_control` 以启用提示缓存 |
| `gemini` | `acompletion(model="gemini/<model>")` | |
| `ollama` | `acompletion(model="ollama_chat/<model>")` | Base URL 末尾的 `/api` 会去掉；`tool_choice=required` 改为系统提示约束；费用记 0 |

每个协议都使用连接自己的 Base URL 与 API Key，不读取 `OPENAI_API_KEY` 等环境变量。

### 推理

- `reasoning_effort` 对所有协议传入（Responses 为 `{effort, summary: "auto"}`），由 LiteLLM 映射为各家参数（Anthropic thinking、Gemini thinkingConfig 等）；不支持时 `drop_params` 丢弃，上游仍以 400/422 拒绝时去掉后重试一次并记住。
- Anthropic 的带签名 `thinking_blocks` 写入 `provider_metadata["thinking_blocks"]`，runtime 存到带工具调用的助手消息 `payload["thinking_blocks"]`，下一轮原样回传，保证工具轮之间的扩展思考不中断。
- Responses 的加密推理条目沿用 `responses_reasoning_items` 回传（直连用 `aresponses`，Router 中用 LiteLLM 的 `reasoning_items`）。
- 流式事件：正文 `text_delta`、推理 `reasoning_delta`、工具调用在 `completed` 事件中汇总，带用量。

### 备用模型（Router）

设置页「备用模型」保存在 `model_fallback_policy`（schema v29）：

- 备用模型（最多 5 个，按顺序）→ `fallbacks`
- 超长上下文时换用（最多 2 个）→ `context_window_fallbacks`
- 内容被拒时换用（最多 2 个）→ `content_policy_fallbacks`
- 重试：超时 / 限流 / 服务错误各 0–3 次（`RetryPolicy`；请求错误、认证失败、内容拒绝不重试）
- 冷却：允许失败次数 `allowed_fails`、冷却时间 `cooldown_time`

每个档案是一个 deployment，各自携带自己的 Key、Base URL、推理强度、温度与最大输出，备用模型不会继承主模型参数。自动协议尚未协商完成的主模型先直连协商，协商后才进入 Router。回退发生时：监控记录主模型一条 `fallback_used`，回答模型一条成功（`fallback_from_profile_id`）；回答的 `model_selection` 带 `fallback_used`、`answered_model_name`，消息下方显示「由备用模型 … 回答」。

### 能力与费用

能力合并优先级：**手动设置 > 真实探测 > LiteLLM 内置数据 > 模型 ID 推测**。`GET /agent/model-profiles/{id}/capabilities` 返回视觉、推理、工具、结构化输出、PDF、缓存及上下文长度、最大输出、参考价格；`PUT` 写入/清除手动设置；`POST …/capabilities/probe` 做一次真实图片探测并记住结果（`model_capability_records`）。

每次调用估算费用写入 `model_service_events.cost_usd`：档案自定义价格优先，其次 LiteLLM 计算的 `response_cost`，再按用量 × 价格表；Ollama 记 0；未知模型留空。监控摘要返回 `estimated_cost_usd`、`priced_requests`、`unpriced_requests`、`fallback_requests`。只用服务商返回的 token 数，不调用分词器。

`response_format`（结构化输出）与提示缓存（Anthropic `cache_control`）经 `ModelRequest.response_format` / `prompt_cache` 透传。

## 离线与安全

- **只在 `litellm_core.py` 导入 litellm**（测试 `test_only_litellm_core_imports_litellm` 守护）。导入前设置：`LITELLM_LOCAL_MODEL_COST_MAP`、`LITELLM_LOCAL_ANTHROPIC_BETA_HEADERS`、`LITELLM_LOCAL_AUTOROUTER_PRESETS`、`LITELLM_LOCAL_BLOG_POSTS`、`LITELLM_LOCAL_POLICY_TEMPLATES` 为 `True`，`LITELLM_MODE=PRODUCTION`（不加载 `.env`），`LITELLM_TELEMETRY=False`，`LITELLM_RUST=False`。配置后清空 `callbacks` / `success_callback` / `failure_callback`，`turn_off_message_logging=True`，`num_retries=0`（重试只由 Router 策略决定）。
- 测试 `test_litellm_imports_offline_without_network_attempts` 在禁用 socket 的子进程中导入并读取价格表，断言没有任何网络尝试。
- 密钥遮盖：上游错误体可能回显 API Key。`app/redaction.py` 的 `redact_secrets` 先精确替换当前连接（路由时含全部备用连接）的密钥，再遮盖 `Bearer`/`sk-`/`AIza`/`api_key=`/`?key=` 等形式；`ModelProviderError` 构造时总会做形式遮盖，LiteLLM `map_litellm_error(..., secrets)`、路由与四个原生适配器的 `_provider_error` 再做精确遮盖，`record_model_service_event` 写库前再遮盖一次。原始异常链（`__cause__`）仍保留上游原文，供本地调试，不写入数据库。
- 懒加载：构建 provider 不导入 litellm，第一次模型调用时才导入（源码环境约 1.5–2 秒、打包 sidecar 约 0.65 秒，见 `GET /agent/model-layer` 的 `litellm_import_seconds`）。
- 依赖锁定：`requirements.txt`、`requirements-dev.txt`、`requirements-litellm.in` 只写直接依赖，用 `uv pip compile --universal --generate-hashes --only-binary :all:` 生成三份锁文件（精确版本 + 仅 wheel 哈希，跨 Linux/macOS/Windows 与 Python 3.11–3.13；共有的包版本一致）：
  - `requirements-lock.txt`（运行时，约 90 个包，来自 `requirements-lock.in`）：`start-remote.sh`、CI e2e，以及桌面 sidecar 打包所用的环境；不含 pytest、PyInstaller。
  - `requirements-dev-lock.txt`（运行时 + 测试/构建工具，来自 `requirements-dev-lock.in`）：`dev.sh` 与 CI 后端测试。
  - `requirements-build-lock.txt`（仅 PyInstaller 及其依赖，来自 `requirements-build.in`，以开发锁为约束）：桌面构建时装在运行时锁之上，构建环境 `backend/.venv-build` 因此只有运行时包 + PyInstaller；`package-sidecar.py` 每次都先用 `install_deps.sh .venv-build build` 准备该环境，发现 pytest 等开发包则拒绝打包。
  安装只用 `pip install --require-hashes --no-deps --only-binary :all: -r <锁文件>`：先装未加哈希的文件会让 pip 跳过已安装包的哈希校验。`install_deps.sh [VENV] [runtime|dev|build]` 在锁文件或模式变化时以 `venv --clear` 重建后强制重装，并移除 ensurepip 附带、锁里没有的 setuptools。已有 venv 用 `backend/scripts/install_deps.sh`（锁文件变化时 `--force-reinstall`；每次调用都重新运行 `.pth` 扫描，失败时删除安装标记，下次强制重装）。
- `.pth` 扫描：安装后立即运行 `python -I -S backend/scripts/scan_pth.py --python <目标解释器>`（CI 后端测试、e2e、桌面构建与 `install_deps.sh` 都执行）。`-S` 让扫描进程和查询路径的目标解释器都不处理 `.pth`，扫描前不会执行任何启动代码；不带 `-I -S` 时脚本拒绝运行。规则：每个 `.pth` 必须出现在某个已安装包的 RECORD 中且哈希一致，无主文件即使内容与放行项相同也判失败；按 `site` 的方式用 UTF-8（允许 BOM）解码，BOM 后的 `import` 行同样算可执行，非 UTF-8 文件直接失败（`site` 会退回本地编码）；可执行 `.pth` 须内容 sha256 与所属包都在放行表中（目前仅 setuptools 的 `distutils-precedence.pth`），并校验该包 RECORD 中的全部文件，确保其导入的 `_distutils_hack` 是原版；站点目录以及每个 `.pth` 加入 `sys.path` 的目录中出现任何形式的 `sitecustomize` / `usercustomize`（`.py`、包、`.pyc`、扩展模块）都视为异常（1.82.7/1.82.8 投毒即通过 `.pth` 执行）。非 venv 解释器还会扫描用户 site-packages。
- 桌面 sidecar 打包 litellm 包内全部运行时数据文件（`proxy/`、`rust_bridge/`、文档与类型存根除外，约 12 MB；手工列清单曾漏掉 `containers/endpoints.json`），排除 Proxy 服务器、管理界面、企业插件、boto3 与可选 Rust 扩展。`package-sidecar.py` 向 PyInstaller 所在的后端 venv 解释器查询 litellm 位置（`npm run package-sidecar` 本身由系统 python3 运行）。
- 桌面冒烟测试 `desktop/scripts/smoke-sidecar.py` 对打包后的 sidecar 用本地假服务各做一次真实调用（OpenAI 兼容、Responses、Anthropic、Gemini、Ollama），打包缺模块或数据文件会在这里失败；未分类异常会以 `Unexpected LiteLLM failure` 写入运行日志。
- 实测（Apple Silicon，2026-10-10）：`灯灯.app` 148 MB（当前安装版 117 MB，+31 MB；sidecar 125 MB vs 95 MB）；sidecar 冷启动到 `/health` 0.53 s（与安装版相同），首次模型调用 0.76 s（其中导入 litellm 0.64 s）。改用 `.venv-build`（Python 3.11，运行时锁 + 构建锁）后：`灯灯.app` 130 MB、sidecar 100 MB，冷启动 0.52 s、首次模型调用 0.75 s（导入 0.63 s）；包内没有 pytest / PyInstaller（setuptools 由 PyInstaller 钩子带入）。新构建首次启动受 macOS 扫描影响可达约 20 s。

## 安全升级流程

1. 查看 [安全公告](https://github.com/BerriAI/litellm/security/advisories) 与发布说明；只选正式版（非 dev/rc），发布至少约一周且没有未修复公告。
2. 修改 `requirements-litellm.in` 中的版本（其他直接依赖改 `requirements.txt` / `requirements-dev.txt`），执行：
   ```bash
   cd backend
   C="uv pip compile --universal --python-version 3.11 --generate-hashes --only-binary :all:"
   $C requirements-dev-lock.in -o requirements-dev-lock.txt
   $C requirements-lock.in -o requirements-lock.txt
   $C requirements-build.in -o requirements-build-lock.txt
   ```
   已有的锁文件作为输出文件时，uv 会尽量保留其中的版本，只改动需要变化的包。核对 `litellm==` 的哈希与 PyPI 页面一致，审阅新增/变化的依赖及其发布时间。
3. 先生成开发锁，运行时锁和构建锁沿用它的版本（`test_requirements_are_hash_pinned` 会检查）。用 `scripts/install_deps.sh /tmp/v runtime`（以及 `dev`、`build`）在全新 venv 中按哈希安装，再 `pip check`，并运行 `python -I -S scripts/scan_pth.py --python .venv/bin/python`；setuptools 升级后需核对并更新 `scan_pth.py` 中 `distutils-precedence.pth` 的内容哈希。
4. 跑全部后端测试（含离线导入、协议映射、Router 测试）、前端测试与桌面冒烟测试 `desktop/scripts/smoke-sidecar.py`。

## 回滚

设置环境变量 `DENGDENG_MODEL_BACKEND=native` 即回到原生适配器（OpenAI SDK / httpx 实现，代码保留未删除）。原生模式下备用模型设置会保存但不生效（设置页提示），能力报告不使用 LiteLLM 数据，其余功能（协商、探测、推理回传、监控）不变。未安装 litellm 时自动使用原生模式并打印一次警告；`DENGDENG_MODEL_BACKEND` 取 `litellm`、`native` 以外的值时打印一次警告并按默认 `litellm` 处理。数据库 v29 的新增列与表对原生模式无影响。

### 降级到旧版本应用

上面的环境变量只切换模型实现，不涉及数据库。**v29 没有自动降级路径**：旧版本应用（v28 及以前）打开 v29 数据库时会提示「数据库来自更新版本，请升级应用后打开」并拒绝打开，不会修改文件。确需回到旧版本时：

1. 完全退出灯灯（确保后端进程已结束）。
2. 用数据目录下 `.upgrade-backups/before-schema-v29/careerloop.db` 覆盖数据目录中的 `careerloop.db`，并删除同目录的 `careerloop.db-wal`、`careerloop.db-shm`（如存在）。
3. 再启动旧版本应用。

**升级到 v29 之后写入的对话、资料、模型设置与调用记录都会丢失**，恢复前可先另存一份当前的 `careerloop.db`。该备份只在第一次升级到 v29 时写入，之后不会覆盖（`upgrades.py` 的 `_backup` 发现目标已存在即跳过）；如果恢复后又重新升级，目录里仍是最早那份备份，需要新备份时先把旧目录移走。
