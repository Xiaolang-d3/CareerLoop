import {
  ArrowRight,
  Building2,
  CalendarDays,
  FileText,
  MessageCircle,
  UserRound
} from "lucide-react";
import { ActionButton } from "../../components/ui/ActionButton";
import type { JobProject } from "../../types";
import { latestJobAnalysisAt, splitHomeTags } from "./home-metrics";

export type HomePageProps = {
  apiBase?: string;
  accessToken?: string;
  displayName?: string;
  email?: string;
  profileName?: string;
  targetRole?: string;
  targetCity?: string;
  resumeText?: string;
  resumeFilename?: string;
  skills?: string;
  profileLoaded?: boolean;
  jobs: JobProject[];
  jobsLoaded?: boolean;
  onOpenAnalysis: () => void;
  onOpenResume: () => void;
  onOpenInterview: () => void;
  onOpenProfile: () => void;
};

function formatAnalysisTime(value: string) {
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function metricValue(ready: boolean, value: string) {
  return ready ? value : "—";
}

export function HomePage({
  displayName,
  email,
  profileName,
  targetRole,
  targetCity,
  resumeText,
  resumeFilename,
  skills,
  profileLoaded = false,
  jobs,
  jobsLoaded = false,
  onOpenAnalysis,
  onOpenResume,
  onOpenInterview,
  onOpenProfile
}: HomePageProps) {
  const greetingName = profileName?.trim() || displayName?.trim() || email?.split("@")[0] || "";
  const resumeChars = (resumeText || "").trim().length;
  const skillTags = splitHomeTags(skills || "");
  const lastAnalysis = jobsLoaded ? latestJobAnalysisAt(jobs) : null;

  const cards = [
    {
      label: "简历",
      value: metricValue(profileLoaded, resumeChars ? String(resumeChars) : "0"),
      icon: <FileText size={18} />,
      note: !profileLoaded ? "资料尚未读取" : resumeChars ? `${resumeFilename || "已保存"} · 字` : "尚未保存"
    },
    {
      label: "岗位项目",
      value: metricValue(jobsLoaded, String(jobs.length)),
      icon: <Building2 size={18} />,
      note: !jobsLoaded ? "计数稍后更新" : jobs.length ? `${jobs.filter((job) => job.priority === "high").length} 个高优先级` : "还没有岗位"
    },
    {
      label: "最近分析",
      value: metricValue(jobsLoaded, lastAnalysis ? formatAnalysisTime(lastAnalysis) : "暂无"),
      icon: <CalendarDays size={18} />,
      note: !jobsLoaded ? "时间稍后更新" : lastAnalysis ? "最近一次岗位分析" : "完成分析后会出现在这里"
    }
  ];

  return (
    <section className="dashboard-page home-page">
      <div className="dashboard-hero" aria-labelledby="home-greeting-title">
        <div>
          <h2 id="home-greeting-title">{greetingName ? `你好，${greetingName}` : "你好"}</h2>
          <p>{targetRole?.trim() ? `目标方向：${targetRole.trim()}` : "完善个人资料后，这里会显示你的求职方向。"}</p>
        </div>
        <div className="home-hero-actions">
          <ActionButton variant="primary" icon={<ArrowRight size={16} />} onClick={onOpenAnalysis}>
            去分析简历
          </ActionButton>
          <ActionButton variant="secondary" onClick={onOpenProfile}>
            完善个人资料
          </ActionButton>
        </div>
      </div>

      <div className="metric-grid">
        {cards.map((card) => (
          <article className="metric-card" key={card.label}>
            <span>{card.icon}</span>
            <div>
              <small>{card.label}</small>
              <strong>{card.value}</strong>
              <p>{card.note}</p>
            </div>
          </article>
        ))}
      </div>

      <section className="home-charts" aria-label="资料概览">
        <article className="home-chart-card">
          <div className="section-heading">
            <div><div><h3>技能标签</h3></div></div>
            <small>{profileLoaded ? `${skillTags.length} 个` : "—"}</small>
          </div>
          {!profileLoaded ? (
            <p className="home-chart-empty">技能标签稍后更新。</p>
          ) : skillTags.length ? (
            <div className="home-skill-chips">
              {skillTags.slice(0, 8).map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          ) : (
            <p className="home-chart-empty">还没有技能标签，可在个人资料里补充。</p>
          )}
        </article>
      </section>

      <section className="home-next-actions" aria-label="下一步">
        <button type="button" className="workbench-task-card" onClick={onOpenAnalysis}>
          <span className="task-card-icon"><FileText size={16} /></span>
          <div>
            <h3>去分析简历</h3>
            <p>查看已保存简历的印象、证据和下一步。</p>
          </div>
        </button>
        <button type="button" className="workbench-task-card" onClick={onOpenResume}>
          <span className="task-card-icon"><UserRound size={16} /></span>
          <div>
            <h3>去定制简历</h3>
            <p>选择类型和模板，编辑并导出一版简历。</p>
          </div>
        </button>
        <button type="button" className="workbench-task-card" onClick={onOpenInterview}>
          <span className="task-card-icon"><MessageCircle size={16} /></span>
          <div>
            <h3>去面试问答</h3>
            <p>围绕真实项目练习问答和知识点。</p>
          </div>
        </button>
      </section>
    </section>
  );
}
