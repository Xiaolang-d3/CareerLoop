export type MindmapNode = {
  id: string;
  label: string;
  children: MindmapNode[];
};

const shapedLabel = /^(?:[\w.-]+\s*)?(?:\(\((.+)\)\)|\[\[(.+)\]\]|\[(.+)\]|\((.+)\)|\{\{(.+)\}\}|](.+)\[|\)(.+)\()$/;

export function isMermaidMindmap(source: string): boolean {
  return /^\s*mindmap(?:\s|$)/im.test(source);
}

export function parseMermaidMindmap(source: string): MindmapNode | null {
  if (!isMermaidMindmap(source)) return null;

  const roots: MindmapNode[] = [];
  const stack: Array<{ indent: number; node: MindmapNode }> = [];
  let started = false;
  let nextId = 0;

  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!started) {
      if (/^mindmap\b/i.test(trimmed)) started = true;
      continue;
    }
    if (!trimmed || trimmed.startsWith("%%")) continue;

    const label = normalizeMindmapLabel(trimmed);
    if (!label) return null;

    const indent = (line.match(/^\s*/)?.[0] ?? "").replace(/\t/g, "  ").length;
    const node: MindmapNode = { id: `mind-${++nextId}`, label, children: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ indent, node });
  }

  if (!roots.length) return null;
  if (roots.length === 1) return roots[0];
  return { id: "mind-root", label: "主题", children: roots };
}

export function collectExpandableIds(node: MindmapNode, depth = 0, fromDepth = 1): string[] {
  const ids: string[] = [];
  if (node.children.length && depth >= fromDepth) ids.push(node.id);
  for (const child of node.children) ids.push(...collectExpandableIds(child, depth + 1, fromDepth));
  return ids;
}

function normalizeMindmapLabel(raw: string): string | null {
  let text = raw.replace(/::icon\([^)]*\)/g, "").replace(/:::\S+/g, "").trim();
  if (!text) return null;
  if (/\(\(|\[\[|\{\{/.test(text) && !/\)\)|\]\]|\}\}/.test(text)) return null;

  const shaped = text.match(shapedLabel);
  if (shaped) {
    const label = (shaped[1] || shaped[2] || shaped[3] || shaped[4] || shaped[5] || shaped[6] || shaped[7] || "").trim();
    return label || null;
  }
  return text;
}
