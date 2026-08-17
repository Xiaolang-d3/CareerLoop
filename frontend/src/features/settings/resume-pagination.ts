import type { ResumeTemplate } from "../../types";
import { skillTags, splitResumeLayout, type ResumePreviewKind, type ResumePreviewSection } from "./resume-preview";

export type ResumePreviewLane = "full" | "sidebar" | "main";

export type ResumePreviewBlock =
  | { id: string; type: "title"; lane: "full"; text: string; contact?: string[]; target?: string }
  | { id: string; type: "heading"; lane: ResumePreviewLane; sectionKind: ResumePreviewKind; sectionId?: string; label: string }
  | { id: string; type: "entry"; lane: ResumePreviewLane; sectionKind: ResumePreviewKind; sectionId?: string; lines: string[] }
  | { id: string; type: "skills"; lane: ResumePreviewLane; sectionKind: ResumePreviewKind; sectionId?: string; tags: string[] };

export type ResumePageItem = {
  id: string;
  height: number;
  lane?: ResumePreviewLane;
  keepWithNext?: boolean;
  type?: ResumePreviewBlock["type"];
  sectionKind?: ResumePreviewKind;
  sectionId?: string;
};

export type MeasuredResumeBlock = ResumePreviewBlock & {
  height: number;
  keepWithNext?: boolean;
};

function laneOf(block: ResumePageItem): ResumePreviewLane {
  return block.lane ?? "full";
}

function takeBlocks<T extends ResumePageItem>(blocks: T[], budget: number, gap: number): { taken: T[]; rest: T[] } {
  const taken: T[] = [];
  let used = 0;
  const limit = Math.max(1, budget);

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const height = Math.max(0, block.height);
    const next = blocks[index + 1];
    const leading = taken.length ? gap : 0;
    const pair = block.keepWithNext && next
      ? height + gap + Math.max(0, next.height)
      : height;

    if (taken.length && block.keepWithNext && next && used + leading + pair > limit) {
      return { taken, rest: blocks.slice(index) };
    }
    if (taken.length && used + leading + height > limit) {
      return { taken, rest: blocks.slice(index) };
    }

    taken.push(block);
    used += leading + height;
  }

  return { taken, rest: [] };
}

function paginateLinear<T extends ResumePageItem>(blocks: T[], pageHeight: number, gap: number): T[][] {
  const pages: T[][] = [];
  let current: T[] = [];
  let used = 0;

  const flush = () => {
    if (current.length) pages.push(current);
    current = [];
    used = 0;
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const height = Math.max(0, block.height);
    const next = blocks[index + 1];
    const leading = current.length ? gap : 0;
    const pair = block.keepWithNext && next
      ? height + gap + Math.max(0, next.height)
      : height;

    if (current.length && block.keepWithNext && next && used + leading + pair > pageHeight) {
      flush();
    } else if (current.length && used + leading + height > pageHeight) {
      flush();
    }

    current.push(block);
    used += (current.length > 1 ? gap : 0) + height;
  }

  flush();
  return pages.length ? pages : [[]];
}

