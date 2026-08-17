from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class PrivacyScanIn(BaseModel):
    text: str = Field(default="", max_length=100_000)


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=500)
    captcha_id: str = Field(min_length=10, max_length=100)
    captcha_code: str = Field(min_length=5, max_length=12)


class AccountUpdateIn(BaseModel):
    display_name: str = Field(default="", max_length=40)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=500)
    new_password: str = Field(min_length=8, max_length=500)


class ChatMessageIn(BaseModel):
    content: str = Field(min_length=1)
    conversation_id: int | None = None
    attachment_ids: list[str] = Field(default_factory=list, max_length=8)
    vision_attachment_ids: list[str] = Field(default_factory=list, max_length=4)
    web_search: bool = False


class ConversationIn(BaseModel):
    title: str = Field(default="新对话", max_length=80)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    status: Literal["active", "archived"] | None = None


class JobCreate(BaseModel):
    conversation_id: int | None = Field(default=None, ge=1)
    job_title: str = Field(min_length=1, max_length=200)
    company_name: str = Field(default="", max_length=200)
    location: str = Field(default="", max_length=200)
    salary_text: str = Field(default="", max_length=100)
    source_url: str = Field(default="", max_length=1_000)
    description: str = Field(min_length=20, max_length=50_000)
    notes: str = Field(default="", max_length=5_000)
    priority: Literal["low", "medium", "high"] = "medium"


class JobUpdate(BaseModel):
    job_title: str | None = Field(default=None, max_length=200)
    company_name: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    salary_text: str | None = Field(default=None, max_length=100)
    source_url: str | None = Field(default=None, max_length=1_000)
    description: str | None = Field(default=None, max_length=50_000)
    notes: str | None = Field(default=None, max_length=5_000)
    priority: Literal["low", "medium", "high"] | None = None


class JobImportTextPreviewIn(BaseModel):
    text: str = Field(min_length=1, max_length=50_000)
    source_url: str = Field(default="", max_length=2_000)


class JobEvaluationCreateIn(BaseModel):
    strategy_id: int | None = Field(default=None, ge=1)
    include_public_research: bool = True


class JobEvaluationReviewIn(BaseModel):
    target_type: Literal["requirement", "dimension", "risk", "compensation"]
    target_key: str = Field(min_length=1, max_length=100)
    action: Literal["confirm", "edit", "reject", "resolve", "restore"]
    override: dict[str, Any] = Field(default_factory=dict)
    note: str = Field(default="", max_length=2_000)


class JobComparisonIn(BaseModel):
    evaluation_ids: list[int] = Field(min_length=2, max_length=10)


class ResumeLayoutSettings(BaseModel):
    spacing: int | None = Field(default=None, ge=70, le=130)
    one_page: bool | None = None


class ResumeVersionUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    status: Literal["draft", "final"] | None = None
    template_id: Literal["classic", "compact", "minimal"] | None = None
    style_id: Literal["navy", "forest", "ink", "wine"] | None = None
    layout: ResumeLayoutSettings | None = None


class QuickMatchIn(BaseModel):
    job_description: str = Field(default="", max_length=50_000)
    job_title: str = Field(default="", max_length=200)
    company_name: str = Field(default="", max_length=200)


class QuickMatchApplyRewriteIn(BaseModel):
    original: str = Field(min_length=1, max_length=2_000)
    suggested: str = Field(min_length=1, max_length=2_000)
    job_description: str = Field(default="", max_length=50_000)
    job_title: str = Field(default="", max_length=200)
    company_name: str = Field(default="", max_length=200)


class ResumeChangeUpdate(BaseModel):
    decision: Literal["pending", "accepted", "rejected"] | None = None
    after_text: str | None = Field(default=None, max_length=100_000)


class InterviewKitCreate(BaseModel):
    interview_type: Literal["general", "hr", "business", "technical", "final"] = "general"


class InterviewKitUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    status: Literal["draft", "ready"] | None = None
    self_intro: str | None = Field(default=None, max_length=10_000)
    notes: str | None = Field(default=None, max_length=10_000)


class InterviewTaskUpdate(BaseModel):
    completed: bool


class InterviewPreparationFragmentReviewIn(BaseModel):
    action: Literal["confirm_project", "work_responsibility", "skill_evidence", "ignore"]


class InterviewPreparationNodeUpdate(BaseModel):
    completed: bool | None = None
    note: str | None = Field(default=None, max_length=2_000)


class InterviewPreparationRecordIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=10_000)
    occurred_on: str | None = Field(default=None, max_length=20)


class InterviewPreparationProjectSelectionIn(BaseModel):
    project_ids: list[str] = Field(default_factory=list)


class InterviewPreparationJdIn(BaseModel):
    job_description: str = Field(min_length=20, max_length=50_000)


class InterviewPreparationFeedbackIn(BaseModel):
    answer: str = Field(min_length=10, max_length=5_000)


class ProjectBriefingIn(BaseModel):
    source_kind: Literal["description", "code", "repo"] = "description"
    description: str = Field(default="", max_length=8_000)
    code_excerpt: str = Field(default="", max_length=20_000)
    repo_url: str = Field(default="", max_length=500)
    use_model: bool = False


class InterviewRoundCreate(BaseModel):
    kit_id: int | None = Field(default=None, ge=1)
    round_type: Literal["general", "hr", "business", "technical", "final"] = "general"
    scheduled_at: str | None = Field(default=None, max_length=50)
    interviewer: str = Field(default="", max_length=200)
    location: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=5_000)


class InterviewRoundUpdate(BaseModel):
    scheduled_at: str | None = Field(default=None, max_length=50)
    interviewer: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=300)
    status: Literal["scheduled", "completed", "cancelled"] | None = None
    outcome: Literal["pending", "passed", "failed"] | None = None
    notes: str | None = Field(default=None, max_length=5_000)


class JobEventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    detail: str = Field(default="", max_length=5_000)
    occurred_at: str | None = Field(default=None, max_length=50)


class AgentSettingsIn(BaseModel):
    display_name: str = Field(default="CareerLoop", min_length=1, max_length=40)
    persona_role: str = Field(min_length=1, max_length=300)
    response_style: Literal["concise", "balanced", "detailed"] = "concise"
    custom_instructions: str = Field(default="", max_length=1000)
    profile_memory_enabled: bool = True
    conversation_memory_enabled: bool = True
    knowledge_memory_enabled: bool = True
    summary_enabled: bool = True
    context_message_limit: int = Field(default=12, ge=4, le=30)
    model_name: str = Field(default="gpt-5.5", min_length=1, max_length=120)
    model_base_url: str = Field(default="", max_length=500)
    api_key: str = Field(default="", max_length=500)


class ModelDiscoveryIn(BaseModel):
    model_base_url: str = Field(default="", max_length=500)
    api_key: str = Field(default="", max_length=500)


class ModelCapabilitiesIn(BaseModel):
    model_name: str = Field(default="", max_length=120)
    model_base_url: str = Field(default="", max_length=500)
    api_key: str = Field(default="", max_length=500)
    probe: bool = False


# CareerLoop 2.0 career operating system
class CareerProfileInitIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    locale: str = Field(default="zh-CN", max_length=20)
    privacy_mode: Literal["redacted", "original"] = "redacted"


class CandidateSourceIn(BaseModel):
    source_type: Literal[
        "resume", "certificate", "portfolio", "chat_message",
        "interview_debrief", "github", "public_page", "other",
    ]
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=200_000)
    source_uri: str = Field(default="", max_length=2_000)
    privacy_mode: Literal["redacted", "original"] = "redacted"
    allow_model_original: bool = False
    extract_knowledge: bool = True


class CandidateSourceAccessIn(BaseModel):
    allow_model_original: bool
    privacy_mode: Literal["redacted", "original"] | None = None


