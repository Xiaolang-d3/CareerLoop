import { useEffect, useMemo, useState } from "react";
import { ChevronRight, CircleAlert, FileCode2, FileText, Github, Layers3, LoaderCircle, RefreshCw, UserRound } from "lucide-react";
import { fetchWithTimeout } from "../../api/client";
import { ChatWorkspaceMermaid } from "../../components/ChatWorkspaceMermaid";
import type { ProjectBriefing, ProjectBriefingSource, ProjectStudio, ProjectStudioItem } from "../../types";
import "./project-studio.css";

type Props = {
  apiBase: string;
  accessToken: string;
  projectId?: string;
  onOpenProject: (projectId?: string) => void;
  onOpenProfile: () => void;
};

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

export function ProjectStudioPage({ apiBase, accessToken, projectId, onOpenProject, onOpenProfile }: Props) {
  const [data, setData] = useState<ProjectStudio | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourceKind, setSourceKind] = useState<ProjectBriefingSource>("description");
  const [description, setDescription] = useState("");
  const [codeExcerpt, setCodeExcerpt] = useState("");
  const [repoUrl, setRepoUrl] = useState("");

  const selected = useMemo(
    () => data?.projects.find((item) => item.id === projectId) ?? data?.projects[0] ?? null,
    [data, projectId]
  );

  useEffect(() => {
    let cancelled = false;
    setError("");
    requestJson<ProjectStudio>(apiBase, accessToken, "/project-studio")
      .then((result) => {
        if (cancelled) return;
        setData(result);
        if (!projectId && result.projects[0]) onOpenProject(result.projects[0].id);
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
    return (
      <section className="project-studio-state">
        <h2>暂时无法加载项目</h2>
        <p>{error}</p>
      </section>
    );
  }

  return (
    <section className="project-studio">
      <header className="project-studio-intro">
        <div>
          <p>项目</p>
          <h2>按材料梳理，不编造架构</h2>
        </div>
        <p>有代码就从文件和实现拆链路；没有代码就从项目描述整理技术栈、核心和情况。</p>
      </header>

      <div className="project-studio-workspace">
        <aside aria-label="项目列表">
          {data.projects.length ? data.projects.map((item) => (
            <button
              type="button"
              key={item.id}
              className={item.id === selected?.id ? "is-active" : undefined}
              onClick={() => onOpenProject(item.id)}
            >
              <strong>{item.title}</strong>
              <small>{sourceKindLabel(item.briefing.source_kind)} · {item.briefing.layers.length} 层</small>
            </button>
          )) : <p>还没有识别到可梳理的项目。</p>}
        </aside>

        {selected ? (
          <ProjectDossier
            project={selected}
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
        ) : (
          <div className="project-studio-empty">从左侧选择一个项目，开始看全链路。</div>
        )}
      </div>
    </section>
  );
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

function ProjectDossier({
  project,
  sourceKind,
  description,
  codeExcerpt,
  repoUrl,
  busy,
  error,
  onSourceKind,
  onDescription,
  onCodeExcerpt,
  onRepoUrl,
  onSubmit,
  onModelSubmit
}: {
  project: ProjectStudioItem;
  sourceKind: ProjectBriefingSource;
  description: string;
  codeExcerpt: string;
  repoUrl: string;
  busy: boolean;
  error: string;
  onSourceKind: (kind: ProjectBriefingSource) => void;
  onDescription: (value: string) => void;
  onCodeExcerpt: (value: string) => void;
  onRepoUrl: (value: string) => void;
  onSubmit: () => void;
  onModelSubmit: () => void;
}) {
  const briefing = project.briefing;
  const repoHref = briefing.repo_owner && briefing.repo_name
    ? `https://github.com/${briefing.repo_owner}/${briefing.repo_name}`
    : briefing.repo_url || "";
  return (
    <main>
      <header className="project-studio-detail-header">
        <div>
          <h3>{project.title}</h3>
          <p>{sourceKindHint(briefing.source_kind)}</p>
          {repoHref ? (
            <a className="project-studio-repo-link" href={repoHref} target="_blank" rel="noreferrer">
              {briefing.repo_owner && briefing.repo_name ? `${briefing.repo_owner}/${briefing.repo_name}` : repoHref}
            </a>
          ) : null}
        </div>
        {briefing.missing.length ? <span><CircleAlert size={14} />缺 {briefing.missing.join("、")}</span> : <span>可回顾</span>}
      </header>

      <ArchitectureMap briefing={briefing} />

      <div className="project-studio-facts">
        <article>
          <h4>项目情况</h4>
          <p>{briefing.situation || "还没有从材料里读到背景或目标。"}</p>
        </article>
        <article>
          <h4>项目核心</h4>
          <p>{briefing.core || "还没有读到你具体负责的部分。"}</p>
        </article>
        <article>
          <h4>技术栈</h4>
          {briefing.stack.length ? (
            <div className="project-studio-stack">{briefing.stack.map((item) => <span key={item}>{item}</span>)}</div>
          ) : <p>材料里还没有出现可确认的技术名。</p>}
        </article>
      </div>

      {briefing.mermaid ? <ChatWorkspaceMermaid source={briefing.mermaid} /> : null}

      <section className="project-studio-source" aria-label="梳理材料">
        <div className="project-studio-source-tabs">
          <button type="button" className={sourceKind === "description" ? "is-active" : undefined} onClick={() => onSourceKind("description")}>
            <FileText size={14} />从描述梳理
          </button>
          <button type="button" className={sourceKind === "code" ? "is-active" : undefined} onClick={() => onSourceKind("code")}>
            <FileCode2 size={14} />从代码分析
          </button>
          <button type="button" className={sourceKind === "repo" ? "is-active" : undefined} onClick={() => onSourceKind("repo")}>
            <Github size={14} />从仓库分析
          </button>
        </div>
        {sourceKind === "description" ? (
          <label>
            项目描述
            <textarea
              aria-label="项目描述"
              value={description}
              onChange={(event) => onDescription(event.target.value)}
              rows={6}
              placeholder="补充背景、职责、方案和结果。只写你能讲清楚的事实。"
            />
          </label>
        ) : sourceKind === "code" ? (
          <label>
            代码或文件路径
            <textarea
              aria-label="代码或文件路径"
              value={codeExcerpt}
              onChange={(event) => onCodeExcerpt(event.target.value)}
              rows={8}
              placeholder={"frontend/src/audio/capture.ts\nbackend/app/asr.py\n也可以粘贴关键实现。"}
            />
          </label>
        ) : (
          <label>
            GitHub 仓库
            <input
              type="url"
              aria-label="GitHub 仓库"
              value={repoUrl}
              onChange={(event) => onRepoUrl(event.target.value)}
              placeholder="https://github.com/owner/repo"
            />
          </label>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={onSubmit}>
            <RefreshCw size={14} />{busy ? "正在梳理…" : "按当前材料重梳"}
          </button>
          <button type="button" className="is-quiet" disabled={busy} onClick={onModelSubmit}>
            <Layers3 size={14} />用模型加深
          </button>
        </footer>
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}

function ArchitectureMap({ briefing }: { briefing: ProjectBriefing }) {
  if (!briefing.layers.length) {
    return (
      <section className="project-studio-map is-empty" aria-label="项目架构">
        <p>还没有足够材料画出全链路。补一段描述或文件路径后再梳理。</p>
      </section>
    );
  }
  return (
    <section className="project-studio-map" aria-label="项目架构">
      <header>
        <h4>全链路</h4>
        <small>{briefing.layers.length} 层 · {briefing.generated_from === "model" ? "模型归纳" : "材料归纳"}</small>
      </header>
      <div className="project-studio-layers">
        {briefing.layers.map((layer, index) => (
          <section key={`${layer.name}-${index}`}>
            <div>
              <p>{layer.name}</p>
              <ol>
                {layer.steps.map((step) => (
                  <li key={`${step.title}-${step.detail}`}>
                    <strong>{step.title}</strong>
                    {step.detail && step.detail !== step.title ? <small>{step.detail}</small> : null}
                  </li>
                ))}
              </ol>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
