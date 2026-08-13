import type { ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  FileText,
  ShieldCheck,
  TriangleAlert,
  UserRound
} from "lucide-react";
import type { CandidateEditor } from "../../types";
import type { SettingsPage } from "../../routing";
import "./settings-workspace.css";

type WorkspaceProps = {
  page: SettingsPage;
  children: ReactNode;
  onBack: () => void;
};

const pageLabels: Record<Exclude<SettingsPage, "overview">, string> = {
  profile: "我的求职资料",
  model: "Agent 推理模型",
  agent: "Agent 执行记录"
};

export function SettingsWorkspace({ page, children, onBack }: WorkspaceProps) {
  return (
    <section className={`settings-workspace settings-${page}`}>
      {page !== "overview" && page !== "profile" ? (
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
  onOpen: (page: Exclude<SettingsPage, "overview">) => void;
};

export function SettingsOverview({ profile, profileReady, onOpen }: OverviewProps) {
  return (
    <div className="settings-overview">
      <div className="settings-overview-heading">
        <span className="settings-eyebrow">CAREER SETTINGS</span>
        <h2>让求职准备更贴合你</h2>
        <p>完善你的经历、简历和求职偏好；每次推荐和准备都会基于你确认过的资料。</p>
      </div>
      <div className="settings-overview-grid">
        <button className="settings-entry-card profile" type="button" onClick={() => onOpen("profile")}>
          <span className="settings-entry-icon"><UserRound size={21} /></span>
          <span className="settings-entry-copy">
            <span className="settings-entry-title"><strong>我的求职资料</strong><em className={profileReady ? "success" : "warning"}>{profileReady ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />}{profileReady ? "资料已就绪" : "待完善"}</em></span>
            <span className="settings-entry-primary">{profile.name || "尚未填写称呼"}</span>
            <span className="settings-entry-meta"><FileText size={13} />{profile.resumeFilename || (profile.resumeText ? "已粘贴简历文本" : "尚未保存简历")}</span>
            <span className="settings-entry-meta"><ShieldCheck size={13} />{profile.privacyMode === "original" ? "允许使用原文" : "脱敏模式"}</span>
          </span>
          <ChevronRight size={19} />
        </button>

      </div>
    </div>
  );
}
