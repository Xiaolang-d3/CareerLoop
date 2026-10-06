# 文件库落地视觉验收

## Findings

最终对照没有剩余需要阻止交付的 P0/P1/P2 问题。文件库沿用当前灯灯的全局导航、字体和品牌交互色，采用已确认 V3 的模块结构。历史品牌验收原文保存在 [品牌 V2 验收归档](docs/design-qa-brand-v2-archive.md)。

## 比较目标与证据

source visual truth paths:
- /Users/kkxny/CareerLoop/output/design/file-library-v3-2026-10-06/browse.png
- /Users/kkxny/CareerLoop/output/design/file-library-v3-2026-10-06/quick-preview.png
- /Users/kkxny/CareerLoop/output/design/file-library-v3-2026-10-06/reader.png

implementation screenshot paths:
- /Users/kkxny/CareerLoop/output/design/file-library-implementation-2026-10-06/browse.png
- /Users/kkxny/CareerLoop/output/design/file-library-implementation-2026-10-06/quick-preview.png
- /Users/kkxny/CareerLoop/output/design/file-library-implementation-2026-10-06/reader.png
- /Users/kkxny/CareerLoop/output/design/file-library-implementation-2026-10-06/mobile-browse.png
- /Users/kkxny/CareerLoop/output/design/file-library-implementation-2026-10-06/mobile-preview.png
- /Users/kkxny/CareerLoop/output/design/file-library-implementation-2026-10-06/tablet-browse.png

实际预览：http://127.0.0.1:5181/#/library。连接隔离的真实后端，使用合成测试账号及资料；没有读取或上传用户的私人文件。

viewport：桌面 1586 × 992 CSS px；源图和实现截图均为 1586 × 992 px，截图密度为每 CSS px 一个图像像素，无设备外框或浏览器工具栏。移动端 375 × 900，平板 784 × 900；实测 document.scrollWidth 等于视口宽度。最终桌面截图在侧栏 CSS 过渡完成、侧栏宽度稳定为 232 px 后捕获。没有缩放截图来掩盖布局差异。

state：浏览态为全部文件、列表视图、3 个文件夹及 6 个文件、未选中；快速预览态只选中“产品调研报告”、原文件标签打开；阅读态为同一 PDF 原文件。主题为浅色、已登录。源图使用演示文档；真实实现使用测试 PDF、Word、图片及文本笔记，因此文件大小、顺序、时间、正文和实际页数不同。正文内容不参与像素一致性判断；没有把源图的 8 页或演示文件大小伪造为实际数据。

完整源图与最终截图已放在同一比较输入中打开：
- /Users/kkxny/CareerLoop/output/design/file-library-implementation-2026-10-06/compare-browse.png
- /Users/kkxny/CareerLoop/output/design/file-library-implementation-2026-10-06/compare-quick-preview.png
- /Users/kkxny/CareerLoop/output/design/file-library-implementation-2026-10-06/compare-reader.png

聚焦比较已打开：/Users/kkxny/CareerLoop/output/design/file-library-implementation-2026-10-06/compare-detail.png。取模块标签、文件夹与表格区域，保留各自原始像素，另以 original detail 检查文字和图标，未把分开查看称为并排比较。手机快速预览也已直接打开确认控制栏、隐私提示和底部操作。

## 五项视觉表面

- 字体与排版：沿用现有应用字体栈和字号体系。文件库标题、分区标题、标签、文件标题、辅助文件名层级清楚；表格文字可辨，较长文件名截断，不挤压操作列。当前应用的全局品牌和导航比演示稿紧凑，模块标题、表格字号也略小；这是整合现有产品的明确约束，没有声称像素级复制演示稿。
- 间距与布局：四个全局入口保持单层，全部文件/最近使用/收藏/回收站位于模块内，文件夹直接显示在内容区。顶部搜索与上传、横向文件夹、文件列表、右侧约 500 px 预览和完整阅读结构与 V3 一致。全局侧栏保留现有 232 px，而源图是 292 px；主内容获得更宽空间。列表分隔、圆角、选中行和底部提示对齐。小屏预览覆盖模块内容，保留顶端主导航和关闭入口，没有横向溢出。
- 色彩与 tokens：实际品牌色 #6557dc、选中浅紫 #eeecff、分隔线 #e5e3ee，延续现有品牌。源图更亮的蓝紫和整体淡紫底转换为当前应用紫色与白色列表底；选中、悬浮、主按钮和次按钮保持一致语义，文字对比清楚。阅读区淡底与白色纸页分离。
- 图片与资产：使用已有正式灯灯 Logo 和标准图标库；没有手绘 SVG、CSS 画图或将整页图片贴成假界面。PDF 显示来自实际原文件字节的渲染画布，适配宽度和缩放，文档内容真实。图片预览使用原文件，原件与 AI 提取文本分开；未成功提取的图片正确标注“暂无提取文字”。
- 文案与内容：全局和模块入口都显示“文件库”；搜索提示明确“搜索文件名或内容”。选中数量、大小、日期和页数来自真实数据；文本笔记以字数表示。快速预览和完整阅读都提示模型使用脱敏文本或原文，避免将原件预览误解为发送给模型的内容。用于对话只准备附件，等待用户发送消息。

