from __future__ import annotations

import json
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse

from ..workspace import bind_workspace
from ..agent import get_agent_capabilities
from ..agent.bootstrap import reload_agent_components
from ..agent.model_capabilities import (
    build_model_list,
    infer_model_capabilities,
)
from ..agent.settings import (
    get_agent_settings,
    get_model_connection,
    save_agent_settings,
)
from ..agent.operations import get_agent_operations_snapshot
from ..attachments.service import (
    create_attachment,
    delete_attachment,
    delete_conversation_attachments,
    list_attachments,
    parse_attachment,
)
from ..config import get_settings
from ..agent.snapshots import clear_run_snapshot
from ..chat.conversations import (
    create_conversation,
    delete_conversation,
    list_conversations,
    reset_conversation_context,
    update_conversation,
)
from ..db import connect
from ..profile.candidate_core import (
    create_candidate_source,
    clear_candidate_resume,
    add_writing_sample,
    create_or_update_profile,
    create_story,
    create_strategy,
    export_career_profile,
    get_candidate_context,
    get_career_profile,
    get_or_start_profile_interview,
    get_voice_profile,
    ingest_resume_knowledge,
    blocked_skill_names,
    resolved_skill_names,
    list_candidate_sources,
    list_candidate_narratives,
    list_facts,
    merge_facts,
    list_stories,
    list_strategies,
    list_strategy_evidence,
    list_writing_samples,
    propose_fact,
    review_fact,
    review_candidate_narrative,
    review_story,
    record_profile_interview_answer,
    save_voice_profile,
    save_candidate_narrative,
    set_strategy_evidence,
    update_candidate_source_access,
    update_strategy,
    verify_candidate_material,
)
from ..profile.career_feedback import (
    career_patterns,
    record_interview_debrief,
    skill_growth_map,
)
from ..profile.intelligence import filter_blocked_skills
from ..profile.skill_tags import resolve_home_skill_tags, skill_tag_source
from ..opportunities.service import (
    OpportunityScanError,
    add_opportunity_source,
    create_or_update_company,
    get_discovered_job,
    list_companies,
    list_discovered_jobs,
    list_opportunity_sources,
    promote_discovered_job,
    scan_followed_sources,
    scan_opportunity_source,
    update_discovered_job,
    update_opportunity_source,
)
from ..opportunities.runs import (
    cancel_discovery_run,
    create_discovery_run,
    execute_discovery_run,
    get_discovery_run,
    list_company_signals,
    list_discovered_job_assessments,
    list_discovery_runs,
    retry_discovery_run,
)
from ..jobs.service import create_job, delete_job, get_job, list_jobs, update_job
from ..jobs.imports import (
    JobImportError,
    preview_job_screenshot,
    preview_job_text,
)
from ..jobs.quick_match import analyze_job_description, apply_resume_rewrite_and_analyze
from ..profile.analysis_run import encode_sse, iter_analysis_run_events
from ..jobs.evaluations import (
    cancel_job_evaluation,
    create_job_comparison,
    create_job_evaluation,
    execute_job_evaluation,
    export_job_evaluation,
    get_job_comparison,
    get_job_evaluation,
    list_job_evaluation_sources,
    list_job_evaluations,
    retry_job_evaluation,
    review_job_evaluation,
    validate_evaluation_weights,
)
from ..observability.model_monitor import get_model_monitor_snapshot, record_model_service_event
from ..models import ModelProviderError, OpenAICompatibleProvider
from ..interview.workflow import (
    add_job_event,
    create_interview_kit,
    create_interview_round,
    delete_interview_kit,
    delete_interview_round,
    get_interview_kit,
    list_interview_kits,
    list_interview_rounds,
    list_job_events,
    update_interview_kit,
    update_interview_round,
    update_interview_task,
)
from ..interview.preparation import (
    add_interview_preparation_record,
    analyze_interview_preparation_jd,
    give_interview_preparation_feedback,
    get_interview_preparation,
    review_interview_preparation_fragment,
    select_interview_preparation_projects,
    start_interview_preparation_resume_analysis,
    update_interview_preparation_node,
)
from ..projects.briefing import analyze_project_briefing, get_project_studio
from ..resume.versions import (
    create_baseline_resume_version,
    create_resume_version,
    delete_resume_version,
    export_resume_version,
    get_resume_version,
    list_resume_versions,
    update_resume_change,
    update_resume_version,
)
from ..profile import service as profile_service
from ..workflow.engine import record_stage_activity, refresh_workflow_status
from .dependencies import require_conversation
from .schemas import (
    AgentSettingsIn,
    CandidateFactIn,
    CandidateFactMergeIn,
    CandidateFactReviewIn,
    CandidateSourceIn,
    CandidateSourceAccessIn,
    CandidateNarrativeIn,
    CandidateNarrativeReviewIn,
    CandidateStoryIn,
    CandidateStoryReviewIn,
    CareerProfileInitIn,
    CareerStrategyIn,
    CareerStrategyUpdateIn,
    CompanyIn,
    ConversationIn,
    ConversationUpdate,
    InterviewKitCreate,
    InterviewKitUpdate,
    InterviewRoundCreate,
    InterviewRoundUpdate,
    InterviewTaskUpdate,
    InterviewPreparationFragmentReviewIn,
    InterviewPreparationFeedbackIn,
    InterviewPreparationJdIn,
    InterviewPreparationNodeUpdate,
    InterviewPreparationProjectSelectionIn,
    InterviewPreparationRecordIn,
    ProjectBriefingIn,
    JobCreate,
    JobComparisonIn,
    JobEvaluationCreateIn,
    JobEvaluationReviewIn,
    JobImportTextPreviewIn,
    JobEventCreate,
    JobUpdate,
    ModelCapabilitiesIn,
    ModelDiscoveryIn,
    MaterialVerifyIn,
    DiscoveryRunIn,
    OpportunitySourceIn,
    OpportunitySourceUpdateIn,
    PrivacyScanIn,
    ProfileInterviewAnswerIn,
    ProfileInterviewStartIn,
    DiscoveredJobPromoteIn,
    DiscoveredJobUpdateIn,
    InterviewDebriefIn,
    ResumeChangeUpdate,
    QuickMatchApplyRewriteIn,
    QuickMatchIn,
    ResumeVersionUpdate,
    VoiceProfileIn,
    StrategyEvidenceIn,
    WritingSampleIn,
)


