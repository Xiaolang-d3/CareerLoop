type ResumePreviewKind = "summary" | "experience" | "projects" | "skills" | "education" | "other";
type ResumeSourceKind = ResumePreviewKind | "combined";

export type ResumePreviewSection = {
  kind: ResumePreviewKind;
  label: string;
  entries: string[][];
};

const sectionDefinitions: Array<{ kind: ResumeSourceKind; label: string; pattern: RegExp }> = [
  { kind: "summary", label: "个人概述", pattern: /^(?:个人简介|个人概述|自我评价|个人总结|简介|个人优势)$/ },
  { kind: "experience", label: "工作与实习经历", pattern: /^(?:工作|职业|实习)(?:经历|经验)?$/ },
  { kind: "combined", label: "工作与项目经历", pattern: /^(?:工作与项目|工作及项目)(?:经历|经验)?$/ },
  { kind: "projects", label: "项目经历", pattern: /^(?:项目(?:经历|经验|实践)?|实践(?:经历|经验)?|项目[／/]实践经历)$/ },
  { kind: "skills", label: "技能", pattern: /^(?:专业|核心|技术)?技能(?:与工具)?$/ },
  { kind: "education", label: "教育经历", pattern: /^(?:教育)(?:经历|背景)?$/ }
];

function normalizeLine(value: string) {
  return value.replace(/^[\s•·▪◦*-]+/, "").replace(/\s+/g, " ").trim();
}

function normalizeHeading(value: string) {
  return value
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(?:(?:[一二三四五六七八九十]+|\d+)[、.．)）]\s*)/, "")
    .replace(/\s*[／/]\s*/g, "/")
    .replace(/[：:]$/, "");
}

function splitEntries(lines: string[]) {
  const entries: string[][] = [];
  let current: string[] = [];
  const dateLine = /(?:19|20)\d{2}(?:[./年-]\d{1,2})?(?:\s*[至—-]\s*(?:(?:19|20)\d{2}(?:[./年-]\d{1,2})?|至今|现在))?/;

  for (const line of lines) {
    if (!line) {
      if (current.length) {
        entries.push(current);
        current = [];
      }
      continue;
    }
    if (dateLine.test(line) && current.length > 1) {
      entries.push(current);
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length) entries.push(current);
  return entries;
}

function isProjectTitle(line: string) {
  return line.length <= 80
    && !/[，、；。：:]/.test(line)
    && (/[（(][^()（）]+[)）]$/.test(line) || /(项目|平台|系统|工具|助手|应用|引擎|服务|网站|小程序)$/.test(line));
}

function splitCombinedWorkAndProjects(lines: string[]) {
  const projectStart = lines.findIndex((line, index) => index > 0 && isProjectTitle(line));
  if (projectStart < 0) return { experience: splitEntries(lines), projects: [] as string[][] };

  const projects: string[][] = [];
  let current: string[] = [];
  for (const line of lines.slice(projectStart)) {
    if (!line) {
      if (current.length) {
        projects.push(current);
        current = [];
      }
      continue;
    }
    if (current.length && isProjectTitle(line)) {
      projects.push(current);
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length) projects.push(current);

  return { experience: splitEntries(lines.slice(0, projectStart)), projects };
}

export function parseResumePreview(text: string): ResumePreviewSection[] {
  const buckets = new Map<ResumeSourceKind, string[]>();
  let activeKind: ResumeSourceKind = "summary";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = normalizeLine(rawLine);
    const definition = sectionDefinitions.find((item) => item.pattern.test(normalizeHeading(line)));
    if (definition) {
      activeKind = definition.kind;
      if (!buckets.has(activeKind)) buckets.set(activeKind, []);
      continue;
    }
    if (!line && !buckets.has(activeKind)) continue;
    const bucket = buckets.get(activeKind) || [];
    bucket.push(line);
    buckets.set(activeKind, bucket);
  }

  const combined = splitCombinedWorkAndProjects(buckets.get("combined") || []);
  const sections = sectionDefinitions
    .filter((definition): definition is { kind: ResumePreviewKind; label: string; pattern: RegExp } => definition.kind !== "combined")
    .map(({ kind, label }) => {
      const entries = splitEntries(buckets.get(kind) || []);
      if (kind === "experience") entries.push(...combined.experience);
      if (kind === "projects") entries.push(...combined.projects);
      return { kind, label, entries };
    })
    .filter((section) => section.entries.length);

  if (sections.length) return sections;
  return text.trim() ? [{ kind: "other", label: "简历内容", entries: splitEntries(text.split(/\r?\n/).map(normalizeLine)) }] : [];
}

export function skillTags(entries: string[][]) {
  return entries
    .flat()
    .flatMap((line) => line.split(/[、，,；;｜|/]+/))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}
