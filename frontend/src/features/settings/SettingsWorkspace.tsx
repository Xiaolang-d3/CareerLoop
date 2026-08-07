import type { ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronRight,
  FileText,
  ShieldCheck,
  TriangleAlert,
  UserRound
} from "lucide-react";
import type { AgentOperationsSnapshot, AgentSettings, CandidateEditor, ModelServiceMonitor } from "../../types";
import type { SettingsPage } from "../../routing";
import "./settings-workspace.css";

type WorkspaceProps = {
  page: SettingsPage;
  children: ReactNode;
  onBack: () => void;
};

const pageLabels: Record<Exclude<SettingsPage, "overview">, string> = {
  profile: "Agent 求职资料库",
  model: "Agent 推理模型",
  agent: "Agent 执行记录"
};

export function SettingsWorkspace({ page, children, onBack }: WorkspaceProps) {
  return (
    <section className={`settings-workspace settings-${page}`}>
      {page !== "overview" ? (
        <nav className="settings-breadcrumb" aria-label="设置路径">
          <button type="button" onClick={onBack}><ArrowLeft size={14} />设置</button>
          <ChevronRight size={13} aria-hidden="true" />
          <span aria-current="page">{pageLabels[page]}</span>
        </nav>
      ) : null}
      {children}
    </section>
  );
}

type OverviewProps = {
  profile: CandidateEditor;
  profileReady: boolean;
  settings: AgentSettings;
  monitor: ModelServiceMonitor | null;
  operations: AgentOperationsSnapshot | null;
  onOpen: (page: Exclude<SettingsPage, "overview">) => void;
};

function recentException(operations: AgentOperationsSnapshot | null) {
  return operations?.recent_runs.find((run) => run.status === "failed") ?? null;
}

export function SettingsOverview({ profile, profileReady, settings, monitor, operations, onOpen }: OverviewProps) {
  const exception = recentException(operations);
  return (
    <div className="settings-overview">
      <div className="settings-overview-heading">
        <span className="settings-eyebrow">AGENT FOUNDATION</span>
        <h2>让 Agent 在正确的边界内工作</h2>
        <p>确认可用资料、推理模型和执行状态；你始终决定哪些信息可以使用、哪些结果可以采纳。</p>
      </div>
      <div className="settings-overview-grid">
        <button className="settings-entry-card profile" type="button" onClick={() => onOpen("profile")}>
          <span className="settings-entry-icon"><UserRound size={21} /></span>
          <span className="settings-entry-copy">
            <span className="settings-entry-title"><strong>Agent 求职资料</strong><em className={profileReady ? "success" : "warning"}>{profileReady ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />}{profileReady ? "可用于分析" : "待完善"}</em></span>
            <span className="settings-entry-primary">{profile.name || "尚未填写称呼"}</span>
            <span className="settings-entry-meta"><FileText size={13} />{profile.resumeFilename || (profile.resumeText ? "已粘贴简历文本" : "尚未保存简历")}</span>
            <span className="settings-entry-meta"><ShieldCheck size={13} />{profile.privacyMode === "original" ? "允许使用原文" : "脱敏模式"}</span>
          </span>
          <ChevronRight size={19} />
        </button>

        <button className="settings-entry-card model" type="button" onClick={() => onOpen("model")}>
          <span className="settings-entry-icon"><Bot size={21} /></span>
          <span className="settings-entry-copy">
            <span className="settings-entry-title"><strong>Agent 推理模型</strong><em className={monitor?.status || "unknown"}>{monitor?.status === "healthy" ? "连接正常" : monitor?.status === "degraded" ? "服务波动" : monitor?.status === "unavailable" ? "当前不可用" : "等待检测"}</em></span>
            <span className="settings-entry-primary">{settings.model_name || "尚未配置模型"}</span>
            <span className="settings-entry-meta"><Activity size={13} />{monitor?.last_event_at ? `最近检测 ${new Date(monitor.last_event_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "还没有检测记录"}</span>
          </span>
          <ChevronRight size={19} />
        </button>

        <button className="settings-entry-card agent" type="button" onClick={() => onOpen("agent")}>
          <span className="settings-entry-icon"><Activity size={21} /></span>
          <span className="settings-entry-copy">
            <span className="settings-entry-title"><strong>Agent 执行记录</strong><em className={exception ? "warning" : operations ? "success" : "unknown"}>{exception ? "需要关注" : operations ? "状态稳定" : "暂无记录"}</em></span>
            <span className="settings-entry-primary">{operations ? `${operations.summary.total_runs} 次运行 · ${operations.summary.success_rate == null ? "—" : `${operations.summary.success_rate}%`} 成功率` : "暂无运行数据"}</span>
            <span className="settings-entry-meta"><TriangleAlert size={13} />{exception ? `最近异常：${exception.error_message || exception.error_code || exception.goal}` : "最近没有失败记录"}</span>
          </span>
          <ChevronRight size={19} />
        </button>
      </div>
    </div>
  );
}
