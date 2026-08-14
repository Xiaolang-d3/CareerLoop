import { describe, expect, it } from "vitest";
import { collectExpandableIds, isMermaidMindmap, parseMermaidMindmap } from "./mindmap-source";

describe("mindmap-source", () => {
  it("detects mermaid mindmap source only", () => {
    expect(isMermaidMindmap("mindmap\n  root((主题))")).toBe(true);
    expect(isMermaidMindmap("flowchart LR\n  A --> B")).toBe(false);
  });

  it("parses shaped root nodes and indented children", () => {
    const tree = parseMermaidMindmap(`mindmap
  root((Summary AI))
    产品定位
      文本摘要
    核心功能
      自动生成`);

    expect(tree).toEqual({
      id: "mind-1",
      label: "Summary AI",
      children: [
        {
          id: "mind-2",
          label: "产品定位",
          children: [{ id: "mind-3", label: "文本摘要", children: [] }]
        },
        {
          id: "mind-4",
          label: "核心功能",
          children: [{ id: "mind-5", label: "自动生成", children: [] }]
        }
      ]
    });
    expect(collectExpandableIds(tree!)).toEqual(["mind-2", "mind-4"]);
  });

  it("rejects unbalanced mindmap shapes", () => {
    expect(parseMermaidMindmap("mindmap\n  root((未闭合)")).toBeNull();
  });
});
