import type { CSSProperties } from "react";
import type { ResumeLayoutSettings, ResumeStyle, ResumeTemplate } from "../../types";
import type { ResumeEditorModel, ResumeModuleKind, ResumePreviewKind } from "./resume-preview";
import type { ResumePreviewBlock } from "./resume-pagination";

type ResumeSpacingStyle = CSSProperties & Record<`--resume-${string}`, string>;

export const RESUME_LAYOUTS: Array<{ id: ResumeTemplate; name: string; note: string }> = [
  { id: "classic", name: "专业单栏", note: "适合网申" },
  { id: "compact", name: "技术紧凑", note: "技能放侧栏" },
  { id: "minimal", name: "极简单栏", note: "留白更多" }
];

export const DEFAULT_RESUME_LAYOUT: ResumeLayoutSettings = {
  spacing: 100,
  one_page: false
};

export const RESUME_SPACING_MIN = 70;
export const RESUME_SPACING_MAX = 130;
/** Studio preview sheet height; matches `.resume-studio-canvas .resume-paper` min-height. */
export const RESUME_PREVIEW_PAGE_HEIGHT = 760;
/** Studio one-page lock; matches `.resume-studio-canvas .resume-paper.is-one-page`. */
export const RESUME_PREVIEW_ONE_PAGE_HEIGHT = 764;

function cssPx(value: string | number | undefined) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resumePreviewBlockGap(spacing: number) {
  return cssPx(resumeSpacingStyle(spacing)["--resume-section-gap"]);
}

export function resumePreviewContentHeight(spacing: number, templateId: ResumeTemplate = "classic") {
  const style = resumeSpacingStyle(spacing);
  const compact = templateId === "compact";
  const top = cssPx(compact ? style["--resume-compact-pad"] : style["--resume-page-pad"]);
  const bottom = cssPx(compact ? style["--resume-compact-pad-bottom"] : style["--resume-page-pad-bottom"]);
  return Math.max(1, RESUME_PREVIEW_PAGE_HEIGHT - top - bottom);
}

export function parseResumeLayoutSettings(value: unknown): ResumeLayoutSettings {
  const data = value && typeof value === "object" ? value as Partial<ResumeLayoutSettings> : {};
  const spacing = Number(data.spacing);
  return {
    spacing: Number.isFinite(spacing)
      ? Math.min(RESUME_SPACING_MAX, Math.max(RESUME_SPACING_MIN, Math.round(spacing)))
      : DEFAULT_RESUME_LAYOUT.spacing,
    one_page: Boolean(data.one_page)
  };
}

export function resumeSpacingStyle(spacing: number): ResumeSpacingStyle {
  const scale = parseResumeLayoutSettings({ spacing }).spacing / 100;
  return {
    "--resume-page-pad": `${Math.round(36 * scale)}px`,
    "--resume-page-pad-x": `${Math.round(38 * scale)}px`,
    "--resume-page-pad-bottom": `${Math.round(42 * scale)}px`,
    "--resume-para-gap": `${Math.round(5 * scale)}px`,
    "--resume-body-size": `${(12 + 0.6 * scale).toFixed(1)}px`,
    "--resume-line-height": (1.22 + 0.22 * scale).toFixed(2),
    "--resume-title-gap": `${Math.round(12 * scale)}px`,
    "--resume-title-size": `${Math.round(21 + 2 * scale)}px`,
    "--resume-section-top": `${Math.round(14 * scale)}px`,
    "--resume-section-bottom": `${Math.round(6 * scale)}px`,
    "--resume-heading-size": `${(12.5 + 0.8 * scale).toFixed(1)}px`,
    "--resume-section-gap": `${Math.round(10 * scale)}px`,
    "--resume-compact-pad": `${Math.round(22 * scale)}px`,
    "--resume-compact-pad-x": `${Math.round(20 * scale)}px`,
    "--resume-compact-pad-bottom": `${Math.round(26 * scale)}px`
  } as ResumeSpacingStyle;
}

export const RESUME_STYLES: Array<{ id: ResumeStyle; name: string; note: string }> = [
  { id: "navy", name: "藏青商务", note: "稳妥，适合大多数岗位" },
  { id: "forest", name: "松绿稳重", note: "产品和运营常用" },
  { id: "ink", name: "墨黑衬线", note: "更克制的人文风" },
  { id: "wine", name: "酒红专业", note: "咨询和职能岗" }
];

export type StudioPreviewFocus = {
  section: ResumePreviewKind | "title";
  label?: string;
};

export type StudioJumpTarget = {
  id: string;
  label: string;
  focus: StudioPreviewFocus;
};

export type StudioPersistState = "unsaved" | "saving" | "exporting" | "saved" | "final" | "none";

export function previewSectionForModule(kind: ResumeModuleKind): ResumePreviewKind {
  return kind === "custom" ? "other" : kind;
}

export function studioJumpTargets(model: ResumeEditorModel): StudioJumpTarget[] {
  return [
    { id: "profile", label: "个人信息", focus: { section: "title", label: "个人信息" } },
    { id: "summary", label: "个人概述", focus: { section: "summary", label: "个人概述" } },
    ...model.modules.map((item) => ({
      id: item.id,
      label: item.label,
      focus: { section: previewSectionForModule(item.kind), label: item.label }
    }))
  ];
}

export function studioPersistState(input: {
  dirty: boolean;
  saving: boolean;
  exporting: boolean;
  hasVersion: boolean;
  isFinal: boolean;
}): StudioPersistState {
  if (input.saving) return "saving";
  if (input.exporting) return "exporting";
  if (input.dirty) return "unsaved";
  if (input.isFinal) return "final";
  if (input.hasVersion) return "saved";
  return "none";
}

export function studioPersistLabel(state: StudioPersistState) {
  switch (state) {
    case "unsaved":
      return "未保存";
    case "saving":
      return "保存中…";
    case "exporting":
      return "导出中…";
    case "saved":
      return "已保存";
    case "final":
      return "最终版";
    default:
      return "";
  }
}

export function blockMatchesFocus(block: ResumePreviewBlock, focus: StudioPreviewFocus) {
  if (focus.section === "title") return block.type === "title";
  if (block.type === "title") return false;
  if (focus.label && block.type === "heading" && block.label === focus.label) return true;
  return block.sectionKind === focus.section;
}

export function shouldHighlightPreviewBlock(
  block: ResumePreviewBlock,
  focus: StudioPreviewFocus | null,
  blocks: ResumePreviewBlock[]
) {
  if (!focus) return false;
  if (blockMatchesFocus(block, focus)) return true;
  if (block.type === "title" && focus.section === "summary") {
    return !blocks.some((item) => item !== block && blockMatchesFocus(item, focus));
  }
  return false;
}

export function shouldHighlightPreviewGroup(
  items: ResumePreviewBlock[],
  focus: StudioPreviewFocus | null,
  blocks: ResumePreviewBlock[]
) {
  return items.some((item) => shouldHighlightPreviewBlock(item, focus, blocks));
}

export function pageIndexForFocus(
  pages: ResumePreviewBlock[][],
  focus: StudioPreviewFocus | null
) {
  if (!focus || !pages.length) return 0;
  const all = pages.flat();
  const index = pages.findIndex((page) => (
    page.some((block) => shouldHighlightPreviewBlock(block, focus, all))
  ));
  return index < 0 ? 0 : index;
}
