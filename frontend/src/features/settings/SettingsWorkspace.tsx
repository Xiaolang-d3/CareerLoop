import type { ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileText,
  KeyRound,
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
  account: "账号与安全",
  profile: "资料库",
  model: "模型设置",
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
  profileReady: boolean | null;
  onOpen: (page: Exclude<SettingsPage, "overview">) => void;
  accountEmail?: string;
  accountName?: string;
  modelName?: string;
  apiKeyConfigured?: boolean;
};

function profileReadyBadge(profileReady: boolean | null) {
  if (profileReady == null) {
    return <em>检查中</em>;
  }
  return (
    <em className={profileReady ? "success" : "warning"}>
      {profileReady ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />}
      {profileReady ? "资料已就绪" : "待完善"}
    </em>
  );
}

export function SettingsOverview({
  profile,
  profileReady,
  onOpen,
  accountEmail,
  accountName,
  modelName,
  apiKeyConfigured
}: OverviewProps) {
  const accountLabel = accountName?.trim() || accountEmail || "尚未设置昵称";
  const configuredModel = modelName?.trim() || "尚未设置模型";
  return (
    <div className="settings-overview">
      <div className="settings-overview-grid">
        <button className="settings-entry-card account" type="button" onClick={() => onOpen("account")}>
          <span className="settings-entry-icon"><KeyRound size={21} /></span>
          <span className="settings-entry-copy">
            <span className="settings-entry-title"><strong>账号与安全</strong></span>
            <span className="settings-entry-primary">{accountLabel}</span>
            {accountName?.trim() && accountEmail ? <span className="settings-entry-meta"><UserRound size={13} />{accountEmail}</span> : null}
            <span className="settings-entry-meta"><ShieldCheck size={13} />昵称、头像和密码</span>
          </span>
          <ChevronRight size={19} />
        </button>
        <button className="settings-entry-card profile" type="button" onClick={() => onOpen("profile")}>
          <span className="settings-entry-icon"><UserRound size={21} /></span>
          <span className="settings-entry-copy">
            <span className="settings-entry-title"><strong>资料库</strong>{profileReadyBadge(profileReady)}</span>
            <span className="settings-entry-primary">{profile.name || "尚未填写称呼"}</span>
            <span className="settings-entry-meta"><FileText size={13} />{profile.resumeFilename || (profile.resumeText ? "已粘贴简历文本" : "尚未保存简历")}</span>
            <span className="settings-entry-meta"><ShieldCheck size={13} />{profile.privacyMode === "original" ? "允许使用原文" : "脱敏模式"}</span>
          </span>
          <ChevronRight size={19} />
        </button>
        <button className="settings-entry-card model" type="button" onClick={() => onOpen("model")}>
          <span className="settings-entry-icon"><Cpu size={21} /></span>
          <span className="settings-entry-copy">
            <span className="settings-entry-title">
              <strong>模型设置</strong>
              <em className={apiKeyConfigured ? "success" : "warning"}>
                {apiKeyConfigured ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />}
                {apiKeyConfigured ? "密钥已配置" : "待配置密钥"}
              </em>
            </span>
            <span className="settings-entry-primary">{configuredModel}</span>
            <span className="settings-entry-meta"><Cpu size={13} />对话与分析共用此模型</span>
            <span className="settings-entry-meta"><ShieldCheck size={13} />{apiKeyConfigured ? "密钥只保存在本机，页面不显示原文" : "填写模型名称、服务地址和 API Key"}</span>
          </span>
          <ChevronRight size={19} />
        </button>
      </div>
    </div>
  );
}
