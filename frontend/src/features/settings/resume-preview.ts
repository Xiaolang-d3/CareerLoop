export type ResumePreviewKind =
  | "summary"
  | "strengths"
  | "experience"
  | "internship"
  | "projects"
  | "skills"
  | "education"
  | "campus"
  | "honors"
  | "other";
type ResumeSourceKind = ResumePreviewKind | "combined";

export type ResumePreviewSection = {
  kind: ResumePreviewKind;
  label: string;
  entries: string[][];
};

const sectionDefinitions: Array<{ kind: ResumeSourceKind; label: string; pattern: RegExp }> = [
  { kind: "summary", label: "个人概述", pattern: /^(?:个人简介|个人概述|自我评价|个人总结|简介|个人信息|基本信息)$/ },
  { kind: "strengths", label: "个人优势", pattern: /^(?:个人优势|核心优势|个人亮点|能力特长|核心竞争力)$/ },
  { kind: "experience", label: "工作与实习经历", pattern: /^(?:工作|职业)(?:经历|经验)?$/ },
  { kind: "internship", label: "实习经历", pattern: /^实习(?:经历|经验)?$/ },
  { kind: "combined", label: "工作与项目经历", pattern: /^(?:工作与项目|工作及项目)(?:经历|经验)?$/ },
  { kind: "projects", label: "项目经历", pattern: /^(?:项目(?:经历|经验|实践)?|实践(?:经历|经验)?|项目[／/]实践经历)$/ },
  { kind: "skills", label: "技能", pattern: /^(?:专业|核心|技术|相关)?技能(?:与工具)?$/ },
  { kind: "education", label: "教育经历", pattern: /^(?:教育)(?:经历|背景)?$/ },
  { kind: "campus", label: "在校经历", pattern: /^(?:在校|校园|校内)(?:经历|经验)?$/ },
  { kind: "honors", label: "荣誉证书", pattern: /^(?:荣誉证书|荣誉奖项|所获荣誉|获奖经历|证书奖项)$/ }
];

const TITLED_CAPABILITY_START = /[「『][^」』]{1,40}[」』]\s*[:：]|[【\[][^】\]]{1,40}[】\]]\s*[:：]|\*{2}[^*]{1,40}能力\*{2}\s*[:：]?/g;
const TITLED_CAPABILITY_LINE = /^(?:[「『][^」』]{1,40}[」』]\s*[:：]|[【\[][^】\]]{1,40}[】\]]\s*[:：]|\*{2}[^*]{1,40}能力\*{2}\s*[:：]?)/;
const QUOTED_CAPABILITY = /^[「『]([^」』]{1,40})[」』]\s*[:：]\s*(.*)$/;
const BRACKET_CAPABILITY = /^[【\[]([^】\]]{1,40})[】\]]\s*[:：]\s*(.*)$/;
const BOLD_CAPABILITY = /^\*{2}([^*]{1,40}能力)\*{2}\s*[:：]?\s*(.*)$/;

