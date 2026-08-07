import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  ListFilter,
  LoaderCircle,
  Play,
  Plus,
  Radar,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createApiClient } from "../../api/client";
import type {
  CareerProfileBundle,
  DiscoveredJobAssessment,
  DiscoveredOpportunity,
  OpportunityRun,
  OpportunityRunMode,
  OpportunitySource
} from "../../types";
import { captureBrowserJobPage, detectBrowserBridge } from "../browser/browserBridge";

type Page = "index" | "new" | "pipeline" | "sources" | "run" | "job";

type Props = {
  apiBase: string;
  page: Page;
  runId?: number;
  discoveredJobId?: number;
  onNavigateHome: () => void;
  onNavigateNew: () => void;
  onNavigatePipeline: () => void;
  onNavigateSources: () => void;
  onNavigateRun: (runId: number) => void;
  onNavigateJob: (jobId: number) => void;
  onJobsChanged: () => void | Promise<void>;
};

const modeMeta: Record<OpportunityRunMode, { title: string; summary: string; icon: typeof Radar }> = {
  scan: { title: "扫描来源", summary: "刷新关注的公司官网与公开招聘源；国内平台等待你读取当前页。", icon: Radar },
  discover: { title: "识别公司 ATS", summary: "根据公司名单找到官网、招聘页和所使用的招聘系统。", icon: Building2 },
  company_funded: { title: "近期融资公司", summary: "从公开证据发现近期融资公司，再确认是否值得关注。", icon: CircleDollarSign },
  pipeline: { title: "评估待处理岗位", summary: "按当前职业策略完成归一化、硬条件检查与本地匹配。", icon: ListFilter },
  batch: { title: "批量并行初筛", summary: "使用同一套轻量 Triage 规则处理大量岗位，不生成完整报告。", icon: Sparkles }
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

function splitList(value: string) {
  return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
}

function scoreLabel(score?: number) {
  if (score === undefined) return "待评估";
  if (score >= 75) return `${score} · 高匹配`;
  if (score >= 55) return `${score} · 可关注`;
  return `${score} · 需判断`;
}

const triageVerdictLabel = { pass: "PASS", marginal: "MARGINAL", fail: "FAIL", skip: "SKIP" };

export function OpportunityDiscoveryPage({
  apiBase,
  page,
  runId,
  discoveredJobId,
  onNavigateHome,
  onNavigateNew,
  onNavigatePipeline,
  onNavigateSources,
  onNavigateRun,
  onNavigateJob,
  onJobsChanged
}: Props) {
  const fetchJson = useMemo(() => createApiClient(apiBase), [apiBase]);
  const [runs, setRuns] = useState<OpportunityRun[]>([]);
  const [jobs, setJobs] = useState<DiscoveredOpportunity[]>([]);
  const [sources, setSources] = useState<OpportunitySource[]>([]);
  const [career, setCareer] = useState<CareerProfileBundle | null>(null);
  const [run, setRun] = useState<OpportunityRun | null>(null);
  const [job, setJob] = useState<DiscoveredOpportunity | null>(null);
  const [assessments, setAssessments] = useState<DiscoveredJobAssessment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedJobs, setSelectedJobs] = useState<number[]>([]);
  const refreshOverview = useCallback(async () => {
    const [nextRuns, nextJobs, nextSources, nextCareer] = await Promise.all([
      fetchJson<OpportunityRun[]>("/opportunity-runs?limit=30"),
      fetchJson<DiscoveredOpportunity[]>("/discovered-jobs"),
      fetchJson<OpportunitySource[]>("/opportunity-sources"),
      fetchJson<CareerProfileBundle>("/career-profile")
    ]);
    setRuns(nextRuns);
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

  async function readVisiblePage() {
    setBusy(true);
    setError("");
    try {
      const bridge = await detectBrowserBridge();
      if (!bridge.available) throw new Error("未检测到浏览器助手。请安装或刷新浏览器助手后重试。");
      const capture = await captureBrowserJobPage();
      const result = await fetchJson<{ job: DiscoveredOpportunity; run: OpportunityRun }>("/opportunities/browser-detail-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...capture, user_initiated: true })
      });
      setNotice(`已读取 ${result.job.company_name} · ${result.job.job_title}，正在进行本地初筛。`);
      onNavigateRun(result.run.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取当前招聘页失败");
    } finally {
      setBusy(false);
    }
  }

  async function createRun(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const created = await fetchJson<OpportunityRun>("/opportunity-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      onNavigateRun(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建岗位发现任务失败");
    } finally {
      setBusy(false);
    }
  }

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
      await fetchJson(`/discovered-jobs/${target.id}/promote${career?.active_strategy ? `?strategy_id=${career.active_strategy.id}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "medium" })
      });
      setNotice("已保存为正式岗位项目。");
      if (job?.id === target.id) setJob({ ...job, lifecycle_status: "saved" });
      await onJobsChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存岗位项目失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="opportunity-shell">
      {error ? <div className="feedback-banner error-banner"><AlertTriangle size={16} /><span>{error}</span><button onClick={() => setError("")} aria-label="关闭错误"><XCircle size={15} /></button></div> : null}
      {notice ? <div className="feedback-banner notice-banner"><CheckCircle2 size={16} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="关闭提示"><XCircle size={15} /></button></div> : null}
      {busy && !run && !job ? <div className="page-loading"><LoaderCircle className="spinning" size={18} />正在读取岗位发现数据…</div> : null}

      {page === "index" ? <OpportunityHome
        runs={runs} jobs={jobs} sources={sources}
        onNew={onNavigateNew} onPipeline={onNavigatePipeline} onSources={onNavigateSources}
        onRun={onNavigateRun} onJob={onNavigateJob}
      /> : null}
      {page === "new" ? <NewRunPage
        busy={busy} strategyId={career?.active_strategy?.id || null}
        onBack={onNavigateHome} onCreate={(payload) => void createRun(payload)}
      /> : null}
      {page === "pipeline" ? <PipelinePage
        jobs={jobs} selected={selectedJobs} busy={busy}
        onBack={onNavigateHome} onOpen={onNavigateJob}
        onToggle={(id) => setSelectedJobs((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
        onRun={() => void createRun({ mode: "batch", strategy_id: career?.active_strategy?.id || null, job_ids: selectedJobs, deep_analysis: "none" })}
        onDecide={(target, status) => void decide(target, status)}
      /> : null}
      {page === "sources" ? <SourcesPage
        apiBase={apiBase} sources={sources} busy={busy} onBack={onNavigateHome}
        onRefresh={refreshOverview} onRun={(sourceIds) => void createRun({ mode: "scan", source_ids: sourceIds })}
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
        onReadVisible={() => void readVisiblePage()}
      /> : null}
      {page === "job" ? <JobDetailPage
        job={job} assessments={assessments} busy={busy} onBack={onNavigatePipeline}
        onDecide={(status) => job && void decide(job, status)}
        onPromote={() => job && void promote(job)}
      /> : null}
    </div>
  );
}

function OpportunityHome({ runs, jobs, sources, onNew, onPipeline, onSources, onRun, onJob }: {
  runs: OpportunityRun[]; jobs: DiscoveredOpportunity[]; sources: OpportunitySource[];
  onNew: () => void; onPipeline: () => void; onSources: () => void; onRun: (id: number) => void; onJob: (id: number) => void;
}) {
  const pending = jobs.filter((item) => item.lifecycle_status === "discovered");
  const shortlisted = jobs.filter((item) => item.lifecycle_status === "shortlisted");
  const sourceErrors = sources.filter((item) => item.last_status === "failed");
  const ranked = jobs.filter((item) => item.assessment).sort((a, b) => (b.assessment?.score || 0) - (a.assessment?.score || 0)).slice(0, 4);
  return <>
    <section className="opportunity-metrics">
      <button onClick={onPipeline}><small>待评估</small><strong>{pending.length}</strong><span>进入队列<ArrowRight size={13} /></span></button>
      <button onClick={onPipeline}><small>已入围</small><strong>{shortlisted.length}</strong><span>查看候选岗位<ArrowRight size={13} /></span></button>
      <button onClick={onSources}><small>已配置来源</small><strong>{sources.length}</strong><span>{sourceErrors.length ? `${sourceErrors.length} 个异常` : "来源正常"}<ArrowRight size={13} /></span></button>
      <button onClick={() => runs[0] && onRun(runs[0].id)}><small>最近任务</small><strong>{runs.length}</strong><span>{runs[0] ? runStatusLabel[runs[0].status] : "尚未运行"}<ArrowRight size={13} /></span></button>
    </section>
    <section className="opportunity-home-grid">
      <div className="opportunity-panel"><header><div><h3>发现方式</h3><p>通过“新建发现任务”进入配置页，首页只保留入口与结果。</p></div></header><div className="mode-preview-grid">{Object.entries(modeMeta).map(([key, meta]) => { const Icon = meta.icon; return <button key={key} onClick={onNew}><Icon size={18} /><span><strong>{meta.title}</strong><small>{meta.summary}</small></span><ArrowRight size={15} /></button>; })}</div></div>
      <div className="opportunity-panel"><header><div><h3>最近运行</h3><p>每次扫描和评估都有可恢复的独立记录。</p></div></header><div className="run-list">{runs.slice(0, 6).map((item) => <button key={item.id} onClick={() => onRun(item.id)}><span className={`run-dot ${item.status}`} /><span><strong>{modeMeta[item.mode].title}</strong><small>{item.created_at} · {item.succeeded_count}/{item.total_count || 0}</small></span><em>{runStatusLabel[item.status]}</em></button>)}{!runs.length ? <div className="opportunity-empty">还没有发现任务。</div> : null}</div></div>
    </section>
    {ranked.length ? <section className="opportunity-panel"><header><div><h3>值得优先查看</h3><p>推荐只用于排序，不会替你自动入围。</p></div><button onClick={onPipeline}>查看全部</button></header><div className="opportunity-job-grid">{ranked.map((item) => <button key={item.id} onClick={() => onJob(item.id)}><span>{scoreLabel(item.assessment?.score)}</span><strong>{item.company_name} · {item.job_title}</strong><small>{item.location || "地点未注明"} · {item.salary_text || "薪资未注明"}</small></button>)}</div></section> : null}
  </>;
}

function NewRunPage({ busy, strategyId, onBack, onCreate }: { busy: boolean; strategyId: number | null; onBack: () => void; onCreate: (payload: Record<string, unknown>) => void }) {
  const [mode, setMode] = useState<OpportunityRunMode>("scan");
  const [query, setQuery] = useState("");
  const [companyNames, setCompanyNames] = useState("");
  const [regions, setRegions] = useState("中国");
  const [industries, setIndustries] = useState("");
  const [windowDays, setWindowDays] = useState(90);
  return <section className="opportunity-subpage">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} />返回岗位发现</button>
    <header><div><span className="eyebrow">新建任务</span><h2>选择发现方式</h2><p>任务创建后进入独立运行详情，不会阻塞这个页面。</p></div></header>
    <div className="mode-select-grid">{(Object.keys(modeMeta) as OpportunityRunMode[]).map((key) => { const meta = modeMeta[key]; const Icon = meta.icon; return <button className={mode === key ? "active" : ""} key={key} onClick={() => setMode(key)}><Icon size={20} /><strong>{meta.title}</strong><span>{meta.summary}</span></button>; })}</div>
    <div className="opportunity-form-card">
      <h3>{modeMeta[mode].title}</h3>
      {mode === "discover" ? <><label><span>发现条件</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：上海 AI 企业" /></label><label><span>指定公司（每行一个，可选）</span><textarea value={companyNames} onChange={(event) => setCompanyNames(event.target.value)} placeholder="字节跳动\n小红书" /></label></> : null}
      {mode === "company_funded" ? <><div className="form-row"><label><span>地区</span><input value={regions} onChange={(event) => setRegions(event.target.value)} /></label><label><span>行业</span><input value={industries} onChange={(event) => setIndustries(event.target.value)} placeholder="人工智能，企业服务" /></label></div><label><span>融资时间窗口</span><select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}><option value={30}>近 30 天</option><option value={90}>近 90 天</option><option value={180}>近 180 天</option></select></label><p className="form-note">融资是公司发现信号，不代表公司一定正在扩招。</p></> : null}
      {mode === "scan" ? <div className="boundary-note"><Radar size={18} /><p><strong>公开来源自动扫描</strong><span>BOSS、猎聘、智联和前程无忧会等待你打开页面并主动读取当前可见内容。</span></p></div> : null}
      {mode === "pipeline" || mode === "batch" ? <div className="boundary-note"><ListFilter size={18} /><p><strong>{mode === "batch" ? "分层批量评估" : "处理待评估队列"}</strong><span>只使用已确认事实计分，结果不会自动改变岗位决策状态。</span></p></div> : null}
      <footer><button onClick={onBack}>取消</button><button className="primary-action" disabled={busy || (mode === "discover" && !query.trim() && !companyNames.trim())} onClick={() => onCreate({ mode, strategy_id: strategyId, query: query.trim(), company_names: splitList(companyNames), regions: splitList(regions), industries: splitList(industries), funding_window_days: windowDays, deep_analysis: "none" })}><Play size={15} />开始运行</button></footer>
    </div>
  </section>;
}

