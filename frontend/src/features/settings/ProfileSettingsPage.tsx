import {
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  Download,
  Edit3,
  FileText,
  LoaderCircle,
  Merge,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  TriangleAlert,
  Upload,
  UserRound,
  WandSparkles
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createApiClient } from "../../api/client";
import type { CandidateEditor, ResumeProfileSuggestion } from "../../types";

type PrivacyFinding = { entity_type: string; preview: string };

type Props = {
  apiBase: string;
  editor: CandidateEditor;
  busy: boolean;
  resumeBusy: boolean;
  enhancedParse: boolean;
  privacyFindings: PrivacyFinding[];
  suggestion: ResumeProfileSuggestion | null;
  returnToWorkbench: boolean;
  onChange: (editor: CandidateEditor) => void;
  onEnhancedParseChange: (enabled: boolean) => void;
  onParseFiles: (files: File[]) => void;
  onScanPrivacy: () => void;
  onFillSuggestion: () => void;
  onCareerChange: () => void | Promise<void>;
  onOpenChat: () => void;
  onClearResume: () => void;
  onSave: () => void | Promise<void>;
  onReturnToWorkbench: () => void;
};

type CareerFact = {
  id: number;
  category: string;
  statement: string;
  status: "pending" | "confirmed" | "disputed" | "retracted";
  evidence: Array<{ source_id: number; source_title: string; excerpt: string }>;
};

type KnowledgeChange = {
  id: number;
  entity_type: string;
  entity_id: number | null;
  operation: string;
  proposed: Record<string, unknown>;
  reason: string;
};

type CareerStrategy = {
  id: number;
  name: string;
  target_roles: string[];
  locations: string[];
  industries: string[];
  salary: { min?: number | null; max?: number | null; currency?: string };
  work_modes: string[];
  priority: number;
  is_active: boolean;
};

type CareerBundle = {
  profile: { id: number; name: string; locale: string; knowledge_revision: number } | null;
  facts: CareerFact[];
  strategies: CareerStrategy[];
  active_strategy: CareerStrategy | null;
  stories: Array<{ id: number; title: string; status: CareerFact["status"]; situation: string; action: string; result: string; reflection: string }>;
  narratives: Array<{ id: number; strategy_id: number | null; headline: string; transition_story: string; status: CareerFact["status"] }>;
  writing_samples: Array<{ id: number; title: string; sample_type: string }>;
  sources: Array<{
    id: number; title: string; source_type: string; privacy_mode: string;
    allow_model_original: boolean; character_count: number; created_at: string;
  }>;
  voice: { name: string; tone_rules: string[]; banned_phrases: string[] } | null;
  pending_changes: KnowledgeChange[];
  completeness: { score: number; dimensions: Record<string, boolean>; missing: string[] };
};

type JobOption = { id: number; company_name: string; job_title: string; status: string };
type PatternInsight = {
  eligible: boolean; progressed_count: number; minimum_required: number;
  stage_counts: Record<string, number>; limitations: string[];
  recommendations: Array<{ message: string }>;
};
type SkillGrowth = { items: Array<{ skill: string; frequency: number; eligible_for_recommendation: boolean; reason: string }>; rule: string };

const splitTextList = (value: string) => value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);

