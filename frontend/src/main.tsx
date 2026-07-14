import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  GraduationCap,
  Layers3,
  LoaderCircle,
  MapPin,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UserRound
} from "lucide-react";
import "./styles.css";

type Job = {
  id: number;
  source?: string;
  source_url?: string;
  title: string;
  company: string;
  city: string;
  district: string;
  salary_text: string;
  experience: string;
  education: string;
  industry?: string;
  company_size?: string;
  hr_active_text?: string;
  description: string;
  status: string;
};

type Application = {
  id: number;
  job_id: number;
  profile_id: number;
  status: string;
  notes: string;
  job_title?: string;
  company?: string;
};

type WorkflowNode = {
  id: string;
  title: string;
  status: "done" | "in_progress" | "pending" | "blocked";
  detail: string;
};

type WorkflowStatus = {
  run?: { id: number; status: string; current_node: string; updated_at: string };
  status: string;
  counts: { profiles: number; jobs: number; applications: number };
  nodes: WorkflowNode[];
  events?: Array<{
    id: number;
    node_id: string;
    event_type: string;
    message: string;
    created_at: string;
  }>;
};

type AgentRunResult = {
  provider: string;
  platform: string;
  rounds: number;
  events: Array<{
    round: number;
    tool_call_id: string;
    tool_name: string;
    status: string;
    message: string;
  }>;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  payload?: { workflow?: WorkflowStatus; agent?: AgentRunResult };
};

type AgentCapabilities = {
  active_model_provider: string;
  active_model_name: string;
  active_platform: string;
  model_providers: string[];
  platforms: string[];
  tools: string[];
};

type ViewKey = "chat" | "jobs" | "applications" | "review";

const quickPrompts = [
  "帮我找上海的 AI Agent 工程师岗位",
  "搜索杭州的 Python 后端岗位",
  "查看当前求职任务进度"
];

const applicationLabels: Record<string, string> = {
  queued: "待投递",
  applied: "已投递",
  contacted: "已沟通",
  interview: "面试中",
  rejected: "未通过",
  no_response: "暂无回复"
};

const toolLabels: Record<string, string> = {
  search_jobs: "搜索岗位",
  get_job_detail: "读取岗位详情",
  rank_jobs: "分析匹配度"
};

