import { describe, expect, it } from "vitest";
import { buildResumePreviewBlocks } from "./resume-pagination";
import { parseResumeEditor } from "./resume-preview";
import {
  pageIndexForFocus,
  parseResumeLayoutSettings,
  resumePreviewBlockGap,
  resumePreviewContentHeight,
  resumeSpacingStyle,
  shouldHighlightPreviewBlock,
  studioJumpTargets,
  studioPersistLabel,
  studioPersistState
} from "./resume-studio";

describe("resume layout settings", () => {
  it("clamps spacing and keeps one-page off by default", () => {
    expect(parseResumeLayoutSettings(undefined)).toEqual({ spacing: 100, one_page: false });
    expect(parseResumeLayoutSettings({ spacing: 40, one_page: true })).toEqual({
      spacing: 70,
      one_page: true
    });
    expect(parseResumeLayoutSettings({ spacing: 200 })).toEqual({
      spacing: 130,
      one_page: false
    });
  });

  it("maps spacing to preview CSS variables", () => {
    expect(resumeSpacingStyle(75)).toMatchObject({
      "--resume-page-pad": "27px",
      "--resume-section-gap": "8px",
      "--resume-line-height": "1.39"
    });
  });

  it("exposes the studio sheet content height for pagination", () => {
    expect(resumePreviewBlockGap(100)).toBe(10);
    expect(resumePreviewContentHeight(100)).toBe(682);
    expect(resumePreviewContentHeight(100, "compact")).toBe(712);
  });
});

describe("studio orientation helpers", () => {
  it("lists profile, summary, and added modules as jump targets", () => {
    const model = parseResumeEditor(`陈露鑫｜后端工程师

个人优势
「落地」：能把需求做成可上线的服务。

工作经历
示例科技｜后端工程师`);
    expect(studioJumpTargets(model).map((item) => item.label)).toEqual([
      "个人信息",
      "个人概述",
      "个人优势",
      "工作经历"
    ]);
  });

  it("surfaces save and export state in a single label", () => {
    expect(studioPersistState({
      dirty: true,
      saving: false,
      exporting: false,
      hasVersion: true,
      isFinal: false
    })).toBe("unsaved");
    expect(studioPersistLabel("unsaved")).toBe("未保存");
    expect(studioPersistLabel("saved")).toBe("已保存");
    expect(studioPersistLabel("exporting")).toBe("导出中…");
    expect(studioPersistState({
      dirty: true,
      saving: true,
      exporting: false,
      hasVersion: true,
      isFinal: false
    })).toBe("saving");
  });

  it("highlights the summary section when overview is focused", () => {
    const blocks = buildResumePreviewBlocks("负责 AI 产品从 0 到 1。", "classic");
    const summary = blocks.find((block) => block.type !== "title" && "sectionKind" in block && block.sectionKind === "summary");
    expect(summary).toBeTruthy();
    expect(shouldHighlightPreviewBlock(summary!, { section: "summary", label: "个人概述" }, blocks)).toBe(true);
  });

  it("falls back to the title block when overview has no section of its own", () => {
    const blocks = [{ id: "title", type: "title" as const, lane: "full" as const, text: "陈露鑫" }];
    expect(shouldHighlightPreviewBlock(blocks[0], { section: "summary", label: "个人概述" }, blocks)).toBe(true);
  });

  it("turns the preview to the page that holds the focused section", () => {
    const experience = {
      id: "experience-0-heading",
      type: "heading" as const,
      lane: "full" as const,
      sectionKind: "experience" as const,
      sectionId: "experience-0",
      label: "工作与实习经历"
    };
    const pages = [
      [{ id: "title", type: "title" as const, lane: "full" as const, text: "陈露鑫" }],
      [experience]
    ];
    expect(pageIndexForFocus(pages, { section: "title", label: "个人信息" })).toBe(0);
    expect(pageIndexForFocus(pages, { section: "experience", label: "工作经历" })).toBe(1);
  });
});
