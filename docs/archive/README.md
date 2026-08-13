# 历史文档归档

本目录保存已经不代表当前实现的历史方案文档。它们仅用于追溯设计过程，不应作为开发依据。

当前事实来源是根目录 `README.md`、`docs/current-project-overview.md`、`docs/technical-architecture.md` 和 `backend/tests/`。

## 归档清单

| 文档 | 归档原因 |
| --- | --- |
| `bosscopilot-mvp-prd.md` | 固定范围的 MVP 方案已取消，其中岗位库、投递台和状态管理不代表当前实现 |
| `browser-agent-foundation-plan.md` | 通用浏览器能力基础层未落地，`backend/app/browser/` 与 `browser_read_page` 等工具不存在 |
| `browser-assisted-job-import-plan.md` | 依赖上述基础层；实际实现收窄为 `backend/app/job_browser_capture.py` 与 `browser-extension/` |
| `2026-07-18-agent-tool-domain-refactor-plan.md` | 计划中的 `search_local_jobs`、`rank_local_jobs`、`queue_application` 等工具和 repository 分层未采用 |
| `2026-07-18-agent-tool-domain-refactor-design.md` | 同上，为该重构方案的配套设计文档 |

上述重构方向已被 `backend/app/tools/career_os.py`、`backend/app/job_evaluations.py` 和 `backend/app/opportunity_runs.py` 的实际实现取代。