function formatDate(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function App() {
  const apiBase = useMemo(() => `${window.location.protocol}//${window.location.hostname}:8000`, []);
  const [activeView, setActiveView] = useState<ViewKey>("chat");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowStatus | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState("mock");

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;
  const appliedCount = applications.filter((item) => item.status === "applied").length;
  const queuedCount = applications.filter((item) => item.status === "queued").length;
  const completedNodes = workflow?.nodes.filter((node) => node.status === "done").length ?? 0;
  const workflowProgress = workflow?.nodes.length
    ? Math.round((completedNodes / workflow.nodes.length) * 100)
    : 0;

  async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, options);
    if (!response.ok) throw new Error(`${path} 请求失败（${response.status}）`);
    return response.json() as Promise<T>;
  }

  async function refreshData(showFeedback = false) {
    if (showFeedback) setRefreshBusy(true);
    try {
      const [nextJobs, nextApplications, nextWorkflow] = await Promise.all([
        fetchJson<Job[]>("/jobs"),
        fetchJson<Application[]>("/applications"),
        fetchJson<WorkflowStatus>("/workflow/status")
      ]);
      setJobs(nextJobs);
      setApplications(nextApplications);
      setWorkflow(nextWorkflow);
      setSelectedJobId((current) => current ?? nextJobs[0]?.id ?? null);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "数据刷新失败");
    } finally {
      if (showFeedback) setRefreshBusy(false);
    }
  }

  async function refreshChat() {
    setChatMessages(await fetchJson<ChatMessage[]>("/chat/messages"));
  }

  async function refreshCapabilities() {
    const next = await fetchJson<AgentCapabilities>("/agent/capabilities");
    setCapabilities(next);
    setSelectedPlatform(next.active_platform);
  }

  async function sendChatMessage(contentOverride?: string) {
    const content = (contentOverride ?? chatInput).trim();
    if (!content || chatBusy) return;
    setChatBusy(true);
    setChatInput("");
    setErrorMessage("");
    try {
      const response = await fetchJson<{ workflow: WorkflowStatus }>("/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, platform: selectedPlatform })
      });
      setWorkflow(response.workflow);
      await Promise.all([refreshChat(), refreshData()]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "消息发送失败");
      setChatInput(content);
    } finally {
      setChatBusy(false);
    }
  }

  useEffect(() => {
    Promise.all([refreshData(), refreshChat(), refreshCapabilities()]).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "系统连接失败");
    });
  }, []);

  const pageCopy: Record<ViewKey, { eyebrow: string; title: string; subtitle: string }> = {
    chat: {
      eyebrow: "AI JOB COPILOT",
      title: "今天想找什么工作？",
      subtitle: "描述目标，Agent 会调用招聘平台完成搜索、整理和匹配排序。"
    },
    jobs: {
      eyebrow: "JOB WORKSPACE",
      title: "岗位工作台",
      subtitle: "集中查看已采集的真实岗位，并快速判断是否值得继续。"
    },
    applications: {
      eyebrow: "APPLICATIONS",
      title: "投递记录",
      subtitle: "追踪每个岗位从待投递到面试的完整状态。"
    },
    review: {
      eyebrow: "PROGRESS REVIEW",
      title: "求职复盘",
      subtitle: "用真实数据回顾岗位获取、投递进展和工作流状态。"
    }
  };

  const navItems: Array<{ key: ViewKey; label: string; icon: React.ReactNode; count?: number }> = [
    { key: "chat", label: "Agent 对话", icon: <MessageCircle size={18} /> },
    { key: "jobs", label: "岗位工作台", icon: <BriefcaseBusiness size={18} />, count: jobs.length },
    { key: "applications", label: "投递记录", icon: <Layers3 size={18} />, count: applications.length },
    { key: "review", label: "求职复盘", icon: <BarChart3 size={18} /> }
  ];

  function renderExecution(message: ChatMessage) {
    const agentRun = message.payload?.agent;
    if (!agentRun?.events.length) return null;
    return (
      <details className="execution-card">
        <summary>
          <span><CheckCircle2 size={15} /> 已完成 {agentRun.events.length} 个步骤</span>
          <small>{agentRun.platform === "boss" ? "BOSS 直聘" : "模拟平台"} · {agentRun.rounds} 轮</small>
        </summary>
        <div className="execution-list">
          {agentRun.events.map((event) => (
            <div className="execution-row" key={event.tool_call_id}>
              <span className={`event-dot ${event.status}`} />
              <div>
                <strong>{toolLabels[event.tool_name] ?? event.tool_name}</strong>
                <p>{event.message}</p>
              </div>
            </div>
          ))}
        </div>
      </details>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Sparkles size={19} /></span>
          <div><strong>BossCopilot</strong><small>求职 Agent</small></div>
        </div>

        <nav className="nav" aria-label="主导航">
          <span className="nav-label">工作空间</span>
          {navItems.map((item) => (
            <button
              className={`nav-item ${activeView === item.key ? "active" : ""}`}
              key={item.key}
              onClick={() => setActiveView(item.key)}
            >
              {item.icon}<span>{item.label}</span>
              {item.count !== undefined ? <em>{item.count}</em> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <div className="status-heading"><CircleDot size={14} /><span>系统状态</span></div>
          <strong>{capabilities ? "Agent 已就绪" : "正在连接"}</strong>
          <p>{capabilities?.active_model_name ?? "读取运行配置中"}</p>
          <div className="status-meter"><span style={{ width: `${workflowProgress}%` }} /></div>
          <small>任务流完成 {workflowProgress}%</small>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">{pageCopy[activeView].eyebrow}</span>
            <h1>{pageCopy[activeView].title}</h1>
            <p>{pageCopy[activeView].subtitle}</p>
          </div>
          <div className="topbar-actions">
            <span className="live-badge"><span /> 本地运行</span>
            {activeView !== "chat" ? (
              <button className="icon-button" onClick={() => void refreshData(true)} disabled={refreshBusy} title="刷新数据">
                <RefreshCw className={refreshBusy ? "spinning" : ""} size={18} />
              </button>
            ) : null}
          </div>
        </header>

        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

        {activeView === "chat" ? (
          <section className="chat-workspace">
            <div className="chat-main">
              <div className="chat-thread">
                {chatMessages.length === 0 ? (
                  <div className="chat-welcome">
                    <span className="welcome-icon"><Bot size={28} /></span>
                    <h2>从一个求职目标开始</h2>
                    <p>告诉我目标岗位和城市，我会帮你完成搜索和初步筛选。</p>
                  </div>
                ) : (
                  chatMessages.map((message) => (
                    <article className={`message ${message.role}`} key={message.id}>
                      <span className="avatar">{message.role === "user" ? <UserRound size={17} /> : <Sparkles size={17} />}</span>
                      <div className="message-content">
                        <div className="message-meta">
                          <strong>{message.role === "user" ? "你" : "BossCopilot"}</strong>
                          <time>{formatDate(message.created_at)}</time>
                        </div>
                        <p>{message.content}</p>
                        {message.role === "assistant" ? renderExecution(message) : null}
                      </div>
                    </article>
                  ))
                )}
                {chatBusy ? (
                  <article className="message assistant is-loading">
                    <span className="avatar"><Sparkles size={17} /></span>
                    <div className="message-content"><LoaderCircle className="spinning" size={18} /><span>Agent 正在分析并调用工具…</span></div>
                  </article>
                ) : null}
              </div>

              <div className="chat-composer">
                <div className="composer-tools">
                  <label>
                    <Database size={14} /> 数据来源
                    <select value={selectedPlatform} onChange={(event) => setSelectedPlatform(event.target.value)} disabled={chatBusy}>
                      {(capabilities?.platforms ?? ["mock"]).map((platform) => (
                        <option value={platform} key={platform}>{platform === "boss" ? "BOSS 直聘" : "模拟平台"}</option>
                      ))}
                    </select>
                  </label>
                  <span>Enter 发送 · Shift + Enter 换行</span>
                </div>
                <div className="composer-input">
                  <textarea
                    value={chatInput}
                    placeholder="例如：帮我找上海的 AI Agent 工程师岗位，薪资 25K 以上"
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendChatMessage();
                      }
                    }}
                  />
                  <button className="send-button" onClick={() => void sendChatMessage()} disabled={chatBusy || !chatInput.trim()}>
                    <Send size={18} /><span>发送</span>
                  </button>
                </div>
              </div>
            </div>

            <aside className="agent-rail">
              <section className="rail-card agent-card">
                <span className="card-kicker">当前 Agent</span>
                <div className="agent-identity"><span><Bot size={20} /></span><div><strong>求职搜索助手</strong><small>状态正常</small></div></div>
                <dl>
                  <div><dt>模型</dt><dd>{capabilities?.active_model_name ?? "—"}</dd></div>
                  <div><dt>平台</dt><dd>{selectedPlatform === "boss" ? "BOSS 直聘" : "模拟平台"}</dd></div>
                  <div><dt>工具</dt><dd>{capabilities?.tools.length ?? 0} 个</dd></div>
                </dl>
              </section>
              <section className="rail-card">
                <span className="card-kicker">快捷开始</span>
                <div className="quick-prompts">
                  {quickPrompts.map((prompt) => (
                    <button key={prompt} onClick={() => void sendChatMessage(prompt)} disabled={chatBusy}>
                      <span>{prompt}</span><ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              </section>
            </aside>
          </section>
        ) : null}

        {activeView === "jobs" ? (
          jobs.length === 0 ? (
            <div className="large-empty">
              <span><Search size={30} /></span><h2>还没有真实岗位</h2>
              <p>在 Agent 对话中选择 BOSS 直聘并发起搜索，采集到的岗位会出现在这里。</p>
              <button className="primary-button" onClick={() => setActiveView("chat")}><MessageCircle size={17} /> 去搜索岗位</button>
            </div>
          ) : (
            <section className="job-workspace">
              <div className="job-list-panel">
                <div className="section-heading"><div><span>岗位列表</span><strong>{jobs.length} 个结果</strong></div></div>
                <div className="job-list">
                  {jobs.map((job) => (
                    <button className={`job-card ${selectedJob?.id === job.id ? "active" : ""}`} key={job.id} onClick={() => setSelectedJobId(job.id)}>
                      <div className="job-card-top"><strong>{job.title}</strong><em>{job.salary_text || "薪资面议"}</em></div>
                      <span><Building2 size={14} />{job.company}</span>
                      <div className="job-tags">
                        {job.city ? <small><MapPin size={12} />{job.city}{job.district}</small> : null}
                        {job.experience ? <small>{job.experience}</small> : null}
                        {job.education ? <small>{job.education}</small> : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {selectedJob ? (
                <article className="job-detail">
                  <div className="job-detail-header">
                    <div><span>{selectedJob.source?.toUpperCase() || "BOSS"}</span><h2>{selectedJob.title}</h2><p>{selectedJob.company}</p></div>
                    <strong>{selectedJob.salary_text || "薪资面议"}</strong>
                  </div>
                  <div className="detail-meta">
                    {selectedJob.city ? <span><MapPin size={15} />{selectedJob.city}{selectedJob.district}</span> : null}
                    {selectedJob.experience ? <span><BriefcaseBusiness size={15} />{selectedJob.experience}</span> : null}
                    {selectedJob.education ? <span><GraduationCap size={15} />{selectedJob.education}</span> : null}
                  </div>
                  <section><h3>岗位描述</h3><p className="job-description">{selectedJob.description || "暂无完整岗位描述，可前往来源页面查看。"}</p></section>
                  <div className="detail-actions">
                    {selectedJob.source_url ? <a className="primary-button" href={selectedJob.source_url} target="_blank" rel="noreferrer">查看原岗位 <ChevronRight size={16} /></a> : null}
                    <span>当前仅支持只读查看，不会自动投递</span>
                  </div>
                </article>
              ) : null}
            </section>
          )
        ) : null}

        {activeView === "applications" ? (
          <section className="data-panel">
            <div className="section-heading"><div><span>全部记录</span><strong>{applications.length} 条投递</strong></div></div>
            {applications.length === 0 ? (
              <div className="large-empty compact"><span><Clock3 size={28} /></span><h2>暂无投递记录</h2><p>后续通过审核的辅助投递会集中显示在这里。</p></div>
            ) : (
              <div className="application-list">
                {applications.map((item) => (
                  <div className="application-row" key={item.id}>
                    <span className="company-avatar">{(item.company || "岗").slice(0, 1)}</span>
                    <div><strong>{item.job_title || `岗位 #${item.job_id}`}</strong><span>{item.company || "公司未记录"}</span></div>
                    <em className={`status-pill ${item.status}`}>{applicationLabels[item.status] ?? item.status}</em>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {activeView === "review" ? (
          <section className="review-layout">
            <div className="metric-grid">
              <article><span className="metric-icon green"><BriefcaseBusiness size={18} /></span><div><small>真实岗位</small><strong>{jobs.length}</strong><em>已进入本地岗位库</em></div></article>
              <article><span className="metric-icon amber"><Clock3 size={18} /></span><div><small>待投递</small><strong>{queuedCount}</strong><em>等待你的确认</em></div></article>
              <article><span className="metric-icon blue"><CheckCircle2 size={18} /></span><div><small>已投递</small><strong>{appliedCount}</strong><em>持续跟进结果</em></div></article>
            </div>
            <div className="review-panels">
              <section className="data-panel workflow-card">
                <div className="section-heading"><div><span>任务流程</span><strong>{completedNodes}/{workflow?.nodes.length ?? 0} 已完成</strong></div></div>
                <div className="workflow-list">
                  {workflow?.nodes.map((node, index) => (
                    <div className={`workflow-row ${node.status}`} key={node.id}>
                      <span className="workflow-index">{node.status === "done" ? <CheckCircle2 size={16} /> : index + 1}</span>
                      <div><strong>{node.title}</strong><p>{node.detail}</p></div>
                      <em>{node.status === "done" ? "已完成" : node.status === "blocked" ? "已阻塞" : node.status === "in_progress" ? "进行中" : "待开始"}</em>
                    </div>
                  ))}
                </div>
              </section>
              <section className="data-panel data-note">
                <span className="metric-icon green"><Database size={18} /></span>
                <h3>数据真实可追溯</h3>
                <p>岗位与投递统计来自本地 SQLite。模拟平台结果不会混入真实岗位数据。</p>
              </section>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);
