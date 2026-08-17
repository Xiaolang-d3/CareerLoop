import { describe, expect, it } from "vitest";
import {
  buildResumePreviewBlocks,
  estimateResumePreviewHeights,
  paginateResumePreview
} from "./resume-pagination";
import {
  addResumeModule,
  composeResumeEditor,
  moveResumeModule,
  parseResumeEditor,
  parseResumePreview,
  projectOrdinalLabel,
  removeResumeModule,
  skillTags,
  splitDocumentName,
  splitEntryHeading,
  splitResumeLayout,
  updateResumeModule
} from "./resume-preview";
import { resumePreviewBlockGap, resumePreviewContentHeight } from "./resume-studio";

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

    expect(sections.map((section) => section.kind)).toEqual(["strengths", "experience", "projects", "education"]);
    expect(sections.find((section) => section.kind === "strengths")?.entries).toEqual([
      ["具备 AI 工程化全栈交付能力。"]
    ]);
    expect(sections.find((section) => section.kind === "experience")?.entries).toEqual([
      ["89Trillion | AI 应用工程师 2025.07 - 2026.04"]
    ]);
    expect(sections.find((section) => section.kind === "projects")?.entries).toEqual([
      ["智能会议总结（Summary）", "基于 LangChain 搭建统一 LLM 接入网关。"],
      ["多端 AI 内容分析平台（TrueOrFalse）", "支持文本、图片和音频多模态分析。"]
    ]);
  });

  it("rejoins mid-sentence PDF wraps without merging headings", () => {
    const sections = parseResumePreview(`个人优势
熟悉 Python / FastAPI / Docker 等技术栈，
擅长实时语音链路与多模型协同。
独立完成业务内容生产链路，有效提升业务内容产出效
率 60%+
工作经历
某公司
AI 应用工程师`);

    const strengths = sections.find((section) => section.kind === "strengths")?.entries.flat().join("\n") || "";
    expect(strengths).toContain("Docker 等技术栈，擅长实时语音链路与多模型协同。");
    expect(strengths).toContain("产出效率 60%+");
    expect(sections.find((section) => section.kind === "summary")).toBeUndefined();
    expect(sections.find((section) => section.kind === "experience")?.entries.flat()).toEqual([
      "某公司",
      "AI 应用工程师"
    ]);
  });

  it("splits consecutive project titles into separate project entries", () => {
    const sections = parseResumePreview(`项目经历
智能会议总结（Summary）
基于 LangChain 搭建统一 LLM 接入网关。
负责实时语音处理链路开发。
多端 AI 内容分析平台（TrueOrFalse）
搭建文本、图片和音频多模态分析链路。
支持场景化 Prompt 模板迭代。`);

    expect(sections.find((section) => section.kind === "projects")?.entries).toEqual([
      ["智能会议总结（Summary）", "基于 LangChain 搭建统一 LLM 接入网关。", "负责实时语音处理链路开发。"],
      ["多端 AI 内容分析平台（TrueOrFalse）", "搭建文本、图片和音频多模态分析链路。", "支持场景化 Prompt 模板迭代。"]
    ]);
    expect(projectOrdinalLabel(0)).toBe("项目一");
    expect(projectOrdinalLabel(1)).toBe("项目二");
  });

  it("keeps education school/dates as the heading and awards as separate lines", () => {
    const sections = parseResumePreview(`教育经历
复旦大学｜计算机科学与技术｜2018.09-2022.06
国家奖学金、校级优秀毕业生

项目经历
CareerLoop 求职助手
完成简历解析与岗位匹配`);

    expect(sections.find((section) => section.kind === "education")?.entries).toEqual([
      ["复旦大学｜计算机科学与技术｜2018.09-2022.06", "国家奖学金", "校级优秀毕业生"]
    ]);
  });

  it("splits three titled capability paragraphs into 个人优势 entries", () => {
    const sections = parseResumePreview(`陈露鑫｜AI 应用工程师
GitHub：https://github.com/example
电话：13800138000

「AIGC 与大模型落地能力」：熟练掌握 LangChain、Prompt 工程与多模型协同。
「AI 工程化全栈交付能力」：能独立完成从接口、编排到前端工作台的交付。
「产品从 0 到 1 落地迭代能力」：从需求拆解到上线闭环，带过完整产品。

工作经历
示例科技｜AI 应用工程师｜2024.01 - 至今
负责 Agent 工作台交付`);

    const summary = sections.find((section) => section.kind === "summary")?.entries.flat().join("\n") || "";
    const strengths = sections.find((section) => section.kind === "strengths");
    expect(strengths?.label).toBe("个人优势");
    expect(strengths?.entries).toEqual([
      ["「AIGC 与大模型落地能力」", "熟练掌握 LangChain、Prompt 工程与多模型协同。"],
      ["「AI 工程化全栈交付能力」", "能独立完成从接口、编排到前端工作台的交付。"],
      ["「产品从 0 到 1 落地迭代能力」", "从需求拆解到上线闭环，带过完整产品。"]
    ]);
    expect(summary).not.toContain("AIGC 与大模型落地能力");
    expect(summary).not.toContain("AI 工程化全栈交付能力");
    expect(summary).not.toContain("产品从 0 到 1 落地迭代能力");
    expect(sections.find((section) => section.kind === "experience")?.entries[0][0]).toContain("示例科技");
  });

  it("splits three titled capabilities jammed into one summary paragraph", () => {
    const sections = parseResumePreview(`陈露鑫｜AI 应用工程师
GitHub：https://github.com/example
「AIGC 与大模型落地能力」：熟练掌握 LangChain。「AI 工程化全栈交付能力」：独立完成全栈交付。「产品从 0 到 1 落地迭代能力」：从需求到上线闭环。
工作经历
示例科技`);

    expect(sections.find((section) => section.kind === "strengths")?.entries).toEqual([
      ["「AIGC 与大模型落地能力」", "熟练掌握 LangChain。"],
      ["「AI 工程化全栈交付能力」", "独立完成全栈交付。"],
      ["「产品从 0 到 1 落地迭代能力」", "从需求到上线闭环。"]
    ]);
    expect(sections.find((section) => section.kind === "summary")?.entries.flat().join("\n") || "").not.toContain("AIGC");
  });

  it("splits awards jammed onto an education heading line", () => {
    const sections = parseResumePreview(`教育经历
复旦大学 计算机科学与技术 2018.09-2022.06国家奖学金校级优秀毕业生`);

    expect(sections.find((section) => section.kind === "education")?.entries).toEqual([
      ["复旦大学 计算机科学与技术 2018.09-2022.06", "国家奖学金", "校级优秀毕业生"]
    ]);
  });
});

