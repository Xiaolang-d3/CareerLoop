import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Plus,
  RotateCcw,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createApiClient } from "../../api/client";
import { ActionButton } from "../../components/ui/ActionButton";
import type {
  CareerProfileBundle,
  DiscoveredJobAssessment,
  DiscoveredOpportunity,
  JobProject,
  OpportunityRun,
  OpportunityRunMode,
  OpportunitySource
} from "../../types";

type Page = "index" | "new" | "pipeline" | "sources" | "run" | "job";

type Props = {
  apiBase: string;
  accessToken: string;
  page: Page;
  runId?: number;
  discoveredJobId?: number;
  onNavigateHome: () => void;
  onNavigatePipeline: () => void;
  onNavigateSources: () => void;
  onNavigateRun: (runId: number) => void;
  onNavigateJob: (jobId: number) => void;
  onJobsChanged: () => void | Promise<void>;
  onOpenPreparedJob: (jobId: number) => void;
};

const modeMeta: Record<OpportunityRunMode, { title: string }> = {
  scan: { title: "扫描来源" },
  discover: { title: "识别公司 ATS" },
  company_funded: { title: "近期融资公司" },
  pipeline: { title: "评估待处理岗位" },
  batch: { title: "批量并行初筛" }
};

const runStatusLabel: Record<OpportunityRun["status"], string> = {
  queued: "等待开始",
  running: "运行中",
  waiting_for_user: "等待你的操作",
  completed: "已完成",
  partial_failed: "部分失败",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断"
};

const decisionLabel: Record<DiscoveredOpportunity["lifecycle_status"], string> = {
  discovered: "待评估",
  shortlisted: "已入围",
  saved: "已保存项目",
  dismissed: "已忽略"
};

function scoreLabel(score?: number) {
  if (score === undefined) return "待评估";
  if (score >= 75) return `${score} · 高匹配`;
  if (score >= 55) return `${score} · 可关注`;
  return `${score} · 需判断`;
}

const triageVerdictLabel = { pass: "值得关注", marginal: "可以看看", fail: "匹配度较低", skip: "暂不判断" };

