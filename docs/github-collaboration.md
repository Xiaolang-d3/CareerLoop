# GitHub 开发协作

仓库中的 Actions 负责自动验证与发布，Agents 负责按任务开发或审查，Projects 负责整理需求和进度。配置 Agents 和 Projects 不会启动网站部署。

## Agents

共用约定在 [copilot-instructions.md](../.github/copilot-instructions.md)，项目角色为：

| 角色 | 用途 | 工具范围 |
| --- | --- | --- |
| [dengdeng-developer](../.github/agents/dengdeng-developer.agent.md) | 实现小范围功能、修复、测试与必要文档 | 读、搜索、编辑、执行命令 |
| [dengdeng-reviewer](../.github/agents/dengdeng-reviewer.agent.md) | 静态审查具体缺陷、账户隔离与数据保护 | 本地读/搜索及当前仓库的 GitHub 只读工具，不能运行测试或修改文件 |

角色需要手动选择，不自动委派，不固定模型，也不配置额外 MCP 或生产密钥。审查角色的 `github/*` 仅使用 GitHub 云端智能体内置、限当前仓库的只读工具，以取得指定 PR/提交的差异，避免把已有问题误报为新增回归。开发角色的命令执行权限用于 GitHub 临时环境；它不连接线上 Mac、Cloudflare 或真实用户数据。角色文件不授予仓库成员权限，也不替代 `ci-gate` 或维护者的合并判断。

文件合入默认分支后，在仓库 **Agents → 新任务 → 角色选择** 中选择对应角色。GitHub Copilot 云端任务需要账号具备相应付费 Copilot 方案，且该仓库未禁用云端智能体；提交配置文件不代表订阅或任务已经启用。不会因添加角色自动发起付费 AI 任务。

[copilot-setup-steps.yml](../.github/workflows/copilot-setup-steps.yml) 在 GitHub 托管 Ubuntu 临时环境准备 Python 3.11、Node 24、后端开发锁与前端依赖；后端安装复用哈希校验与 `.pth` 扫描。该文件变更时会作为 Actions 检查，也可手动运行。初始化不启动后端、不执行模型请求、不生成业务数据；Playwright 浏览器和桌面 Rust 环境按任务需要另行安装。

示例开发任务：

> 修复 Issue 中描述的问题，先检查已有实现与测试，增加能捕获该问题的确定性回归测试。按贡献规范交付 PR，列出实际验证结果；不要访问线上实例。

示例审查任务：

> 对照给定的变更与验收条件，静态检查回归、账户隔离和数据恢复路径。只报告有代码依据的问题及位置，明确未执行测试。

GitHub 的角色配置、普通 `AGENTS.md` 工作约定和本地 Codex skill 分别由各自的工具读取；安装 `dengdeng-deploy` skill 不会在 GitHub 自动创建角色或购买服务。静态审查角色也不等于 GitHub 的自动 PR review 功能。

## Projects

维护一个与 `Xiaolang-d3/CareerLoop` 关联的「灯灯开发计划」看板，避免同时维护多个重复清单。具体看板与自动化启用状态以 GitHub 页面为准，不以本文件的存在推断已经创建。

- 状态：`Todo`（待办）、`In Progress`（进行中）、`Done`（已完成）。
- Issue 记录需求、问题与验收条件，PR 记录实现；临时想法可先用看板草稿，确认后再转成 Issue。
- 可选 `Priority` 字段用 `P0`、`P1`、`P2` 表示优先级；不要将用户账号、密钥、私有聊天、数据库或日志放进卡片。
- 使用内置 `Auto-add to project` 自动纳入本仓库匹配 `is:open` 的 Issue 与 PR；这是项目内置自动化，不向 Actions 增加个人项目令牌。启用后只处理新建或更新的匹配项，已有项目需手动补入。
- 项目项新增时设为 `Todo`；Issue 关闭或 PR 合并时设为 `Done`。这些状态表示工作进度，不证明网站已经部署。部署状态须另查 Actions 与线上版本。

若账号缺少 Projects 授权或尚未登录，先完成网页登录；不为看板擅自扩大现有 CLI 令牌权限。

## 官方参考

- [自定义角色配置](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [智能体开发环境](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment)
- [Projects 内置自动化](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations)