describe("splitEntryHeading", () => {
  it("pulls trailing and leading dates off experience titles", () => {
    expect(splitEntryHeading("89Trillion | AI 应用工程师 2025.07 - 2026.04")).toEqual({
      title: "89Trillion | AI 应用工程师",
      date: "2025.07 - 2026.04"
    });
    expect(splitEntryHeading("2024.01 - 至今  星环科技｜前端工程师")).toEqual({
      title: "星环科技｜前端工程师",
      date: "2024.01 - 至今"
    });
    expect(splitDocumentName("陈露鑫｜AI 应用工程师")).toEqual({
      name: "陈露鑫",
      role: "AI 应用工程师"
    });
  });
});

describe("splitResumeLayout", () => {
  it("keeps a hash title and a following name line as one header", () => {
    const layout = splitResumeLayout(`# 小程

小程
GitHub：https://github.com/example
求职意向：AI应用工程师

个人优势
「AIGC 与大模型落地能力」：熟练掌握 LangChain。

工作经历
示例科技｜AI 应用工程师`);

    expect(layout.title).toBe("小程");
    expect(layout.contact.join("\n")).toContain("github.com/example");
    expect(layout.target).toBe("AI应用工程师");
    expect(layout.sections.map((section) => section.kind)).toEqual(["strengths", "experience"]);
    expect(layout.sections.some((section) => section.kind === "summary")).toBe(false);
    expect(layout.sections.flatMap((section) => section.entries.flat()).join("\n")).not.toContain("小程");
  });

  it("drops a leftover name line even when the first section is not summary", () => {
    const layout = splitResumeLayout(`# 小程
小程
求职意向：AI应用工程师

个人优势
「AIGC 与大模型落地能力」：熟练掌握 LangChain。

项目经历
智能会议总结（Summary）
将新模型接入周期由
3
天缩短至 4h。`);

    expect(layout.title).toBe("小程");
    expect(layout.sections.flatMap((section) => section.entries.flat()).filter((line) => line.includes("小程"))).toEqual([]);
    expect(layout.sections.find((section) => section.kind === "projects")?.entries.flat().join("")).toContain("由3天缩短至 4h");
  });

  it("puts skills and education in the compact sidebar", () => {
    const layout = splitResumeLayout(`陈露鑫｜后端工程师

工作经历
示例科技｜后端工程师
负责接口与任务调度

项目经历
CareerLoop 求职助手
完成简历解析与岗位匹配

核心技能
Python、FastAPI、PostgreSQL

教育经历
复旦大学｜计算机科学与技术`);

    expect(layout.title).toBe("陈露鑫｜后端工程师");
    expect(layout.sidebar.map((section) => section.kind)).toEqual(["skills", "education"]);
    expect(layout.main.map((section) => section.kind)).toEqual(["experience", "projects"]);
  });
});

