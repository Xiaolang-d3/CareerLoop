from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .agent import get_agent_capabilities, get_agent_runtime, get_job_platform
from .browser import browser_controller
from .db import connect, init_db, json_dump, row_to_dict, rows_to_dicts
from .errors import UnknownRegistrationError
from .workflow.engine import open_boss_via_workflow, refresh_workflow_status


app = FastAPI(title="BossCopilot API", version="0.1.0")
login_resume_lock = asyncio.Lock()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_origin_regex=r"http://(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):5173",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProfileIn(BaseModel):
    name: str = Field(min_length=1)
    resume_text: str = ""
    skills: list[str] = []
    projects: list[dict[str, Any]] = []


class PreferenceIn(BaseModel):
    profile_id: int
    target_roles: list[str] = []
    target_cities: list[str] = []
    salary_min: int | None = None
    salary_max: int | None = None
    preferred_industries: list[str] = []
    blocked_keywords: list[str] = []
    blocked_companies: list[str] = []


class JobIn(BaseModel):
    source_url: str = Field(min_length=1)
    title: str = Field(min_length=1)
    company: str = Field(min_length=1)
    city: str = ""
    district: str = ""
    salary_text: str = ""
    salary_min: int | None = None
    salary_max: int | None = None
    experience: str = ""
    education: str = ""
    industry: str = ""
    company_size: str = ""
    hr_active_text: str = ""
    description: str = ""
    raw: dict[str, Any] = {}


class ApplicationIn(BaseModel):
    job_id: int
    profile_id: int
    status: Literal["queued", "applied", "contacted", "interview", "rejected", "no_response"] = "queued"
    notes: str = ""


class ChatMessageIn(BaseModel):
    content: str = Field(min_length=1)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/workflow/status")
def workflow_status() -> dict[str, Any]:
    return refresh_workflow_status()


@app.get("/agent/capabilities")
def agent_capabilities() -> dict[str, Any]:
    return get_agent_capabilities()


@app.post("/platforms/{platform_name}/session")
async def start_platform_session(platform_name: str) -> dict[str, Any]:
    try:
        platform = get_job_platform(platform_name)
    except UnknownRegistrationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return (await platform.start_session()).model_dump(mode="json")


@app.get("/platforms/{platform_name}/auth")
async def platform_auth_status(platform_name: str) -> dict[str, Any]:
    try:
        platform = get_job_platform(platform_name)
    except UnknownRegistrationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return (await platform.check_auth()).model_dump(mode="json")


@app.post("/workflow/open-boss")
def workflow_open_boss() -> dict[str, Any]:
    return open_boss_via_workflow()


