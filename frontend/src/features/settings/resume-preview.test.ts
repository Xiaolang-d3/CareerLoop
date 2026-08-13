import { describe, expect, it } from "vitest";
import { parseResumePreview, skillTags } from "./resume-preview";

describe("parseResumePreview", () => {
  it("groups common Chinese resume headings into readable sections", () => {
    const sections = parseResumePreview(`小林｜AI 应用开发工程师

工作经历
2024.01 - 至今  星环科技｜前端工程师
负责 Agent 工作台的交付与迭代

项目经历
CareerLoop 面试准备工具
完成简历解析与项目问答流程

核心技能
React、TypeScript、FastAPI、LangGraph`);

    expect(sections.map((section) => section.kind)).toEqual(["summary", "experience", "projects", "skills"]);
    expect(skillTags(sections.find((section) => section.kind === "skills")?.entries || [])).toEqual(["React", "TypeScript", "FastAPI", "LangGraph"]);
  });

  it("splits numbered project-practice headings into a project section", () => {
    const sections = parseResumePreview(`个人概述
3 年 AI 应用开发经验

二、项目 / 实践经历
CareerLoop 求职助手｜2025.03 - 至今
负责简历解析、岗位匹配与面试准备功能

三、教育经历
复旦大学｜计算机科学与技术`);

    expect(sections.map((section) => section.kind)).toEqual(["summary", "projects", "education"]);
    expect(sections.find((section) => section.kind === "projects")?.entries).toEqual([
      ["CareerLoop 求职助手｜2025.03 - 至今", "负责简历解析、岗位匹配与面试准备功能"]
    ]);
  });

  it("extracts projects nested under a combined work-and-project heading", () => {
    const sections = parseResumePreview(`个人优势
具备 AI 工程化全栈交付能力。

工作与项目经历
89Trillion | AI 应用工程师 2025.07 - 2026.04

智能会议总结（Summary）
基于 LangChain 搭建统一 LLM 接入网关。

多端 AI 内容分析平台（TrueOrFalse）
支持文本、图片和音频多模态分析。

教育经历
复旦大学｜计算机科学与技术`);

    expect(sections.map((section) => section.kind)).toEqual(["summary", "experience", "projects", "education"]);
    expect(sections.find((section) => section.kind === "experience")?.entries).toEqual([
      ["89Trillion | AI 应用工程师 2025.07 - 2026.04"]
    ]);
    expect(sections.find((section) => section.kind === "projects")?.entries).toEqual([
      ["智能会议总结（Summary）", "基于 LangChain 搭建统一 LLM 接入网关。"],
      ["多端 AI 内容分析平台（TrueOrFalse）", "支持文本、图片和音频多模态分析。"]
    ]);
  });
});
