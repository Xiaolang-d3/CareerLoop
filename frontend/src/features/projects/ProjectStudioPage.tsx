import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FileCode2,
  FileText,
  Github,
  Layers3,
  LoaderCircle,
  RefreshCw,
  UserRound
} from "lucide-react";
import { fetchWithTimeout } from "../../api/client";
import { ChatWorkspaceMermaid } from "../../components/ChatWorkspaceMermaid";
import type { ProjectStudioPage as ProjectPage } from "../../routing";
import type { ProjectBriefing, ProjectBriefingSource, ProjectStudio, ProjectStudioItem } from "../../types";
import "./project-studio.css";

type Props = {
  apiBase: string;
  accessToken: string;
  projectId?: string;
  page?: ProjectPage;
  onOpenProject: (projectId?: string, page?: ProjectPage) => void;
  onOpenInterview?: (projectId: string) => void;
  onOpenProfile: () => void;
};

const PROJECT_PAGES: Array<{ page: ProjectPage; label: string }> = [
  { page: "overview", label: "总览" },
  { page: "architecture", label: "架构拆解" },
  { page: "materials", label: "材料与分析" },
  { page: "interview", label: "面试准备" }
];
const URL_PATTERN = /https?:\/\/\S+/i;
const URL_PATTERN_GLOBAL = /https?:\/\/\S+/gi;

