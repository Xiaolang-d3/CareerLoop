import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BriefcaseBusiness,
  RefreshCw
} from "lucide-react";
import "./styles.css";

type Job = {
  id: number;
  title: string;
  company: string;
  city: string;
  district: string;
  salary_text: string;
  experience: string;
  education: string;
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

type BrowserStatus = {
  running: boolean;
  url: string;
  title: string;
  is_boss_page: boolean;
  profile_dir: string;
};

type WorkflowNode = {
  id: string;
  title: string;
  status: "done" | "in_progress" | "pending" | "blocked";
  detail: string;
};

type WorkflowStatus = {
  run?: {
    id: number;
    status: string;
    current_node: string;
    updated_at: string;
  };
  status: string;
  counts: {
    profiles: number;
    jobs: number;
    applications: number;
  };
  nodes: WorkflowNode[];
  events?: Array<{
    id: number;
    node_id: string;
    event_type: string;
    message: string;
    created_at: string;
  }>;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  payload?: {
    workflow?: WorkflowStatus;
    agent?: AgentRunResult;
  };
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

type ViewKey = "chat" | "applications" | "review";

function App() {
  const apiBase = useMemo(() => `${window.location.protocol}//${window.location.hostname}:8000`, []);
  const [activeView, setActiveView] = useState<ViewKey>("chat");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowStatus | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  const appliedCount = applications.filter((item) => item.status === "applied").length;
  const queuedCount = applications.filter((item) => item.status === "queued").length;

  async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, options);
    if (!response.ok) {
      throw new Error(`${path} failed`);
    }
    return response.json() as Promise<T>;
  }

  async function refreshData() {
    const [nextJobs, nextApplications, nextWorkflow] = await Promise.all([
      fetchJson<Job[]>("/jobs"),
      fetchJson<Application[]>("/applications"),
      fetchJson<WorkflowStatus>("/workflow/status")
    ]);
    setJobs(nextJobs);
    setApplications(nextApplications);
    setWorkflow(nextWorkflow);
  }

  async function refreshChat() {
    const nextMessages = await fetchJson<ChatMessage[]>("/chat/messages");
    setChatMessages(nextMessages);
  }

  async function sendChatMessage() {
    const content = chatInput.trim();
    if (!content) {
      return;
    }
    setChatBusy(true);
    setChatInput("");
    try {
      const response = await fetchJson<{
        assistant_message: ChatMessage;
        workflow: WorkflowStatus;
      }>("/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      setWorkflow(response.workflow);
      await refreshChat();
      await refreshData();
    } finally {
      setChatBusy(false);
    }
  }

  useEffect(() => {
    refreshData().catch(() => undefined);
    refreshChat().catch(() => undefined);
  }, []);

  const viewTitle = {
    chat: "求职助手",
    applications: "投递记录",
    review: "复盘"
  }[activeView];

  const viewSubtitle = {
    chat: "直接描述你的求职目标，Agent 会分析需求并调用工具执行。",
    applications: "只展示后端 applications 表中的真实投递记录。",
    review: "基于真实 jobs/applications 数据做统计。"
  }[activeView];

  function renderToolStatus(message: ChatMessage) {
    const messageWorkflow = message.payload?.workflow;
    const agentRun = message.payload?.agent;
    if (!messageWorkflow && !agentRun) {
      return null;
    }
    const latestEvents = messageWorkflow?.events?.slice(0, 3) ?? [];
    const doneCount = messageWorkflow?.nodes.filter((node) => node.status === "done").length ?? 0;
    return (
      <div className="inline-tool-status">
        {messageWorkflow ? (
          <>
            <strong>工作流状态：{messageWorkflow.status}</strong>
            <span>{doneCount}/{messageWorkflow.nodes.length} 个节点完成</span>
          </>
        ) : null}
        {latestEvents.map((event) => (
          <div className="inline-tool-event" key={event.id}>
            <em>{event.event_type}</em>
            <span>{event.message}</span>
          </div>
        ))}
        {agentRun ? (
          <>
            <strong>Agent：{agentRun.provider} · 平台：{agentRun.platform} · {agentRun.rounds} 轮</strong>
            {agentRun.events.map((event) => (
              <div className="inline-tool-event" key={event.tool_call_id}>
                <em>{event.tool_name}</em>
                <span>{event.message}</span>
              </div>
            ))}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BriefcaseBusiness size={22} />
          <span>BossCopilot</span>
        </div>
        <nav className="nav">
          <button className={`nav-item ${activeView === "chat" ? "active" : ""}`} onClick={() => setActiveView("chat")}>聊天</button>
          <button className={`nav-item ${activeView === "applications" ? "active" : ""}`} onClick={() => setActiveView("applications")}>投递记录</button>
          <button className={`nav-item ${activeView === "review" ? "active" : ""}`} onClick={() => setActiveView("review")}>复盘</button>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>{viewTitle}</h1>
            <p>{viewSubtitle}</p>
          </div>
          {activeView !== "chat" ? (
            <button className="secondary-button" onClick={() => refreshData()}>
              <RefreshCw size={18} />
              刷新
            </button>
          ) : null}
        </header>

        {activeView === "chat" ? (
          <section className="chat-layout">
            <div className="chat-thread">
              {chatMessages.length === 0 ? (
                <div className="empty-state">还没有对话。你可以直接说“我想找 AI Agent 相关工作”或“打开 BOSS 登录”。</div>
              ) : (
                chatMessages.map((message) => (
                  <div className={`chat-bubble ${message.role}`} key={message.id}>
                    <span>{message.role === "user" ? "你" : "BossCopilot"}</span>
                    <p>{message.content}</p>
                    <em>{message.created_at}</em>
                    {message.role === "assistant" ? renderToolStatus(message) : null}
                  </div>
                ))
              )}
            </div>
            <div className="chat-composer">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendChatMessage();
                  }
                }}
              />
              <button className="primary-button" onClick={sendChatMessage} disabled={chatBusy}>
                {chatBusy ? "执行中" : "发送"}
              </button>
            </div>
          </section>
        ) : null}

        {activeView === "applications" ? (
          <section className="panel">
            <div className="panel-header">
              <h2>投递记录</h2>
              <span>{applications.length} 条</span>
            </div>
            {applications.length === 0 ? (
              <div className="empty-state">暂无真实投递记录。</div>
            ) : (
              <div className="application-list">
                {applications.map((item) => (
                  <div className="application-row" key={item.id}>
                    <div>
                      <strong>{item.job_title || `岗位 #${item.job_id}`}</strong>
                      <span>{item.company || "公司未记录"}</span>
                    </div>
                    <em>{item.status}</em>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {activeView === "review" ? (
          <div className="review-grid">
            <section className="metric-panel">
              <span>真实岗位</span>
              <strong>{jobs.length}</strong>
            </section>
            <section className="metric-panel">
              <span>待投递</span>
              <strong>{queuedCount}</strong>
            </section>
            <section className="metric-panel">
              <span>已投递</span>
              <strong>{appliedCount}</strong>
            </section>
            <section className="panel review-notes">
              <div className="panel-header">
                <h2>数据来源</h2>
              </div>
              <p>这些数字来自本地 SQLite 的 jobs 和 applications 表。当前没有真实岗位采集时，统计会保持为 0。</p>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
