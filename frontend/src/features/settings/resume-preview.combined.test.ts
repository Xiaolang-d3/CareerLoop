import { describe, it, expect } from "vitest";
import { parseResumePreview } from "./resume-preview";

const RESUME = `李明
求职方向: AI 应用工程师 电话：13812345678
邮箱：candidate@example.com 英语：CET-6
GitHub：https://github.com/example/candidate
个人优势
「AIGC 与大模型落地能力」：熟练掌握 LangChain 框架、RAG 检索增强、Prompt 工程、多模态 AI 开发，具备
LLM 模型接入、微调优化、结构化输出约束能力，落地会议 AI 问答、智能报告生成等场景，有效提升业务内容产出效
率 60%+。
「AI 工程化全栈交付能力」：熟练使用 Python、FastAPI、Redis、Kafka、gRPC、WebSocket、Docker 等技术栈，
擅长实时语音链路、分布式服务架构、缓存优化与任务调度，可独立完成 AI 功能从开发、调优、排障到上线的全流
程工程化交付。
「产品从 0 到 1 落地迭代能力」：具备完整 AI 产品设计与开发思维，拥有两款 AI 应用从零搭建至上线谷歌商
店的实战经验，擅长需求拆解、性能迭代、线上运维与跨团队协作，侧重业务落地与高可用服务搭建。
工作与项目经历
星河科技（北京星河科技有限公司）-AI 应用开发工程师 2025.07 - 2026.04 智能会议总结（Summary） https://example.com/apps/summary
- 基于 LangChain 搭建统一 LLM 接入网关，标准化封装模型调用逻辑，兼容多厂商大模型。
- 搭建 RAG 会议问答流水线，优化混合检索策略，问答准确率由 68% 提升至 90%。
智能内容分析平台(True or False) https://example.com/apps/analysis
- 基于 LangChain 搭建文本、图片、音频多模态统一分析链路。
- 实现语义自动标签模块，内容分类准确率达 93%。
云端科技-测试开发工程师 2025.03 - 2025.05
- 负责 100+ 款鸿蒙应用兼容性比对测试，累计定位 30+ 项异常问题。
教育经历
示例大学 软件工程专业 2021.09-2025.6
校级数据库应用与开发比赛 银奖`;

describe("复合工作标题解析（回归：简历提取错位）", () => {
  it("同一行粘连的公司、项目名和链接仍会拆成工作区与项目区", () => {
    const sections = parseResumePreview(RESUME);
    const experience = sections.find((section) => section.kind === "experience");
    const projects = sections.find((section) => section.kind === "projects");

    expect(experience?.label).toBe("工作经历");
    expect(experience?.entries).toEqual([
      ["星河科技（北京星河科技有限公司）-AI 应用开发工程师 2025.07 - 2026.04"],
      ["云端科技-测试开发工程师 2025.03 - 2025.05", "负责 100+ 款鸿蒙应用兼容性比对测试，累计定位 30+ 项异常问题。"]
    ]);
    expect(projects?.entries.map((entry) => entry[0])).toEqual([
      "智能会议总结（Summary） https://example.com/apps/summary",
      "智能内容分析平台(True or False) https://example.com/apps/analysis"
    ]);
    expect(projects?.entries.flat().join("")).not.toContain("星河科技");
    expect(projects?.entries.flat().join("")).not.toContain("云端科技");
  });

  it("「工作与项目经历」标题仍拆分为工作 + 项目两段（既有行为回归）", () => {
    const sections = parseResumePreview(RESUME);
    expect(sections.map((section) => section.kind)).toEqual(
      expect.arrayContaining(["experience", "projects"])
    );
    const experience = sections.find((section) => section.kind === "experience");
    expect(experience?.entries[0][0]).toContain("星河科技");
  });

  it("「工作经历」等单标题不受影响", () => {
    const sections = parseResumePreview(RESUME.replace("工作与项目经历", "工作经历"));
    expect(sections.find((section) => section.kind === "experience")).toBeDefined();
  });
});
