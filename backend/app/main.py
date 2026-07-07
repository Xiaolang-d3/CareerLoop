from __future__ import annotations

from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .browser import browser_controller
from .db import connect, init_db, json_dump, row_to_dict, rows_to_dicts
from .workflow.engine import open_boss_via_workflow, refresh_workflow_status


app = FastAPI(title="BossCopilot API", version="0.1.0")

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


@app.get("/chat/messages")
def list_chat_messages() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM chat_messages ORDER BY id ASC").fetchall()
    return rows_to_dicts(rows)


@app.post("/chat/messages")
def create_chat_message(payload: ChatMessageIn) -> dict[str, Any]:
    user_message = _save_chat_message("user", payload.content)
    text = payload.content.lower()

    if ("boss" in text or "直聘" in text) and ("打开" in text or "登录" in text):
        workflow = open_boss_via_workflow()
        assistant_text = "我已经在 Mac 上打开 BOSS 官方页面。你可以按官方方式扫码/登录，我会在任务流里记录这个节点状态。"
    elif "状态" in text or "进度" in text or "到哪" in text:
        workflow = refresh_workflow_status()
        assistant_text = _workflow_summary(workflow)
    else:
        workflow = refresh_workflow_status()
        browser_node = next((node for node in workflow["nodes"] if node["id"] == "open_boss"), None)
        login_hint = "你还没有打开 BOSS 官方页面。需要我继续操作时，可以直接说“打开 BOSS 登录”。"
        if browser_node and browser_node["status"] == "done":
            login_hint = "BOSS 官方页面已经打开。你完成官方登录后，我就可以继续规划岗位采集和分析。"
        assistant_text = (
            "我先记录你的求职目标，并会根据当前状态规划下一步。"
            f"{login_hint}"
            "后续会接入 LLM planner，由大模型根据你的目标动态选择工具。"
        )

    assistant_message = _save_chat_message("assistant", assistant_text, {"workflow": workflow})
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
