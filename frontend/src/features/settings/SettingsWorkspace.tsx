import type { ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileText,
  Folder,
  KeyRound,
  Palette,
  ShieldCheck,
  TriangleAlert,
  UserRound
} from "lucide-react";
import type { LibraryEditor } from "../../types";
import type { SettingsPage } from "../../routing";
import { productIntroHash } from "../../app/public-routing";
import "./settings-workspace.css";

type WorkspaceProps = {
  page: SettingsPage;
  children: ReactNode;
  onBack: () => void;
};

const pageLabels: Record<Exclude<SettingsPage, "overview">, string> = {
  appearance: "外观",
  account: "账号与安全",
  library: "文件库管理",
  model: "模型设置",
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
  library: LibraryEditor;
  libraryReady: boolean | null;
  sourceTitle?: string;
  fileCount?: number;
  onOpen: (page: Exclude<SettingsPage, "overview">) => void;
  accountEmail?: string;
  accountName?: string;
  modelName?: string;
  apiKeyConfigured?: boolean;
};

export function SettingsOverview({
  fileCount,
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
        <button className="settings-entry-card library" type="button" onClick={() => onOpen("library")}>
          <span className="settings-entry-icon"><Folder size={21} /></span>
          <span className="settings-entry-copy">
            <span className="settings-entry-title"><strong>文件库管理</strong></span>
            <span className="settings-entry-primary">文件、主题集合与知识</span>
            <span className="settings-entry-meta"><FileText size={13} />{fileCount === undefined ? "整理文件与长期使用范围" : fileCount ? `共 ${fileCount} 个文件` : "暂无文件，可随时添加"}</span>
            <span className="settings-entry-meta">与 AI 工作区共用同一文件库</span>
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
        <button className="settings-entry-card appearance" type="button" onClick={() => onOpen("appearance")}>
          <span className="settings-entry-icon"><Palette size={21} /></span>
          <span className="settings-entry-copy"><span className="settings-entry-title"><strong>外观</strong></span><span className="settings-entry-primary">全局主题</span><span className="settings-entry-meta">浅色、深色或跟随系统</span><span className="settings-entry-meta">所有模块统一外观，立即生效</span></span>
          <ChevronRight size={19} />
        </button>
      </div>
      <a className="settings-product-link" href={productIntroHash}>了解 灯灯<ChevronRight size={15} aria-hidden="true" /></a>
    </div>
  );
}