function matchSectionHeading(line: string): { kind: ResumeSourceKind; label: string } | null {
  const normalized = normalizeHeading(line);
  if (!normalized) return null;
  const definition = sectionDefinitions.find((item) => item.pattern.test(normalized));
  if (definition) return { kind: definition.kind, label: definition.label };
  if (/^#{2,6}\s+\S/.test(line.trim())) return { kind: "other", label: normalized };
  return null;
}

function normalizeLine(value: string) {
  return value.replace(/^[\s•·▪◦*-]+/, "").replace(/\s+/g, " ").trim();
}

function isCjk(character: string) {
  return character >= "\u4e00" && character <= "\u9fff";
}

function isHeadingLine(line: string) {
  return Boolean(matchSectionHeading(line));
}

function isAwardLikeLine(line: string) {
  return /奖学金|优秀毕业生|优秀学生|三好学生|荣誉称号|荣誉证书|GPA|绩点|CET-?\d|大学英语[四六]级|[四六]级证书|保研资格|学科竞赛/.test(line)
    && !/(?:大学|学院|学校|University|College)/i.test(line);
}

function looksLikeSchoolLine(line: string) {
  return /(?:大学|学院|学校|中学|高中|University|College)/i.test(line)
    && (/(?:19|20)\d{2}/.test(line) || /[|｜]/.test(line) || line.length <= 32);
}

function isTitledCapabilityLine(line: string) {
  return TITLED_CAPABILITY_LINE.test(line.trim());
}

function splitTitledCapabilityChunks(text: string): string[] {
  const value = text.trim();
  if (!value) return [];
  const starts: number[] = [];
  const pattern = new RegExp(TITLED_CAPABILITY_START.source, "g");
  for (const match of value.matchAll(pattern)) {
    if (match.index !== undefined) starts.push(match.index);
  }
  if (!starts.length) return [text];
  const chunks: string[] = [];
  if (starts[0] > 0) {
    const prefix = value.slice(0, starts[0]).trim();
    if (prefix) chunks.push(prefix);
  }
  for (let index = 0; index < starts.length; index += 1) {
    const end = index + 1 < starts.length ? starts[index + 1] : value.length;
    const chunk = value.slice(starts[index], end).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function parseTitledCapability(line: string): string[] | null {
  const value = line.trim();
  const quoted = value.match(QUOTED_CAPABILITY);
  if (quoted) return [`「${quoted[1]}」`, quoted[2].trim()].filter((item, index) => index === 0 || item);
  const bracket = value.match(BRACKET_CAPABILITY);
  if (bracket) return [`【${bracket[1]}】`, bracket[2].trim()].filter((item, index) => index === 0 || item);
  const bold = value.match(BOLD_CAPABILITY);
  if (bold) return [bold[1], bold[2].trim()].filter((item, index) => index === 0 || item);
  return isTitledCapabilityLine(value) ? [value] : null;
}

function isStrengthBodyLine(line: string) {
  const value = line.trim();
  if (!value) return false;
  if (isTitledCapabilityLine(value) || isHeadingLine(value)) return false;
  if (isContactLine(value) || TARGET_LINE.test(value)) return false;
  if (looksLikeSchoolLine(value) || isAwardLikeLine(value) || isProjectTitle(value)) return false;
  return true;
}

function nextNonEmptyIndex(lines: string[], start: number) {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index]) return index;
  }
  return -1;
}

function peelStrengthLines(lines: string[]): { kept: string[]; strengths: string[] } {
  const expanded = lines.flatMap((line) => (line ? splitTitledCapabilityChunks(line) : [line]));
  const kept: string[] = [];
  const strengths: string[] = [];
  let index = 0;
  while (index < expanded.length) {
    if (isTitledCapabilityLine(expanded[index])) {
      strengths.push(expanded[index]);
      index += 1;
      while (index < expanded.length) {
        const line = expanded[index];
        if (isTitledCapabilityLine(line)) {
          strengths.push(line);
          index += 1;
          continue;
        }
        if (!line) {
          const next = nextNonEmptyIndex(expanded, index + 1);
          if (next >= 0 && (isTitledCapabilityLine(expanded[next]) || isStrengthBodyLine(expanded[next]))) {
            strengths.push(line);
            index += 1;
            continue;
          }
          break;
        }
        if (isStrengthBodyLine(line)) {
          const previous = strengths.at(-1);
          const parsed = previous ? parseTitledCapability(previous) : null;
          if (parsed && parsed.length === 1) {
            strengths.push(line);
            index += 1;
            continue;
          }
          break;
        }
        break;
      }
      continue;
    }
    kept.push(expanded[index]);
    index += 1;
  }
  return { kept, strengths };
}

function splitStrengthEntries(lines: string[]) {
  const expanded = lines.flatMap((line) => (line ? splitTitledCapabilityChunks(line) : [line]));
  if (!expanded.some(isTitledCapabilityLine)) return splitEntries(expanded);
  const entries: string[][] = [];
  let current: string[] = [];
  for (const line of expanded) {
    const titled = line ? parseTitledCapability(line) : null;
    if (titled) {
      if (current.length) entries.push(current);
      current = titled;
      continue;
    }
    if (!line) {
      if (current.length) {
        entries.push(current);
        current = [];
      }
      continue;
    }
    if (current.length) current.push(line);
    else current = [line];
  }
  if (current.length) entries.push(current);
  return entries;
}

