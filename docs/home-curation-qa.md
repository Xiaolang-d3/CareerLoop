# 今日值得看：接入验收

验证日期：2026-10-18。本次为代码与浏览器测试验收，未在真实付费搜索/模型服务上进行选题质量验收，也没有重打桌面安装包。

## 范围与结果

- 已接入首页「今日值得看」卡片、兴趣设置显式启用、文本档案复用、后台搜索/正文读取/编辑筛选、独立缓存与重新筛选 API。
- 旧账号默认关闭；固定信息源列表与原 AI 日报保留。开关关闭时不产生精选搜索或模型请求。
- 独立验证了候选发布时间、正文与摘要区分、逐字证据、真实来源 ref 绑定、事件去重、条数上限、不凑数、跨日去重历史、失败保留旧内容、当天不自动重试、账号隔离、运行合并、关闭后的晚到结果失效，以及重启中断后可手动恢复。
- 桌面打包参数测试确认带入 `daily-news-curator/SKILL.md`；资源缺失会在搜索和模型请求之前报错。此项不等同重建/运行已安装的桌面 sidecar。

## 实际执行

| 验证 | 命令与结果 |
| --- | --- |
| 后端全量 | `cd backend && .venv/bin/python -m pytest tests -q`：1132 passed，79 subtests passed；8 条第三方依赖警告 |
| 前端全量单测 | `cd frontend && npm run test -- --reporter=dot`：595 passed |
| 最终首页回归 | `cd frontend && npm run test -- src/features/home`：52 passed |
| TypeScript 与生产构建 | `cd frontend && npm run build`：通过；保留现有大 chunk 提示 |
| 浏览器 | `cd frontend && npx playwright test e2e/home-curation.spec.ts --workers=1`：浅色、深色两项通过 |
| Diff 格式 | `git diff --check`：通过 |

TDD 已实际看到缺少精选快照、缺少 API、无效证据被误判为空、丢失运行导致无限生成、同日重筛丢失历史、桌面漏带技能及图片模型被错误用于编辑等失败，再修复到通过。首次 TypeScript 构建发现测试 mock 的泛型签名不兼容，已按相邻测试的 `Mock<FetchJson> & FetchJson` 约定修复。

最终检查补充并复现了跨日自动启动后首个响应仍为 `stale`、导致浏览器不开始轮询的问题；精选与原日报两条相同路径均已修复为在预留后台运行后更新返回状态，旧内容继续保留。两条回归与后端全量验证通过。

## 浏览器验证与截图

`frontend/e2e/home-curation.spec.ts` 明确使用带「测试夹具」标记的确定性资讯、伪登录状态与 API 响应，不是真实新闻，不发送付费请求。验证首次关闭状态、打开设置不请求生成、选择模型并显式勾选后保存、轮询到完成、查看原文与证据，以及重新筛选失败后仍保留旧条目且不显示「没有资讯」。捕获浏览器 pageerror，结果为空。

浅色和深色各在 1280、768、390 像素宽度截图；卡片无水平内容溢出。另人工查看浅色宽屏及深色窄屏截图，标题、摘要、推荐理由、日期和证据无截断或不可读问题。生成文件位于工作区 `output/home-curation/`（不提交）：

- `../output/home-curation/curation-light-1280.png`
- `../output/home-curation/curation-light-768.png`
- `../output/home-curation/curation-light-390.png`
- `../output/home-curation/curation-dark-1280.png`
- `../output/home-curation/curation-dark-768.png`
- `../output/home-curation/curation-dark-390.png`

后端还通过 `httpx.MockTransport` 实际执行 Tavily 请求构造与结果归一化，通过真实模型请求构造路径验证 stage、token 上限和无工具调用；只是服务端响应被确定性夹具替代，不代表验证了真实账号权限、额度或搜索/模型质量。

## 启用与边界

首页 → 兴趣设置 → 选择文本「日报模型」→ 勾选「启用每日资讯精选」→ 保存。需要原有联网搜索服务已启用并配置。精选自动每日最多三组搜索和一次文本调用；正文提取及原日报另计，手动重新筛选另计。

只在后端运行并访问首页时懒执行，不承诺关闭应用后定时生成。事件日期精度为日；语义去重、旧闻识别、相关性和置信度仍是模型判断，不能据此声称完美核实或全网覆盖。下一步真实质量验收需使用用户已授权的搜索和文本模型配置，检查实际入选事件，不以测试夹具替代。
