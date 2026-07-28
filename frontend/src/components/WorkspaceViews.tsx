import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Circle,
  FileText,
  LockKeyhole,
  MessageCircle,
  Target,
  Search,
  UsersRound
} from "lucide-react";
import type { Conversation, WorkflowStatus } from "../types";

type WorkbenchViewProps = {
  hasProfile: boolean;
  chatBusy: boolean;
  onRunTask: (content: string) => void;
  webResearchEnabled: boolean;
};

const taskCards = [
  {
    key: "company",
    title: "公司背景调查",
    description: "搜索业务、近期动态和公开风险，生成带来源报告",
    icon: <Building2 size={20} />,
    action: "调查公司",
  },
  {
    key: "match",
    title: "岗位匹配分析",
    description: "查看匹配优势、能力缺口和改进优先级",
    icon: <Target size={20} />,
    action: "开始分析",
  },
  {
    key: "resume",
    title: "生成高匹配简历",
    description: "基于真实经历，生成针对当前岗位的简历文本",
    icon: <FileText size={20} />,
    action: "生成简历",
  },
  {
    key: "interview",
    title: "面试准备",
    description: "准备自我介绍、问题预测和回答思路",
    icon: <UsersRound size={20} />,
    action: "准备面试",
  }
] as const;

export function WorkbenchView({
  hasProfile,
  chatBusy,
  onRunTask,
  webResearchEnabled
}: WorkbenchViewProps) {
  const [jobDescription, setJobDescription] = useState("");
  const [companyName, setCompanyName] = useState("");

  function runTask(task: "company" | "match" | "resume" | "interview") {
    const instruction = {
      company: `请联网调查“${companyName.trim()}”的公开信息。核验公司身份，研究核心产品与商业模式、近期动态、正面和风险信号、与这个岗位的关系，并列出信息冲突、未知项和建议向 HR 确认的问题。每项可核验事实必须附来源链接。`,
      match: "请分析这份岗位 JD 与我的当前简历的匹配度、优势、缺口和优先改进建议。",
      resume: "请根据这份岗位 JD 和我的当前简历，生成一份完整、可直接复制的高度匹配简历内容，不要生成文件。",
      interview: "请根据这份岗位 JD 和我的当前简历，生成个人化面试准备建议，包括自我介绍、问题预测、回答方向、STAR 素材、反向提问和准备清单。"
    }[task];
    onRunTask(`${instruction}${jobDescription.trim() ? `\n\n岗位 JD：\n${jobDescription.trim()}` : ""}`);
  }

  const ready = hasProfile && Boolean(jobDescription.trim()) && !chatBusy;
  const companyReady = webResearchEnabled && Boolean(companyName.trim()) && !chatBusy;
  const anyTaskReady = ready || companyReady;

  return (
    <section className="workbench-page">
      <section className={`flow-step jd-entry-card ${jobDescription.trim() ? "complete" : ""}`}>
        <header className="flow-step-heading">
          <span className="flow-step-number">2</span>
          <div>
            <h2>填写目标岗位</h2>
            <p>复制招聘页面中的岗位职责和任职要求。</p>
          </div>
          <span className={`flow-step-status ${jobDescription.trim() ? "complete" : ""}`}>
            {jobDescription.trim() ? <CheckCircle2 size={14} /> : <Circle size={14} />}
            {jobDescription.trim() ? "已填写" : "必填"}
          </span>
        </header>
        <div className="section-heading">
          <div>
            <div>
              <h3>岗位描述</h3>
            </div>
          </div>
        </div>
        <textarea
          value={jobDescription}
          maxLength={50_000}
          placeholder="例如：岗位职责、任职要求、技能要求、工作地点等…"
          onChange={(event) => setJobDescription(event.target.value)}
        />
        <label className="company-research-field">
          <span>公司名称</span>
          <input
            value={companyName}
            maxLength={200}
            placeholder="例如：北京示例科技有限公司"
            onChange={(event) => setCompanyName(event.target.value)}
          />
          <small>{webResearchEnabled ? "用于公开信息检索；填写公司全称可减少同名误判。" : "联网研究尚未启用，请先配置 AgentSearch。"}</small>
        </label>
        <p className="field-help">
          {jobDescription.trim()
            ? "岗位信息已就绪，可以选择下一步。"
            : "这些信息只用于本次匹配、简历或面试准备。"}
        </p>
      </section>

      <section className={`flow-step output-step ${anyTaskReady ? "ready" : ""}`}>
        <header className="flow-step-heading">
          <span className="flow-step-number">3</span>
          <div>
            <h2>选择需要的结果</h2>
            <p>{anyTaskReady ? "资料齐全，选择一项开始。" : "完善所选任务需要的资料后即可使用。"}</p>
          </div>
          <span className={`flow-step-status ${anyTaskReady ? "complete" : ""}`}>
            {anyTaskReady ? <CheckCircle2 size={14} /> : <LockKeyhole size={14} />}
            {anyTaskReady ? "可开始" : "未就绪"}
          </span>
        </header>
        <div className="task-card-grid">
          {taskCards.map((task) => (
            <article className="workbench-task-card" key={task.key}>
              <span className="task-card-icon">{task.icon}</span>
              <div><h3>{task.title}</h3><p>{task.description}</p></div>
              <button
                disabled={task.key === "company" ? !companyReady : !ready}
                title={task.key === "company"
                  ? !webResearchEnabled ? "请先启用联网公司研究" : !companyName.trim() ? "请先填写公司名称" : undefined
                  : !hasProfile ? "请先完成人物资料并保存简历" : !jobDescription.trim() ? "请先填写目标岗位" : undefined}
                onClick={() => runTask(task.key)}
              >
                {task.action}<ArrowRight size={14} />
              </button>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

type DashboardViewProps = {
  workflow: WorkflowStatus | null;
  conversations: Conversation[];
  onOpenConversation: (conversationId: number) => void;
};

export function DashboardView({
  workflow,
  conversations,
  onOpenConversation
}: DashboardViewProps) {
  const counts = workflow?.counts;
  const cards = [
    { label: "匹配分析", value: counts?.jd_analyses ?? 0, icon: <Target size={18} />, note: "当前对话累计" },
    { label: "简历生成", value: counts?.tailored_resume_generations ?? 0, icon: <FileText size={18} />, note: "高匹配文本" },
    { label: "面试准备", value: counts?.interview_advice_generations ?? 0, icon: <UsersRound size={18} />, note: "个人化建议" },
    { label: "公司研究", value: counts?.company_researches ?? 0, icon: <Search size={18} />, note: "带来源报告" },
    { label: "活跃对话", value: conversations.filter((item) => item.status === "active").length, icon: <MessageCircle size={18} />, note: "可继续追问" }
  ];

  return (
    <section className="dashboard-page">
      <div className="dashboard-hero">
        <div><h2>任务概览</h2></div>
        <span className="dashboard-badge"><BarChart3 size={17} />本地任务数据</span>
      </div>

      <div className="metric-grid">
        {cards.map((card) => (
          <article className="metric-card" key={card.label}>
            <span>{card.icon}</span>
            <div><small>{card.label}</small><strong>{card.value}</strong><p>{card.note}</p></div>
          </article>
        ))}
      </div>

      <section className="dashboard-history">
        <div className="section-heading">
          <div><div><h3>最近任务</h3></div></div>
          <small>{conversations.length} 条记录</small>
        </div>
        {conversations.length ? (
          <div className="dashboard-history-list">
            {conversations.slice(0, 8).map((conversation) => (
              <button key={conversation.id} onClick={() => onOpenConversation(conversation.id)}>
                <span className={conversation.status} />
                <div><strong>{conversation.title}</strong><small>{conversation.message_count ?? 0} 条消息 · {conversation.task_status === "active" ? "任务进行中" : conversation.status === "archived" ? "已归档" : "可继续"}</small></div>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty"><BarChart3 size={24} /><span>完成第一次岗位分析后，任务记录会显示在这里。</span></div>
        )}
      </section>
    </section>
  );
}