function attachContinuedHeadings<T extends ResumePageItem>(pages: T[][], all: T[]): T[][] {
  return pages.map((page, pageIndex) => {
    if (pageIndex === 0) return page;
    const extras: T[] = [];
    const seen = new Set<string>();
    for (const block of page) {
      if (block.type !== "entry" && block.type !== "skills") continue;
      const key = `${laneOf(block)}:${block.sectionId ?? block.sectionKind ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hasHeading = page.some((item) => (
        item.type === "heading"
        && laneOf(item) === laneOf(block)
        && (item.sectionId ?? item.sectionKind) === (block.sectionId ?? block.sectionKind)
      ));
      if (hasHeading) continue;
      const heading = all.find((item) => (
        item.type === "heading"
        && laneOf(item) === laneOf(block)
        && (item.sectionId ?? item.sectionKind) === (block.sectionId ?? block.sectionKind)
      ));
      if (heading) extras.push(heading);
    }
    return extras.length ? [...extras, ...page] : page;
  });
}

export function paginateResumePreview<T extends ResumePageItem>(
  blocks: T[],
  pageHeight: number,
  options: { gap?: number } = {}
): T[][] {
  const gap = Math.max(0, options.gap ?? 0);
  const limit = Math.max(1, pageHeight);
  const hasColumns = blocks.some((block) => laneOf(block) === "sidebar")
    && blocks.some((block) => laneOf(block) === "main");

  if (!hasColumns) {
    return attachContinuedHeadings(paginateLinear(blocks, limit, gap), blocks);
  }

  const title = blocks.filter((block) => laneOf(block) === "full");
  let sideRest = blocks.filter((block) => laneOf(block) === "sidebar");
  let mainRest = blocks.filter((block) => laneOf(block) === "main");
  let titleRest = title;
  const pages: T[][] = [];
  let first = true;

  while (titleRest.length || sideRest.length || mainRest.length) {
    const titleHeight = first
      ? titleRest.reduce((sum, block) => sum + Math.max(0, block.height), 0) + (titleRest.length && (sideRest.length || mainRest.length) ? gap : 0)
      : 0;
    const budget = Math.max(1, limit - titleHeight);
    let { taken: sideTaken, rest: nextSide } = takeBlocks(sideRest, budget, gap);
    let { taken: mainTaken, rest: nextMain } = takeBlocks(mainRest, budget, gap);

    if (!sideTaken.length && !mainTaken.length) {
      if (sideRest.length) {
        sideTaken = [sideRest[0]];
        nextSide = sideRest.slice(1);
      } else if (mainRest.length) {
        mainTaken = [mainRest[0]];
        nextMain = mainRest.slice(1);
      } else {
        break;
      }
    }

    pages.push([
      ...(first ? titleRest : []),
      ...sideTaken,
      ...mainTaken
    ]);
    titleRest = [];
    sideRest = nextSide;
    mainRest = nextMain;
    first = false;
  }

  return attachContinuedHeadings(pages.length ? pages : [[]], blocks);
}

function pushSection(blocks: ResumePreviewBlock[], section: ResumePreviewSection, lane: ResumePreviewLane, ordinal: number) {
  const sectionId = `${section.kind}-${ordinal}`;
  blocks.push({
    id: `${sectionId}-heading`,
    type: "heading",
    lane,
    sectionKind: section.kind,
    sectionId,
    label: section.label
  });
  if (section.kind === "skills") {
    blocks.push({
      id: `${sectionId}-skills`,
      type: "skills",
      lane,
      sectionKind: section.kind,
      sectionId,
      tags: skillTags(section.entries)
    });
    return;
  }
  section.entries.forEach((lines, index) => {
    blocks.push({
      id: `${sectionId}-entry-${index}`,
      type: "entry",
      lane,
      sectionKind: section.kind,
      sectionId,
      lines
    });
  });
}

export function buildResumePreviewBlocks(content: string, templateId: ResumeTemplate): ResumePreviewBlock[] {
  const layout = splitResumeLayout(content);
  const compactColumns = templateId === "compact" && layout.sidebar.length > 0 && layout.main.length > 0;
  const blocks: ResumePreviewBlock[] = [];

  if (layout.title || layout.contact.length || layout.target) {
    blocks.push({
      id: "title",
      type: "title",
      lane: "full",
      text: layout.title,
      contact: layout.contact,
      target: layout.target
    });
  }

  if (compactColumns) {
    layout.sidebar.forEach((section, index) => pushSection(blocks, section, "sidebar", index));
    layout.main.forEach((section, index) => pushSection(blocks, section, "main", index + layout.sidebar.length));
    return blocks;
  }

  layout.sections.forEach((section, index) => pushSection(blocks, section, "full", index));
  return blocks;
}

export function estimateResumePreviewHeights(
  blocks: ResumePreviewBlock[],
  spacing = 100
): MeasuredResumeBlock[] {
  const scale = Math.max(0.7, spacing / 100);
  const line = Math.round(18 + 6 * scale);
  const heading = Math.round(28 + 8 * scale);
  const title = Math.round(32 + 10 * scale);
  const chip = Math.round(20 * scale);

  return blocks.map((block) => {
    if (block.type === "title") {
      const extra = ((block.contact?.length ? 1 : 0) + (block.target ? 1 : 0)) * Math.round(16 * scale);
      return { ...block, height: title + extra };
    }
    if (block.type === "heading") return { ...block, height: heading, keepWithNext: true };
    if (block.type === "skills") {
      return { ...block, height: Math.max(1, Math.ceil(block.tags.length / 3)) * chip + 6 };
    }
    return { ...block, height: block.lines.length * line + 6 };
  });
}
