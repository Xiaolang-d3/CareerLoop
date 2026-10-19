# GitHub CI/CD 与 Mac 自动部署

CI（持续集成）检查代码，CD（持续部署）在检查成功后更新服务。本方案的入口为 `main`：

```text
push / 合并 PR 到 main
  → CI：后端、前端、Linux/macOS E2E 全部成功
  → CD：复用该次 CI 的 frontend-dist，打包同一提交
  → GitHub 预发布 deploy-<完整 SHA>
  → Mac 每分钟检查 main，拉取该 SHA 的发布包
  → 校验 SHA256、安装锁定依赖、隔离数据冒烟测试
  → 维护状态、停服、一致性备份、切换与数据库检查
  → 解除维护，xiaocheng.online 提供新版本
```

实现入口：[`cd.yml`](../.github/workflows/cd.yml)、[`deployment.py`](../scripts/deployment.py)、[`dengdeng-deploy`](../skills/dengdeng-deploy/SKILL.md)。**仓库中存在这些文件不代表自动部署已经启用**：工作流需要合入默认分支，Mac 还需完成一次性服务配置。

## GitHub 侧

CD 使用 GitHub 托管的 Ubuntu runner，不在公开仓库向日常使用的 Mac 注册通用 self-hosted runner。仅本仓库 `main` 的成功 push CI 能发布；PR、fork、其他分支、手动 CI 和失败 CI 都不会触发发布。

发布包只含后端应用、运行时安装/扫描脚本、运行时锁及 CI 已构建的前端；不含 `.env`、虚拟环境、本地数据和令牌。校验清单记录完整提交、仓库、归档大小及 SHA256。包先上传到 draft，完整后才公开；已公开的同 SHA 包不覆盖。预发布标签不以 `v` 开头，不触发桌面 Release 工作流。

CI/CD 完成顺序可能与 push 顺序不同，GitHub 发布前和 Mac 激活前均检查当前 `main`，跳过过时的候选。连续快速 push 可能合并为部署最新通过 CI 的 main，不能保证每个中间提交都曾对外服务。

默认不需要设置模型密钥、SSH 密钥或 Cloudflare 令牌等 GitHub Secrets。Mac 拉取的是本公开仓库的发布资产，不需要 GitHub 写权限；Cloudflare 常驻隧道继续独立运行。

## Mac 首次启用

前置条件：macOS、Python 3.11+、git，以及已接通的 `dengdeng-public` 固定隧道。运行应用的用户需要能访问该实例原有的账户钥匙串。保留实际数据目录的绝对路径，否则旧凭证引用可能失效。Windows 需另配服务适配，不能直接使用 plist。

1. 合入 CI/CD PR，等该 `main` 的 CI/CD 成功并在 Releases 出现 `deploy-<SHA>`。
2. 核实旧进程、真实数据目录及保留要求；当前手动/reload 服务不由新管理器控制，不能让两个应用写同一目录。
3. 生成配置。下面的路径只是示例；将数据目录替换为已核实的实际路径，解释器必须是可独立使用的基础 Python，不能指向随后会被重建的 venv。

   ```bash
   python3 scripts/deployment.py configure \
     --root "$HOME/Library/Application Support/DengDengDeploy" \
     --data-dir /absolute/path/to/existing/data \
     --python /absolute/path/to/python3.11 \
     --port 8000
   ```

4. 检查生成的 `config.json`、`web.plist`、`deploy.plist`。初始 `enabled=false`，生成配置不会停服或注册后台任务。数据和部署根目录须在同一卷，数据不能位于 releases/backups 内，部署根目录也不能位于数据内。
5. 为真正重启后自动运行，将两份 plist 安装到该用户的 `~/Library/LaunchAgents/`；先核实没有同名服务，不覆盖已有配置。plist 仍引用独立部署根目录中的 manager，不引用 Actions checkout 或开发目录。
6. 在受控停机窗口停止已确认的旧应用，确认 8000 端口空闲且数据目录无其他写入者；不要停止 cloudflared。将 `config.json` 的 `enabled` 改为 `true`，运行一次 `once` 并验证成功，然后 `launchctl bootstrap gui/$(id -u) <已安装的 deploy.plist>` 启用每分钟检查。

   ```bash
   python3 scripts/deployment.py once --root "$HOME/Library/Application Support/DengDengDeploy"
   python3 scripts/deployment.py status --root "$HOME/Library/Application Support/DengDengDeploy"
   ```

7. 通过公网页面和 `/health` 核实 `instance_id` 为成功的完整 SHA，检查登录、旧资料和图标；模型连接由用户自行配置/验证，不用运营者密钥做收费冒烟测试。

管理器不会抢占不属于自身的端口。现有回源 `http://localhost:8000` 可保留，不需要重建 DNS 或隧道。若决定改用其他端口，需要同步修改固定隧道的回源并重新验收。

服务为用户级 LaunchAgent，需要该用户登录。FileVault 重启解锁、接电不睡眠及联网条件仍需单独确认；这不是无需登录的系统守护进程。

## 数据、模型凭证与回退

- 代码在 `releases/<SHA>`，数据沿用配置中的固定目录，`current.json` 只记录代码指针；脚本不修改开发仓库或运行 `git reset/clean`。
- 发布进程使用单 worker、loopback 端口、关闭 API 文档，不读开发 `.env`。清空共享模型/搜索凭证，Mac 上的用户模型凭证继续按原工作区钥匙串引用读取；不把自带密钥计入运营者账单。
- 默认联网搜索关闭、附件使用本地目录。已有实例若依赖 MinIO、外部搜索或其他定制环境，先完成显式适配再切换，不能声称通用脚本已覆盖这些配置。
- 切换期间 `CAREERLOOP_MAINTENANCE_FILE` 对除 `/health` 外的请求返回 503；现有活动任务会随受控停服中断，用户可在更新后继续或重试。没有健康检查通过前不接受新版用户写入。
- 停服后复制完整数据目录，覆盖 `auth.db`、工作区数据库与附件/头像。失败先停候选、保留失败目录、恢复快照及旧代码。新安装没有业务库也合法；多账户时逐一检查业务库。
- `transaction.json` 记录切换阶段。Mac 或进程在切换中断时，下次轮询先恢复事务，再判断 SHA 是否已部署；同一个失败 SHA 不无限重试。修复原因后用 `once --retry` 明确重试。
- 已解除维护后接受过用户写入的版本，不自动恢复旧数据快照；这时的回退需单独停写、备份最新数据并核实 schema 兼容性。
- 不自动删除历史发布与备份；剩余空间低于 15 GiB 会暂停激活。首次启用时核对数据总量及备份空间，定期将备份转移至加密外置/异机存储并按明确保留策略清理。

## 运维命令

```bash
# 状态：不打印密钥或用户资料
python3 scripts/deployment.py status --root "$HOME/Library/Application Support/DengDengDeploy"

# 修复失败原因后，重试当前 main
python3 scripts/deployment.py once --retry --root "$HOME/Library/Application Support/DengDengDeploy"

# 暂停轮询；不停止现有网站
launchctl bootout gui/$(id -u)/online.xiaocheng.dengdeng.deploy
```

日志在部署根目录 `logs/`。脚本默认日志只报告异常类型，排查时查看受限本机日志，不能将 `.env`、钥匙串、完整聊天或数据库上传到 GitHub。

更改已安装的部署管理器或 launchd 配置需通过 skill 明确维护；应用代码更新不会静默替换控制部署权限的 manager。当前上线能力与公众注册加固的其余事项仍见[上线计划](mac-cloudflare-deployment-plan.md)。
