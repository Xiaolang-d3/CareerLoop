import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Route,
  Sparkles,
  Wrench
} from "lucide-react";
import { StatusBadge } from "../../components/ui";
import type { AgentOperationsSnapshot } from "../../types";
import "./agent-operations-dashboard.css";


type Props = {
  snapshot: AgentOperationsSnapshot | null;
  days: 7 | 30 | 90;
  loading: boolean;
  onDaysChange: (days: 7 | 30 | 90) => void;
};

const statusMeta = {
  done: { label: "已完成", tone: "success" as const },
  failed: { label: "失败", tone: "danger" as const },
  waiting_user: { label: "等待确认", tone: "warning" as const },
  cancelled: { label: "已取消", tone: "neutral" as const }
};

const routeLabels: Record<string, string> = {
  conversation: "普通咨询",
  resume_review: "简历诊断",
  jd_analysis: "岗位分析",
  tailored_resume: "定制简历",
  interview_advice: "面试准备",
  company_research: "公司研究",
  public_web_search: "公开搜索"
};

function formatLatency(value: number | null) {
  if (value === null) return "—";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} s`;
}

function formatTokens(value: number) {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
}

function formatTime(value: string | null) {
  if (!value) return "暂无记录";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function TrendChart({ data }: { data: AgentOperationsSnapshot["trend"] }) {
  const maxTotal = Math.max(1, ...data.map((item) => item.total));
  const labelEvery = data.length > 30 ? 10 : data.length > 14 ? 5 : 1;
  return (
    <div className="agent-trend-chart" aria-label="Agent 运行状态趋势图">
      <div className="agent-trend-grid" aria-hidden="true"><i /><i /><i /></div>
      <div className="agent-trend-columns">
        {data.map((item, index) => {
          const height = item.total ? Math.max(8, item.total / maxTotal * 100) : 2;
          return (
            <div className="agent-trend-column" key={item.date} title={`${item.label}：${item.total} 次运行`}>
              <div className="agent-trend-value">{item.total || ""}</div>
              <div className="agent-trend-bar" style={{ height: `${height}%` }}>
                {item.total ? (
                  <>
                    <i className="done" style={{ flexGrow: item.done }} />
                    <i className="failed" style={{ flexGrow: item.failed }} />
                    <i className="waiting" style={{ flexGrow: item.waiting_user }} />
                    <i className="cancelled" style={{ flexGrow: item.cancelled }} />
                  </>
                ) : <i className="empty" />}
              </div>
              <span>{index % labelEvery === 0 || index === data.length - 1 ? item.label : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolBars({ data }: { data: AgentOperationsSnapshot["tool_breakdown"] }) {
  const maxCount = Math.max(1, ...data.map((item) => item.count));
  if (!data.length) {
    return <div className="agent-chart-empty"><Wrench size={18} />暂无工具调用</div>;
  }
  return (
    <div className="agent-tool-bars">
      {data.slice(0, 6).map((item) => (
        <div key={item.name}>
          <span title={item.label}>{item.label}</span>
          <div><i style={{ width: `${Math.max(4, item.count / maxCount * 100)}%` }} /></div>
          <strong>{item.count}</strong>
        </div>
      ))}
    </div>
  );
}

export function AgentOperationsDashboard({ snapshot, days, loading, onDaysChange }: Props) {
  const summary = snapshot?.summary;
  return (
    <section className="settings-card agent-operations-card">
      <header className="agent-operations-heading">
        <div className="settings-card-heading">
          <span><Bot size={18} /></span>
          <div>
            <h3>Agent 执行记录</h3>
            <p>回看 Agent 做过的工作、使用的工具和需要处理的异常。</p>
          </div>
        </div>
        <div className="agent-operations-controls">
          <div className="agent-window-switch" aria-label="统计时间范围">
            {([7, 30, 90] as const).map((option) => (
              <button
                className={days === option ? "active" : ""}
                key={option}
                onClick={() => onDaysChange(option)}
              >
                {option} 天
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="agent-operations-freshness">
        <Activity size={13} />
          <span>{loading && !snapshot ? "正在读取 Agent 执行记录…" : `数据更新至 ${formatTime(snapshot?.freshness_at ?? null)}`}</span>
        <em>本机数据</em>
      </div>

      <div className="agent-kpi-grid">
        <article>
          <span><Activity size={14} />运行次数</span>
          <strong>{summary?.total_runs ?? "—"}</strong>
          <small>{summary ? `${summary.successful_runs} 次完成 · ${summary.failed_runs} 次失败` : "等待数据"}</small>
        </article>
        <article>
          <span><CheckCircle2 size={14} />运行成功率</span>
          <strong>{summary?.success_rate == null ? "—" : `${summary.success_rate}%`}</strong>
          <small>{summary?.waiting_runs ? `${summary.waiting_runs} 次等待确认` : "完成状态占全部运行"}</small>
        </article>
        <article>
          <span><Wrench size={14} />工具调用</span>
          <strong>{summary?.total_tool_calls ?? "—"}</strong>
          <small>{summary?.average_rounds == null ? "等待数据" : `平均 ${summary.average_rounds} 轮 / 运行`}</small>
        </article>
        <article>
          <span><Clock3 size={14} />模型 P95 耗时</span>
          <strong>{formatLatency(summary?.model_p95_latency_ms ?? null)}</strong>
          <small>{summary ? `${summary.model_requests} 次同期模型请求` : "等待数据"}</small>
        </article>
        <article>
          <span><Sparkles size={14} />模型 Token</span>
          <strong>{summary ? formatTokens(summary.total_tokens) : "—"}</strong>
          <small>{summary?.model_success_rate == null ? "暂无模型调用" : `模型请求成功率 ${summary.model_success_rate}%`}</small>
        </article>
      </div>

      <div className="agent-charts-grid">
        <article className="agent-chart-panel trend-panel">
          <header>
            <div><strong>运行状态趋势</strong><span>按天统计，柱内展示状态构成</span></div>
            <div className="agent-chart-legend">
              <span className="done">完成</span><span className="failed">失败</span><span className="waiting">等待</span>
            </div>
          </header>
          <TrendChart data={snapshot?.trend ?? []} />
        </article>
        <article className="agent-chart-panel">
          <header>
            <div><strong>工具使用排行</strong><span>按去重后的真实工具调用计数</span></div>
          </header>
          <ToolBars data={snapshot?.tool_breakdown ?? []} />
        </article>
      </div>

      <div className="agent-run-log">
        <header>
          <div><strong>最近运行记录</strong><span>点击记录可查看目标、工具和错误原因</span></div>
          <StatusBadge tone="info" icon={<Route size={12} />}>{snapshot?.recent_runs.length ?? 0} 条</StatusBadge>
        </header>
        {snapshot?.recent_runs.length ? (
          <div className="agent-run-list">
            {snapshot.recent_runs.map((run) => {
              const meta = statusMeta[run.status];
              return (
                <details key={run.id}>
                  <summary>
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    <div><strong>{run.conversation_title}</strong><span>{routeLabels[run.route] || run.route}</span></div>
                    <span>{run.tool_call_count} 个工具 · {run.rounds} 轮</span>
                    <time>{formatTime(run.created_at)}</time>
                  </summary>
                  <div className="agent-run-detail">
                    <div><span>运行目标</span><p>{run.goal}</p></div>
                    <div><span>调用工具</span><p>{run.tools.length ? run.tools.join("、") : "本轮未调用工具"}</p></div>
                    {run.error_message ? (
                      <div className="agent-run-error">
                        <span><CircleAlert size={13} />失败原因</span>
                        <p>{run.error_message}{run.error_code ? `（${run.error_code}）` : ""}</p>
                      </div>
                    ) : null}
                    <small>记录 ID {run.id} · {run.provider || "本地"} / {run.platform || "manual"}</small>
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="agent-run-empty"><Bot size={22} /><span>这个时间范围内还没有 Agent 运行记录。</span></div>
        )}
      </div>

      <footer className="agent-coverage-note">
        <CircleAlert size={13} />
        <span>模型耗时与 Token 为同期请求汇总；单次运行精确耗时和 Token 将随 Agent v1 审计底座接入。</span>
      </footer>
    </section>
  );
}