function PipelinePage({ jobs, selected, busy, onBack, onOpen, onToggle, onRun, onDecide }: {
  jobs: DiscoveredOpportunity[]; selected: number[]; busy: boolean; onBack: () => void; onOpen: (id: number) => void; onToggle: (id: number) => void; onRun: () => void; onDecide: (job: DiscoveredOpportunity, status: "shortlisted" | "dismissed") => void;
}) {
  const visible = jobs.filter((item) => item.lifecycle_status !== "saved");
  return <section className="opportunity-subpage"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />返回岗位工作台</button><header className="pipeline-header"><div><span className="eyebrow">JOB QUEUE</span><h2>决定哪些岗位值得推进</h2><p>先查看初步匹配结论，再由你决定暂不推进、值得推进或开始求职准备。</p></div><button className="primary-action" disabled={busy || (!selected.length && !visible.length)} onClick={onRun}><Sparkles size={15} />{selected.length ? `分析选中 ${selected.length} 项` : "分析全部待处理岗位"}</button></header><div className="pipeline-table"><div className="pipeline-table-head"><span>选择</span><span>岗位</span><span>匹配</span><span>状态</span><span>操作</span></div>{visible.map((item) => <article key={item.id}><label aria-label={`选择 ${item.company_name} ${item.job_title}`}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} /></label><button className="pipeline-job" onClick={() => onOpen(item.id)}><strong>{item.company_name} · {item.job_title}</strong><small>{item.location || "地点未注明"} · {item.salary_text || "薪资未注明"}</small></button><button className="score-chip" onClick={() => onOpen(item.id)}>{scoreLabel(item.assessment?.score)}</button><span>{decisionLabel[item.lifecycle_status]}</span><div>{item.lifecycle_status === "discovered" ? <><button onClick={() => onDecide(item, "shortlisted")}>值得推进</button><button onClick={() => onDecide(item, "dismissed")}>暂不推进</button></> : <button onClick={() => onOpen(item.id)}>查看</button>}</div></article>)}{!visible.length ? <div className="opportunity-empty">队列为空。请先通过浏览器扩展读取岗位详情页。</div> : null}</div></section>;
}

