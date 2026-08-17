# CareerLoop 贡献规范

## Git 是项目变更记录的唯一事实来源

所有项目变更都必须由 Git 管理。完成的代码和文档不能以未提交状态交付。每个提交只包含一个内聚变更，并清楚说明变更目的。

开始工作前执行：

```bash
git status
git pull --ff-only
```

禁止在共享分支上使用破坏性历史重写命令。多人协作后，功能开发应使用短生命周期分支。

## 提交信息格式

采用 Conventional Commits 格式：

```text
<类型>(<范围>): <中文摘要>
```

类型和范围使用小写英文，摘要与正文使用中文。允许的类型：

- `docs`：仅文档变更
- `feat`：新增用户可见功能
- `fix`：修复缺陷
- `refactor`：不改变预期行为的代码重构
- `test`：自动化测试变更
- `chore`：工具、依赖或日常维护
- `build`：构建系统变更
- `ci`：持续集成变更

示例：

```text
docs(architecture): 定义模块化 Agent 架构边界
feat(agent): 增加模型工具调用循环
feat(import): 增加用户确认的岗位导入
fix(privacy): 修复脱敏简历证据泄露
test(attachments): 验证附件删除会清理底层对象
```

摘要使用动词开头，保持简洁，结尾不加句号。变更动机、迁移方式、风险或验证过程不明显时，需要在提交正文中补充说明。

不允许只写以下模糊信息：

```text
更新代码
修复问题
一些修改
update
fix bug
```

## 提交边界

- 智能体行为变更必须同步更新 `docs/agent.md`（路由、工具、runtime、记忆、阶段或导入循环）；文档基线与业务代码仍分别提交。
- 条件允许时，代码重构与行为变更分别提交。
- 依赖变更与对应锁文件放在同一提交中。
- 不提交构建产物、本地数据库、浏览器配置、运行日志和密钥。
- 里程碑级别或用户可见的变更需要同步更新 `CHANGELOG.md`；Git 提交记录保留详细开发过程。

## 必须遵循的提交流程

1. 编辑前检查 `git status`。
2. 完成一个内聚变更。
3. 检查 `git diff`，确认不存在密钥和无关文件。
4. 执行与变更相关的前后端验证命令。
5. 只暂存预期文件。
6. 按规定格式提交。
7. 提交后检查 `git status` 和 `git log -1 --stat`。

严禁提交：

- `.env` 文件和 API Key
- SQLite 数据库
- 招聘网站 Cookie、登录信息或其他会话凭据
- 简历和候选人个人数据
- 包含隐私信息的运行日志或截图
- `node_modules`、Python 虚拟环境和构建产物

## 分支策略

仓库只有一名活跃开发者时，经过验证的小提交可以直接进入 `main`。开始多人协作或远程自动化后：

- 保护 `main` 分支。
- 分支使用 `<类型>-<简短目标>` 格式，例如 `feat-resume-analysis`。
- 通过经过审查的 Pull Request 合并。
- 强制执行后端测试和前端构建检查。

分支类型与提交类型保持一致，常用类型包括 `feat`、`fix`、`refactor`、`docs`、`test`、`chore`、`build` 和 `ci`。目标部分使用小写英文与连字符，描述该分支最终交付的能力或解决的问题：

```text
feat-interview-practice
fix-chat-stream-reconnect
refactor-agent-runtime
docs-development-workflow
```

一个分支只承载一个明确的交付目标。为完成同一目标，可以同时修改前端、后端、智能体、测试和文档；没有共同交付目标的改动应拆分到不同分支。避免使用 `dev`、`update`、`fix` 或 `feat-many-changes` 等目标不明确的名称。

## 查看变更记录

使用以下命令查看开发历史：

```bash
git log --oneline --decorate --graph
git show --stat <commit>
git blame <file>
```

提交哈希是已完成变更的唯一标识。发布版本和里程碑摘要记录在 `CHANGELOG.md` 中；具备条件时应引用相关提交或 Pull Request。