router = APIRouter()


def _record_workbench_stage(stage_id: str, message: str, **payload: Any) -> None:
    record_stage_activity(stage_id, "stage_engaged", message, payload or None)


@router.post("/quick-match")
def quick_match(payload: QuickMatchIn) -> dict[str, Any]:
    try:
        return analyze_job_description(
            payload.job_description,
            job_title=payload.job_title,
            company_name=payload.company_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/quick-match/run")
async def quick_match_run(payload: QuickMatchIn) -> StreamingResponse:
    async def stream():
        try:
            async for event in iter_analysis_run_events(
                payload.job_description,
                job_title=payload.job_title,
                company_name=payload.company_name,
            ):
                yield encode_sse(event)
        except ValueError as exc:
            yield encode_sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/quick-match/apply-rewrite")
def quick_match_apply_rewrite(payload: QuickMatchApplyRewriteIn) -> dict[str, Any]:
    try:
        return apply_resume_rewrite_and_analyze(
            payload.original,
            payload.suggested,
            job_description=payload.job_description,
            job_title=payload.job_title,
            company_name=payload.company_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/interview-preparation")
def interview_preparation_get() -> dict[str, Any]:
    try:
        return get_interview_preparation()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/interview-preparation/analyze")
async def interview_preparation_analyze() -> dict[str, Any]:
    try:
        result = await start_interview_preparation_resume_analysis()
        _record_workbench_stage("interview_preparation", "工作台已开始面试准备分析")
        return result
    except (ValueError, ModelProviderError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/interview-preparation/projects")
def interview_preparation_projects_select(
    payload: InterviewPreparationProjectSelectionIn,
) -> dict[str, Any]:
    try:
        return select_interview_preparation_projects(payload.project_ids)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/interview-preparation/jd-analysis")
async def interview_preparation_jd_analyze(
    payload: InterviewPreparationJdIn,
) -> dict[str, Any]:
    try:
        result = await analyze_interview_preparation_jd(payload.job_description)
        _record_workbench_stage("interview_preparation", "工作台已按 JD 分析面试准备")
        return result
    except (ValueError, ModelProviderError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/interview-preparation/questions/{question_id}/feedback")
async def interview_preparation_feedback(
    question_id: str,
    payload: InterviewPreparationFeedbackIn,
) -> dict[str, Any]:
    try:
        return await give_interview_preparation_feedback(question_id, payload.answer)
    except (ValueError, ModelProviderError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/interview-preparation/fragments/{fragment_id}/review")
def interview_preparation_fragment_review(
    fragment_id: str,
    payload: InterviewPreparationFragmentReviewIn,
) -> dict[str, Any]:
    try:
        return review_interview_preparation_fragment(fragment_id, action=payload.action)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/interview-preparation/nodes/{node_id}")
def interview_preparation_node_update(
    node_id: str,
    payload: InterviewPreparationNodeUpdate,
) -> dict[str, Any]:
    try:
        return update_interview_preparation_node(
            node_id,
            completed=payload.completed,
            note=payload.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/project-studio")
def project_studio_get() -> dict[str, Any]:
    try:
        return get_project_studio()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/project-studio/{project_id}/briefing")
async def project_studio_briefing(
    project_id: str,
    payload: ProjectBriefingIn,
) -> dict[str, Any]:
    try:
        return await analyze_project_briefing(
            project_id,
            source_kind=payload.source_kind,
            description=payload.description,
            code_excerpt=payload.code_excerpt,
            repo_url=payload.repo_url,
            use_model=payload.use_model,
        )
    except (ValueError, ModelProviderError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/interview-preparation/records")
def interview_preparation_record_create(
    payload: InterviewPreparationRecordIn,
) -> dict[str, Any]:
    try:
        return add_interview_preparation_record(
            title=payload.title,
            summary=payload.summary,
            occurred_on=payload.occurred_on,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/conversations")
def conversations_index() -> list[dict[str, Any]]:
    return list_conversations()


@router.post("/conversations")
def conversations_create(payload: ConversationIn) -> dict[str, Any]:
    return create_conversation(payload.title)


@router.patch("/conversations/{conversation_id}")
def conversations_update(
    conversation_id: int,
    payload: ConversationUpdate,
) -> dict[str, Any]:
    require_conversation(conversation_id)
    return update_conversation(
        conversation_id,
        title=payload.title,
        status=payload.status,
    )


@router.delete("/conversations/{conversation_id}")
def conversations_delete(conversation_id: int) -> dict[str, Any]:
    require_conversation(conversation_id)
    try:
        delete_conversation_attachments(conversation_id)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"对话附件清理失败，已保留对话记录：{exc}",
        ) from exc
    clear_run_snapshot(conversation_id)
    if not delete_conversation(conversation_id):
        raise HTTPException(status_code=404, detail="对话不存在")
    with connect() as conn:
        conn.execute(
            "DELETE FROM workflow_runs WHERE name = ?",
            (f"conversation-{conversation_id}",),
        )
    remaining = list_conversations()
    if not remaining:
        remaining = [create_conversation()]
    return {"deleted": True, "next_conversation": remaining[0]}


@router.post("/conversations/{conversation_id}/context/reset")
def conversation_context_reset(conversation_id: int) -> dict[str, Any]:
    require_conversation(conversation_id)
    conversation = reset_conversation_context(conversation_id)
    return {
        "reset": True,
        "context_cutoff_message_id": conversation["context_cutoff_message_id"],
        "conversation": conversation,
    }


@router.get("/jobs")
def jobs_index() -> list[dict[str, Any]]:
    return list_jobs()


@router.post("/jobs")
def jobs_create(payload: JobCreate) -> dict[str, Any]:
    try:
        return create_job(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/job-imports/text-preview")
def job_import_text_preview(payload: JobImportTextPreviewIn) -> dict[str, Any]:
    try:
        return preview_job_text(payload.text, source_url=payload.source_url)
    except JobImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/job-imports/screenshot-preview")
async def job_import_screenshot_preview(
    source_url: str = Form(default=""),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    try:
        return preview_job_screenshot(
            file.filename or "job-screenshot.png",
            await file.read(),
            source_url=source_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await file.close()


@router.get("/jobs/{job_id}")
def jobs_get(job_id: int) -> dict[str, Any]:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="岗位项目不存在")
    return job


@router.patch("/jobs/{job_id}")
def jobs_update(job_id: int, payload: JobUpdate) -> dict[str, Any]:
    try:
        job = update_job(job_id, payload.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if job is None:
        raise HTTPException(status_code=404, detail="岗位项目不存在")
    return job


@router.delete("/jobs/{job_id}")
def jobs_delete(job_id: int) -> dict[str, bool]:
    if not delete_job(job_id):
        raise HTTPException(status_code=404, detail="岗位项目不存在")
    return {"deleted": True}


@router.post("/jobs/{job_id}/evaluations", status_code=status.HTTP_202_ACCEPTED)
def job_evaluation_create(
    job_id: int, payload: JobEvaluationCreateIn, background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    try:
        evaluation = create_job_evaluation(
            job_id, strategy_id=payload.strategy_id,
            include_public_research=payload.include_public_research,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404 if str(exc) == "岗位项目不存在" else 422, detail=str(exc)) from exc
    _record_workbench_stage("job_evaluation", "工作台已创建岗位评估", job_id=job_id)
    background_tasks.add_task(bind_workspace(execute_job_evaluation, int(evaluation["id"])))
    return evaluation


@router.get("/jobs/{job_id}/evaluations")
def job_evaluations_get(job_id: int, limit: int = 50) -> list[dict[str, Any]]:
    try:
        return list_job_evaluations(job_id, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/job-evaluations/{evaluation_id}")
def job_evaluation_get(evaluation_id: int) -> dict[str, Any]:
    try:
        return get_job_evaluation(evaluation_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/job-evaluations/{evaluation_id}/cancel")
def job_evaluation_cancel(evaluation_id: int) -> dict[str, Any]:
    try:
        return cancel_job_evaluation(evaluation_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/job-evaluations/{evaluation_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def job_evaluation_retry(evaluation_id: int, background_tasks: BackgroundTasks) -> dict[str, Any]:
    try:
        evaluation = retry_job_evaluation(evaluation_id)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc
    _record_workbench_stage("job_evaluation", "工作台已重试岗位评估", evaluation_id=evaluation_id)
    background_tasks.add_task(bind_workspace(execute_job_evaluation, int(evaluation["id"])))
    return evaluation


@router.post("/job-evaluations/{evaluation_id}/reviews")
def job_evaluation_review(evaluation_id: int, payload: JobEvaluationReviewIn) -> dict[str, Any]:
    try:
        result = review_job_evaluation(evaluation_id, **payload.model_dump())
        _record_workbench_stage("job_evaluation", "工作台已审核岗位评估", evaluation_id=evaluation_id)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.get("/job-evaluations/{evaluation_id}/sources")
def job_evaluation_sources(evaluation_id: int) -> list[dict[str, Any]]:
    try:
        return list_job_evaluation_sources(evaluation_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/job-evaluations/{evaluation_id}/export")
def job_evaluation_export(
    evaluation_id: int, format: Literal["json", "markdown"] = "markdown",
) -> Response:
    try:
        bundle = export_job_evaluation(evaluation_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if format == "json":
        body = json.dumps(bundle["json"], ensure_ascii=False, indent=2)
        media, suffix = "application/json", "json"
    else:
        body = bundle["markdown"]
        media, suffix = "text/markdown; charset=utf-8", "md"
    return Response(
        content=body.encode("utf-8"), media_type=media,
        headers={"Content-Disposition": f"attachment; filename=job-evaluation-{evaluation_id}.{suffix}"},
    )


@router.post("/job-comparisons")
def job_comparison_create(payload: JobComparisonIn) -> dict[str, Any]:
    try:
        return create_job_comparison(payload.evaluation_ids)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/job-comparisons/{comparison_id}")
def job_comparison_get(comparison_id: int) -> dict[str, Any]:
    try:
        return get_job_comparison(comparison_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/resume-versions")
def resume_versions_all() -> list[dict[str, Any]]:
    return list_resume_versions()


@router.post("/resume-versions")
def resume_versions_create_baseline() -> dict[str, Any]:
    try:
        result = create_baseline_resume_version()
        _record_workbench_stage("material_preparation", "工作台已生成简历版本")
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/jobs/{job_id}/resume-versions")
def resume_versions_index(job_id: int) -> list[dict[str, Any]]:
    try:
        return list_resume_versions(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/resume-versions")
def resume_versions_create(job_id: int) -> dict[str, Any]:
    try:
        result = create_resume_version(job_id)
        _record_workbench_stage("material_preparation", "工作台已生成岗位简历版本", job_id=job_id)
        return result
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if message == "岗位项目不存在" else 422
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.get("/resume-versions/{version_id}")
def resume_versions_get(version_id: int) -> dict[str, Any]:
    version = get_resume_version(version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="定制简历版本不存在")
    return version


@router.patch("/resume-versions/{version_id}")
def resume_versions_update(
    version_id: int,
    payload: ResumeVersionUpdate,
) -> dict[str, Any]:
    try:
        version = update_resume_version(
            version_id,
            title=payload.title,
            status=payload.status,
            template_id=payload.template_id,
            style_id=payload.style_id,
            layout=payload.layout.model_dump(exclude_none=True) if payload.layout else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if version is None:
        raise HTTPException(status_code=404, detail="定制简历版本不存在")
    return version


@router.patch("/resume-versions/{version_id}/changes/{change_id}")
def resume_changes_update(
    version_id: int,
    change_id: int,
    payload: ResumeChangeUpdate,
) -> dict[str, Any]:
    try:
        return update_resume_change(
            version_id,
            change_id,
            decision=payload.decision,
            after_text=payload.after_text,
        )
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if "不存在" in message else 422
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.delete("/resume-versions/{version_id}")
def resume_versions_delete(version_id: int) -> dict[str, bool]:
    if not delete_resume_version(version_id):
        raise HTTPException(status_code=404, detail="定制简历版本不存在")
    return {"deleted": True}


@router.get("/resume-versions/{version_id}/export")
def resume_versions_export(
    version_id: int,
    format: Literal["docx", "pdf"] = "docx",
) -> Response:
    try:
        content, filename, media_type = export_resume_version(version_id, format)
    except ValueError as exc:
        status_code = 404 if str(exc) == "定制简历版本不存在" else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    fallback = f"resume-version-{version_id}.{format}"
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{fallback}\"; "
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )


@router.get("/interview-kits")
def interview_kits_all() -> list[dict[str, Any]]:
    return list_interview_kits()


@router.get("/jobs/{job_id}/interview-kits")
def interview_kits_index(job_id: int) -> list[dict[str, Any]]:
    try:
        return list_interview_kits(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/interview-kits")
def interview_kits_create(
    job_id: int,
    payload: InterviewKitCreate,
) -> dict[str, Any]:
    try:
        return create_interview_kit(job_id, payload.interview_type)
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if message == "岗位项目不存在" else 422
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.get("/interview-kits/{kit_id}")
def interview_kits_get(kit_id: int) -> dict[str, Any]:
    kit = get_interview_kit(kit_id)
    if kit is None:
        raise HTTPException(status_code=404, detail="面试准备包不存在")
    return kit


@router.patch("/interview-kits/{kit_id}")
def interview_kits_update(
    kit_id: int,
    payload: InterviewKitUpdate,
) -> dict[str, Any]:
    try:
        kit = update_interview_kit(
            kit_id,
            title=payload.title,
            status=payload.status,
            self_intro=payload.self_intro,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if kit is None:
        raise HTTPException(status_code=404, detail="面试准备包不存在")
    return kit


@router.delete("/interview-kits/{kit_id}")
def interview_kits_delete(kit_id: int) -> dict[str, bool]:
    if not delete_interview_kit(kit_id):
        raise HTTPException(status_code=404, detail="面试准备包不存在")
    return {"deleted": True}


@router.patch("/interview-kits/{kit_id}/tasks/{task_id}")
def interview_tasks_update(
    kit_id: int,
    task_id: int,
    payload: InterviewTaskUpdate,
) -> dict[str, Any]:
    try:
        return update_interview_task(kit_id, task_id, payload.completed)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/jobs/{job_id}/interview-rounds")
def interview_rounds_index(job_id: int) -> list[dict[str, Any]]:
    try:
        return list_interview_rounds(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/interview-rounds")
def interview_rounds_create(
    job_id: int,
    payload: InterviewRoundCreate,
) -> dict[str, Any]:
    try:
        return create_interview_round(
            job_id,
            kit_id=payload.kit_id,
            round_type=payload.round_type,
            scheduled_at=payload.scheduled_at,
            interviewer=payload.interviewer,
            location=payload.location,
            notes=payload.notes,
        )
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if "不存在" in message else 422
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.patch("/interview-rounds/{round_id}")
def interview_rounds_update(
    round_id: int,
    payload: InterviewRoundUpdate,
) -> dict[str, Any]:
    try:
        item = update_interview_round(
            round_id,
            **payload.model_dump(exclude_none=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="面试轮次不存在")
    return item


@router.delete("/interview-rounds/{round_id}")
def interview_rounds_delete(round_id: int) -> dict[str, bool]:
    if not delete_interview_round(round_id):
        raise HTTPException(status_code=404, detail="面试轮次不存在")
    return {"deleted": True}


@router.get("/jobs/{job_id}/timeline")
def job_timeline_index(job_id: int) -> list[dict[str, Any]]:
    try:
        return list_job_events(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/timeline")
def job_timeline_create(
    job_id: int,
    payload: JobEventCreate,
) -> dict[str, Any]:
    try:
        return add_job_event(
            job_id,
            "note",
            payload.title,
            payload.detail,
            occurred_at=payload.occurred_at,
        )
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if message == "岗位项目不存在" else 422
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.get("/conversations/{conversation_id}/attachments")
def conversation_attachments(conversation_id: int) -> list[dict[str, Any]]:
    require_conversation(conversation_id)
    return list_attachments(conversation_id)


@router.post("/attachments")
async def attachments_upload(
    conversation_id: int = Form(...),
    kind: Literal["job_screenshot", "resume"] = Form(...),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    try:
        attachment = create_attachment(
            conversation_id,
            kind,
            (file.filename or "attachment").strip(),
            await file.read(),
        )
    except ValueError as exc:
        status_code = 404 if str(exc) == "对话不存在" else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        await file.close()
    return attachment


@router.post("/attachments/{attachment_id}/parse")
def attachments_parse(
    attachment_id: str,
    mode: str = Form(default="fast"),
) -> dict[str, Any]:
    try:
        return parse_attachment(attachment_id, mode=mode)
    except ValueError as exc:
        status_code = 404 if str(exc) == "附件不存在" else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.delete("/attachments/{attachment_id}")
def attachments_delete(attachment_id: str) -> dict[str, bool]:
    if not delete_attachment(attachment_id):
        raise HTTPException(status_code=404, detail="附件不存在")
    return {"deleted": True}


@router.get("/attachments/config")
def attachments_config() -> dict[str, Any]:
    settings = get_settings()
    minio_configured = bool(
        settings.minio_endpoint
        and settings.minio_access_key
        and settings.minio_secret_key
        and settings.minio_bucket
    )
    vision_ready = (
        settings.attachment_vision_enabled
        and settings.attachment_storage == "minio"
        and bool(settings.minio_public_endpoint)
        and minio_configured
    )
    checks = [
        {
            "key": "local_storage",
            "label": "本地附件目录",
            "status": "ok",
            "message": "可用于默认本地解析与临时附件保存",
        },
        {
            "key": "minio_private_storage",
            "label": "MinIO 私有存储",
            "status": (
                "ok"
                if settings.attachment_storage == "local" or minio_configured
                else "warning"
            ),
            "message": (
                "当前使用本地附件目录"
                if settings.attachment_storage == "local"
                else "MinIO 必要配置已填写"
                if minio_configured
                else "缺少 MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY 或 MINIO_BUCKET"
            ),
        },
        {
            "key": "vision_public_url",
            "label": "图片直传公网地址",
            "status": (
                "ok"
                if vision_ready
                else "warning"
                if settings.attachment_vision_enabled
                else "disabled"
            ),
            "message": (
                "岗位截图可按次生成短期签名 URL"
                if vision_ready
                else "图片直传未启用"
                if not settings.attachment_vision_enabled
                else "需要 MinIO 私有存储和 MINIO_PUBLIC_ENDPOINT"
            ),
        },
    ]
    return {
        "storage": settings.attachment_storage,
        "vision_enabled": settings.attachment_vision_enabled,
        "vision_ready": vision_ready,
        "vision_url_ttl_seconds": settings.attachment_vision_url_ttl_seconds,
        "requires_public_endpoint": (
            settings.attachment_vision_enabled and not settings.minio_public_endpoint
        ),
        "checks": checks,
    }


@router.get("/workflow/status")
def workflow_status(conversation_id: int | None = None) -> dict[str, Any]:
    if conversation_id is not None:
        require_conversation(conversation_id)
    return refresh_workflow_status(conversation_id)


@router.get("/agent/capabilities")
def agent_capabilities() -> dict[str, Any]:
    return get_agent_capabilities()


@router.get("/agent/settings")
def agent_settings_get() -> dict[str, Any]:
    return get_agent_settings()


@router.put("/agent/settings")
def agent_settings_put(payload: AgentSettingsIn) -> dict[str, Any]:
    saved = save_agent_settings(payload.model_dump())
    reload_agent_components()
    return saved


@router.post("/agent/models/discover")
async def discover_models(payload: ModelDiscoveryIn) -> dict[str, Any]:
    connection = get_model_connection()
    api_key = payload.api_key.strip() or connection["api_key"]
    base_url = payload.model_base_url.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")

    provider = OpenAICompatibleProvider(
        api_key=api_key,
        model=connection["model_name"],
        base_url=base_url or None,
        timeout_seconds=min(get_settings().model_timeout_seconds, 20),
    )
    try:
        models = await provider.list_models()
    except ModelProviderError as exc:
        raise HTTPException(
            status_code=503 if exc.retryable else 400,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        # 识别模型是配置类操作，未预期异常也要给出可读原因，不能冒泡成 500。
        raise HTTPException(
            status_code=502,
            detail=(
                f"读取模型目录 {provider.models_url} 时发生未预期异常，"
                "请确认 Base URL 与 API Key 后重试"
            ),
        ) from exc
    if not models:
        raise HTTPException(
            status_code=404,
            detail=(
                f"服务已连接，但 {provider.models_url} 没有返回可用模型；"
                "请继续手动填写模型名称"
            ),
        )
    provider_name = get_settings().model_provider
    normalized_base = OpenAICompatibleProvider._normalize_base_url(base_url) or ""
    return {
        "models": models,
        "count": len(models),
        "base_url": OpenAICompatibleProvider._normalize_base_url(base_url),
        "provider": provider_name,
        "items": build_model_list(
            connection["model_name"],
            models,
            provider=provider_name,
            base_url=normalized_base,
        ),
    }


@router.get("/agent/models/capabilities")
def model_capabilities_get(model_name: str = "") -> dict[str, Any]:
    connection = get_model_connection()
    settings = get_settings()
    return infer_model_capabilities(
        model_name.strip() or connection["model_name"],
        provider=settings.model_provider,
        base_url=connection["model_base_url"],
    )


@router.post("/agent/models/capabilities")
async def model_capabilities_probe(payload: ModelCapabilitiesIn) -> dict[str, Any]:
    connection = get_model_connection()
    settings = get_settings()
    model_name = payload.model_name.strip() or connection["model_name"]
    base_url = payload.model_base_url.strip() or connection["model_base_url"]
    report = infer_model_capabilities(
        model_name,
        provider=settings.model_provider,
        base_url=base_url,
    )
    if not payload.probe:
        return report

    api_key = payload.api_key.strip() or connection["api_key"]
    if not api_key:
        report["probe_error"] = "请先填写或保存 API Key"
        return report

    provider = OpenAICompatibleProvider(
        api_key=api_key,
        model=model_name,
        base_url=base_url or None,
        timeout_seconds=min(settings.model_timeout_seconds, 20),
    )
    try:
        report["vision"] = await provider.probe_vision()
        report["probed"] = True
        report["probe_error"] = None
    except ModelProviderError as exc:
        report["probed"] = False
        report["probe_error"] = str(exc)
    return report


@router.get("/agent/model-monitor")
def model_monitor_get(hours: int = 24) -> dict[str, Any]:
    return get_model_monitor_snapshot(hours)


@router.get("/agent/operations")
def agent_operations_get(days: int = 7, limit: int = 20) -> dict[str, Any]:
    try:
        return get_agent_operations_snapshot(days=days, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/agent/model-monitor/check")
async def model_monitor_check() -> dict[str, Any]:
    connection = get_model_connection()
    if not connection["api_key"]:
        record_model_service_event(
            request_kind="health_check",
            status="error",
            error_code="not_configured",
            error_message="尚未配置模型服务 API Key",
            latency_ms=0,
            model_name=connection["model_name"],
            base_url=OpenAICompatibleProvider._normalize_base_url(
                connection["model_base_url"]
            ),
        )
        return get_model_monitor_snapshot()

    provider = OpenAICompatibleProvider(
        api_key=connection["api_key"],
        model=connection["model_name"],
        base_url=connection["model_base_url"] or None,
        timeout_seconds=get_settings().model_timeout_seconds,
    )
    try:
        await provider.check_connection()
    except ModelProviderError:
        # The provider already stored a classified failure without prompt content.
        pass
    except Exception:
        record_model_service_event(
            request_kind="health_check",
            status="error",
            error_code="provider_error",
            error_message="主动检测发生未知异常",
            latency_ms=0,
            model_name=connection["model_name"],
            base_url=OpenAICompatibleProvider._normalize_base_url(
                connection["model_base_url"]
            ),
        )
    return get_model_monitor_snapshot()


@router.post("/career-profile/resume/parse")
async def parse_candidate_resume(
    file: UploadFile = File(...),
    mode: str = Form(default="fast"),
) -> dict[str, Any]:
    filename = (file.filename or "resume").strip()
    try:
        content = await file.read()
        result = profile_service.parse_candidate_resume(filename, content, mode)
        _record_workbench_stage("candidate_knowledge", "工作台已解析简历")
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail="无法解析该简历，请确认文件或截图清晰、未损坏且包含可识别文字",
        ) from exc
    finally:
        await file.close()


@router.delete("/career-profile/resume")
def career_profile_resume_delete() -> dict[str, Any]:
    try:
        return {"profile": clear_candidate_resume()}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/career-profile/privacy/scan")
def scan_candidate_privacy(payload: PrivacyScanIn) -> dict[str, Any]:
    return profile_service.scan_candidate_privacy(payload.text)


@router.get("/career-profile")
def career_profile_get() -> dict[str, Any]:
    return get_career_profile()


@router.get("/career-profile/skill-tags")
async def career_profile_skill_tags() -> dict[str, Any]:
    bundle = get_career_profile()
    profile = bundle.get("profile") or {}
    facts = bundle.get("facts") or []
    confirmed_tags = resolved_skill_names()
    blocked = blocked_skill_names()
    skills_text = "\n".join(
        str((item.get("value") or {}).get("name") or item.get("statement") or "")
        for item in facts
        if item.get("category") == "skill" and item.get("status") == "confirmed"
    )
    result = await resolve_home_skill_tags(
        skill_tag_source(
            skills_text="\n".join([*confirmed_tags, skills_text]),
            resume_text=str(profile.get("resume_text") or ""),
        )
    )
    result["skills"] = filter_blocked_skills(
        [*confirmed_tags, *(result.get("skills") or [])],
        blocked,
    )
    return result


@router.put("/career-profile")
def career_profile_put(payload: CareerProfileInitIn) -> dict[str, Any]:
    create_or_update_profile(**payload.model_dump())
    return get_career_profile()


@router.get("/career-profile/sources")
def career_profile_sources_get() -> list[dict[str, Any]]:
    try:
        return list_candidate_sources()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/career-profile/sources")
def career_profile_sources_post(payload: CandidateSourceIn) -> dict[str, Any]:
    try:
        source = create_candidate_source(
            source_type=payload.source_type,
            title=payload.title,
            content=payload.content,
            source_uri=payload.source_uri,
            privacy_mode=payload.privacy_mode,
            allow_model_original=payload.allow_model_original,
        )
        proposals = ingest_resume_knowledge(source_id=int(source["id"])) \
            if payload.extract_knowledge and payload.source_type == "resume" else []
        safe_source = next(
            item for item in list_candidate_sources() if item["id"] == source["id"]
        )
        return {"source": safe_source, "proposals": proposals}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/career-profile/sources/{source_id}/access")
def career_profile_source_access_patch(
    source_id: int, payload: CandidateSourceAccessIn
) -> dict[str, Any]:
    try:
        return update_candidate_source_access(source_id, **payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/career-profile/facts")
def career_profile_facts_get(
    status: Literal["pending", "confirmed", "disputed", "retracted"] | None = None,
    category: str | None = None,
) -> list[dict[str, Any]]:
    try:
        return list_facts(status=status, category=category)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/career-profile/facts")
def career_profile_facts_post(payload: CandidateFactIn) -> dict[str, Any]:
    try:
        return propose_fact(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/career-profile/facts/{fact_id}/review")
def career_profile_fact_review(
    fact_id: int,
    payload: CandidateFactReviewIn,
) -> dict[str, Any]:
    status_value = {
        "confirm": "confirmed",
        "edit": "confirmed",
        "reject": "disputed",
        "retract": "retracted",
    }[payload.action]
    try:
        result = review_fact(fact_id, status=status_value, statement=payload.statement)
        if status_value == "confirmed":
            _record_workbench_stage("candidate_knowledge", "工作台已确认画像事实", fact_id=fact_id)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.post("/career-profile/facts/{fact_id}/merge")
def career_profile_fact_merge(
    fact_id: int,
    payload: CandidateFactMergeIn,
) -> dict[str, Any]:
    try:
        return merge_facts(fact_id, payload.target_fact_id)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.get("/career-profile/strategies")
def career_profile_strategies_get() -> list[dict[str, Any]]:
    try:
        return list_strategies()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/career-profile/strategies")
def career_profile_strategies_post(payload: CareerStrategyIn) -> dict[str, Any]:
    try:
        weights = validate_evaluation_weights(payload.evaluation_weights)
        return create_strategy(
            name=payload.name,
            target_roles=payload.target_roles,
            seniority=payload.target_level,
            locations=payload.regions,
            salary={
                "min": payload.salary_min,
                "max": payload.salary_max,
                "currency": payload.salary_currency,
            },
            work_modes=payload.work_modes,
            industries=payload.industries,
            hard_constraints=payload.hard_constraints,
            soft_preferences=payload.soft_preferences,
            blocked_companies=payload.blocked_companies,
            title_expansions=payload.title_expansions,
            evaluation_weights=weights,
            priority=payload.priority,
            is_active=payload.is_active,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/career-profile/strategies/{strategy_id}")
def career_profile_strategy_patch(
    strategy_id: int,
    payload: CareerStrategyUpdateIn,
) -> dict[str, Any]:
    incoming = payload.model_dump(exclude_unset=True)
    updates: dict[str, Any] = {}
    mapping = {
        "target_level": "seniority",
        "regions": "locations",
    }
    for key, value in incoming.items():
        if key in {"salary_min", "salary_max", "salary_currency"}:
            continue
        updates[mapping.get(key, key)] = value
    if any(key in incoming for key in ("salary_min", "salary_max", "salary_currency")):
        updates["salary"] = {
            "min": incoming.get("salary_min"),
            "max": incoming.get("salary_max"),
            "currency": incoming.get("salary_currency", "CNY"),
        }
    try:
        if "evaluation_weights" in updates:
            updates["evaluation_weights"] = validate_evaluation_weights(updates["evaluation_weights"])
        return update_strategy(strategy_id, updates)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.get("/career-profile/strategies/{strategy_id}/evidence")
def career_profile_strategy_evidence_get(strategy_id: int) -> list[dict[str, Any]]:
    return list_strategy_evidence(strategy_id)


@router.put("/career-profile/strategies/{strategy_id}/evidence")
def career_profile_strategy_evidence_put(
    strategy_id: int,
    payload: StrategyEvidenceIn,
) -> dict[str, Any]:
    try:
        return set_strategy_evidence(strategy_id, **payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.get("/career-profile/stories")
def career_profile_stories_get(
    status: Literal["pending", "confirmed", "disputed", "retracted"] | None = None,
    strategy_id: int | None = None,
) -> list[dict[str, Any]]:
    try:
        return list_stories(status=status, strategy_id=strategy_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/career-profile/stories")
def career_profile_stories_post(payload: CandidateStoryIn) -> dict[str, Any]:
    try:
        primary_strategy = payload.strategy_ids[0] if payload.strategy_ids else None
        return create_story(
            title=payload.title,
            strategy_id=primary_strategy,
            strategy_ids=payload.strategy_ids,
            situation=payload.situation,
            task=payload.task,
            action=payload.action,
            result=payload.result,
            reflection=payload.reflection,
            applicable_questions=payload.question_tags,
            fact_ids=payload.fact_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/career-profile/stories/{story_id}/review")
def career_profile_story_review(
    story_id: int,
    payload: CandidateStoryReviewIn,
) -> dict[str, Any]:
    status = {"confirm": "confirmed", "reject": "disputed", "retract": "retracted"}[payload.action]
    try:
        return review_story(story_id, status)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.get("/career-profile/narratives")
def career_profile_narratives_get() -> list[dict[str, Any]]:
    try:
        return list_candidate_narratives()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/career-profile/narratives")
def career_profile_narratives_post(payload: CandidateNarrativeIn) -> dict[str, Any]:
    try:
        return save_candidate_narrative(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/career-profile/narratives/{narrative_id}/review")
def career_profile_narrative_review(
    narrative_id: int,
    payload: CandidateNarrativeReviewIn,
) -> dict[str, Any]:
    status = {"confirm": "confirmed", "reject": "disputed", "retract": "retracted"}[payload.action]
    try:
        return review_candidate_narrative(narrative_id, status)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.get("/career-profile/voice")
def career_profile_voice_get() -> dict[str, Any] | None:
    try:
        return get_voice_profile()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/career-profile/voice")
def career_profile_voice_put(payload: VoiceProfileIn) -> dict[str, Any]:
    try:
        return save_voice_profile(
            name=payload.name,
            tone_rules=payload.tone_rules,
            banned_phrases=payload.banned_phrases,
            warning_phrases=[],
            formatting_rules=payload.preferred_phrases,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/career-profile/writing-samples")
def career_profile_writing_samples_get() -> list[dict[str, Any]]:
    try:
        return list_writing_samples()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/career-profile/writing-samples")
def career_profile_writing_samples_post(payload: WritingSampleIn) -> dict[str, Any]:
    try:
        return add_writing_sample(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/career-profile/context")
def career_profile_context_get(
    scope: Literal["triage", "match", "resume", "interview", "outreach", "coaching", "discovery"],
    strategy_id: int | None = None,
) -> dict[str, Any]:
    try:
        return get_candidate_context(scope, strategy_id=strategy_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/career-profile/materials/verify")
def career_profile_material_verify(payload: MaterialVerifyIn) -> dict[str, Any]:
    try:
        return verify_candidate_material(payload.text)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/career-profile/interviews")
def career_profile_interview_start(payload: ProfileInterviewStartIn) -> dict[str, Any]:
    require_conversation(payload.conversation_id)
    try:
        return get_or_start_profile_interview(payload.conversation_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/career-profile/interviews/{conversation_id}/answer")
def career_profile_interview_answer(
    conversation_id: int,
    payload: ProfileInterviewAnswerIn,
) -> dict[str, Any]:
    require_conversation(conversation_id)
    try:
        return record_profile_interview_answer(conversation_id, payload.answer)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/career-profile/export")
def career_profile_export(
    format: Literal["bundle", "json", "markdown"] = "bundle",
) -> Any:
    try:
        bundle = export_career_profile()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if format == "bundle":
        return bundle
    if format == "json":
        content = json.dumps(bundle["json"], ensure_ascii=False, indent=2).encode("utf-8")
        suffix, media = "json", "application/json"
    else:
        content = bundle["markdown"].encode("utf-8")
        suffix, media = "md", "text/markdown; charset=utf-8"
    filename = f"{bundle['filename_base']}.{suffix}"
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.post("/interviews/{job_id}/debrief")
def interview_debrief_post(job_id: int, payload: InterviewDebriefIn) -> dict[str, Any]:
    try:
        result = record_interview_debrief(
            job_id,
            round_id=payload.interview_round_id,
            summary=payload.source_text,
            questions=payload.questions,
            feedback_verbatim=payload.raw_feedback,
        )
        _record_workbench_stage("outcome_tracking", "工作台已记录面试复盘", job_id=job_id)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.get("/career-insights/patterns")
def career_patterns_get() -> dict[str, Any]:
    return career_patterns()


@router.get("/career-insights/skill-growth")
def career_skill_growth_get() -> dict[str, Any]:
    return skill_growth_map()


@router.get("/companies")
def companies_get(followed_only: bool = False) -> list[dict[str, Any]]:
    return list_companies(followed_only=followed_only)


@router.post("/companies")
def companies_post(payload: CompanyIn) -> dict[str, Any]:
    try:
        evidence = list(payload.evidence)
        if payload.region or payload.industry:
            evidence.append({"region": payload.region, "industry": payload.industry, "source": "user"})
        return create_or_update_company(
            name=payload.name,
            website_url=payload.website_url,
            careers_url=payload.careers_url,
            evidence=evidence,
            followed=payload.followed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/opportunity-sources")
@router.get("/opportunities/sources")
def opportunity_sources_get(enabled_only: bool = False) -> list[dict[str, Any]]:
    return list_opportunity_sources(enabled_only=enabled_only)


@router.post("/opportunity-sources")
@router.post("/opportunities/sources")
def opportunity_sources_post(payload: OpportunitySourceIn) -> dict[str, Any]:
    try:
        return add_opportunity_source(
            source_url=payload.source_url,
            company_id=payload.company_id,
            provider=payload.provider or None,
            access_mode=payload.access_mode,
            platform=payload.platform,
            evidence=payload.evidence,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/opportunity-sources/{source_id}")
@router.patch("/opportunities/sources/{source_id}")
def opportunity_source_patch(source_id: int, payload: OpportunitySourceUpdateIn) -> dict[str, Any]:
    try:
        return update_opportunity_source(source_id, **payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.post("/opportunities/sources/{source_id}/scan")
def opportunity_source_scan(source_id: int) -> dict[str, Any]:
    try:
        result = scan_opportunity_source(source_id, trigger="manual")
        _record_workbench_stage("opportunity_discovery", "工作台已扫描职位来源", source_id=source_id)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OpportunityScanError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/opportunities/sources/scan")
def opportunity_sources_scan() -> list[dict[str, Any]]:
    result = scan_followed_sources(trigger="manual")
    _record_workbench_stage("opportunity_discovery", "工作台已扫描已关注来源")
    return result


@router.get("/discovered-jobs")
def discovered_jobs_get(
    lifecycle_status: str | None = None,
    posting_status: str | None = None,
    processing_status: str | None = None,
    source_id: int | None = None,
    min_score: int | None = None,
) -> list[dict[str, Any]]:
    return list_discovered_jobs(
        lifecycle_status=lifecycle_status,
        posting_status=posting_status,
        processing_status=processing_status,
        source_id=source_id,
        min_score=min_score,
    )


@router.get("/discovered-jobs/{discovered_job_id}")
def discovered_job_get(discovered_job_id: int) -> dict[str, Any]:
    try:
        return get_discovered_job(discovered_job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/discovered-jobs/{discovered_job_id}/assessments")
def discovered_job_assessments_get(discovered_job_id: int) -> list[dict[str, Any]]:
    try:
        return list_discovered_job_assessments(discovered_job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/companies/{company_id}/signals")
def company_signals_get(company_id: int) -> list[dict[str, Any]]:
    return list_company_signals(company_id)


@router.post("/opportunity-runs", status_code=status.HTTP_202_ACCEPTED)
def opportunity_run_create(payload: DiscoveryRunIn, background_tasks: BackgroundTasks) -> dict[str, Any]:
    config = payload.model_dump(exclude={"mode", "strategy_id"})
    run = create_discovery_run(
        payload.mode,
        strategy_id=payload.strategy_id,
        config=config,
        trigger="manual",
    )
    _record_workbench_stage("opportunity_discovery", "工作台已创建机会发现任务", run_id=int(run["id"]))
    background_tasks.add_task(bind_workspace(execute_discovery_run, int(run["id"])))
    return run


@router.get("/opportunity-runs")
def opportunity_runs_get(
    mode: str | None = None,
    run_status: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    try:
        return list_discovery_runs(mode=mode, status=run_status, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/opportunity-runs/{run_id}")
def opportunity_run_get(run_id: int) -> dict[str, Any]:
    try:
        return get_discovery_run(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/opportunity-runs/{run_id}/cancel")
def opportunity_run_cancel(run_id: int) -> dict[str, Any]:
    try:
        return cancel_discovery_run(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/opportunity-runs/{run_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def opportunity_run_retry(run_id: int, background_tasks: BackgroundTasks) -> dict[str, Any]:
    try:
        run = retry_discovery_run(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _record_workbench_stage("opportunity_discovery", "工作台已重试机会发现任务", run_id=int(run["id"]))
    background_tasks.add_task(bind_workspace(execute_discovery_run, int(run["id"])))
    return run


@router.patch("/discovered-jobs/{discovered_job_id}")
def discovered_job_patch(
    discovered_job_id: int,
    payload: DiscoveredJobUpdateIn,
) -> dict[str, Any]:
    try:
        return update_discovered_job(discovered_job_id, payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.post("/discovered-jobs/{discovered_job_id}/promote")
def discovered_job_promote(
    discovered_job_id: int,
    payload: DiscoveredJobPromoteIn,
    strategy_id: int | None = None,
) -> dict[str, Any]:
    try:
        job = promote_discovered_job(discovered_job_id, strategy_id=strategy_id)
        if payload.priority != "medium":
            updated = update_job(int(job["id"]), {"priority": payload.priority})
            return updated or job
        return job
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc
