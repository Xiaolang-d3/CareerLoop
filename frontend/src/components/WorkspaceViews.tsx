import {
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDot,
  Clock3,
  Database,
  ShieldCheck,
  WandSparkles
} from "lucide-react";
import { applicationLabels, toolLabels, toolProfiles } from "../constants";
import type { AgentCapabilities, Application, Job, WorkflowStatus } from "../types";
import type { AgentRunResult, AttachmentConfig } from "./ChatWorkspace";

type ToolsViewProps = {
  capabilities: AgentCapabilities | null;
  attachmentConfig: AttachmentConfig | null;
  recentToolEvents: AgentRunResult["events"];
};

export function ToolsView({ capabilities, attachmentConfig, recentToolEvents }: ToolsViewProps) {
  return (
    <section className="tool-center">
      <div className="tool-center-hero">
        <div>
          <span className="card-kicker">透明执行</span>
          <h2>Agent 能做什么，一目了然</h2>
          <p>这里只展示工具能力、数据范围和执行结果摘要，不展示简历原文、模型提示词或敏感参数。</p>
        </div>
        <div className="tool-health">
          <span><CircleDot size={14} />{capabilities ? "工具系统已连接" : "正在连接"}</span>
          <strong>{capabilities?.tools.length ?? 0}<small> 个可用工具</small></strong>
        </div>
      </div>

      {attachmentConfig ? (
        <section className="attachment-health-card">
          <div className="tool-category-heading">
            <span>附件与图片能力</span>
            <small>{attachmentConfig.vision_ready ? "截图可按次授权看图" : "默认本地解析"}</small>
          </div>
          <div className="attachment-health-grid">
            {(attachmentConfig.checks ?? []).map((check) => (
              <article className={check.status} key={check.key}>
                <span><CircleDot size={12} />{check.status === "ok" ? "正常" : check.status === "warning" ? "需配置" : "未启用"}</span>
                <strong>{check.label}</strong>
                <small>{check.message}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="tool-category-list">
        {(["读取资料", "分析判断", "准备行动", "进展记录"] as const).map((category) => (
          <section className="tool-category" key={category}>
            <div className="tool-category-heading">
              <span>{category}</span>
              <small>{toolProfiles.filter((tool) => tool.category === category).length} 项能力</small>
            </div>
            <div className="tool-grid">
              {toolProfiles.filter((tool) => tool.category === category).map((tool) => {
                const available = capabilities?.tools.includes(tool.name) ?? false;
                return (
                  <article className={`tool-card ${available ? "available" : "unavailable"}`} key={tool.name}>
                    <div className="tool-card-top">
                      <span className="tool-icon">{tool.category === "分析判断" ? <WandSparkles size={17} /> : tool.category === "读取资料" ? <Database size={17} /> : <Bot size={17} />}</span>
                      <span className="tool-availability"><i />{available ? "可用" : "未连接"}</span>
                    </div>
                    <strong>{toolLabels[tool.name] ?? tool.name}</strong>
                    <code>{tool.name}</code>
                    <p>{tool.description}</p>
                    <div className="tool-meta">
                      <span><Database size={12} />{tool.dataScope}</span>
                      <span><ShieldCheck size={12} />{tool.control}</span>
                      <span>{tool.local ? "仅本地操作" : "需外部授权"}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <aside className="tool-activity">
        <div className="tool-category-heading"><span>当前对话最近调用</span><small>只显示安全摘要</small></div>
        {recentToolEvents.length ? (
          <div className="tool-activity-list">
            {recentToolEvents.map((event) => (
              <div key={`${event.tool_call_id}-${event.round}`}>
                <span className={`event-dot ${event.status}`} />
                <strong>{toolLabels[event.tool_name] ?? event.tool_name}</strong>
                <p>{event.message}</p>
                <small>第 {event.round} 轮 · {event.status === "done" ? "完成" : event.status}</small>
              </div>
            ))}
          </div>
        ) : <div className="tool-activity-empty"><Clock3 size={20} /><span>当前对话还没有工具调用记录</span></div>}
      </aside>
    </section>
  );
}

export function ApplicationsView({
  applications,
  onOpenJobs
}: {
  applications: Application[];
  onOpenJobs: () => void;
}) {
  return (
    <section className="data-panel">
      <div className="section-heading"><div><span>全部进展</span><strong>{applications.length} 条求职记录</strong></div><small>本地待确认与真实进展清楚分开</small></div>
      {applications.length === 0 ? (
        <div className="large-empty compact"><span><Clock3 size={28} /></span><h2>还没有求职进展</h2><p>把感兴趣的岗位加入待投队列；真正开聊或投递后，再记录状态。</p><button className="secondary-button" onClick={onOpenJobs}>查看岗位</button></div>
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
  );
}

export function ReviewView({
  jobs,
  queuedCount,
  appliedCount,
  completedNodes,
  workflow
}: {
  jobs: Job[];
  queuedCount: number;
  appliedCount: number;
  completedNodes: number;
  workflow: WorkflowStatus | null;
}) {
  return (
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
                <em>{node.status === "done" ? "已完成" : node.status === "blocked" ? "已阻塞" : node.status === "running" ? "进行中" : "待开始"}</em>
              </div>
            ))}
          </div>
        </section>
        <section className="data-panel data-note">
          <span className="metric-icon green"><ShieldCheck size={18} /></span>
          <h3>安全辅助，不替你做决定</h3>
          <p>数据保存在本地；浏览器保持可见；登录、验证、沟通和投递都由你本人确认。</p>
        </section>
      </div>
    </section>
  );
}