function shouldJoinExtractedLines(previous: string, current: string) {
  if (!previous || !current) return false;
  if (previous.startsWith("# ") || current.startsWith("# ")) return false;
  if (isHeadingLine(previous) || isHeadingLine(current)) return false;
  if (isTitledCapabilityLine(current)) return false;
  if (isTitledCapabilityLine(previous)) {
    if (isHeadingLine(current) || isContactLine(current) || TARGET_LINE.test(current)) return false;
    if (/[。！？!?]$/.test(previous)) return false;
    return previous.length >= 16;
  }
  if (isProjectTitle(previous) || /[|｜]/.test(previous)) return false;
  if (looksLikeSchoolLine(previous) || isAwardLikeLine(previous) || isAwardLikeLine(current)) return false;
  if (/^(?:[-–—*•●▪◦·]\s*|\d{1,2}[.、)]\s+|\d{4}\s*[./年-])/.test(current)) return false;
  if (/^.{1,16}[:：]/.test(previous) || /^.{1,16}[:：]/.test(current)) return false;
  if (/[，、,；]$/.test(previous)) return true;
  if (/[。！？：:;!?]$/.test(previous)) return false;
  if (/[由至到为了在与和及的地得于自按将把被从]$/.test(previous) && !isHeadingLine(current)) return true;
  if (/^(?:\d+(?:\.\d+)?(?:\s*(?:%|h|min|ms|倍))?[+＋]?|小时|分钟|[天日点次条个项秒])/.test(current) && !isProjectTitle(previous)) return true;
  return previous.length >= 16;
}

function joinExtractedLines(previous: string, current: string) {
  const left = previous.slice(-1);
  const right = current[0];
  if (previous.endsWith(",")) return current[0] === " " ? previous + current : `${previous} ${current}`;
  if (isCjk(left) && isCjk(right)) return previous + current;
  if (/[A-Za-z0-9]/.test(left) && /[A-Za-z0-9]/.test(right)) return `${previous} ${current}`;
  return previous + current;
}

function unwrapExtractedLines(lines: string[]) {
  const merged: string[] = [];
  for (const line of lines) {
    const previous = merged.at(-1);
    if (previous && shouldJoinExtractedLines(previous, line)) {
      merged[merged.length - 1] = joinExtractedLines(previous, line);
    } else {
      merged.push(line);
    }
  }
  return merged.flatMap((line) => (line ? splitJammedProfileLine(line) : [line]));
}

const PROFILE_FIELD_LABELS = "电话|手机|邮箱|邮件|微信|地址|住址|联系方式|GitHub|Github|LinkedIn|求职意向|意向岗位|目标职位|求职目标|英语|日语|普通话|语言";