describe("parseResumeEditor", () => {
  it("turns a resume into editable modules and can write them back", () => {
    const source = `陈露鑫｜后端工程师

工作经历
示例科技｜后端工程师
负责接口与任务调度

核心技能
Python、FastAPI、PostgreSQL

教育经历
复旦大学｜计算机科学与技术`;
    const model = parseResumeEditor(source);

    expect(model.profile.title).toBe("陈露鑫｜后端工程师");
    expect(model.modules.map((item) => item.kind)).toEqual(["experience", "skills", "education"]);
    expect(model.modules.find((item) => item.kind === "experience")?.body).toContain("示例科技｜后端工程师");
    expect(model.modules.find((item) => item.kind === "skills")?.body).toContain("Python、FastAPI、PostgreSQL");
    expect(model.modules.find((item) => item.kind === "education")?.body).toContain("复旦大学｜计算机科学与技术");

    const composed = composeResumeEditor(updateResumeModule(model, "skills", { body: "Python、FastAPI" }));
    expect(composed).toContain("陈露鑫｜后端工程师");
    expect(composed).toContain("工作经历\n示例科技｜后端工程师");
    expect(composed).toContain("相关技能\nPython、FastAPI");
    expect(composed).not.toContain("PostgreSQL");
  });

  it("roundtrips a custom module and reordered sections", () => {
    const source = `陈露鑫｜后端工程师
电话：13800138000
求职意向：后端工程师

3 年 AI 应用开发经验

项目经历
CareerLoop 求职助手

工作经历
示例科技｜后端工程师

## 开源贡献
维护内部工具`;
    const model = parseResumeEditor(source);

    expect(model.profile.title).toBe("陈露鑫｜后端工程师");
    expect(model.profile.contact).toContain("13800138000");
    expect(model.profile.target).toBe("后端工程师");
    expect(model.profile.summary).toContain("3 年 AI 应用开发经验");
    expect(model.modules.map((item) => item.kind)).toEqual(["projects", "experience", "custom"]);
    expect(model.modules[2]).toMatchObject({ label: "开源贡献", body: "维护内部工具" });

    const composed = composeResumeEditor(model);
    expect(composed.indexOf("项目经历")).toBeLessThan(composed.indexOf("工作经历"));
    expect(composed).toContain("## 开源贡献\n维护内部工具");
    expect(composed).toContain("求职意向：后端工程师");

    const again = parseResumeEditor(composed);
    expect(again.modules.map((item) => item.heading)).toEqual(["项目经历", "工作经历", "开源贡献"]);
    expect(again.profile.contact).toContain("13800138000");
    expect(composeResumeEditor(again)).toBe(composed);
  });

  it("can add, remove, and reorder modules in the editor model", () => {
    const model = parseResumeEditor("陈露鑫｜后端工程师\n\n工作经历\n示例科技");
    const withProjects = addResumeModule(model, "projects");
    expect(withProjects.modules.map((item) => item.kind)).toEqual(["experience", "projects"]);

    const moved = moveResumeModule(withProjects, "experience", 1);
    expect(moved.modules.map((item) => item.kind)).toEqual(["projects", "experience"]);
    expect(composeResumeEditor(updateResumeModule(moved, "projects", { body: "CareerLoop" }))).toMatch(
      /项目经历\nCareerLoop[\s\S]*工作经历\n示例科技/
    );

    const removed = removeResumeModule(moved, "projects");
    expect(removed.modules.map((item) => item.kind)).toEqual(["experience"]);
    expect(composeResumeEditor(removed)).not.toContain("项目经历");
  });

  it("roundtrips titled capabilities as a 个人优势 module", () => {
    const source = `陈露鑫｜AI 应用工程师
GitHub：https://github.com/example
电话：13800138000

「AIGC 与大模型落地能力」：熟练掌握 LangChain、Prompt 工程与多模型协同。
「AI 工程化全栈交付能力」：能独立完成从接口、编排到前端工作台的交付。
「产品从 0 到 1 落地迭代能力」：从需求拆解到上线闭环，带过完整产品。

工作经历
示例科技｜AI 应用工程师`;
    const model = parseResumeEditor(source);

    expect(model.profile.title).toBe("陈露鑫｜AI 应用工程师");
    expect(model.profile.contact).toContain("github.com/example");
    expect(model.profile.contact).toContain("13800138000");
    expect(model.profile.summary).not.toContain("AIGC 与大模型落地能力");
    expect(model.profile.summary).not.toContain("AI 工程化全栈交付能力");
    expect(model.profile.summary).not.toContain("产品从 0 到 1");
    expect(model.modules.map((item) => item.kind)).toEqual(["strengths", "experience"]);
    expect(model.modules[0]).toMatchObject({ label: "个人优势", heading: "个人优势" });
    expect(model.modules[0].body).toContain("「AIGC 与大模型落地能力」");
    expect(model.modules[0].body).toContain("「AI 工程化全栈交付能力」");
    expect(model.modules[0].body).toContain("「产品从 0 到 1 落地迭代能力」");

    const composed = composeResumeEditor(model);
    expect(composed).toContain("个人优势\n「AIGC 与大模型落地能力」");
    expect(composed.indexOf("个人优势")).toBeLessThan(composed.indexOf("工作经历"));

    const again = parseResumeEditor(composed);
    expect(again.modules.map((item) => item.kind)).toEqual(["strengths", "experience"]);
    expect(again.profile.summary).not.toContain("AIGC 与大模型落地能力");
    expect(composeResumeEditor(again)).toBe(composed);
    expect(parseResumePreview(composed).find((section) => section.kind === "strengths")?.entries).toHaveLength(3);
  });

  it("drops a repeated name line after a hash title", () => {
    const model = parseResumeEditor(`# 小程

小程
求职意向：AI应用工程师

工作经历
示例科技`);

    expect(model.profile.title).toBe("小程");
    expect(model.profile.target).toBe("AI应用工程师");
    expect(model.profile.summary).not.toContain("小程");
    expect(composeResumeEditor(model).split("\n").filter((line) => line.trim() === "小程")).toHaveLength(1);
  });

  it("keeps language certificates out of the contact field", () => {
    const source = `小程
邮箱: [邮箱已隐藏] 英语: CET-6GitHub: https://github.com/Xiaolang-d3
求职意向：后端工程师

工作经历
示例科技`;
    const model = parseResumeEditor(source);

    expect(model.profile.title).toBe("小程");
    expect(model.profile.contact).toContain("邮箱");
    expect(model.profile.contact).toContain("github.com/Xiaolang-d3");
    expect(model.profile.contact).not.toMatch(/CET|英语/);
    expect(model.profile.target).toBe("后端工程师");
    expect(model.modules.find((item) => item.kind === "honors")?.body).toMatch(/CET-?6/);
  });
});

