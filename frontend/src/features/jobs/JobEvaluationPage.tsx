import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Download, FileText,
  FlaskConical, LoaderCircle, RefreshCw, ShieldAlert, Sparkles, UsersRound, XCircle
} from "lucide-react";
import type { JobEvaluation, JobEvaluationSection, JobProject } from "../../types";
import { fetchWithTimeout } from "../../api/client";
import { useAsyncPolling } from "../../hooks/useAsyncPolling";

type SectionKey = "a" | "b" | "c" | "d" | "e" | "f" | "g";

type Props = {
  apiBase: string;
  job?: JobProject;
  jobId?: number;
  page: "evaluation" | "evaluation_section" | "evaluation_deep" | "comparison";
  sectionKey?: SectionKey;
  comparisonId?: number;
  onBack: () => void;
  onOpenSection: (key: SectionKey) => void;
  onOpenOverview: () => void;
  onOpenDeep: () => void;
  onCreateResume?: () => Promise<unknown>;
  onCreateInterviewKit?: () => Promise<unknown>;
};

const decisionLabels = {
  apply: "值得申请", consider: "可以考虑", research_first: "先研究", skip: "暂不建议"
};
const riskLabels = {
  high_confidence: "未见突出风险", caution: "需要留意", suspicious: "需要重点核实", unknown: "风险未知"
};
const stageLabels: Record<string, string> = {
  queued: "等待开始", extracting: "拆解岗位要求", researching: "核验公开信息",
  scoring: "计算评分与风险", completed: "已完成", failed: "运行失败",
  cancelled: "已取消", interrupted: "已中断"
};

async function requestJson<T>(apiBase: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(`${apiBase}${path}`, init);
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try { message = (await response.json() as { detail?: string }).detail || message; } catch { /* noop */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function StructuredValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="evaluation-unknown">未知</span>;
  if (typeof value === "boolean") return <span>{value ? "是" : "否"}</span>;
  if (typeof value === "string" || typeof value === "number") return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="evaluation-unknown">暂无</span>;
    return <ul>{value.map((item, index) => <li key={index}><StructuredValue value={item} /></li>)}</ul>;
  }
  return (
    <dl className="evaluation-structured">
      {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
        <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd><StructuredValue value={item} /></dd></div>
      ))}
    </dl>
  );
}

function EvaluationRun({ evaluation, onCancel, onRetry }: { evaluation: JobEvaluation; onCancel: () => void; onRetry: () => void }) {
  const finished = evaluation.sections.filter((item) => item.status === "completed" || item.status === "partial").length;
  return (
    <section className="evaluation-running ui-panel-emphasis">
      <LoaderCircle className={evaluation.status === "running" || evaluation.status === "queued" ? "spinning" : ""} size={28} />
      <div><span>岗位匹配分析</span><h2>{stageLabels[evaluation.current_stage] || evaluation.current_stage}</h2><p>已完成 {finished}/7 个分析区块 · 公开查询 {evaluation.research_query_count}/{evaluation.research_budget}</p></div>
      {evaluation.status === "queued" || evaluation.status === "running"
        ? <button onClick={onCancel}><XCircle size={15} />取消</button>
        : <button onClick={onRetry}><RefreshCw size={15} />重试</button>}
    </section>
  );
}