function splitJammedProfileLine(line: string): string[] {
  const spaced = line
    .replace(/(CET-?\d)(?=[A-Za-z\u4e00-\u9fff])/gi, "$1 ")
    .replace(/([^\s|/｜])((?:GitHub|Github|LinkedIn)[:：])/gi, "$1 $2");
  const starts: number[] = [];
  const pattern = new RegExp(`(?:${PROFILE_FIELD_LABELS})[:：]`, "gi");
  for (const match of spaced.matchAll(pattern)) {
    if (match.index !== undefined) starts.push(match.index);
  }
  if (starts.length < 2) return [spaced.trim() || line];
  const chunks: string[] = [];
  if (starts[0] > 0) {
    const prefix = spaced.slice(0, starts[0]).trim();
    if (prefix) chunks.push(prefix);
  }
  for (let index = 0; index < starts.length; index += 1) {
    const end = index + 1 < starts.length ? starts[index + 1] : spaced.length;
    const chunk = spaced.slice(starts[index], end).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks.length ? chunks : [line];
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

function splitProjectEntries(lines: string[]) {
  const projects: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
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
  return projects;
}

export function projectOrdinalLabel(index: number) {
  const digits = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (index < 10) return `项目${digits[index]}`;
  if (index < 19) return `项目十${digits[index - 10]}`;
  return `项目${index + 1}`;
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

const EDUCATION_DATE = /(?:19|20)\d{2}(?:[./年-]\d{1,2})?(?:\s*[至—\-~～]\s*(?:(?:19|20)\d{2}(?:[./年-]\d{1,2})?|至今|现在))?/;
const EDUCATION_AWARD = /奖学金|优秀毕业生|优秀学生|三好学生|荣誉称号|荣誉证书|GPA|绩点|CET-?\d|大学英语[四六]级|[四六]级证书|保研资格|学科竞赛/;
const JAMMED_AWARDS = /国家奖学金|校长奖学金|[一二三]等奖学金|校级优秀毕业生|优秀毕业生|三好学生|优秀学生干部|保研资格|CET-?[46]|大学英语[四六]级/g;

function splitAwardItems(text: string): string[] {
  const delimited = text.split(/[、，,；;]+/).map((item) => item.trim()).filter(Boolean);
  if (delimited.length > 1) return delimited;

  const matches = [...text.matchAll(JAMMED_AWARDS)];
  if (matches.length < 2) return delimited;

  const parts: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index === undefined) continue;
    const gap = text.slice(cursor, match.index).trim();
    if (gap) parts.push(gap);
    parts.push(match[0]);
    cursor = match.index + match[0].length;
  }
  const tail = text.slice(cursor).trim();
  if (tail) parts.push(tail);
  return parts.filter(Boolean);
}

function splitEducationLine(line: string): string[] {
  const dateMatch = line.match(EDUCATION_DATE);
  if (dateMatch && dateMatch.index !== undefined) {
    const rest = line.slice(dateMatch.index + dateMatch[0].length).replace(/^[\s|｜/／、，,；;]+/, "").trim();
    if (rest && EDUCATION_AWARD.test(rest)) {
      const heading = line.slice(0, dateMatch.index + dateMatch[0].length).trim();
      if (heading) return [heading, ...splitAwardItems(rest)];
    }
  }

  if (looksLikeSchoolLine(line) && EDUCATION_AWARD.test(line)) {
    const awardMatch = line.match(EDUCATION_AWARD);
    if (awardMatch?.index && awardMatch.index >= 4) {
      const heading = line.slice(0, awardMatch.index).replace(/[\s|｜/／、，,；;]+$/, "").trim();
      const rest = line.slice(awardMatch.index).trim();
      if (heading && rest) return [heading, ...splitAwardItems(rest)];
    }
  }

  if (isAwardLikeLine(line) && /[、，,；;]/.test(line)) return splitAwardItems(line);
  return [line];
}

function splitEducationEntries(lines: string[]) {
  return splitEntries(lines).map((entry) => {
    const expanded = entry.flatMap(splitEducationLine);
    return expanded.length ? expanded : entry;
  });
}

function splitSectionEntries(kind: ResumePreviewKind, lines: string[]) {
  if (kind === "projects") return splitProjectEntries(lines);
  if (kind === "education") return splitEducationEntries(lines);
  if (kind === "strengths") return splitStrengthEntries(lines);
  return splitEntries(lines);
}

function pushPreviewSection(sections: ResumePreviewSection[], next: ResumePreviewSection) {
  const last = sections.at(-1);
  if (last && last.kind === next.kind && next.kind !== "other") {
    last.entries.push(...next.entries);
    return;
  }
  sections.push(next);
}

export function parseResumePreview(text: string): ResumePreviewSection[] {
  const rawSections: Array<{ kind: ResumeSourceKind; label: string; lines: string[] }> = [];
  let current: { kind: ResumeSourceKind; label: string; lines: string[] } | null = null;

  for (const line of unwrapExtractedLines(text.split(/\r?\n/).map(normalizeLine))) {
    const heading = matchSectionHeading(line);
    if (heading) {
      current = { kind: heading.kind, label: heading.label, lines: [] };
      rawSections.push(current);
      continue;
    }
    if (!line && !current) continue;
    if (!current) {
      current = { kind: "summary", label: "个人概述", lines: [] };
      rawSections.push(current);
    }
    current.lines.push(line);
  }

  const sections: ResumePreviewSection[] = [];
  for (const raw of rawSections) {
    if (raw.kind === "combined") {
      const combined = splitCombinedWorkAndProjects(raw.lines);
      if (combined.experience.length) {
        pushPreviewSection(sections, { kind: "experience", label: "工作与实习经历", entries: combined.experience });
      }
      if (combined.projects.length) {
        pushPreviewSection(sections, { kind: "projects", label: "项目经历", entries: combined.projects });
      }
      continue;
    }
    if (raw.kind === "summary") {
      const peeled = peelStrengthLines(raw.lines);
      const summaryEntries = splitSectionEntries("summary", peeled.kept);
      if (summaryEntries.length) {
        pushPreviewSection(sections, { kind: "summary", label: "个人概述", entries: summaryEntries });
      }
      const strengthEntries = splitStrengthEntries(peeled.strengths);
      if (strengthEntries.length) {
        pushPreviewSection(sections, { kind: "strengths", label: "个人优势", entries: strengthEntries });
      }
      continue;
    }
    const entries = splitSectionEntries(raw.kind, raw.lines);
    if (!entries.length) continue;
    pushPreviewSection(sections, { kind: raw.kind, label: raw.label, entries });
  }

  if (sections.length) return sections;
  return text.trim()
    ? [{ kind: "other", label: "简历内容", entries: splitEntries(unwrapExtractedLines(text.split(/\r?\n/).map(normalizeLine))) }]
    : [];
}

export type ResumePaperLayout = {
  title: string;
  contact: string[];
  target: string;
  sidebar: ResumePreviewSection[];
  main: ResumePreviewSection[];
  sections: ResumePreviewSection[];
};

export function splitResumeLayout(text: string): ResumePaperLayout {
  const hashTitle = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));
  const sections = parseResumePreview(text).map((section) => ({
    ...section,
    entries: section.entries.map((entry) => [...entry])
  }));

  let title = hashTitle ? hashTitle.slice(2).trim() : "";
  const contact: string[] = [];
  const targets: string[] = [];
  if (sections[0]?.kind === "summary") {
    const peeled = peelProfileEntries(sections[0].entries);
    contact.push(...peeled.contact);
    targets.push(...peeled.targets);
    sections[0] = { ...sections[0], entries: peeled.kept };
    if (!sections[0].entries.length) sections.shift();
  }
  if (!title) {
    const first = sections[0]?.entries[0]?.[0] || "";
    if (first && first.length <= 42 && !/[。！？]/.test(first) && !isContactLine(first) && !TARGET_LINE.test(first)) {
      title = first.replace(/^#\s*/, "");
      const rest = sections[0].entries[0].slice(1);
      if (rest.length) sections[0].entries[0] = rest;
      else sections[0].entries.shift();
      if (!sections[0].entries.length) sections.shift();
    }
  }
  if (title) {
    for (let index = sections.length - 1; index >= 0; index -= 1) {
      sections[index] = {
        ...sections[index],
        entries: dropDuplicateTitleEntries(title, sections[index].entries)
      };
      if (!sections[index].entries.length) sections.splice(index, 1);
    }
  }

  const sidebar = sections.filter((section) => section.kind === "skills" || section.kind === "education");
  const main = sections.filter((section) => section.kind !== "skills" && section.kind !== "education");
  const headerContact = contact.filter((item) => !isDuplicateTitleLine(title, item));
  if (!sidebar.length && main.some((section) => section.kind === "summary") && main.length > 1) {
    return {
      title,
      contact: headerContact,
      target: targets[0] || "",
      sidebar: main.filter((section) => section.kind === "summary"),
      main: main.filter((section) => section.kind !== "summary"),
      sections
    };
  }
  return {
    title,
    contact: headerContact,
    target: targets[0] || "",
    sidebar,
    main,
    sections
  };
}