describe("paginateResumePreview", () => {
  it("moves overflow blocks onto the next page and keeps headings with entries", () => {
    expect(paginateResumePreview([
      { id: "a", height: 400 },
      { id: "b", height: 400 }
    ], 600).map((page) => page.map((block) => block.id))).toEqual([["a"], ["b"]]);

    expect(paginateResumePreview([
      { id: "h1", height: 40, keepWithNext: true },
      { id: "e1", height: 80 },
      { id: "h2", height: 40, keepWithNext: true },
      { id: "e2", height: 80 }
    ], 150).map((page) => page.map((block) => block.id))).toEqual([["h1", "e1"], ["h2", "e2"]]);

    expect(paginateResumePreview([
      { id: "big", height: 900 },
      { id: "tail", height: 40 }
    ], 600).map((page) => page.map((block) => block.id))).toEqual([["big"], ["tail"]]);
  });

  it("paginates compact sidebar and main on independent columns", () => {
    const pages = paginateResumePreview([
      { id: "title", height: 40, lane: "full" as const },
      { id: "skill-h", height: 30, lane: "sidebar" as const, keepWithNext: true, type: "heading" as const, sectionKind: "skills" as const },
      { id: "skill", height: 50, lane: "sidebar" as const, type: "skills" as const, sectionKind: "skills" as const },
      { id: "m1", height: 400, lane: "main" as const, type: "entry" as const, sectionKind: "experience" as const },
      { id: "m2", height: 400, lane: "main" as const, type: "entry" as const, sectionKind: "experience" as const }
    ], 500);
    expect(pages[0].map((block) => block.id)).toEqual(["title", "skill-h", "skill", "m1"]);
    expect(pages[1].map((block) => block.id)).toEqual(["m2"]);
  });

  it("estimates two pages for a long resume without measuring the DOM", () => {
    const entries = Array.from({ length: 8 }, (_, index) => (
      `示例科技｜后端工程师｜202${index}.01 - 202${index}.12\n负责接口与任务调度，完成服务治理与监控。\n推动单元测试与持续集成。\n协作产品完成需求拆解与上线。`
    )).join("\n\n");
    const content = `陈露鑫｜后端工程师\n\n工作经历\n${entries}\n\n项目经历\n${entries}`;
    const pages = paginateResumePreview(
      estimateResumePreviewHeights(buildResumePreviewBlocks(content, "classic")),
      resumePreviewContentHeight(100),
      { gap: resumePreviewBlockGap(100) }
    );
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });
});
