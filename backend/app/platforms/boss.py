from __future__ import annotations

import asyncio
import re
from urllib.parse import urljoin

from ..browser import BOSS_HOME_URL, BrowserOperationError, browser_controller
from ..domain import Job, JobSearchQuery, JobSummary, PlatformCapabilities, SalaryRange
from .base import AuthStatus, PlatformOperationError, SessionStatus


CITY_CODES = {
    "北京": "101010100",
    "上海": "101020100",
    "广州": "101280100",
    "深圳": "101280600",
    "杭州": "101210100",
    "南京": "101190100",
    "苏州": "101190400",
    "成都": "101270100",
    "武汉": "101200100",
    "西安": "101110100",
    "重庆": "101040100",
    "天津": "101030100",
}


class BossJobPlatform:
    name = "boss"

    def capabilities(self) -> PlatformCapabilities:
        return PlatformCapabilities(search_jobs=True, read_job_detail=True)

    async def start_session(self) -> SessionStatus:
        status = await asyncio.to_thread(browser_controller.start)
        return SessionStatus(running=status["running"], message="BOSS 浏览器会话已启动")

    async def check_auth(self) -> AuthStatus:
        status = await asyncio.to_thread(browser_controller.boss_auth_status)
        return AuthStatus.model_validate(status)

    async def search_jobs(self, query: JobSearchQuery) -> list[JobSummary]:
        keyword = " ".join(item.strip() for item in query.keywords if item.strip())
        if not keyword:
            raise PlatformOperationError("boss_keyword_required", "BOSS 岗位搜索需要关键词")
        city_code = self._resolve_city_code(query.cities)
        try:
            rows = await asyncio.to_thread(
                browser_controller.search_boss_jobs,
                keyword,
                city_code,
                query.limit,
            )
        except BrowserOperationError as exc:
            raise PlatformOperationError(exc.code, str(exc), blocked=exc.blocked) from exc
        return [self._map_summary(row) for row in rows]

    async def get_job_detail(self, external_id: str) -> Job:
        try:
            row = await asyncio.to_thread(browser_controller.get_boss_job_detail, external_id)
        except BrowserOperationError as exc:
            raise PlatformOperationError(exc.code, str(exc), blocked=exc.blocked) from exc
        salary = self._parse_salary(row.get("salary_text", ""))
        tags = row.get("tags", [])
        return Job(
            platform=self.name,
            external_id=external_id,
            source_url=row.get("url") or f"{BOSS_HOME_URL}job_detail/{external_id}.html",
            title=row.get("title") or "岗位标题未识别",
            company=row.get("company") or "公司未识别",
            location=row.get("location", ""),
            salary=salary,
            tags=tags,
            description=row.get("description", ""),
            requirements=tags,
            raw=row,
        )

    @staticmethod
    def _resolve_city_code(cities: list[str]) -> str | None:
        for city in cities:
            normalized = city.strip().removesuffix("市")
            if normalized in CITY_CODES:
                return CITY_CODES[normalized]
        return None

    def _map_summary(self, row: dict) -> JobSummary:
        source_url = urljoin(BOSS_HOME_URL, row.get("href", ""))
        external_id = self._external_id(source_url)
        return JobSummary(
            platform=self.name,
            external_id=external_id,
            source_url=source_url,
            title=row.get("title") or "岗位标题未识别",
            company=row.get("company") or "公司未识别",
            location=row.get("location", ""),
            salary=self._parse_salary(row.get("salary_text", "")),
            tags=row.get("tags", []),
        )

    @staticmethod
    def _external_id(url: str) -> str:
        match = re.search(r"/job_detail/([^/?#]+)\.html", url)
        if not match:
            raise PlatformOperationError("boss_job_id_missing", "无法从 BOSS 岗位链接识别岗位 ID")
        return match.group(1)

    @staticmethod
    def _parse_salary(text: str) -> SalaryRange | None:
        if not text:
            return None
        match = re.search(r"(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)K", text, re.IGNORECASE)
        months_match = re.search(r"(\d+)薪", text)
        if not match:
            return SalaryRange(text=text)
        return SalaryRange(
            minimum=int(float(match.group(1)) * 1000),
            maximum=int(float(match.group(2)) * 1000),
            months=int(months_match.group(1)) if months_match else None,
            text=text,
        )