function titleName(value: string) {
  return value.replace(/^#\s*/, "").split(/[｜|]/, 1)[0].trim();
}

function isDuplicateTitleLine(title: string, line: string) {
  const clean = line.replace(/^#\s*/, "").trim();
  return Boolean(title) && (clean === title || clean === titleName(title));
}

function dropDuplicateTitleEntries(title: string, entries: string[][]) {
  return entries
    .map((entry) => entry.filter((line) => !isDuplicateTitleLine(title, line)))
    .filter((entry) => entry.length);
}

function peelProfileEntries(entries: string[][]) {
  const contact: string[] = [];
  const targets: string[] = [];
  const kept: string[][] = [];
  for (const entry of entries) {
    const lines: string[] = [];
    for (const line of entry) {
      const targetMatch = line.match(TARGET_LINE);
      if (targetMatch) {
        targets.push((targetMatch[1] || line).trim());
        continue;
      }
      if (isContactLine(line)) {
        contact.push(line);
        continue;
      }
      lines.push(line);
    }
    if (lines.length) kept.push(lines);
  }
  return { contact, targets, kept };
}

export type ResumeModuleKind =
  | "experience"
  | "internship"
  | "projects"
  | "skills"
  | "strengths"
  | "education"
  | "campus"
  | "honors"
  | "custom";

export type ResumeEditorModule = {
  id: string;
  kind: ResumeModuleKind;
  label: string;
  heading: string;
  body: string;
};

export type ResumeEditorProfile = {
  title: string;
  contact: string;
  target: string;
  summary: string;
};

export type ResumeEditorModel = {
  profile: ResumeEditorProfile;
  modules: ResumeEditorModule[];
};

export const RESUME_BUILTIN_MODULES: Array<{
  kind: Exclude<ResumeModuleKind, "custom">;
  label: string;
  heading: string;
  placeholder: string;
}> = [
  { kind: "experience", label: "工作经历", heading: "工作经历", placeholder: "公司｜职位｜时间\n做了什么，结果是什么" },
  { kind: "projects", label: "项目经历", heading: "项目经历", placeholder: "项目名称\n你负责的部分和结果" },
  { kind: "skills", label: "相关技能", heading: "相关技能", placeholder: "Python、FastAPI、PostgreSQL" },
  { kind: "strengths", label: "个人优势", heading: "个人优势", placeholder: "「核心能力」：用一句话说明你擅长什么，以及结果" },
  { kind: "education", label: "教育经历", heading: "教育经历", placeholder: "学校｜专业｜时间" },
  { kind: "internship", label: "实习经历", heading: "实习经历", placeholder: "公司｜职位｜时间\n实习期间做了什么" },
  { kind: "campus", label: "在校经历", heading: "在校经历", placeholder: "组织｜职务｜时间\n你负责的部分" },
  { kind: "honors", label: "荣誉证书", heading: "荣誉证书", placeholder: "奖项或证书｜时间" }
];

const CONTACT_LINE = /^(?:电话|手机|邮箱|邮件|微信|地址|住址|联系方式|GitHub|Github)[:：]|^[\w.+-]+@[\w.-]+\.\w+$|^(?:\+?86[-\s]?)?1[3-9]\d{9}$|^(?:https?:\/\/)?(?:www\.)?github\.com\//i;
const TARGET_LINE = /^(?:求职意向|意向岗位|目标职位|求职目标)[:：]\s*(.*)$/;

function isContactLine(line: string) {
  const value = line.trim();
  if (!value) return false;
  if (isProfileCertLine(value)) return false;
  if (CONTACT_LINE.test(value)) return true;
  return value.length <= 80 && /[｜|].+@/.test(value);
}

function isProfileCertLine(line: string) {
  const value = line.trim();
  if (!value) return false;
  if (/^(?:英语|日语|普通话|语言)[:：]/.test(value)) return true;
  return isAwardLikeLine(value) && value.length <= 40;
}

function splitProfileLines(lines: string[]): ResumeEditorProfile {
  const cleaned = [...lines];
  while (cleaned.length && !cleaned[0].trim()) cleaned.shift();
  while (cleaned.length && !cleaned.at(-1)?.trim()) cleaned.pop();

  let title = "";
  const first = cleaned[0]?.trim() || "";
  if (first.startsWith("# ")) {
    title = first.slice(2).trim();
    cleaned.shift();
  } else if (
    first
    && first.length <= 42
    && !/[。！？]/.test(first)
    && !isContactLine(first)
    && !TARGET_LINE.test(first)
  ) {
    title = first.replace(/^#\s*/, "");
    cleaned.shift();
  }
  while (cleaned.length) {
    const next = cleaned[0]?.trim() || "";
    if (!next || isDuplicateTitleLine(title, next)) {
      cleaned.shift();
      continue;
    }
    break;
  }

  const contact: string[] = [];
  const target: string[] = [];
  const summary: string[] = [];
  for (const line of cleaned) {
    const trimmed = line.trim();
    const targetMatch = trimmed.match(TARGET_LINE);
    if (targetMatch) {
      target.push(targetMatch[1] || trimmed);
      continue;
    }
    if (isContactLine(trimmed)) {
      contact.push(trimmed);
      continue;
    }
    summary.push(line);
  }

  return {
    title,
    contact: contact.join("\n"),
    target: target.join("\n"),
    summary: summary.join("\n").trim()
  };
}

function composeProfile(profile: ResumeEditorProfile) {
  const lines: string[] = [];
  if (profile.title.trim()) lines.push(profile.title.trim());
  if (profile.contact.trim()) lines.push(profile.contact.trim());
  if (profile.target.trim()) {
    const target = profile.target.trim();
    lines.push(TARGET_LINE.test(target) ? target : `求职意向：${target}`);
  }
  if (profile.summary.trim()) {
    if (lines.length) lines.push("");
    lines.push(profile.summary.trim());
  }
  return lines.join("\n");
}

function matchEditorHeading(line: string): { kind: ResumeModuleKind | "summary" | "combined"; label: string; heading: string } | null {
  const heading = matchSectionHeading(line);
  if (!heading) return null;
  if (heading.kind === "summary") return { kind: "summary", label: heading.label, heading: heading.label };
  if (heading.kind === "combined") return { kind: "combined", label: "工作经历", heading: "工作经历" };
  if (heading.kind === "other") return { kind: "custom", label: heading.label, heading: heading.label };
  const builtin = RESUME_BUILTIN_MODULES.find((item) => item.kind === heading.kind);
  return {
    kind: heading.kind,
    label: builtin?.label || heading.label,
    heading: builtin?.heading || heading.label
  };
}

export function parseResumeEditor(text: string): ResumeEditorModel {
  const lines = text.split(/\r?\n/);
  const profileLines: string[] = [];
  const rawModules: Array<{ kind: ResumeModuleKind | "combined"; label: string; heading: string; lines: string[] }> = [];
  let current: { kind: ResumeModuleKind | "combined"; label: string; heading: string; lines: string[] } | null = null;
  let inProfile = true;

  for (const line of lines) {
    const heading = matchEditorHeading(line);
    if (heading?.kind === "summary") {
      inProfile = true;
      current = null;
      continue;
    }
    if (heading) {
      inProfile = false;
      current = { kind: heading.kind, label: heading.label, heading: heading.heading, lines: [] };
      rawModules.push(current);
      continue;
    }
    if (inProfile || !current) profileLines.push(line);
    else current.lines.push(line);
  }

  const modules: ResumeEditorModule[] = [];
  rawModules.forEach((raw, index) => {
    if (raw.kind === "combined") {
      const combined = splitCombinedWorkAndProjects(raw.lines.map(normalizeLine));
      const experience = RESUME_BUILTIN_MODULES.find((item) => item.kind === "experience");
      const projects = RESUME_BUILTIN_MODULES.find((item) => item.kind === "projects");
      if (combined.experience.length && experience) {
        modules.push({
          id: "experience",
          kind: "experience",
          label: experience.label,
          heading: experience.heading,
          body: combined.experience.map((entry) => entry.join("\n")).join("\n\n")
        });
      }
      if (combined.projects.length && projects) {
        modules.push({
          id: "projects",
          kind: "projects",
          label: projects.label,
          heading: projects.heading,
          body: combined.projects.map((entry) => entry.join("\n")).join("\n\n")
        });
      }
      if (!combined.experience.length && !combined.projects.length && experience) {
        modules.push({
          id: "experience",
          kind: "experience",
          label: experience.label,
          heading: experience.heading,
          body: raw.lines.join("\n").trim()
        });
      }
      return;
    }
    const duplicate = raw.kind !== "custom" && modules.some((item) => item.kind === raw.kind);
    modules.push({
      id: raw.kind === "custom" || duplicate ? `custom-${index}-${raw.label}` : raw.kind,
      kind: duplicate ? "custom" : raw.kind,
      label: raw.label,
      heading: raw.heading,
      body: raw.lines.join("\n").trim()
    });
  });

  const expanded = profileLines.flatMap((line) => (line ? splitJammedProfileLine(line) : [line]));
  const peeled = peelStrengthLines(expanded);
  const honorsLines: string[] = [];
  const kept: string[] = [];
  for (const line of peeled.kept) {
    if (isProfileCertLine(line)) honorsLines.push(line.trim());
    else kept.push(line);
  }
  const strengthsBody = peeled.strengths.map((line) => line.trim()).filter(Boolean).join("\n");
  if (strengthsBody) {
    const builtin = RESUME_BUILTIN_MODULES.find((item) => item.kind === "strengths");
    const existing = modules.find((item) => item.kind === "strengths");
    if (existing) {
      existing.body = [strengthsBody, existing.body].filter(Boolean).join("\n\n");
    } else if (builtin) {
      modules.unshift({
        id: "strengths",
        kind: "strengths",
        label: builtin.label,
        heading: builtin.heading,
        body: strengthsBody
      });
    }
  }
  const honorsBody = honorsLines.filter(Boolean).join("\n");
  if (honorsBody) {
    const builtin = RESUME_BUILTIN_MODULES.find((item) => item.kind === "honors");
    const existing = modules.find((item) => item.kind === "honors");
    if (existing) {
      existing.body = [honorsBody, existing.body].filter(Boolean).join("\n\n");
    } else if (builtin) {
      modules.push({
        id: "honors",
        kind: "honors",
        label: builtin.label,
        heading: builtin.heading,
        body: honorsBody
      });
    }
  }

  return { profile: splitProfileLines(kept), modules };
}

export function composeResumeEditor(model: ResumeEditorModel): string {
  const parts: string[] = [];
  const profile = composeProfile(model.profile);
  if (profile) parts.push(profile);
  for (const item of model.modules) {
    const body = item.body.trim();
    const label = item.label.trim() || item.heading.trim() || "自定义模块";
    const heading = item.kind === "custom" ? `## ${label}` : item.heading;
    if (!body && item.kind !== "custom") continue;
    parts.push(body ? `${heading}\n${body}` : heading);
  }
  return parts.join("\n\n");
}

export function unusedResumeBuiltins(model: ResumeEditorModel) {
  const used = new Set(model.modules.filter((item) => item.kind !== "custom").map((item) => item.kind));
  return RESUME_BUILTIN_MODULES.filter((item) => !used.has(item.kind));
}

export function addResumeModule(model: ResumeEditorModel, kind: ResumeModuleKind): ResumeEditorModel {
  if (kind !== "custom" && model.modules.some((item) => item.kind === kind)) return model;
  const builtin = RESUME_BUILTIN_MODULES.find((item) => item.kind === kind);
  const module: ResumeEditorModule = kind === "custom" || !builtin
    ? {
      id: `custom-${Math.random().toString(36).slice(2, 8)}`,
      kind: "custom",
      label: "自定义模块",
      heading: "自定义模块",
      body: ""
    }
    : { id: kind, kind, label: builtin.label, heading: builtin.heading, body: "" };
  return { ...model, modules: [...model.modules, module] };
}

export function removeResumeModule(model: ResumeEditorModel, id: string): ResumeEditorModel {
  return { ...model, modules: model.modules.filter((item) => item.id !== id) };
}

export function moveResumeModule(model: ResumeEditorModel, id: string, delta: number): ResumeEditorModel {
  const index = model.modules.findIndex((item) => item.id === id);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= model.modules.length) return model;
  const modules = [...model.modules];
  const [item] = modules.splice(index, 1);
  modules.splice(nextIndex, 0, item);
  return { ...model, modules };
}

export function updateResumeProfile(model: ResumeEditorModel, patch: Partial<ResumeEditorProfile>): ResumeEditorModel {
  return { ...model, profile: { ...model.profile, ...patch } };
}

export function updateResumeModule(model: ResumeEditorModel, id: string, patch: Partial<Pick<ResumeEditorModule, "label" | "heading" | "body">>): ResumeEditorModel {
  return {
    ...model,
    modules: model.modules.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...patch };
      if (item.kind === "custom" && patch.label !== undefined) next.heading = patch.label.trim() || item.heading;
      return next;
    })
  };
}

