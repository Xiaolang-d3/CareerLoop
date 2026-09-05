# CareerLoop 智能体

本文是 CareerLoop **智能体层的维护文档**。代码是行为的事实来源；本文记录意图、边界和同步点。改智能体行为时必须在同一变更中更新本文。

最近校准：2026-09-05（`GET /agent/runs/current` 读取损坏或过期的 checkpoint/result JSON 时返回安全摘要，不再 500；不可校验的检查点不能恢复）。