export function OpportunityDiscoveryPage({
  apiBase,
  accessToken,
  page,
  runId,
  discoveredJobId,
  onNavigateHome,
  onNavigatePipeline,
  onNavigateSources,
  onNavigateRun,
  onNavigateJob,
  onJobsChanged,
  onOpenPreparedJob
}: Props) {
  const fetchJson = useMemo(() => createApiClient(apiBase, accessToken), [apiBase, accessToken]);
  const [jobs, setJobs] = useState<DiscoveredOpportunity[]>([]);
  const [sources, setSources] = useState<OpportunitySource[]>([]);
  const [career, setCareer] = useState<CareerProfileBundle | null>(null);
  const [run, setRun] = useState<OpportunityRun | null>(null);
  const [job, setJob] = useState<DiscoveredOpportunity | null>(null);
  const [assessments, setAssessments] = useState<DiscoveredJobAssessment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preparedJobIds, setPreparedJobIds] = useState<Record<number, number>>({});

  const refreshOverview = useCallback(async () => {
    const [nextJobs, nextSources, nextCareer] = await Promise.all([
      fetchJson<DiscoveredOpportunity[]>("/discovered-jobs"),
      fetchJson<OpportunitySource[]>("/opportunity-sources"),
      fetchJson<CareerProfileBundle>("/career-profile")
    ]);
    setJobs(nextJobs);
    setSources(nextSources);
    setCareer(nextCareer);
  }, [fetchJson]);

  useEffect(() => {
    if (page === "run" || page === "job") return;
    setBusy(true);
    refreshOverview().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "读取岗位发现数据失败");
    }).finally(() => setBusy(false));
  }, [page, refreshOverview]);

  useEffect(() => {
    if (page !== "run" || !runId) return;
    let active = true;
    let timer = 0;
    const load = async () => {
      try {
        const next = await fetchJson<OpportunityRun>(`/opportunity-runs/${runId}`);
        if (!active) return;
        setRun(next);
        if (["queued", "running"].includes(next.status)) {
          timer = window.setTimeout(() => void load(), 1200);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "读取运行详情失败");
      }
    };
    setBusy(true);
    void load().finally(() => active && setBusy(false));
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [fetchJson, page, runId]);

  useEffect(() => {
    if (page !== "job" || !discoveredJobId) return;
    setBusy(true);
    Promise.all([
      fetchJson<DiscoveredOpportunity>(`/discovered-jobs/${discoveredJobId}`),
      fetchJson<DiscoveredJobAssessment[]>(`/discovered-jobs/${discoveredJobId}/assessments`)
    ]).then(([nextJob, nextAssessments]) => {
      setJob(nextJob);
      setAssessments(nextAssessments);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "读取岗位详情失败"))
      .finally(() => setBusy(false));
  }, [discoveredJobId, fetchJson, page]);

  async function decide(target: DiscoveredOpportunity, status: "shortlisted" | "dismissed") {
    setBusy(true);
    try {
      await fetchJson(`/discovered-jobs/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (job?.id === target.id) setJob({ ...job, lifecycle_status: status });
      await refreshOverview();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新岗位状态失败");
    } finally {
      setBusy(false);
    }
  }

  async function promote(target: DiscoveredOpportunity) {
    setBusy(true);
    try {
      const prepared = await fetchJson<JobProject>(`/discovered-jobs/${target.id}/promote${career?.active_strategy ? `?strategy_id=${career.active_strategy.id}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "medium" })
      });
      if (job?.id === target.id) setJob({ ...job, lifecycle_status: "saved" });
      setPreparedJobIds((current) => ({ ...current, [target.id]: prepared.id }));
      await onJobsChanged();
      onOpenPreparedJob(prepared.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存岗位项目失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="opportunity-shell">
      {error ? <div className="feedback-banner error-banner"><AlertTriangle size={16} /><span>{error}</span><button onClick={() => setError("")} aria-label="关闭错误"><XCircle size={15} /></button></div> : null}
      {busy && !run && !job ? <div className="page-loading"><LoaderCircle className="spinning" size={18} />正在读取岗位发现数据…</div> : null}

      {page === "index" || page === "new" ? <OpportunityHome
        jobs={jobs} sources={sources}
        onPipeline={onNavigatePipeline} onSources={onNavigateSources}
        onJob={onNavigateJob}
      /> : null}
      {page === "pipeline" ? <PipelinePage
        jobs={jobs} busy={busy}
        onBack={onNavigateHome} onOpen={onNavigateJob}
        onDecide={(target, status) => void decide(target, status)}
      /> : null}
      {page === "sources" ? <SourcesPage
        apiBase={apiBase} sources={sources} onBack={onNavigateHome}
        onRefresh={refreshOverview}
      /> : null}
      {page === "run" ? <RunDetailPage
        run={run} busy={busy} onBack={onNavigateHome} onJob={onNavigateJob}
        onCancel={async () => {
          if (!run) return;
          const next = await fetchJson<OpportunityRun>(`/opportunity-runs/${run.id}/cancel`, { method: "POST" });
          setRun(next);
        }}
        onRetry={async () => {
          if (!run) return;
          const next = await fetchJson<OpportunityRun>(`/opportunity-runs/${run.id}/retry`, { method: "POST" });
          onNavigateRun(next.id);
        }}
      /> : null}
      {page === "job" ? <JobDetailPage
        job={job} assessments={assessments} busy={busy} onBack={onNavigatePipeline}
        preparedJobId={job ? preparedJobIds[job.id] : undefined}
        onOpenOpportunities={onNavigateHome}
        onOpenPreparedJob={onOpenPreparedJob}
        onDecide={(status) => job && void decide(job, status)}
        onPromote={() => job && void promote(job)}
      /> : null}
    </div>
  );
}

function OpportunityHome({ jobs, sources, onPipeline, onSources, onJob }: {
  jobs: DiscoveredOpportunity[]; sources: OpportunitySource[];
  onPipeline: () => void; onSources: () => void; onJob: (id: number) => void;
}) {
  const pending = jobs.filter((item) => item.lifecycle_status === "discovered");
  const shortlisted = jobs.filter((item) => item.lifecycle_status === "shortlisted");
  const sourceErrors = sources.filter((item) => item.last_status === "failed");
  const ranked = jobs.filter((item) => item.assessment).sort((a, b) => (b.assessment?.score || 0) - (a.assessment?.score || 0)).slice(0, 4);
  return <>
    <section className="opportunity-metrics">
      <button onClick={onPipeline}><small>待评估</small><strong>{pending.length}</strong><span>进入队列<ArrowRight size={13} /></span></button>
      <button onClick={onPipeline}><small>已入围</small><strong>{shortlisted.length}</strong><span>查看候选岗位<ArrowRight size={13} /></span></button>
      <button onClick={onSources}><small>已保存来源</small><strong>{sources.length}</strong><span>{sourceErrors.length ? `${sourceErrors.length} 个异常` : "只作备忘，不会自动扫描"}<ArrowRight size={13} /></span></button>
    </section>
    {ranked.length ? <section className="opportunity-panel"><header><div><h3>值得优先查看</h3><p>推荐只用于排序，不会替你自动入围。</p></div><button onClick={onPipeline}>查看全部</button></header><div className="opportunity-job-grid">{ranked.map((item) => <button key={item.id} onClick={() => onJob(item.id)}><span>{scoreLabel(item.assessment?.score)}</span><strong>{item.company_name} · {item.job_title}</strong><small>{item.location || "地点未注明"} · {item.salary_text || "薪资未注明"}</small></button>)}</div></section> : <section className="opportunity-panel"><div className="opportunity-empty">还没有待处理岗位。请在分析页粘贴 JD 或上传截图。</div></section>}
  </>;
}

function PipelinePage({ jobs, busy, onBack, onOpen, onDecide }: {
  jobs: DiscoveredOpportunity[]; busy: boolean; onBack: () => void; onOpen: (id: number) => void; onDecide: (job: DiscoveredOpportunity, status: "shortlisted" | "dismissed") => void;
}) {
  const visible = jobs.filter((item) => item.lifecycle_status !== "saved");
  return <section className="opportunity-subpage"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />返回机会中心</button><header className="pipeline-header"><div><span className="eyebrow">岗位队列</span><h2>决定哪些岗位值得推进</h2><p>先查看初步匹配结论，再由你决定暂不推进、值得推进或开始求职准备。</p></div></header><div className="pipeline-table"><div className="pipeline-table-head"><span>岗位</span><span>匹配</span><span>状态</span><span>操作</span></div>{visible.map((item) => <article key={item.id}><button className="pipeline-job" onClick={() => onOpen(item.id)}><strong>{item.company_name} · {item.job_title}</strong><small>{item.location || "地点未注明"} · {item.salary_text || "薪资未注明"}</small></button><button className="score-chip" onClick={() => onOpen(item.id)}>{scoreLabel(item.assessment?.score)}</button><span>{decisionLabel[item.lifecycle_status]}</span><div>{item.lifecycle_status === "discovered" ? <><button disabled={busy} onClick={() => onDecide(item, "shortlisted")}>值得推进</button><button disabled={busy} onClick={() => onDecide(item, "dismissed")}>暂不推进</button></> : <button onClick={() => onOpen(item.id)}>查看</button>}</div></article>)}{!visible.length ? <div className="opportunity-empty">队列为空。请在分析页粘贴 JD 或上传截图。</div> : null}</div></section>;
}

function SourcesPage({ apiBase, sources, onBack, onRefresh }: { apiBase: string; sources: OpportunitySource[]; onBack: () => void; onRefresh: () => Promise<void> }) {
  const fetchJson = useMemo(() => createApiClient(apiBase), [apiBase]);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [platform, setPlatform] = useState("");
  async function addSource() {
    await fetchJson("/opportunity-sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "自定义来源", source_url: url, platform, access_mode: platform ? "browser_visible_only" : null }) });
    setAdding(false); setUrl(""); setPlatform(""); await onRefresh();
  }
  return <section className="opportunity-subpage"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />返回机会中心</button><header className="pipeline-header"><div><span className="eyebrow">来源备忘</span><h2>公司与招聘来源</h2><p>只保存链接，不会自动扫描。需要登录的平台请改用粘贴 JD 或上传截图。</p></div><div><button onClick={() => setAdding((value) => !value)}><Plus size={15} />添加来源</button></div></header>{adding ? <div className="opportunity-form-card compact"><div className="form-row"><label><span>招聘页或已保存搜索页</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></label><label><span>平台（可选）</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="">未指定</option><option value="boss">BOSS 直聘</option><option value="liepin">猎聘</option><option value="zhaopin">智联招聘</option><option value="51job">前程无忧</option></select></label></div><footer><button onClick={() => setAdding(false)}>取消</button><ActionButton variant="primary" disabled={!url.trim()} onClick={() => void addSource()}>保存来源</ActionButton></footer></div> : null}<div className="source-card-grid">{sources.map((source) => <article key={source.id}><div className={`source-icon ${source.access_mode}`}><Building2 size={18} /></div><div><small>{source.platform || source.provider || "来源"}</small><h3>{source.company_name || source.platform || source.provider}</h3><p>{source.source_url}</p></div><div><a href={source.source_url} target="_blank" rel="noreferrer" aria-label="打开来源"><ExternalLink size={15} /></a></div></article>)}{!sources.length ? <div className="opportunity-empty">还没有保存来源。需要岗位时，请在分析页粘贴 JD 或上传截图。</div> : null}</div></section>;
}

function RunDetailPage({ run, busy, onBack, onJob, onCancel, onRetry }: { run: OpportunityRun | null; busy: boolean; onBack: () => void; onJob: (id: number) => void; onCancel: () => Promise<void>; onRetry: () => Promise<void> }) {
  if (!run) return <div className="page-loading"><LoaderCircle className="spinning" size={18} />正在读取运行详情…</div>;
  const active = ["queued", "running"].includes(run.status);
  const progress = run.total_count ? Math.round(run.completed_count / run.total_count * 100) : active ? 8 : 100;
  return <section className="opportunity-subpage"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />返回机会中心</button><header className="run-detail-header"><div><span className="eyebrow">运行 #{run.id}</span><h2>{modeMeta[run.mode].title}</h2><p>{runStatusLabel[run.status]} · {run.created_at}</p></div><div>{active ? <button disabled={busy} onClick={() => void onCancel()}><XCircle size={15} />取消</button> : run.status !== "completed" ? <button onClick={() => void onRetry()}><RotateCcw size={15} />重试</button> : null}</div></header><div className="run-progress-card"><div><strong>{progress}%</strong><span>{run.succeeded_count} 成功 · {run.failed_count} 失败 · {run.waiting_count} 等待操作</span></div><div className="run-progress-track"><i style={{ width: `${progress}%` }} /></div></div>{run.error_message ? <div className="boundary-note error"><AlertTriangle size={18} /><p><strong>运行失败</strong><span>{run.error_message}</span></p></div> : null}<div className="run-item-list">{run.items?.map((item) => <article key={item.id}><span className={`run-item-state ${item.status}`}>{item.status === "completed" ? <CheckCircle2 size={16} /> : item.status === "failed" ? <AlertTriangle size={16} /> : item.status === "waiting_for_user" ? <Clock3 size={16} /> : <LoaderCircle className={item.status === "running" ? "spinning" : ""} size={16} />}</span><div><strong>{item.label}</strong><small>{item.stage}{item.error_message ? ` · ${item.error_message}` : ""}</small></div>{item.status === "waiting_for_user" ? <span>请改用粘贴 JD 或上传截图</span> : item.entity_type === "job" && item.entity_id ? <button onClick={() => onJob(item.entity_id!)}>查看岗位</button> : null}</article>)}{!run.items?.length ? <div className="opportunity-empty">任务尚未产生处理项。</div> : null}</div></section>;
}

function JobDetailPage({ job, assessments, busy, onBack, preparedJobId, onOpenOpportunities, onOpenPreparedJob, onDecide, onPromote }: {
  job: DiscoveredOpportunity | null;
  assessments: DiscoveredJobAssessment[];
  busy: boolean;
  onBack: () => void;
  preparedJobId?: number;
  onOpenOpportunities: () => void;
  onOpenPreparedJob: (jobId: number) => void;
  onDecide: (status: "shortlisted" | "dismissed") => void;
  onPromote: () => void;
}) {
  if (!job) return <div className="page-loading"><LoaderCircle className="spinning" size={18} />正在读取岗位详情…</div>;
  const current = assessments.find((item) => item.status === "current") || assessments[0];
  return <section className="opportunity-subpage"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />返回岗位队列</button><header className="job-discovery-header"><div><span className="eyebrow">{decisionLabel[job.lifecycle_status]}</span><h2>{job.company_name} · {job.job_title}</h2><p>{job.location || "地点未注明"} · {job.salary_text || "薪资未注明"}</p>{job.lifecycle_status === "saved" ? <p>已保存到分析</p> : null}</div><div>{job.lifecycle_status === "discovered" ? <><button disabled={busy} onClick={() => onDecide("dismissed")}>暂不推进</button><ActionButton variant="primary" disabled={busy} onClick={() => onDecide("shortlisted")}>值得推进</ActionButton></> : job.lifecycle_status === "shortlisted" ? <ActionButton variant="primary" disabled={busy || job.posting_status === "closed"} onClick={onPromote}><Plus size={15} />开始求职准备</ActionButton> : job.lifecycle_status === "saved" ? preparedJobId ? <button type="button" onClick={() => onOpenPreparedJob(preparedJobId)}>打开分析</button> : <button type="button" onClick={onOpenOpportunities}>回机会中心</button> : null}</div></header><div className="job-discovery-grid"><div className="opportunity-panel"><header><div><h3>岗位要求</h3><p>这是招聘方发布的岗位信息，供你判断是否值得投递。</p></div>{job.canonical_url ? <a href={job.canonical_url} target="_blank" rel="noreferrer">查看原网页<ExternalLink size={14} /></a> : null}</header><div className="job-description">{job.description || "当前页面没有提供完整的岗位描述。"}</div></div><aside className="assessment-panel"><span>初步建议</span>{current ? <><strong>{triageVerdictLabel[current.verdict]} · {current.score} 分</strong><small>这是根据当前资料给出的初步参考，完整准备前还会进一步核对。</small>{current.hard_conflicts.length ? <div className="assessment-block danger"><b>需要注意</b>{current.hard_conflicts.map((item) => <p key={item}>{item}</p>)}</div> : null}{current.soft_risks.length ? <div className="assessment-block"><b>还需确认</b>{current.soft_risks.map((item) => <p key={item}>{item}</p>)}</div> : null}<div className="assessment-block"><b>推荐原因</b>{current.reasons.map((item) => <p key={item}>{item}</p>)}</div><div className="assessment-block"><b>建议补充的经历</b>{current.evidence_gaps.slice(0, 8).map((item) => <span key={item}>{item}</span>)}</div></> : <><strong>等待初步建议</strong><small>读取完成后会根据你的求职资料给出初步建议。</small></>}</aside></div></section>;
}