def _save_chat_message(role: str, content: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO chat_messages (role, content, payload_json)
            VALUES (?, ?, ?)
            """,
            (role, content, json_dump(payload or {})),
        )
        row = conn.execute("SELECT * FROM chat_messages WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return row_to_dict(row)


def _workflow_summary(status: dict[str, Any]) -> str:
    nodes = status["nodes"]
    done = sum(1 for node in nodes if node["status"] == "done")
    total = len(nodes)
    pending_titles = [node["title"] for node in nodes if node["status"] != "done"]
    if pending_titles:
        return f"当前工作流 {done}/{total} 个节点完成。待处理：{'、'.join(pending_titles)}。"
    return f"当前工作流 {done}/{total} 个节点完成。"


def _is_login_resume(text: str) -> bool:
    return any(phrase in text for phrase in ("已登录", "登录完成", "完成登录"))


def _find_pending_login_request() -> str | None:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM chat_messages WHERE role = 'assistant' ORDER BY id DESC"
        ).fetchall()
        for row in rows:
            assistant = row_to_dict(row)
            agent = (assistant.get("payload") or {}).get("agent") if assistant else None
            if not agent:
                continue
            error = agent.get("error") or {}
            if agent.get("status") != "waiting_user" or error.get("code") != "boss_login_required":
                return None
            pending = conn.execute(
                """
                SELECT content FROM chat_messages
                WHERE role = 'user' AND id < ?
                ORDER BY id DESC LIMIT 1
                """,
                (assistant["id"],),
            ).fetchone()
            return pending["content"] if pending else None
    return None


@app.get("/chat/messages")
def list_chat_messages() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM chat_messages ORDER BY id ASC").fetchall()
    return rows_to_dicts(rows)


@app.post("/chat/resume-after-login")
async def resume_after_login() -> dict[str, Any]:
    async with login_resume_lock:
        platform = get_job_platform("boss")
        auth = await platform.check_auth()
        if auth.status != "authenticated":
            raise HTTPException(
                status_code=409,
                detail={"code": "boss_login_pending", "message": auth.message},
            )
        pending_request = _find_pending_login_request()
        if not pending_request:
            raise HTTPException(
                status_code=404,
                detail={"code": "pending_search_not_found", "message": "没有等待恢复的搜索任务"},
            )
        agent_result = await get_agent_runtime().run(pending_request)
        workflow = refresh_workflow_status()
        assistant_text = f"已自动检测到 BOSS 登录成功，继续执行刚才的搜索。\n\n{agent_result.content}"
        assistant_message = _save_chat_message(
            "assistant",
            assistant_text,
            {"workflow": workflow, "agent": agent_result.model_dump(mode="json")},
        )
        return {"assistant_message": assistant_message, "workflow": workflow}


@app.post("/chat/messages")
async def create_chat_message(payload: ChatMessageIn) -> dict[str, Any]:
    user_message = _save_chat_message("user", payload.content)
    text = payload.content.lower()
    agent_result = None

    if _is_login_resume(text):
        platform = get_job_platform("boss")
        auth = await platform.check_auth()
        pending_request = _find_pending_login_request()
        if auth.status != "authenticated":
            workflow = refresh_workflow_status()
            assistant_text = (
                f"尚未检测到有效的 BOSS 登录状态（{auth.message}）。"
                "系统会继续自动检测；你也可以登录完成后回复“已登录，继续”。"
            )
        elif pending_request:
            agent_result = await get_agent_runtime().run(pending_request)
            workflow = refresh_workflow_status()
            assistant_text = f"已确认 BOSS 登录成功，继续执行刚才的搜索。\n\n{agent_result.content}"
        else:
            workflow = refresh_workflow_status()
            assistant_text = "已确认 BOSS 登录成功。目前没有等待恢复的搜索任务，可以直接告诉我想找的岗位。"
    elif ("boss" in text or "直聘" in text) and ("打开" in text or "登录" in text):
        workflow = open_boss_via_workflow()
        assistant_text = "我已经打开 BOSS 官方页面。请按官方方式完成登录；有等待中的搜索时，系统会自动检测并继续。"
    elif "状态" in text or "进度" in text or "到哪" in text:
        workflow = refresh_workflow_status()
        assistant_text = _workflow_summary(workflow)
    else:
        agent_result = await get_agent_runtime().run(payload.content)
        workflow = refresh_workflow_status()
        assistant_text = agent_result.content

    assistant_payload: dict[str, Any] = {"workflow": workflow}
    if agent_result is not None:
        assistant_payload["agent"] = agent_result.model_dump(mode="json")
    assistant_message = _save_chat_message("assistant", assistant_text, assistant_payload)
    return {
        "user_message": user_message,
        "assistant_message": assistant_message,
        "workflow": workflow,
    }


@app.post("/browser/start")
def start_browser() -> dict[str, Any]:
    return browser_controller.start()


@app.post("/browser/open-boss")
def open_boss() -> dict[str, Any]:
    return browser_controller.open_boss()


@app.get("/browser/status")
def browser_status() -> dict[str, Any]:
    return browser_controller.status()


@app.post("/browser/stop")
def stop_browser() -> dict[str, Any]:
    return browser_controller.stop()


@app.get("/profiles")
def list_profiles() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM profiles ORDER BY updated_at DESC").fetchall()
    return rows_to_dicts(rows)


@app.post("/profiles")
def create_profile(payload: ProfileIn) -> dict[str, Any]:
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO profiles (name, resume_text, skills_json, projects_json)
            VALUES (?, ?, ?, ?)
            """,
            (
                payload.name,
                payload.resume_text,
                json_dump(payload.skills),
                json_dump(payload.projects),
            ),
        )
        row = conn.execute("SELECT * FROM profiles WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return row_to_dict(row)


@app.post("/preferences")
def upsert_preferences(payload: PreferenceIn) -> dict[str, Any]:
    with connect() as conn:
        profile = conn.execute("SELECT id FROM profiles WHERE id = ?", (payload.profile_id,)).fetchone()
        if profile is None:
            raise HTTPException(status_code=404, detail="Profile not found")

        existing = conn.execute(
            "SELECT id FROM preferences WHERE profile_id = ?", (payload.profile_id,)
        ).fetchone()
        values = (
            json_dump(payload.target_roles),
            json_dump(payload.target_cities),
            payload.salary_min,
            payload.salary_max,
            json_dump(payload.preferred_industries),
            json_dump(payload.blocked_keywords),
            json_dump(payload.blocked_companies),
        )

        if existing:
            conn.execute(
                """
                UPDATE preferences
                SET target_roles_json = ?,
                    target_cities_json = ?,
                    salary_min = ?,
                    salary_max = ?,
                    preferred_industries_json = ?,
                    blocked_keywords_json = ?,
                    blocked_companies_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE profile_id = ?
                """,
                (*values, payload.profile_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO preferences (
                    profile_id,
                    target_roles_json,
                    target_cities_json,
                    salary_min,
                    salary_max,
                    preferred_industries_json,
                    blocked_keywords_json,
                    blocked_companies_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (payload.profile_id, *values),
            )

        row = conn.execute(
            "SELECT * FROM preferences WHERE profile_id = ?", (payload.profile_id,)
        ).fetchone()
    return row_to_dict(row)


@app.get("/preferences/{profile_id}")
def get_preferences(profile_id: int) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM preferences WHERE profile_id = ?", (profile_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Preferences not found")
    return row_to_dict(row)


@app.get("/jobs")
def list_jobs() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM jobs ORDER BY first_seen_at DESC").fetchall()
    return rows_to_dicts(rows)


@app.post("/jobs")
def upsert_job(payload: JobIn) -> dict[str, Any]:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO jobs (
                source_url,
                title,
                company,
                city,
                district,
                salary_text,
                salary_min,
                salary_max,
                experience,
                education,
                industry,
                company_size,
                hr_active_text,
                description,
                raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_url) DO UPDATE SET
                title = excluded.title,
                company = excluded.company,
                city = excluded.city,
                district = excluded.district,
                salary_text = excluded.salary_text,
                salary_min = excluded.salary_min,
                salary_max = excluded.salary_max,
                experience = excluded.experience,
                education = excluded.education,
                industry = excluded.industry,
                company_size = excluded.company_size,
                hr_active_text = excluded.hr_active_text,
                description = excluded.description,
                raw_json = excluded.raw_json,
                last_seen_at = CURRENT_TIMESTAMP
            """,
            (
                payload.source_url,
                payload.title,
                payload.company,
                payload.city,
                payload.district,
                payload.salary_text,
                payload.salary_min,
                payload.salary_max,
                payload.experience,
                payload.education,
                payload.industry,
                payload.company_size,
                payload.hr_active_text,
                payload.description,
                json_dump(payload.raw),
            ),
        )
        row = conn.execute("SELECT * FROM jobs WHERE source_url = ?", (payload.source_url,)).fetchone()
    return row_to_dict(row)


@app.post("/jobs/{job_id}/score")
def score_job(job_id: int, profile_id: int) -> dict[str, Any]:
    with connect() as conn:
        job = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        profile = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        if profile is None:
            raise HTTPException(status_code=404, detail="Profile not found")

        job_text = f"{job['title']} {job['description']} {job['industry']}".lower()
        skills = row_to_dict(profile)["skills"]
        matched_skills = [skill for skill in skills if skill.lower() in job_text]
        score = min(100, 50 + len(matched_skills) * 10)
        level = "recommended" if score >= 80 else "consider" if score >= 60 else "skip"
        risks = []
        if "外包" in job["description"] or "外包" in job["company"]:
            risks.append("疑似外包")
        if "培训" in job["description"]:
            risks.append("疑似培训相关")

        cursor = conn.execute(
            """
            INSERT INTO match_results (
                job_id,
                profile_id,
                score,
                level,
                reasons_json,
                risks_json,
                suggested_angle
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                profile_id,
                score,
                level,
                json_dump([f"匹配技能：{', '.join(matched_skills)}"] if matched_skills else ["暂无明显技能命中"]),
                json_dump(risks),
                "突出与岗位关键词最相关的项目经历",
            ),
        )
        row = conn.execute("SELECT * FROM match_results WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return row_to_dict(row)


@app.post("/applications")
def create_application(payload: ApplicationIn) -> dict[str, Any]:
    with connect() as conn:
        job = conn.execute("SELECT id FROM jobs WHERE id = ?", (payload.job_id,)).fetchone()
        profile = conn.execute("SELECT id FROM profiles WHERE id = ?", (payload.profile_id,)).fetchone()
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        if profile is None:
            raise HTTPException(status_code=404, detail="Profile not found")

        cursor = conn.execute(
            """
            INSERT INTO applications (job_id, profile_id, status, notes)
            VALUES (?, ?, ?, ?)
            """,
            (payload.job_id, payload.profile_id, payload.status, payload.notes),
        )
        row = conn.execute("SELECT * FROM applications WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return row_to_dict(row)


@app.get("/applications")
def list_applications() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT applications.*, jobs.title AS job_title, jobs.company AS company
            FROM applications
            JOIN jobs ON jobs.id = applications.job_id
            ORDER BY applications.created_at DESC
            """
        ).fetchall()
    return rows_to_dicts(rows)
