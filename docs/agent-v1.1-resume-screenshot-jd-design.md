# BossCopilot 求职 Agent V1.1 设计方案

## 1. 产品目标

本版本聚焦用户上传简历截图并直接粘贴目标岗位 JD 的路径，完成：

1. 简历截图 OCR 与候选人画像提取。
2. 粘贴 JD 的结构化理解。
3. 匹配度评分与缺口分析。
4. 高匹配简历文本生成。
5. 公司业务结构化研究。
6. 面试建议生成。

核心链路：

```text
简历截图 → OCR → 候选人画像
                    \
粘贴 JD → JD 解析 → 匹配分析 → 高匹配简历文本
                    ├────────→ 公司研究
                    └────────→ 面试建议
```

### 1.1 一级信息架构

产品主导航固定为四个模块：

```text
工作台
数据看板
对话
设置
```

- 工作台：上传或确认当前简历、粘贴 JD、发起岗位匹配、简历生成和面试准备。
- 数据看板：展示真实任务次数、最近记录以及后续接入的匹配趋势和高频缺口。
- 对话：承载 Agent 输出、持续追问、简历内容修改和面试模拟。
- 设置：统一维护个人资料、当前简历、求职偏好、Agent 记忆和隐私配置。

“Agent 工具”不作为普通用户的一级模块；工具执行信息仅在对话执行详情中展示。

## 2. 本版本能力基线

- 用户主动提供简历截图和 JD。
- 当前内置工具以读取、分析和文本生成为主。
- 招聘网站接入、投递、沟通、表单填写和文件生成可作为后续工具扩展。
- 公司研究必须基于公开来源，不能用模型记忆伪装成实时研究。
- 不设置独立的事实一致性校验节点；真实性要求作为简历生成规则执行。

## 3. 输入处理

### 3.1 简历截图

支持 PNG、JPG、JPEG、WebP。单张不超过 10MB，允许分批上传多张截图。

处理步骤：

```text
图片校验 → 本地 OCR → 文本合并 → 隐私脱敏 → 画像建议 → 用户保存
```

无法识别或内容过少时，明确提示重新上传清晰截图。多张截图按上传顺序合并，保存前允许用户检查和修改 OCR 文本。

### 3.2 岗位 JD

用户直接在聊天中粘贴 JD。系统从文本中识别岗位、公司、职责、硬性要求、加分项和关键词。JD 默认只作为当前对话上下文，不建立本地职位库。

## 4. 能力分层

### 4.1 内部服务

- `ResumeScreenshotOcrService`：简历图片校验和 OCR。
- `ResumeProfileService`：画像建议、隐私脱敏和简历知识索引。
- `JobDescriptionParser`：JD 文本清理与结构化理解。
- `AttachmentService`：本地附件生命周期。
- `KnowledgeIndexService`：脱敏简历证据检索。

这些能力由输入触发，不交给模型自主决定是否调用。

### 4.2 Agent 工具

| 工具 | 类型 | 作用 |
|---|---|---|
| `analyze_resume_against_jd` | analysis | 匹配度、优势和缺口 |
| `search_resume_evidence` | read_only | 检索简历中的相关经历 |
| `generate_tailored_resume_content` | analysis | 准备并生成高匹配简历文本 |
| `generate_interview_advice` | analysis | 基于 JD 和简历生成面试建议 |
| `research_company` | external_read | 基于公开来源研究公司业务 |

`research_company` 只有在外部搜索与网页读取能力完成后才注册，禁止先以无来源模型回答冒充工具结果。

## 5. 高匹配简历输出

`generate_tailored_resume_content` 输出完整可复制内容，包括：

- 目标岗位标题。
- 职业概要。
- 核心能力。
- 工作经历。
- 项目经历。
- 教育与证书。
- JD 关键词覆盖。
- 仍然存在的岗位缺口。

生成规则：

- 优先展示与 JD 最相关的经历。
- 使用目标岗位常用的专业表达。
- 调整技能、经历和项目的内容顺序。
- 弱化与目标岗位关系低的内容。
- 保持公司、职位、时间和项目主体不变。
- 不生成任何简历文件。

## 6. 面试建议输出

`generate_interview_advice` 输出：

- 候选人定位与自我介绍框架。
- 核心卖点。
- 可能问题及回答方向。
- 可使用的 STAR 经历。
- 技术与业务准备主题。
- 简历弱项和岗位缺口应对。
- 向面试官提出的问题。
- 面试前检查清单。

## 7. 任务路由

### 匹配分析

```text
analyze_resume_against_jd
search_resume_evidence
```

### 高匹配简历

```text
analyze_resume_against_jd
search_resume_evidence
generate_tailored_resume_content
```

### 面试准备

```text
analyze_resume_against_jd
search_resume_evidence
generate_interview_advice
```

### 公司研究

```text
research_company
```

## 8. 工作流节点

```text
user_goal
resume_ocr
resume_parsing
jd_parsing
agent_planning
match_analysis
resume_evidence
company_research
tailored_resume_content
interview_advice
final_response
```

节点按任务需要执行，不要求每个任务走完全部节点。工具失败后停止后续工具调用并向用户说明恢复方式。

## 9. 实施顺序

1. 支持人物画像入口上传简历截图并 OCR。
2. 扩展匹配分析和简历证据检索。
3. 实现高匹配简历文本工具及路由。
4. 实现面试建议工具及路由。
5. 接入有来源的公司公开信息研究能力。
6. 将轻量工作流状态投影逐步升级为真实可恢复编排。