class CandidateFactIn(BaseModel):
    category: str = Field(min_length=1, max_length=50)
    statement: str = Field(min_length=1, max_length=5_000)
    canonical_key: str = Field(default="", max_length=200)
    value: dict[str, Any] = Field(default_factory=dict)
    sensitivity: Literal["public", "private", "sensitive"] = "private"
    source_id: int | None = Field(default=None, ge=1)
    excerpt: str = Field(default="", max_length=5_000)
    locator: str = Field(default="", max_length=500)


class CandidateFactReviewIn(BaseModel):
    action: Literal["confirm", "edit", "reject", "retract"]
    statement: str = Field(default="", max_length=5_000)


class CandidateFactMergeIn(BaseModel):
    target_fact_id: int = Field(ge=1)


class CareerStrategyIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target_roles: list[str] = Field(default_factory=list, max_length=30)
    target_level: str = Field(default="", max_length=100)
    regions: list[str] = Field(default_factory=list, max_length=30)
    salary_min: int | None = Field(default=None, ge=0)
    salary_max: int | None = Field(default=None, ge=0)
    salary_currency: str = Field(default="CNY", max_length=10)
    work_modes: list[str] = Field(default_factory=list, max_length=10)
    industries: list[str] = Field(default_factory=list, max_length=30)
    hard_constraints: list[str] = Field(default_factory=list, max_length=50)
    soft_preferences: list[str] = Field(default_factory=list, max_length=50)
    blocked_companies: list[str] = Field(default_factory=list, max_length=100)
    title_expansions: list[str] = Field(default_factory=list, max_length=50)
    evaluation_weights: dict[str, float] = Field(default_factory=dict)
    priority: int = Field(default=0, ge=0, le=100)
    is_active: bool = True


class CareerStrategyUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    target_roles: list[str] | None = Field(default=None, max_length=30)
    target_level: str | None = Field(default=None, max_length=100)
    regions: list[str] | None = Field(default=None, max_length=30)
    salary_min: int | None = Field(default=None, ge=0)
    salary_max: int | None = Field(default=None, ge=0)
    salary_currency: str | None = Field(default=None, max_length=10)
    work_modes: list[str] | None = Field(default=None, max_length=10)
    industries: list[str] | None = Field(default=None, max_length=30)
    hard_constraints: list[str] | None = Field(default=None, max_length=50)
    soft_preferences: list[str] | None = Field(default=None, max_length=50)
    blocked_companies: list[str] | None = Field(default=None, max_length=100)
    title_expansions: list[str] | None = Field(default=None, max_length=50)
    evaluation_weights: dict[str, float] | None = None
    priority: int | None = Field(default=None, ge=0, le=100)
    is_active: bool | None = None


class CandidateStoryIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    situation: str = Field(default="", max_length=10_000)
    task: str = Field(default="", max_length=10_000)
    action: str = Field(default="", max_length=10_000)
    result: str = Field(default="", max_length=10_000)
    reflection: str = Field(default="", max_length=10_000)
    question_tags: list[str] = Field(default_factory=list, max_length=50)
    strategy_ids: list[int] = Field(default_factory=list, max_length=20)
    fact_ids: list[int] = Field(default_factory=list, max_length=100)
    source_id: int | None = Field(default=None, ge=1)


class CandidateStoryReviewIn(BaseModel):
    action: Literal["confirm", "reject", "retract"]
    reason: str = Field(default="", max_length=1_000)


class CandidateNarrativeIn(BaseModel):
    strategy_id: int | None = Field(default=None, ge=1)
    headline: str = Field(default="", max_length=500)
    transition_story: str = Field(default="", max_length=10_000)
    strengths: list[str] = Field(default_factory=list, max_length=50)
    risk_explanations: list[str] = Field(default_factory=list, max_length=50)


class CandidateNarrativeReviewIn(BaseModel):
    action: Literal["confirm", "reject", "retract"]