## 比较历史与修复

1. [P1，已修复] 原生 iframe PDF 在内嵌浏览器显示空白，阻断核心阅读。改为 PDF.js 渲染实际文件字节，本地 worker/字体/CMap/wasm 资源随构建发布，加入真实页数、翻页、适宽、缩放和错误态。修复后 quick-preview.png、reader.png 显示真实 PDF 原件，浏览器实际打开并验证缩放和返回。
2. [P2，已修复] 隐藏旧顶部栏后桌面账号入口消失。仅在文件库范围显示侧栏底部账号入口，菜单向上展开。最终 browse.png、quick-preview.png 可见入口；浏览器实际打开菜单确认可用。
3. [P2，已修复] 快速预览的隐私模式只藏在文件设置内，原件与 AI 内容的区别不够明确。增加常驻隐私提示；最终 quick-preview.png 和 mobile-preview.png 均显示“模型使用脱敏文本”。
4. [P2，已修复] 模块与全局导航移动断点不一致。统一到 820 px，375 和 784 px 下检查主导航、表格、预览和底部按钮；横向无溢出。

中间有截图在视口变化的 CSS 动画过程中捕获，以及路由跳转后视口覆盖重置造成的截图裁切；这些捕获无效，最终对照板已经使用稳定视口截图重新生成，不用于通过依据。

## 交互与验证

- 浏览器真实流程：原 PDF 快速预览、完整阅读、缩放、返回；按正文“连贯”搜索得到访谈记录；选中文件用于对话后出现待发送文本附件，没有自动发送消息；桌面账号菜单及移动/平板布局检查。
- 末次控制台检查：无 error/warn。
- 前端：31 个测试文件、248 项测试通过，包含选择/移动/回收站、过期搜索结果、隐私文本、原件显示、PDF 翻页缩放与清理、对话附件只消费一次；生产构建通过。
- 后端：350 项测试、8 项子测试通过，包含组织元数据、账号隔离、正文搜索、隐私附件快照、失败清理、解析失败保留原件、回收站索引及 v24 到 v25 的数据保留迁移。
- git diff --check 通过。
- E2E 规格已更新，但本轮没有执行完整自动 E2E 套件；不能据此声称完整 E2E 或发布检查通过。浏览器验收针对本机网页，不代表已重新构建或安装桌面包。

## Open Questions

没有阻止当前文件库落地的待确认问题。文件用于对话生成的是当时隐私模式下的文本附件快照；后续修改文件不会改写历史附件。既有记忆规则仍可能使用其他已启用资料，当前没有宣称“仅使用所选文件”的独占检索范围。

## Follow-up Polish

- [P3] PDF 可进一步增加可选文本层、页缩略图和页码跳转；当前支持原件逐页阅读和缩放。
- [P3] Word 当前支持原文件下载及 AI 提取文本阅读；没有原生 Word 排版预览。若后续需要完整排版，可增加专门的转换或渲染方案。

## Implementation Checklist

- [x] 保持四项单层全局导航，文件分类和文件夹放在模块内。
- [x] 导入、搜索、收藏、移动、回收站、预览、阅读和选中文件用于对话接入真实数据。
- [x] 原件与 AI 内容分离，并明确隐私模式。
- [x] 最终源图/实现完整对照与聚焦对照已打开检查。
- [x] P0/P1/P2 修复后重新捕获；前后端测试及构建通过。
- [x] 保留本地隔离预览，生产资料未被测试数据改写。

final result: passed