async function requestJson<T>(apiBase: string, accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetchWithTimeout(`${apiBase}${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(payload.detail || "请求失败，请稍后重试");
  }
  return response.json() as Promise<T>;
}

function cleanDisplayText(value: string) {
  return value.replace(URL_PATTERN_GLOBAL, "").replace(/\s+/g, " ").trim();
}

function projectTitle(project: ProjectStudioItem) {
  return cleanDisplayText(project.title) || "未命名项目";
}

function projectExternalUrl(project: ProjectStudioItem) {
  return project.title.match(URL_PATTERN)?.[0] || "";
}

function projectPageHref(projectId: string, page: ProjectPage) {
  const project = encodeURIComponent(projectId);
  return page === "overview" ? `#/project/${project}` : `#/project/${project}/${page}`;
}

export function ProjectStudioPage({
  apiBase,
  accessToken,
  projectId,
  page = "overview",
  onOpenProject,
  onOpenInterview,
  onOpenProfile
}: Props) {
  const [data, setData] = useState<ProjectStudio | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourceKind, setSourceKind] = useState<ProjectBriefingSource>("description");
  const [description, setDescription] = useState("");
  const [codeExcerpt, setCodeExcerpt] = useState("");
  const [repoUrl, setRepoUrl] = useState("");

  const selected = useMemo(
    () => projectId ? data?.projects.find((item) => item.id === projectId) ?? null : null,
    [data, projectId]
  );

  useEffect(() => {
    let cancelled = false;
    setError("");
    requestJson<ProjectStudio>(apiBase, accessToken, "/project-studio")
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "暂时无法加载项目");
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, accessToken]);

  useEffect(() => {
    if (!selected) return;
    setSourceKind(selected.briefing.source_kind);
    setDescription(selected.briefing.description || selected.evidence);
    setCodeExcerpt(selected.briefing.code_excerpt);
    setRepoUrl(selected.briefing.repo_url || "");
  }, [selected?.id]);

  async function submitBriefing(useModel = false) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<ProjectStudio>(apiBase, accessToken, `/project-studio/${selected.id}/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_kind: sourceKind,
          description,
          code_excerpt: codeExcerpt,
          repo_url: repoUrl,
          use_model: useModel
        })
      });
      setData(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "梳理失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) {
    return <div className="project-studio-state" role="status"><LoaderCircle className="spinning" size={18} />正在整理项目…</div>;
  }
  if (data?.has_profile === false) {
    return (
      <section className="project-studio-state">
        <UserRound size={27} />
        <h2>先建立候选人画像</h2>
        <p>项目模块要先有一份可核对的简历，才能按描述或代码梳理技术栈和架构。</p>
        <button type="button" onClick={onOpenProfile}>创建求职资料<ChevronRight size={15} /></button>
      </section>
    );
  }
  if (data && !data.has_resume) {
    return (
      <section className="project-studio-state">
        <FileText size={27} />
        <h2>先保存简历里的项目</h2>
        <p>上传或粘贴简历后，这里会列出可梳理的项目。有代码可以再补文件路径或关键实现。</p>
        <button type="button" onClick={onOpenProfile}>完善求职资料<ChevronRight size={15} /></button>
      </section>
    );
  }
  if (!data) {
    return <section className="project-studio-state"><h2>暂时无法加载项目</h2><p>{error}</p></section>;
  }
  if (!projectId) {
    return <ProjectIndex projects={data.projects} onOpenProject={onOpenProject} />;
  }
  if (!selected) {
    return (
      <section className="project-studio-state">
        <h2>没有找到这个项目</h2>
        <p>它可能已经从简历中移除，返回项目列表重新选择。</p>
        <button type="button" onClick={() => onOpenProject()}><ArrowLeft size={15} />返回项目列表</button>
      </section>
    );
  }

  return (
    <section className="project-studio">
      <ProjectHeader projects={data.projects} project={selected} page={page} onOpenProject={onOpenProject} />
      <nav className="project-studio-subnav" aria-label="项目工作区">
        {PROJECT_PAGES.map((item) => (
          <a key={item.page} href={projectPageHref(selected.id, item.page)} aria-current={page === item.page ? "page" : undefined}>
            {item.label}
          </a>
        ))}
      </nav>
      <main className="project-studio-page">
        {page === "overview" ? <ProjectOverview project={selected} /> : null}
        {page === "architecture" ? <ProjectArchitecture briefing={selected.briefing} /> : null}
        {page === "materials" ? (
          <ProjectMaterials
            sourceKind={sourceKind}
            description={description}
            codeExcerpt={codeExcerpt}
            repoUrl={repoUrl}
            busy={busy}
            error={error}
            onSourceKind={setSourceKind}
            onDescription={setDescription}
            onCodeExcerpt={setCodeExcerpt}
            onRepoUrl={setRepoUrl}
            onSubmit={() => void submitBriefing(false)}
            onModelSubmit={() => void submitBriefing(true)}
          />
        ) : null}
        {page === "interview" ? <ProjectInterview project={selected} onOpenInterview={() => onOpenInterview?.(selected.id)} /> : null}
      </main>
    </section>
  );
}

function ProjectIndex({ projects, onOpenProject }: { projects: ProjectStudioItem[]; onOpenProject: Props["onOpenProject"] }) {
  return (
    <section className="project-studio project-studio-index">
      <header className="project-studio-intro">
        <p>项目证据</p>
        <h2>从已确认项目继续梳理</h2>
        <span>项目属于证据账本；面试准备挂在同一条证据链上。</span>
      </header>
      {projects.length ? (
        <div className="project-studio-project-grid" aria-label="项目列表">
          {projects.map((project) => (
            <button type="button" key={project.id} onClick={() => onOpenProject(project.id, "overview")}>
              <span className="project-studio-project-state">{sourceKindLabel(project.briefing.source_kind)}</span>
              <strong>{projectTitle(project)}</strong>
              <small>{project.briefing.layers.length} 层链路 · {project.briefing.stack.length} 项技术</small>
              <span className="project-studio-project-open">打开项目<ChevronRight size={15} /></span>
            </button>
          ))}
        </div>
      ) : <div className="project-studio-empty">还没有识别到可梳理的项目。</div>}
    </section>
  );
}

function ProjectHeader({ projects, project, page, onOpenProject }: { projects: ProjectStudioItem[]; project: ProjectStudioItem; page: ProjectPage; onOpenProject: Props["onOpenProject"] }) {
  const briefing = project.briefing;
  const externalUrl = projectExternalUrl(project);
  const ready = !briefing.missing.length;
  return (
    <header className="project-studio-detail-header">
      <div className="project-studio-detail-heading">
        <button className="project-studio-back" type="button" onClick={() => onOpenProject()}><ArrowLeft size={15} />所有项目</button>
        <h2>{projectTitle(project)}</h2>
        <p>{sourceKindHint(briefing.source_kind)} · {briefing.layers.length} 层链路</p>
      </div>
      <div className="project-studio-detail-actions">
        <span className={`project-studio-readiness ${ready ? "is-ready" : ""}`}>
          {!ready ? <CircleAlert size={14} /> : null}{ready ? "可回顾" : `缺 ${briefing.missing.join("、")}`}
        </span>
        {externalUrl ? <a href={externalUrl} target="_blank" rel="noreferrer">查看原项目<ExternalLink size={14} /></a> : null}
        <label><span>切换项目</span><select value={project.id} onChange={(event) => onOpenProject(event.target.value, page)} aria-label="切换项目">{projects.map((item) => <option value={item.id} key={item.id}>{projectTitle(item)}</option>)}</select></label>
      </div>
    </header>
  );
}

function ProjectOverview({ project }: { project: ProjectStudioItem }) {
  const briefing = project.briefing;
  const evidence = projectEvidence(briefing);
  return (
    <section className="project-studio-overview" aria-label="项目总览">
      <div className="project-studio-facts">
        <article><h3>项目情况</h3><p>{cleanDisplayText(briefing.situation) || "还没有从材料里读到背景或目标。"}</p></article>
        <article><h3>我的职责</h3><p>{cleanDisplayText(briefing.core) || "还没有读到你具体负责的部分。"}</p></article>
        <article><h3>技术栈</h3>{briefing.stack.length ? <div className="project-studio-stack">{briefing.stack.map((item) => <span key={item}>{item}</span>)}</div> : <p>材料里还没有出现可确认的技术名。</p>}</article>
      </div>
      <section className="project-studio-evidence">
        <div><p>关键证据</p><h3>{evidence.length ? `已整理 ${evidence.length} 条可讲事实` : "还缺少可讲清楚的项目证据"}</h3></div>
        {evidence.length ? <ul>{evidence.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        <div className="project-studio-overview-actions">
          <a href={projectPageHref(project.id, "architecture")}>查看完整架构<ChevronRight size={15} /></a>
          <a href={projectPageHref(project.id, "materials")} className="is-primary">继续完善材料<ChevronRight size={15} /></a>
        </div>
      </section>
    </section>
  );
}

function ProjectArchitecture({ briefing }: { briefing: ProjectBriefing }) {
  return (
    <section className="project-studio-architecture" aria-label="架构拆解">
      <header className="project-studio-section-heading"><div><p>架构拆解</p><h3>从材料确认的完整链路</h3></div><span>{briefing.layers.length} 层 · {briefing.generated_from === "model" ? "模型归纳" : "材料归纳"}</span></header>
      <ArchitectureMap briefing={briefing} />
      {briefing.mermaid ? <details className="project-studio-full-diagram"><summary>展开完整架构图</summary><ChatWorkspaceMermaid source={briefing.mermaid} /></details> : null}
    </section>
  );
}

function ProjectMaterials({ sourceKind, description, codeExcerpt, repoUrl, busy, error, onSourceKind, onDescription, onCodeExcerpt, onRepoUrl, onSubmit, onModelSubmit }: {
  sourceKind: ProjectBriefingSource; description: string; codeExcerpt: string; repoUrl: string; busy: boolean; error: string;
  onSourceKind: (kind: ProjectBriefingSource) => void; onDescription: (value: string) => void; onCodeExcerpt: (value: string) => void; onRepoUrl: (value: string) => void; onSubmit: () => void; onModelSubmit: () => void;
}) {
  return (
    <section className="project-studio-source" aria-label="材料与分析">
      <header className="project-studio-section-heading"><div><p>材料与分析</p><h3>选择一种事实来源</h3></div><span>更新后会重建总览与架构，不改写原始材料</span></header>
      <div className="project-studio-source-tabs" role="tablist" aria-label="材料来源">
        <button type="button" role="tab" aria-selected={sourceKind === "description"} className={sourceKind === "description" ? "is-active" : undefined} onClick={() => onSourceKind("description")}><FileText size={15} />项目描述</button>
        <button type="button" role="tab" aria-selected={sourceKind === "code"} className={sourceKind === "code" ? "is-active" : undefined} onClick={() => onSourceKind("code")}><FileCode2 size={15} />代码与文件</button>
        <button type="button" role="tab" aria-selected={sourceKind === "repo"} className={sourceKind === "repo" ? "is-active" : undefined} onClick={() => onSourceKind("repo")}><Github size={15} />GitHub 仓库</button>
      </div>
      {sourceKind === "description" ? <label>项目描述<textarea aria-label="项目描述" value={description} onChange={(event) => onDescription(event.target.value)} rows={10} placeholder="补充背景、职责、方案和结果。只写你能讲清楚的事实。" /></label> : sourceKind === "code" ? <label>代码或文件路径<textarea aria-label="代码或文件路径" value={codeExcerpt} onChange={(event) => onCodeExcerpt(event.target.value)} rows={10} placeholder={"frontend/src/audio/capture.ts\nbackend/app/asr.py\n也可以粘贴关键实现。"} /></label> : <label>GitHub 仓库<input type="url" aria-label="GitHub 仓库" value={repoUrl} onChange={(event) => onRepoUrl(event.target.value)} placeholder="https://github.com/owner/repo" /></label>}
      <footer>
        <div><strong>更新当前分析</strong><small>按规则重建速度更快；模型补充适合材料较长或链路复杂的项目。</small></div>
        <button type="button" className="is-quiet" disabled={busy} onClick={onModelSubmit}><Layers3 size={15} />使用模型补充结构</button>
        <button type="button" disabled={busy} onClick={onSubmit}><RefreshCw size={15} />{busy ? "正在更新…" : "根据当前材料更新分析"}</button>
      </footer>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </section>
  );
}

function ProjectInterview({ project, onOpenInterview }: { project: ProjectStudioItem; onOpenInterview: () => void }) {
  const briefing = project.briefing;
  const evidence = projectEvidence(briefing);
  return (
    <section className="project-studio-interview" aria-label="面试准备">
      <header className="project-studio-section-heading"><div><p>面试准备</p><h3>只围绕现有材料组织表达</h3></div><span>不补写未经确认的职责与结果</span></header>
      <div className="project-studio-interview-grid">
        <article><h4>30 秒项目介绍</h4><p>{[cleanDisplayText(briefing.situation), cleanDisplayText(briefing.core)].filter(Boolean).join("；") || "先补充项目背景和个人职责。"}</p></article>
        <article><h4>可讲成果</h4>{evidence.length ? <ul>{evidence.map((item) => <li key={item}>{item}</li>)}</ul> : <p>当前材料还没有足够的成果证据。</p>}</article>
        <article><h4>事实边界</h4><p>{cleanDisplayText(project.evidence) || "只使用简历与已补充材料中的事实。"}</p></article>
      </div>
      <button type="button" className="project-studio-interview-cta" onClick={onOpenInterview}>进入完整面试准备<ChevronRight size={15} /></button>
    </section>
  );
}

function projectEvidence(briefing: ProjectBriefing) {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const layer of briefing.layers) {
    for (const step of layer.steps) {
      const value = cleanDisplayText(step.detail || step.title);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      items.push(value);
    }
  }
  return items.slice(0, 3);
}

function sourceKindLabel(kind: ProjectBriefingSource) {
  if (kind === "code") return "代码";
  if (kind === "repo") return "仓库";
  return "描述";
}

function sourceKindHint(kind: ProjectBriefingSource) {
  if (kind === "code") return "当前按代码拆链路";
  if (kind === "repo") return "当前按仓库目录拆链路";
  return "当前按描述梳理";
}

function ArchitectureMap({ briefing }: { briefing: ProjectBriefing }) {
  if (!briefing.layers.length) {
    return <section className="project-studio-map is-empty" aria-label="项目架构"><p>还没有足够材料画出全链路。补一段描述或文件路径后再梳理。</p></section>;
  }
  return (
    <section className="project-studio-map" aria-label="项目架构">
      <div className="project-studio-layers">
        {briefing.layers.map((layer, index) => (
          <section key={`${layer.name}-${index}`}><div><p>{layer.name}</p><ol>{layer.steps.map((step) => <li key={`${step.title}-${step.detail}`}><strong>{cleanDisplayText(step.title)}</strong>{step.detail && step.detail !== step.title ? <small>{cleanDisplayText(step.detail)}</small> : null}</li>)}</ol></div></section>
        ))}
      </div>
    </section>
  );
}