export function skillTags(entries: string[][]) {
  return entries
    .flat()
    .flatMap((line) => line.split(/[、，,；;｜|/]+/))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}

const DATE_CORE = "(?:19|20)\\d{2}(?:[./年-]\\d{1,2}月?)?(?:\\s*[至—\\-~～-]\\s*(?:(?:19|20)\\d{2}(?:[./年-]\\d{1,2}月?)?|至今|现在))?";
const TRAILING_DATE = new RegExp(`[\\s|｜/／]+(${DATE_CORE})\\s*$`);
const LEADING_DATE = new RegExp(`^(${DATE_CORE})[\\s|｜/／]+(.+)$`);
const DATE_ONLY = new RegExp(`^${DATE_CORE}$`);

export function splitEntryHeading(line: string): { title: string; date: string } {
  const value = line.trim();
  if (!value) return { title: "", date: "" };
  const trailing = value.match(TRAILING_DATE);
  if (trailing?.index !== undefined && trailing.index >= 2) {
    const title = value.slice(0, trailing.index).replace(/[\s|｜/／]+$/, "").trim();
    if (title) return { title, date: trailing[1].trim() };
  }
  const leading = value.match(LEADING_DATE);
  if (leading) return { title: leading[2].trim(), date: leading[1].trim() };
  return { title: value, date: "" };
}

export function splitDocumentName(title: string): { name: string; role: string } {
  const value = title.trim();
  for (const separator of ["｜", "|"] as const) {
    if (!value.includes(separator)) continue;
    const [name, rest] = value.split(separator, 2).map((item) => item.trim());
    if (name && rest && !DATE_ONLY.test(rest)) return { name, role: rest };
  }
  return { name: value, role: "" };
}