export function JobEvaluationPage(props: Props) {
  const { apiBase, job, jobId, page, sectionKey, comparisonId } = props;
  const [evaluation, setEvaluation] = useState<JobEvaluation | null>(null);
  const [sources, setSources] = useState<Array<Record<string, unknown>>>([]);
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadEvaluation() {
    if (!jobId) return;
    const items = await requestJson<JobEvaluation[]>(apiBase, `/jobs/${jobId}/evaluations`);
    setEvaluation(items[0] || null);
    if (items[0]?.id) {
      setSources(await requestJson<Array<Record<string, unknown>>>(apiBase, `/job-evaluations/${items[0].id}/sources`));
    }
  }

  useEffect(() => {
    setError("");
    if (page === "comparison" && comparisonId) {
      void requestJson<Record<string, unknown>>(apiBase, `/job-comparisons/${comparisonId}`).then(setComparison).catch((reason: Error) => setError(reason.message));
    } else {
      void loadEvaluation().catch((reason: Error) => setError(reason.message));
    }
  }, [apiBase, jobId, page, comparisonId]);

  useAsyncPolling({
    enabled: Boolean(evaluation && ["queued", "running"].includes(evaluation.status)),
    intervalMs: 1_200,
    poll: loadEvaluation,
    onError: (_reason, failures) => {
      if (failures >= 3) setError("暂时无法获取岗位分析进度，请检查网络后重试。");
    }
  });

  async function createEvaluation(kind: "full" | "retry" | "deep") {
    if (!jobId) return;
    if (kind === "full" && !window.confirm("本次完整评估最多执行 5 次公开搜索，用于薪资和岗位风险核实。是否继续？")) return;
    setBusy(true); setError("");
    try {
      const path = kind === "full" ? `/jobs/${jobId}/evaluations` : `/job-evaluations/${evaluation?.id}/${kind === "deep" ? "deep-research" : "retry"}`;
      const body = kind === "full" ? JSON.stringify({ strategy_id: job?.career_strategy_id || null, include_public_research: true }) : undefined;
      const created = await requestJson<JobEvaluation>(apiBase, path, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body });
      setEvaluation(created);
      if (kind === "deep") props.onOpenDeep();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建评估失败"); }
    finally { setBusy(false); }
  }

  async function cancelEvaluation() {
    if (!evaluation) return;
    setEvaluation(await requestJson<JobEvaluation>(apiBase, `/job-evaluations/${evaluation.id}/cancel`, { method: "POST" }));
  }

  async function reviewRisk(riskKey: string, action: "resolve" | "restore") {
    if (!evaluation) return;
    setBusy(true);
    try {
      setEvaluation(await requestJson<JobEvaluation>(apiBase, `/job-evaluations/${evaluation.id}/reviews`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_type: "risk", target_key: riskKey, action, override: {}, note: "用户在报告详情页审核" })
      }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "审核保存失败"); }
    finally { setBusy(false); }
  }

  const currentSection = useMemo(() => evaluation?.sections.find((item) => item.section_key === sectionKey), [evaluation, sectionKey]);

  if (page === "comparison") {
    const result = (comparison?.result || {}) as Record<string, unknown>;
    const entries = (result.entries || []) as Array<Record<string, unknown>>;
    return <section className="evaluation-page"><button className="back-link" onClick={props.onBack}><ArrowLeft size={15} />返回求职准备</button><header className="evaluation-title"><div><span>岗位比较</span><h1>值得优先投入的岗位</h1><p>结合匹配程度和需要留意的事项，帮助你安排投递顺序。</p></div></header>{error ? <p className="inline-error">{error}</p> : null}<section className="comparison-table ui-panel"><header><span>名次</span><span>岗位</span><span>匹配程度</span><span>信息完整度</span><span>需要留意</span><span>建议</span></header>{entries.map((entry) => <article key={String(entry.evaluation_id)}><strong>#{String(entry.rank)}</strong><div><b>{String(entry.company_name || "公司待补充")} · {String(entry.job_title || "岗位待补充")}</b><small>{String(entry.location || "地点未知")}</small></div><span>{entry.score == null ? "暂无法判断" : `${String(entry.score)} 分`}</span><span>{String(entry.coverage || 0)}%</span><span>{riskLabels[entry.risk_tier as keyof typeof riskLabels] || String(entry.risk_tier)}</span><span>{decisionLabels[entry.decision as keyof typeof decisionLabels] || String(entry.decision)}</span></article>)}{!entries.length ? <p>还没有可以比较的岗位。</p> : null}</section><footer className="evaluation-limitations"><AlertTriangle size={16} /><div><strong>说明</strong><p>{String(result.ranking_rule || "系统会结合匹配程度、信息完整度和风险提示给出优先顺序。")}</p></div></footer></section>;
  }

  if (!evaluation) {
    return (
      <section className="evaluation-page"><button className="back-link" onClick={props.onBack}><ArrowLeft size={15} />返回求职准备</button>
        <section className="evaluation-empty ui-panel-emphasis"><Sparkles size={30} /><h1>开始岗位匹配分析</h1><p>分析会拆解岗位要求，对照已确认的个人经历，并将不确定信息明确标出。</p>{error ? <p className="inline-error">{error}</p> : null}<button className="primary-action" disabled={busy} onClick={() => void createEvaluation("full")}>{busy ? "正在创建…" : "开始匹配分析"}<ArrowRight size={15} /></button><small>确认后，本次最多使用 5 次公开搜索核验补充信息。</small></section>
      </section>
    );
  }

  const materialReady = ["completed", "partial_failed"].includes(evaluation.status) && !evaluation.is_stale;

  if (["queued", "running", "failed", "cancelled", "interrupted"].includes(evaluation.status)) {
    return <section className="evaluation-page"><button className="back-link" onClick={props.onBack}><ArrowLeft size={15} />返回求职准备</button><EvaluationRun evaluation={evaluation} onCancel={() => void cancelEvaluation()} onRetry={() => void createEvaluation("retry")} />{evaluation.error_message ? <p className="inline-error">{evaluation.error_message}</p> : null}</section>;
  }

  if (page === "evaluation_section" && currentSection) {
    const risks = evaluation.effective_risks || evaluation.risks;
    return (
      <section className="evaluation-page"><button className="back-link" onClick={props.onOpenOverview}><ArrowLeft size={15} />返回评估首页</button>
        <header className="evaluation-title"><div><span>岗位匹配详情</span><h1>{currentSection.title}</h1><p>{currentSection.status === "partial" ? "部分信息尚不完整，请结合未确认项判断。" : "查看这项岗位信息与你的经历是否匹配。"}</p></div>{currentSection.section_key === "e" && props.onCreateResume ? <button disabled={!materialReady || busy} title={!materialReady ? "请先完成或更新有效的岗位分析" : undefined} onClick={() => void props.onCreateResume?.()}><FileText size={15} />创建定制简历</button> : null}{currentSection.section_key === "f" && props.onCreateInterviewKit ? <button disabled={!materialReady || busy} title={!materialReady ? "请先完成或更新有效的岗位分析" : undefined} onClick={() => void props.onCreateInterviewKit?.()}><UsersRound size={15} />创建面试包</button> : null}</header>
        {error ? <p className="inline-error">{error}</p> : null}
        <section className="evaluation-detail ui-panel"><StructuredValue value={currentSection.content} /></section>
        {currentSection.section_key === "g" && risks.length ? <section className="evaluation-risks"><h2>风险观察与审核</h2>{risks.map((risk) => <article className={`risk-${risk.effective_severity || risk.severity}`} key={risk.risk_key}><div><strong>{risk.observation}</strong><p>{risk.explanation}</p><small>{risk.effective_status === "resolved" ? "你的审核：已解决/不采用" : `系统原判：${risk.severity}`}</small></div><button disabled={busy} onClick={() => void reviewRisk(risk.risk_key, risk.effective_status === "resolved" ? "restore" : "resolve")}>{risk.effective_status === "resolved" ? "恢复原判" : "标记已解决"}</button></article>)}</section> : null}
        {currentSection.limitations.length ? <footer className="evaluation-limitations"><AlertTriangle size={16} /><div><strong>限制</strong>{currentSection.limitations.map((item) => <p key={item}>{item}</p>)}</div></footer> : null}
        <section className="evaluation-sources ui-panel"><h2>参考信息</h2><p>以下内容帮助你核对岗位与公司信息。</p>{sources.length ? <div>{sources.map((source, index) => <article key={String(source.id || source.source_key || index)}><div><strong>{String(source.title || "未命名资料")}</strong><small>{String(source.source_type || "公开信息")}</small></div>{source.url ? <a href={String(source.url)} target="_blank" rel="noreferrer">查看原网页</a> : null}<p>{String(source.excerpt || "暂无摘要")}</p></article>)}</div> : null}</section>
      </section>
    );
  }

  if (page === "evaluation_deep") {
    return <section className="evaluation-page"><button className="back-link" onClick={props.onOpenOverview}><ArrowLeft size={15} />返回岗位建议</button><section className="evaluation-empty ui-panel-emphasis"><FlaskConical size={30} /><h1>补充岗位信息</h1><p>{evaluation.mode === "deep" ? "补充的信息已整理完成。" : "进一步核对薪资、公司和岗位信息，帮助你判断是否值得投入。"}</p><button className="primary-action" disabled={busy || evaluation.mode === "deep"} onClick={() => void createEvaluation("deep")}>{evaluation.mode === "deep" ? "补充已完成" : "开始补充"}</button><small>无法确认的信息会明确标注，供你自行判断。</small></section></section>;
  }

  const score = evaluation.effective_overall_score;
  return (
    <section className="evaluation-page"><button className="back-link" onClick={props.onBack}><ArrowLeft size={15} />返回求职准备</button>
      <header className="evaluation-title"><div><span>岗位建议</span><h1>{decisionLabels[evaluation.effective_final_decision]}</h1><p>{score === null ? "目前信息不足，建议补充后再判断。" : `综合匹配程度 ${score} / 100`}</p></div><div className="evaluation-actions"><a href={`${apiBase}/job-evaluations/${evaluation.id}/export?format=markdown`}><Download size={15} />导出建议</a><button onClick={props.onOpenDeep}><FlaskConical size={15} />补充信息</button><button disabled={busy} onClick={() => void createEvaluation("retry")}><RefreshCw size={15} />更新建议</button></div></header>
      {evaluation.is_stale ? <section className="evaluation-stale"><AlertTriangle size={18} /><div><strong>这份报告已过期</strong><p>{evaluation.stale_reasons.join("；")}</p></div></section> : null}
      <div className="evaluation-dual"><article><CheckCircle2 size={20} /><span>匹配建议</span><strong>{decisionLabels[evaluation.effective_final_decision]}</strong><small>{score === null ? "暂时无法判断" : `${score} / 100`}</small></article><article className={`risk-${evaluation.effective_risk_tier}`}><ShieldAlert size={20} /><span>岗位风险提示</span><strong>{riskLabels[evaluation.effective_risk_tier]}</strong><small>投递前建议核对</small></article></div>
      <section className="evaluation-journey" aria-label="求职推进路径">
        <header>
          <div>
            <span className="evaluation-journey-kicker">下一步</span>
            <h2>确认分析后继续准备</h2>
          </div>
          <p>先确认匹配依据，再生成材料和记录面试；所有内容都保留在同一个岗位下。</p>
        </header>
        <div className="evaluation-journey-steps">
          <article className="active">
            <span>1</span>
            <div>
              <strong>匹配分析</strong>
              <small>查看岗位要求、匹配依据与待确认风险</small>
            </div>
          </article>
          <article>
            <span>2</span>
            <div>
              <strong>定制简历</strong>
              <small>逐项确认修改，再导出 PDF</small>
            </div>
              {props.onCreateResume ? (
              <button disabled={!materialReady || busy} title={!materialReady ? "请先完成或更新有效的 A–G 评估" : undefined} onClick={() => void props.onCreateResume?.()}>
                创建版本<ArrowRight size={14} />
              </button>
            ) : null}
          </article>
          <article>
            <span>3</span>
            <div>
              <strong>重点问答与复盘</strong>
              <small>准备下一轮，并记录真实问题和反馈</small>
            </div>
            {props.onCreateInterviewKit ? (
              <button disabled={!materialReady || busy} title={!materialReady ? "请先完成或更新有效的 A–G 评估" : undefined} onClick={() => void props.onCreateInterviewKit?.()}>
                创建重点问答<ArrowRight size={14} />
              </button>
            ) : null}
          </article>
        </div>
      </section>
      <section className="evaluation-dimensions ui-panel"><h2>匹配情况</h2><div>{evaluation.effective_dimensions.map((item) => <article key={item.dimension_key}><header><strong>{item.title}</strong><span>{item.effective_status === "unknown" || item.status === "unknown" ? "待补充" : `${item.effective_score ?? item.score} 分`}</span></header><div><i style={{ width: `${item.effective_score ?? item.score ?? 0}%` }} /></div><small>{(item.rationale || []).join("；")}</small></article>)}</div></section>
      <section className="evaluation-section-grid">{evaluation.sections.map((section) => <button key={section.section_key} onClick={() => props.onOpenSection(section.section_key)}><span>{section.section_key.toUpperCase()}</span><div><strong>{section.title}</strong><small>{section.status === "partial" ? "部分完成 · 有限制" : section.status === "completed" ? "已完成" : stageLabels[section.status] || section.status}</small></div><ArrowRight size={16} /></button>)}</section>
      <footer className="evaluation-limitations"><AlertTriangle size={16} /><div><strong>报告边界</strong>{evaluation.limitations.map((item) => <p key={item}>{item}</p>)}</div></footer>
    </section>
  );
}