function SourcesPage({ apiBase, sources, busy, onBack, onRefresh, onRun }: { apiBase: string; sources: OpportunitySource[]; busy: boolean; onBack: () => void; onRefresh: () => Promise<void>; onRun: (ids: number[]) => void }) {
  const fetchJson = useMemo(() => createApiClient(apiBase), [apiBase]);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [platform, setPlatform] = useState("");
  async function addSource() {
    await fetchJson("/opportunity-sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "自定义来源", source_url: url, platform, access_mode: platform ? "browser_visible_only" : null }) });
    setAdding(false); setUrl(""); setPlatform(""); await onRefresh();
  }
  return <section className="opportunity-subpage"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />返回岗位发现</button><header className="pipeline-header"><div><span className="eyebrow">来源管理</span><h2>公司与招聘来源</h2><p>公开来源可以自动扫描，国内招聘平台只读取你当前可见的页面。</p></div><div><button onClick={() => setAdding((value) => !value)}><Plus size={15} />添加来源</button><button className="primary-action" disabled={busy || !sources.length} onClick={() => onRun(sources.map((item) => item.id))}><RefreshCw size={15} />刷新全部</button></div></header>{adding ? <div className="opportunity-form-card compact"><div className="form-row"><label><span>公开招聘页或已保存搜索页</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></label><label><span>国内平台（可选）</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="">自动识别官网 / ATS</option><option value="boss">BOSS 直聘</option><option value="liepin">猎聘</option><option value="zhaopin">智联招聘</option><option value="51job">前程无忧</option></select></label></div><footer><button onClick={() => setAdding(false)}>取消</button><button className="primary-action" disabled={!url.trim()} onClick={() => void addSource()}>保存来源</button></footer></div> : null}<div className="source-card-grid">{sources.map((source) => <article key={source.id}><div className={`source-icon ${source.access_mode}`}><Building2 size={18} /></div><div><small>{source.access_mode === "browser_visible_only" ? "需主动读取" : source.access_mode === "public_api" ? "公开 API" : "公开招聘页"}</small><h3>{source.company_name || source.platform || source.provider}</h3><p>{source.source_url}</p><span>{source.last_status === "failed" ? "上次扫描失败" : source.last_scanned_at ? `上次扫描 ${source.last_scanned_at}` : "尚未扫描"}</span></div><div><button onClick={() => onRun([source.id])}>{source.access_mode === "browser_visible_only" ? "查看读取步骤" : "扫描"}</button><a href={source.source_url} target="_blank" rel="noreferrer" aria-label="打开来源"><ExternalLink size={15} /></a></div></article>)}{!sources.length ? <div className="opportunity-empty">还没有配置来源。可以添加公司招聘官网或国内平台搜索页。</div> : null}</div></section>;
}

function RunDetailPage({ run, busy, onBack, onJob, onCancel, onRetry, onReadVisible }: { run: OpportunityRun | null; busy: boolean; onBack: () => void; onJob: (id: number) => void; onCancel: () => Promise<void>; onRetry: () => Promise<void>; onReadVisible: () => void }) {
  if (!run) return <div className="page-loading"><LoaderCircle className="spinning" size={18} />正在读取运行详情…</div>;
  const active = ["queued", "running"].includes(run.status);
  const progress = run.total_count ? Math.round(run.completed_count / run.total_count * 100) : active ? 8 : 100;
  return <section className="opportunity-subpage"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />返回岗位发现</button><header className="run-detail-header"><div><span className="eyebrow">运行 #{run.id}</span><h2>{modeMeta[run.mode].title}</h2><p>{runStatusLabel[run.status]} · {run.created_at}</p></div><div>{active ? <button disabled={busy} onClick={() => void onCancel()}><XCircle size={15} />取消</button> : run.status !== "completed" ? <button onClick={() => void onRetry()}><RotateCcw size={15} />重试</button> : null}</div></header><div className="run-progress-card"><div><strong>{progress}%</strong><span>{run.succeeded_count} 成功 · {run.failed_count} 失败 · {run.waiting_count} 等待操作</span></div><div className="run-progress-track"><i style={{ width: `${progress}%` }} /></div></div>{run.error_message ? <div className="boundary-note error"><AlertTriangle size={18} /><p><strong>运行失败</strong><span>{run.error_message}</span></p></div> : null}<div className="run-item-list">{run.items?.map((item) => <article key={item.id}><span className={`run-item-state ${item.status}`}>{item.status === "completed" ? <CheckCircle2 size={16} /> : item.status === "failed" ? <AlertTriangle size={16} /> : item.status === "waiting_for_user" ? <Clock3 size={16} /> : <LoaderCircle className={item.status === "running" ? "spinning" : ""} size={16} />}</span><div><strong>{item.label}</strong><small>{item.stage}{item.error_message ? ` · ${item.error_message}` : ""}</small></div>{item.status === "waiting_for_user" ? <button onClick={onReadVisible}>读取当前页</button> : item.entity_type === "job" && item.entity_id ? <button onClick={() => onJob(item.entity_id!)}>查看岗位</button> : null}</article>)}{!run.items?.length ? <div className="opportunity-empty">任务尚未产生处理项。</div> : null}</div></section>;
}

function JobDetailPage({ job, assessments, busy, onBack, onDecide, onPromote }: { job: DiscoveredOpportunity | null; assessments: DiscoveredJobAssessment[]; busy: boolean; onBack: () => void; onDecide: (status: "shortlisted" | "dismissed") => void; onPromote: () => void }) {
  if (!job) return <div className="page-loading"><LoaderCircle className="spinning" size={18} />正在读取岗位详情…</div>;
  const current = assessments.find((item) => item.status === "current") || assessments[0];
  return <section className="opportunity-subpage"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />返回岗位队列</button><header className="job-discovery-header"><div><span className="eyebrow">{decisionLabel[job.lifecycle_status]}</span><h2>{job.company_name} · {job.job_title}</h2><p>{job.location || "地点未注明"} · {job.salary_text || "薪资未注明"}</p></div><div>{job.lifecycle_status === "discovered" ? <><button disabled={busy} onClick={() => onDecide("dismissed")}>暂不推进</button><button className="primary-action" disabled={busy} onClick={() => onDecide("shortlisted")}>值得推进</button></> : job.lifecycle_status === "shortlisted" ? <button className="primary-action" disabled={busy || job.posting_status === "closed"} onClick={onPromote}><Plus size={15} />开始求职准备</button> : null}</div></header><div className="job-discovery-grid"><div className="opportunity-panel"><header><div><h3>岗位要求</h3><p>来自浏览器读取的原始岗位描述，用于后续匹配分析。</p></div>{job.canonical_url ? <a href={job.canonical_url} target="_blank" rel="noreferrer">打开来源<ExternalLink size={14} /></a> : null}</header><div className="job-description">{job.description || "当前来源没有提供完整岗位描述。"}</div></div><aside className="assessment-panel"><span>初步匹配分析</span>{current ? <><strong>{triageVerdictLabel[current.verdict]} · {current.score}</strong><small>覆盖度 {current.coverage}% · {current.confidence === "high" ? "高" : current.confidence === "medium" ? "中" : "低"}置信度</small>{current.hard_conflicts.length ? <div className="assessment-block danger"><b>需要注意</b>{current.hard_conflicts.map((item) => <p key={item}>{item}</p>)}</div> : null}{current.soft_risks.length ? <div className="assessment-block"><b>待确认风险</b>{current.soft_risks.map((item) => <p key={item}>{item}</p>)}</div> : null}<div className="assessment-block"><b>分析依据</b>{current.reasons.map((item) => <p key={item}>{item}</p>)}</div><div className="assessment-block"><b>建议补充的经历证据</b>{current.evidence_gaps.slice(0, 8).map((item) => <span key={item}>{item}</span>)}</div></> : <><strong>等待初步分析</strong><small>读取完成后会结合已确认的职业资料生成初步匹配结论。</small></>}</aside></div></section>;
}