class StrategyEvidenceIn(BaseModel):
    relationship: Literal["supports", "gap", "risk"]
    fact_id: int | None = Field(default=None, ge=1)
    weight: float = Field(default=1.0, ge=0, le=10)
    note: str = Field(default="", max_length=2_000)


class WritingSampleIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=50_000)
    sample_type: str = Field(default="general", max_length=50)
    source_id: int | None = Field(default=None, ge=1)


class VoiceProfileIn(BaseModel):
    name: str = Field(default="默认表达风格", min_length=1, max_length=120)
    applicable_scenes: list[str] = Field(default_factory=list, max_length=30)
    tone_rules: list[str] = Field(default_factory=list, max_length=100)
    banned_phrases: list[str] = Field(default_factory=list, max_length=100)
    preferred_phrases: list[str] = Field(default_factory=list, max_length=100)
    is_default: bool = True


class MaterialVerifyIn(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)
    context_scope: Literal["resume", "interview", "outreach"] = "resume"
    strategy_id: int | None = Field(default=None, ge=1)


class ProfileInterviewStartIn(BaseModel):
    conversation_id: int = Field(ge=1)


class ProfileInterviewAnswerIn(BaseModel):
    answer: str = Field(min_length=1, max_length=20_000)


class InterviewDebriefIn(BaseModel):
    interview_round_id: int | None = Field(default=None, ge=1)
    strategy_id: int | None = Field(default=None, ge=1)
    questions: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    raw_feedback: str = Field(default="", max_length=30_000)
    source_text: str = Field(default="", max_length=100_000)


class CompanyIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    website_url: str = Field(default="", max_length=2_000)
    careers_url: str = Field(default="", max_length=2_000)
    region: str = Field(default="", max_length=120)
    industry: str = Field(default="", max_length=120)
    followed: bool = False
    evidence: list[dict[str, Any]] = Field(default_factory=list, max_length=50)


class OpportunityDiscoveryIn(BaseModel):
    strategy_id: int | None = Field(default=None, ge=1)
    query: str = Field(default="", max_length=500)
    limit: int = Field(default=12, ge=1, le=30)


class OpportunitySourceIn(BaseModel):
    company_id: int | None = Field(default=None, ge=1)
    name: str = Field(min_length=1, max_length=255)
    source_url: str = Field(min_length=1, max_length=2_000)
    provider: str = Field(default="", max_length=50)
    followed: bool = True
    access_mode: Literal["public_api", "public_page", "browser_visible_only"] | None = None
    platform: str = Field(default="", max_length=50)
    evidence: list[dict[str, Any]] = Field(default_factory=list, max_length=50)


class OpportunitySourceUpdateIn(BaseModel):
    enabled: bool | None = None
    verified: bool | None = None
    access_mode: Literal["public_api", "public_page", "browser_visible_only"] | None = None


class DiscoveryRunIn(BaseModel):
    mode: Literal["scan", "discover", "company_funded", "pipeline", "batch"]
    strategy_id: int | None = Field(default=None, ge=1)
    query: str = Field(default="", max_length=500)
    company_names: list[str] = Field(default_factory=list, max_length=30)
    source_ids: list[int] = Field(default_factory=list, max_length=200)
    job_ids: list[int] = Field(default_factory=list, max_length=200)
    deep_job_ids: list[int] = Field(default_factory=list, max_length=200)
    regions: list[str] = Field(default_factory=list, max_length=20)
    industries: list[str] = Field(default_factory=list, max_length=20)
    funding_window_days: Literal[30, 90, 180] = 90
    limit: int = Field(default=12, ge=1, le=30)
    deep_analysis: Literal["none", "top", "selected"] = "top"


class DiscoveredJobUpdateIn(BaseModel):
    status: Literal["discovered", "shortlisted", "dismissed"]


class DiscoveredJobPromoteIn(BaseModel):
    priority: Literal["low", "medium", "high"] = "medium"