export function ProfileSettingsPage({
  apiBase,
  editor,
  busy,
  resumeBusy,
  enhancedParse,
  privacyFindings,
  suggestion,
  returnToWorkbench,
  onChange,
  onEnhancedParseChange,
  onParseFiles,
  onScanPrivacy,
  onFillSuggestion,
  onCareerChange,
  onOpenChat,
  onClearResume,
  onSave,
  onReturnToWorkbench
}: Props) {
  const ready = Boolean(editor.name.trim());
  const fetchJson = useCallback(createApiClient(apiBase), [apiBase]);
  const [career, setCareer] = useState<CareerBundle | null>(null);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [patterns, setPatterns] = useState<PatternInsight | null>(null);
  const [skillGrowth, setSkillGrowth] = useState<SkillGrowth | null>(null);
  const [careerBusy, setCareerBusy] = useState(false);
  const [careerError, setCareerError] = useState("");
  const [careerNotice, setCareerNotice] = useState("");
  const [activePanel, setActivePanel] = useState<"governance" | "sources" | "strategies" | "feedback">("governance");
  const [newStrategyName, setNewStrategyName] = useState("");
  const [newStrategyRole, setNewStrategyRole] = useState("");
  const [editingFactId, setEditingFactId] = useState<number | null>(null);
  const [editingFactText, setEditingFactText] = useState("");
  const [mergingFactId, setMergingFactId] = useState<number | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [showStoryForm, setShowStoryForm] = useState(false);
  const [storyDraft, setStoryDraft] = useState({ title: "", situation: "", action: "", result: "", reflection: "" });
  const [editingVoice, setEditingVoice] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState({ name: "简洁专业", tone: "", banned: "" });
  const [selectedJobId, setSelectedJobId] = useState("");
  const [outcomeDraft, setOutcomeDraft] = useState({ stage: "applied", notes: "", feedback: "" });
  const [debriefDraft, setDebriefDraft] = useState({ question: "", answer: "", feedback: "", summary: "" });

  const refreshCareer = useCallback(async () => {
    setCareerBusy(true);
    setCareerError("");
    try {
      const [bundle, jobOptions, nextPatterns, nextGrowth] = await Promise.all([
        fetchJson<CareerBundle>("/career-profile"),
        fetchJson<JobOption[]>("/jobs"),
        fetchJson<PatternInsight>("/career-insights/patterns"),
        fetchJson<SkillGrowth>("/career-insights/skill-growth")
      ]);
      setCareer(bundle);
      setJobs(jobOptions);
      setPatterns(nextPatterns);
      setSkillGrowth(nextGrowth);
      setSelectedJobId((current) => current || (jobOptions[0] ? String(jobOptions[0].id) : ""));
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "读取职业画像失败");
    } finally {
      setCareerBusy(false);
    }
  }, [fetchJson]);

  useEffect(() => { void refreshCareer(); }, [refreshCareer]);

  async function reviewFact(fact: CareerFact, action: "confirm" | "edit" | "reject" | "retract", statement?: string) {
    setCareerBusy(true);
    setCareerError("");
    try {
      await fetchJson(`/career-profile/facts/${fact.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, statement })
      });
      await Promise.all([refreshCareer(), onCareerChange()]);
      setEditingFactId(null);
      setEditingFactText("");
      setCareerNotice(action === "retract" ? "事实已撤回，并加入生成内容禁止声明。" : action === "reject" ? "知识提案已拒绝。" : "事实已确认，正式任务现在可以使用它。 ");
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "审核知识失败");
      setCareerBusy(false);
    }
  }

  async function mergeFact(fact: CareerFact) {
    const targetFactId = Number(mergeTargetId);
    if (!targetFactId) return;
    setCareerBusy(true);
    setCareerError("");
    try {
      await fetchJson(`/career-profile/facts/${fact.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_fact_id: targetFactId })
      });
      setMergingFactId(null);
      setMergeTargetId("");
      setCareerNotice("重复事实已合并，原有证据已转移到保留事实。 ");
      await Promise.all([refreshCareer(), onCareerChange()]);
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "合并事实失败");
      setCareerBusy(false);
    }
  }

  async function reviewKnowledgeChange(change: KnowledgeChange, action: "accept" | "reject") {
    setCareerBusy(true);
    setCareerError("");
    try {
      await fetchJson(`/career-profile/knowledge-changes/${change.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      setCareerNotice(action === "accept" ? "知识变更已接受。" : "知识变更已拒绝。 ");
      await Promise.all([refreshCareer(), onCareerChange()]);
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "审核知识变更失败");
      setCareerBusy(false);
    }
  }

  async function updateSourceAccess(source: CareerBundle["sources"][number], allowed: boolean) {
    setCareerBusy(true);
    setCareerError("");
    try {
      await fetchJson(`/career-profile/sources/${source.id}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allow_model_original: allowed,
          privacy_mode: allowed ? "original" : "redacted"
        })
      });
      await Promise.all([refreshCareer(), onCareerChange()]);
      setCareerNotice(allowed ? "已授权该来源原文；其他来源权限不受影响。" : "已恢复为仅使用脱敏文本。 ");
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "更新资料授权失败");
      setCareerBusy(false);
    }
  }

  async function activateStrategy(strategy: CareerStrategy) {
    if (strategy.is_active) return;
    setCareerBusy(true);
    setCareerError("");
    try {
      await fetchJson(`/career-profile/strategies/${strategy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true })
      });
      setCareerNotice(`已切换到“${strategy.name}”，后续任务会使用该策略。`);
      await Promise.all([refreshCareer(), onCareerChange()]);
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "切换职业策略失败");
      setCareerBusy(false);
    }
  }

  async function createStrategy() {
    if (!newStrategyName.trim() || !newStrategyRole.trim()) return;
    setCareerBusy(true);
    try {
      await fetchJson("/career-profile/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newStrategyName.trim(),
          target_roles: newStrategyRole.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
          is_active: !career?.strategies.length,
          priority: career?.strategies.length ? 50 : 100
        })
      });
      setNewStrategyName("");
      setNewStrategyRole("");
      setCareerNotice("新职业策略已创建。 ");
      await Promise.all([refreshCareer(), onCareerChange()]);
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "创建职业策略失败");
      setCareerBusy(false);
    }
  }

  async function reviewStory(storyId: number, action: "confirm" | "reject" | "retract") {
    setCareerBusy(true);
    setCareerError("");
    try {
      await fetchJson(`/career-profile/stories/${storyId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      setCareerNotice(action === "confirm" ? "STAR+R 故事已确认。" : "故事状态已更新。 ");
      await Promise.all([refreshCareer(), onCareerChange()]);
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "审核故事失败");
      setCareerBusy(false);
    }
  }

  async function reviewNarrative(narrativeId: number, action: "confirm" | "reject" | "retract") {
    setCareerBusy(true);
    setCareerError("");
    try {
      await fetchJson(`/career-profile/narratives/${narrativeId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      setCareerNotice(action === "confirm" ? "职业叙事已确认。" : "职业叙事状态已更新。 ");
      await Promise.all([refreshCareer(), onCareerChange()]);
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "审核职业叙事失败");
      setCareerBusy(false);
    }
  }

  async function createStory() {
    if (!storyDraft.title.trim()) return;
    setCareerBusy(true);
    setCareerError("");
    try {
      await fetchJson("/career-profile/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...storyDraft,
          strategy_ids: career?.active_strategy ? [career.active_strategy.id] : [],
          fact_ids: []
        })
      });
      setStoryDraft({ title: "", situation: "", action: "", result: "", reflection: "" });
      setShowStoryForm(false);
      setCareerNotice("故事已进入待确认队列，确认后才会用于面试回答。 ");
      await refreshCareer();
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "创建故事失败");
      setCareerBusy(false);
    }
  }

  function startVoiceEdit() {
    setVoiceDraft({
      name: career?.voice?.name || "简洁专业",
      tone: career?.voice?.tone_rules.join("，") || "",
      banned: career?.voice?.banned_phrases.join("，") || ""
    });
    setEditingVoice(true);
  }

  async function saveVoice() {
    setCareerBusy(true);
    setCareerError("");
    try {
      await fetchJson("/career-profile/voice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: voiceDraft.name.trim() || "默认表达风格",
          tone_rules: splitTextList(voiceDraft.tone),
          banned_phrases: splitTextList(voiceDraft.banned),
          preferred_phrases: [],
          applicable_scenes: ["resume", "interview", "outreach"],
          is_default: true
        })
      });
      setEditingVoice(false);
      setCareerNotice("表达风格已保存并应用到后续生成任务。 ");
      await Promise.all([refreshCareer(), onCareerChange()]);
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "保存表达风格失败");
      setCareerBusy(false);
    }
  }

  async function recordOutcome() {
    if (!selectedJobId) return;
    setCareerBusy(true);
    setCareerError("");
    try {
      await fetchJson(`/jobs/${selectedJobId}/outcomes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: outcomeDraft.stage,
          notes: outcomeDraft.notes,
          recruiter_feedback: outcomeDraft.feedback,
          source: "user"
        })
      });
      setOutcomeDraft((current) => ({ ...current, notes: "", feedback: "" }));
      setCareerNotice("求职阶段已记录，漏斗分析会在样本达到门槛后更新。 ");
      await Promise.all([refreshCareer(), onCareerChange()]);
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "记录求职结果失败");
      setCareerBusy(false);
    }
  }

  async function recordDebrief() {
    if (!selectedJobId || !debriefDraft.summary.trim()) return;
    setCareerBusy(true);
    setCareerError("");
    try {
      await fetchJson(`/interviews/${selectedJobId}/debrief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_id: career?.active_strategy?.id || null,
          source_text: debriefDraft.summary,
          raw_feedback: debriefDraft.feedback,
          questions: debriefDraft.question.trim() ? [{
            question: debriefDraft.question,
            answer: debriefDraft.answer
          }] : []
        })
      });
      setDebriefDraft({ question: "", answer: "", feedback: "", summary: "" });
      setCareerNotice("面试复盘已保存；提取出的故事和事实会进入待确认队列。 ");
      await Promise.all([refreshCareer(), onCareerChange()]);
    } catch (error) {
      setCareerError(error instanceof Error ? error.message : "保存面试复盘失败");
      setCareerBusy(false);
    }
  }

  const pendingFacts = career?.facts.filter((fact) => fact.status === "pending") || [];
  const confirmedFacts = career?.facts.filter((fact) => fact.status === "confirmed") || [];
  const mergeTargets = career?.facts.filter((fact) => fact.status !== "retracted") || [];
  const independentChanges = (career?.pending_changes || []).filter((change) =>
    !pendingFacts.some((fact) => change.entity_type === "fact" && change.entity_id === fact.id)
  );

  return (
    <section className="profile-settings-page">
      <div className="settings-detail-intro">
        <div>
          <span className="settings-eyebrow">AGENT MEMORY</span>
          <h2>Agent 求职资料库</h2>
          <p>确认 Agent 可以使用的经历、目标、表达风格和面试反馈；未确认的信息不会进入正式分析。</p>
        </div>
        {returnToWorkbench ? (
          <button className="secondary-button" type="button" onClick={onReturnToWorkbench}>
            <ArrowLeft size={15} />返回岗位项目
          </button>
        ) : null}
      </div>

      <div className={`career-readiness-banner ${confirmedFacts.length ? "ready" : "locked"}`}>
        <div className="career-readiness-icon">{confirmedFacts.length ? <Check size={20} /> : <ShieldCheck size={20} />}</div>
        <div>
          <strong>{!career?.profile ? "先让 Agent 了解你的求职背景" : confirmedFacts.length ? "Agent 已可使用确认资料" : "还需要确认一条经历"}</strong>
          <span>{!career?.profile ? "从主聊天开始访谈，系统会逐条生成可核对的知识卡片。" : confirmedFacts.length ? `当前有 ${confirmedFacts.length} 条已确认事实可用于匹配、简历和面试。` : `请先确认至少一条事实；${pendingFacts.length} 条待确认知识不会进入正式输出。`}</span>
        </div>
        <div className="career-readiness-actions">
          <button type="button" onClick={onOpenChat}><Sparkles size={14} />继续画像访谈</button>
          {career?.profile ? <><a href={`${apiBase}/career-profile/export?format=json`} download><Download size={14} />JSON</a><a href={`${apiBase}/career-profile/export?format=markdown`} download><Download size={14} />Markdown</a></> : null}
        </div>
      </div>

      <div className="career-os-summary">
        <div><strong>{career?.completeness.score ?? 0}%</strong><span>画像完整度</span></div>
        <div><strong>{confirmedFacts.length}</strong><span>已确认事实</span></div>
        <div><strong>{pendingFacts.length}</strong><span>待确认知识</span></div>
        <div><strong>{career?.strategies.length ?? 0}</strong><span>职业策略</span></div>
        <div><strong>R{career?.profile?.knowledge_revision ?? 0}</strong><span>知识版本</span></div>
      </div>

      <nav className="career-os-tabs" aria-label="职业画像分区">
        {([
          ["governance", "知识治理"],
          ["sources", "资料与隐私"],
          ["strategies", "策略与故事"],
          ["feedback", "结果与成长"]
        ] as const).map(([key, label]) => (
          <button key={key} type="button" className={activePanel === key ? "active" : ""} onClick={() => setActivePanel(key)}>{label}</button>
        ))}
        <button type="button" onClick={() => void refreshCareer()} disabled={careerBusy}>{careerBusy ? "同步中…" : "刷新"}</button>
      </nav>

      {careerError ? <div className="career-os-error"><TriangleAlert size={16} />{careerError}</div> : null}
      {careerNotice ? <div className="career-os-notice"><Check size={16} />{careerNotice}<button type="button" onClick={() => setCareerNotice("")}>知道了</button></div> : null}

      {activePanel === "governance" ? (
        <div className="career-os-grid">
          <section className="career-os-panel wide">
            <header><div><h3>待确认知识</h3><p>确认前不会进入匹配分、简历、面试答案或招聘沟通。</p></div><span>{pendingFacts.length}</span></header>
            {pendingFacts.length ? pendingFacts.map((fact) => (
              <article className="knowledge-review-card" key={fact.id}>
                <div className="knowledge-review-content">
                  <small>{fact.category} · #{fact.id}</small>
                  {editingFactId === fact.id ? <input className="knowledge-edit-input" autoFocus value={editingFactText} onChange={(event) => setEditingFactText(event.target.value)} /> : <p>{fact.statement}</p>}
                  {fact.evidence[0] ? <em>来源：{fact.evidence[0].source_title} · {fact.evidence[0].excerpt}</em> : <em>来源：用户明确输入</em>}
                  {mergingFactId === fact.id ? <div className="knowledge-merge-row"><select aria-label="选择保留事实" value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)}><option value="">选择要保留的事实</option>{mergeTargets.filter((item) => item.id !== fact.id).map((item) => <option key={item.id} value={item.id}>{item.statement}</option>)}</select><button type="button" disabled={!mergeTargetId} onClick={() => void mergeFact(fact)}>确认合并</button><button type="button" onClick={() => { setMergingFactId(null); setMergeTargetId(""); }}>取消</button></div> : null}
                </div>
                <div className="knowledge-actions">
                  {editingFactId === fact.id ? <><button type="button" disabled={!editingFactText.trim()} onClick={() => void reviewFact(fact, "edit", editingFactText.trim())}>保存并确认</button><button type="button" onClick={() => setEditingFactId(null)}>取消</button></> : <><button type="button" onClick={() => void reviewFact(fact, "confirm")}><Check size={13} />确认</button><button type="button" onClick={() => { setEditingFactId(fact.id); setEditingFactText(fact.statement); }}><Edit3 size={13} />编辑</button><button type="button" onClick={() => { setMergingFactId(fact.id); setMergeTargetId(""); }}><Merge size={13} />合并</button><button type="button" onClick={() => void reviewFact(fact, "reject")}>拒绝</button></>}
                </div>
              </article>
            )) : <div className="career-os-empty">当前没有待确认知识。可通过主聊天继续画像访谈。</div>}
            {independentChanges.length ? <div className="knowledge-change-section"><h4>其他知识变更</h4>{independentChanges.map((change) => { const proposal = change.proposed || {}; return <article className="knowledge-change-card" key={change.id}><div><small>{change.entity_type || "knowledge"} · {change.operation || "proposal"}</small><p>{String(proposal.headline || proposal.statement || change.reason || "待审核变更")}</p></div><div><button type="button" onClick={() => void reviewKnowledgeChange(change, "accept")}>接受</button><button type="button" onClick={() => void reviewKnowledgeChange(change, "reject")}>拒绝</button></div></article>; })}</div> : null}
          </section>
          <section className="career-os-panel">
            <header><div><h3>已确认事实</h3><p>正式下游任务唯一可用的事实集合。</p></div><span>{confirmedFacts.length}</span></header>
            <div className="career-os-list">{confirmedFacts.slice(0, 12).map((fact) => <div key={fact.id}><p>{fact.statement}</p><button type="button" onClick={() => void reviewFact(fact, "retract")}>撤回</button></div>)}</div>
          </section>
          <section className="career-os-panel">
            <header><div><h3>安全规则</h3><p>每次定稿自动执行。</p></div><ShieldCheck size={18} /></header>
            <ul><li>未确认事实不参与评分</li><li>无依据指标会定位到句子</li><li>撤回声明成为禁止内容</li><li>资料默认脱敏后进入模型</li></ul>
          </section>
        </div>
      ) : null}

      {activePanel === "sources" ? (
        <div className="career-os-grid">
          <section className="career-os-panel wide">
            <header><div><h3>资料来源</h3><p>原文保存在本地，每个来源独立控制模型原文权限。</p></div><span>{career?.sources.length ?? 0}</span></header>
            <div className="source-governance-list">{career?.sources.map((source) => (
              <div key={source.id}><span className="source-type-icon"><FileText size={17} /></span><div><strong>{source.title}</strong><span>{source.source_type} · {source.character_count.toLocaleString()} 字符 · {source.allow_model_original ? "已授权模型读取原文" : "模型仅看脱敏文本"}</span></div><label className="source-access-toggle"><input type="checkbox" checked={source.allow_model_original} disabled={careerBusy} onChange={(event) => void updateSourceAccess(source, event.target.checked)} /><span>原文授权</span></label></div>
            ))}{!career?.sources.length ? <div className="career-os-empty">还没有资料来源。可在下方上传简历，或从主聊天补充经历。</div> : null}</div>
          </section>
        </div>
      ) : null}

      {activePanel === "strategies" ? (
        <div className="career-os-grid">
          <section className="career-os-panel wide">
            <header><div><h3>多职业策略</h3><p>共享候选人事实，目标、条件和证据权重彼此独立。</p></div><span>{career?.strategies.length ?? 0}</span></header>
            <div className="strategy-card-list">{career?.strategies.map((strategy) => (
              <article key={strategy.id} className={strategy.is_active ? "active" : ""}><div className="strategy-card-heading"><small>{strategy.is_active ? "当前策略" : `优先级 ${strategy.priority}`}</small>{strategy.is_active ? <Check size={15} /> : <button type="button" disabled={careerBusy} onClick={() => void activateStrategy(strategy)}>设为当前</button>}</div><h4>{strategy.name}</h4><p>{strategy.target_roles.join("、") || "待补充岗位"}</p><span>{strategy.locations.join("、") || "地点不限"} · {strategy.industries.join("、") || "行业不限"}</span>{strategy.salary?.min || strategy.salary?.max ? <em>{strategy.salary.min ? `${Math.round(strategy.salary.min / 1000)}K` : "不限"}–{strategy.salary.max ? `${Math.round(strategy.salary.max / 1000)}K` : "不限"} {strategy.salary.currency || "CNY"}</em> : null}</article>
            ))}</div>
            <div className="strategy-create"><input value={newStrategyName} onChange={(event) => setNewStrategyName(event.target.value)} placeholder="策略名称，例如：AI 产品经理" /><input value={newStrategyRole} onChange={(event) => setNewStrategyRole(event.target.value)} placeholder="目标岗位，可用逗号分隔" /><button type="button" onClick={() => void createStrategy()} disabled={!newStrategyName.trim() || !newStrategyRole.trim()}>新增策略</button></div>
          </section>
          <section className="career-os-panel">
            <header><div><h3>STAR+R 故事</h3><p>只有确认后的故事进入面试上下文。</p></div><button className="panel-add-button" type="button" onClick={() => setShowStoryForm((current) => !current)}><Plus size={14} />新增</button></header>
            {showStoryForm ? <div className="career-inline-form"><input placeholder="故事标题" value={storyDraft.title} onChange={(event) => setStoryDraft({ ...storyDraft, title: event.target.value })} /><textarea placeholder="情境 Situation" value={storyDraft.situation} onChange={(event) => setStoryDraft({ ...storyDraft, situation: event.target.value })} /><textarea placeholder="行动 Action" value={storyDraft.action} onChange={(event) => setStoryDraft({ ...storyDraft, action: event.target.value })} /><textarea placeholder="结果 Result" value={storyDraft.result} onChange={(event) => setStoryDraft({ ...storyDraft, result: event.target.value })} /><textarea placeholder="反思 Reflection" value={storyDraft.reflection} onChange={(event) => setStoryDraft({ ...storyDraft, reflection: event.target.value })} /><button type="button" disabled={!storyDraft.title.trim()} onClick={() => void createStory()}>保存为待确认故事</button></div> : null}
            <div className="story-list">{career?.stories.map((story) => <article key={story.id}><div><small>{story.status === "confirmed" ? "已确认" : story.status === "pending" ? "待确认" : story.status}</small><p>{story.title}</p>{story.result ? <span>{story.result}</span> : null}</div>{story.status === "pending" ? <div><button type="button" onClick={() => void reviewStory(story.id, "confirm")}>确认</button><button type="button" onClick={() => void reviewStory(story.id, "reject")}>拒绝</button></div> : story.status === "confirmed" ? <button type="button" className="text-danger" onClick={() => void reviewStory(story.id, "retract")}>撤回</button> : null}</article>)}{!career?.stories.length ? <div className="career-os-empty">还没有故事。面试复盘也可以自动生成待确认故事。</div> : null}</div>
          </section>
          <section className="career-os-panel">
            <header><div><h3>表达风格</h3><p>用于简历、面试和沟通草稿。</p></div><button className="panel-add-button" type="button" onClick={startVoiceEdit}><Edit3 size={14} />编辑</button></header>
            {editingVoice ? <div className="career-inline-form"><input value={voiceDraft.name} onChange={(event) => setVoiceDraft({ ...voiceDraft, name: event.target.value })} placeholder="风格名称" /><textarea value={voiceDraft.tone} onChange={(event) => setVoiceDraft({ ...voiceDraft, tone: event.target.value })} placeholder="语气规则，用逗号或换行分隔" /><textarea value={voiceDraft.banned} onChange={(event) => setVoiceDraft({ ...voiceDraft, banned: event.target.value })} placeholder="禁用表达，用逗号或换行分隔" /><div className="inline-form-actions"><button type="button" onClick={() => void saveVoice()}>保存风格</button><button type="button" onClick={() => setEditingVoice(false)}>取消</button></div></div> : <><p>{career?.voice?.name || "尚未建立表达风格"}</p><small>{career?.voice?.tone_rules.join(" · ") || "可在主聊天中描述偏好的语气和禁用表达"}</small>{career?.voice?.banned_phrases.length ? <div className="banned-phrase-list">{career.voice.banned_phrases.map((phrase) => <span key={phrase}>{phrase}</span>)}</div> : null}</>}
          </section>
          <section className="career-os-panel wide">
            <header><div><h3>职业叙事</h3><p>不同职业策略可拥有独立标题、转型说明和风险解释。</p></div><span>{career?.narratives.length ?? 0}</span></header>
            <div className="narrative-list">{career?.narratives.map((narrative) => <article key={narrative.id}><div><small>{narrative.status} · {career.strategies.find((item) => item.id === narrative.strategy_id)?.name || "通用"}</small><h4>{narrative.headline || "未命名叙事"}</h4><p>{narrative.transition_story}</p></div>{narrative.status === "pending" ? <div><button type="button" onClick={() => void reviewNarrative(narrative.id, "confirm")}>确认</button><button type="button" onClick={() => void reviewNarrative(narrative.id, "reject")}>拒绝</button></div> : null}</article>)}{!career?.narratives.length ? <div className="career-os-empty">暂无职业叙事，可通过主聊天补充转型原因和核心优势。</div> : null}</div>
          </section>
        </div>
      ) : null}

      {activePanel === "feedback" ? (
        <div className="career-os-grid">
          <section className="career-os-panel wide">
            <header><div><h3>记录求职结果</h3><p>阶段事件采用追加记录，不会覆盖历史。</p></div><BriefcaseBusiness size={18} /></header>
            {jobs.length ? <div className="feedback-entry-grid"><label><span>岗位项目</span><select value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)}>{jobs.map((job) => <option key={job.id} value={job.id}>{job.company_name} · {job.job_title}</option>)}</select></label><label><span>最新阶段</span><select value={outcomeDraft.stage} onChange={(event) => setOutcomeDraft({ ...outcomeDraft, stage: event.target.value })}>{[["saved", "已保存"], ["shortlisted", "已入围"], ["applied", "已投递"], ["recruiter_screen", "招聘沟通"], ["interview", "面试"], ["final", "终面"], ["offer", "Offer"], ["hired", "已入职"], ["rejected", "未通过"], ["withdrawn", "主动撤回"], ["no_response", "无回复"], ["archived", "归档"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="wide-field"><span>过程备注</span><textarea value={outcomeDraft.notes} onChange={(event) => setOutcomeDraft({ ...outcomeDraft, notes: event.target.value })} placeholder="例如：完成一面，约定下周反馈" /></label><label className="wide-field"><span>招聘方原话</span><textarea value={outcomeDraft.feedback} onChange={(event) => setOutcomeDraft({ ...outcomeDraft, feedback: event.target.value })} placeholder="原样保存反馈；系统不会自行推断因果" /></label><button type="button" onClick={() => void recordOutcome()} disabled={!selectedJobId || careerBusy}>记录阶段</button></div> : <div className="career-os-empty">还没有岗位项目。先从发现岗位池保存一个岗位。</div>}
          </section>
          <section className="career-os-panel wide">
            <header><div><h3>面试复盘</h3><p>真实问题、原回答和反馈会沉淀为待确认知识，不直接修改正式画像。</p></div><Target size={18} /></header>
            {jobs.length ? <div className="feedback-entry-grid"><label className="wide-field"><span>复盘摘要 <em className="required-mark">必填</em></span><textarea value={debriefDraft.summary} onChange={(event) => setDebriefDraft({ ...debriefDraft, summary: event.target.value })} placeholder="回忆本轮面试过程和整体表现" /></label><label><span>真实问题</span><textarea value={debriefDraft.question} onChange={(event) => setDebriefDraft({ ...debriefDraft, question: event.target.value })} placeholder="面试官问了什么？" /></label><label><span>我的原回答</span><textarea value={debriefDraft.answer} onChange={(event) => setDebriefDraft({ ...debriefDraft, answer: event.target.value })} placeholder="尽量按原话记录" /></label><label className="wide-field"><span>面试官反馈原文</span><textarea value={debriefDraft.feedback} onChange={(event) => setDebriefDraft({ ...debriefDraft, feedback: event.target.value })} placeholder="没有可以留空" /></label><button type="button" onClick={() => void recordDebrief()} disabled={!selectedJobId || !debriefDraft.summary.trim() || careerBusy}>保存复盘</button></div> : <div className="career-os-empty">创建岗位项目后即可记录面试复盘。</div>}
          </section>
          <section className="career-os-panel">
            <header><div><h3>个人漏斗模式</h3><p>{patterns?.eligible ? "样本已达到分析门槛。" : `还需 ${Math.max(0, (patterns?.minimum_required || 5) - (patterns?.progressed_count || 0))} 条进入投递后的记录。`}</p></div><strong className="insight-count">{patterns?.progressed_count ?? 0}/5</strong></header>
            {patterns?.eligible ? <><div className="stage-count-grid">{Object.entries(patterns.stage_counts).map(([stage, count]) => <div key={stage}><strong>{count}</strong><span>{stage}</span></div>)}</div>{patterns.recommendations.map((item) => <p className="insight-recommendation" key={item.message}>{item.message}</p>)}</> : <div className="career-progress-track"><span style={{ width: `${Math.min(100, ((patterns?.progressed_count || 0) / 5) * 100)}%` }} /></div>}
            <small>{patterns?.limitations?.[0] || "只分析个人漏斗相关性，不推断招聘方因果。"}</small>
          </section>
          <section className="career-os-panel">
            <header><div><h3>能力成长信号</h3><p>重复出现两次以上才建议投入学习。</p></div><span>{skillGrowth?.items?.filter((item) => item.eligible_for_recommendation).length ?? 0}</span></header>
            <div className="skill-growth-list">{skillGrowth?.items?.map((item) => <div key={item.skill} className={item.eligible_for_recommendation ? "recommended" : "observing"}><div><strong>{item.skill}</strong><span>{item.reason}</span></div><em>{item.frequency} 次</em></div>)}{!skillGrowth?.items?.length ? <div className="career-os-empty">暂无重复能力缺口。</div> : null}</div>
          </section>
        </div>
      ) : null}

      {activePanel === "sources" ? <><div className="profile-editor-card">
        <div className="profile-card-heading">
          <span className="profile-card-icon"><UserRound size={19} /></span>
          <div><h2>人物画像</h2><p>这些信息会用于岗位匹配和沟通准备。</p></div>
        </div>
        <div className="candidate-form">
          <label><span>称呼 <em className="required-mark">必填</em></span><input required value={editor.name} placeholder="例如：小林" onChange={(event) => onChange({ ...editor, name: event.target.value })} /></label>
          <label><span>目标岗位</span><input value={editor.targetRole} placeholder="AI Agent 工程师" onChange={(event) => onChange({ ...editor, targetRole: event.target.value })} /></label>
          <label><span>目标城市</span><input value={editor.targetCity} placeholder="上海，杭州" onChange={(event) => onChange({ ...editor, targetCity: event.target.value })} /></label>
          <label className="wide-field"><span>核心技能</span><input value={editor.skills} placeholder="Python，FastAPI，LLM，Agent" onChange={(event) => onChange({ ...editor, skills: event.target.value })} /></label>
          <label><span>最低月薪（K）</span><input type="number" min="0" value={editor.salaryMin} placeholder="25" onChange={(event) => onChange({ ...editor, salaryMin: event.target.value })} /></label>
          <label><span>最高月薪（K）</span><input type="number" min="0" value={editor.salaryMax} placeholder="40" onChange={(event) => onChange({ ...editor, salaryMax: event.target.value })} /></label>
          <label className="wide-field"><span>偏好行业</span><input value={editor.industries} placeholder="人工智能，企业服务" onChange={(event) => onChange({ ...editor, industries: event.target.value })} /></label>
          <label className="wide-field"><span>屏蔽关键词</span><input value={editor.blockedKeywords} placeholder="外包，纯销售" onChange={(event) => onChange({ ...editor, blockedKeywords: event.target.value })} /></label>
          <label className="wide-field"><span>不考虑的公司</span><input value={editor.blockedCompanies} placeholder="使用逗号分隔" onChange={(event) => onChange({ ...editor, blockedCompanies: event.target.value })} /></label>
        </div>
      </div>

      <div className="resume-upload-card">
        <div className="profile-card-heading">
          <span className="profile-card-icon"><Upload size={19} /></span>
          <div><h2>上传简历</h2><p>可选；也可以仅通过主聊天建立画像。</p></div>
        </div>
        <label className={`resume-upload ${resumeBusy ? "busy" : ""}`}>
          {resumeBusy ? <LoaderCircle className="spinning" size={23} /> : <Upload size={23} />}
          <strong>{resumeBusy ? "正在本地解析…" : editor.resumeFilename || "上传简历截图"}</strong>
          <span>支持多张 PNG、JPG、WEBP 截图，也兼容 PDF、DOCX、TXT</span>
          <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md" disabled={resumeBusy} onChange={(event) => { onParseFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
        </label>
        <div className="resume-options">
          <label><input type="checkbox" checked={enhancedParse} onChange={(event) => onEnhancedParseChange(event.target.checked)} /><span>增强解析</span><small>适合复杂排版或扫描版，首次可能较慢</small></label>
          <button type="button" onClick={onScanPrivacy} disabled={resumeBusy || !editor.resumeText}><ShieldCheck size={14} />隐私检查</button>
        </div>
        {privacyFindings.length ? (
          <div className="privacy-result">
            <ShieldCheck size={16} /><div><strong>检测到 {privacyFindings.length} 处敏感信息</strong><span>{privacyFindings.slice(0, 3).map((item) => item.preview).join("、")}；默认向 Agent 提供脱敏版本。</span></div>
          </div>
        ) : null}
      </div>

      <div className="resume-editor-card resume-text-card">
        <div className="profile-card-heading">
          <span className="profile-card-icon"><FileText size={19} /></span>
          <div><h2>编辑简历内容</h2><p>检查解析结果，也可以直接粘贴或修改文本。</p></div>
        </div>
        <div className="resume-preview-heading"><span>简历文本</span><small>{editor.resumeText.length.toLocaleString()} 字符</small></div>
        <textarea className="resume-preview" value={editor.resumeText} placeholder="上传简历或直接粘贴简历文本。内容只会在点击保存后进入人物画像。" onChange={(event) => onChange({ ...editor, resumeText: event.target.value, resumeRedactedText: "" })} />
        {suggestion && (suggestion.name || suggestion.target_roles.length || suggestion.target_cities.length || suggestion.skills.length) ? (
          <div className="profile-fill-suggestion">
            <WandSparkles size={17} />
            <div>
              <strong>识别到可填充的画像内容</strong>
              <span>{[
                suggestion.name ? `称呼：${suggestion.name}` : "",
                suggestion.target_roles.length ? `目标岗位：${suggestion.target_roles.join("、")}` : "",
                suggestion.target_cities.length ? `目标城市：${suggestion.target_cities.join("、")}` : "",
                suggestion.skills.length ? `技能：${suggestion.skills.join("、")}` : ""
              ].filter(Boolean).join("；")}</span>
              <small>只补充空字段，并合并新技能，不会覆盖已填写内容。</small>
            </div>
            <button type="button" onClick={onFillSuggestion}>一键填充</button>
          </div>
        ) : null}
        <label className="agent-privacy-choice"><input type="checkbox" checked={editor.privacyMode === "original"} onChange={(event) => onChange({ ...editor, privacyMode: event.target.checked ? "original" : "redacted" })} /><span>允许 Agent 使用简历原文</span><small>关闭时，手机号、邮箱和身份证号不会进入模型上下文</small></label>
        {editor.resumeText ? <button type="button" className="clear-resume-button" onClick={onClearResume}><Trash2 size={13} />清除简历内容</button> : null}
      </div>

      <div className="profile-save-bar">
        <span>
          {!ready ? <TriangleAlert size={15} /> : <ShieldCheck size={15} />}
          {!editor.name.trim() ? "请先填写称呼" : !editor.resumeText.trim() ? "可以先保存基本信息，再通过主聊天补充事实" : "资料保存在本地，不会自动发送给招聘平台"}
        </span>
        <button className="primary-button" type="button" onClick={async () => { await onSave(); await refreshCareer(); }} disabled={busy || resumeBusy || !ready}>
          {busy ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}
          {busy ? "保存中…" : returnToWorkbench ? "保存并返回岗位" : "保存资料"}
        </button>
      </div>
      </> : null}
    </section>
  );
}
