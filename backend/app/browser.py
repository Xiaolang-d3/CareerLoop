from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, TypeVar
from urllib.parse import urlencode

from playwright.sync_api import (
    BrowserContext,
    Error,
    Page,
    Playwright,
    TimeoutError as PlaywrightTimeoutError,
    sync_playwright,
)


BOSS_HOME_URL = "https://www.zhipin.com/"
ROOT_DIR = Path(__file__).resolve().parents[1]
BROWSER_PROFILE_DIR = ROOT_DIR / "data" / "browser-profile"

T = TypeVar("T")


class BrowserOperationError(RuntimeError):
    def __init__(self, code: str, message: str, blocked: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.blocked = blocked


class BrowserController:
    """Runs every Playwright operation on one dedicated thread.

    Playwright's synchronous API is thread-affine. FastAPI can execute sync and
    async endpoints on different threads, so browser objects must never be used
    directly from request threads.
    """

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bosscopilot-browser")
        self._playwright: Playwright | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

    def _submit(self, operation: Callable[..., T], *args: Any) -> T:
        return self._executor.submit(operation, *args).result()

    def start(self) -> dict[str, Any]:
        return self._submit(self._start)

    def _start(self) -> dict[str, Any]:
        if self._context is not None:
            return self._status()

        BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        self._playwright = sync_playwright().start()

        try:
            self._context = self._playwright.chromium.launch_persistent_context(
                user_data_dir=str(BROWSER_PROFILE_DIR),
                channel="chrome",
                headless=False,
                viewport={"width": 1360, "height": 860},
            )
        except Error:
            self._context = self._playwright.chromium.launch_persistent_context(
                user_data_dir=str(BROWSER_PROFILE_DIR),
                headless=False,
                viewport={"width": 1360, "height": 860},
            )

        self._page = self._context.pages[0] if self._context.pages else self._context.new_page()
        return self._status()

    def _ensure_page(self) -> Page:
        if self._context is None or self._page is None:
            self._start()
        assert self._page is not None
        return self._page

    def open_boss(self) -> dict[str, Any]:
        return self._submit(self._open_boss)

    def _open_boss(self) -> dict[str, Any]:
        page = self._ensure_page()
        page.goto(BOSS_HOME_URL, wait_until="domcontentloaded", timeout=30000)
        return self._status()

    def status(self) -> dict[str, Any]:
        return self._submit(self._status)

    def _status(self) -> dict[str, Any]:
        page = self._page
        if page is None:
            return {
                "running": False,
                "url": "",
                "title": "",
                "is_boss_page": False,
                "profile_dir": str(BROWSER_PROFILE_DIR),
            }

        url = page.url
        try:
            title = page.title()
        except Error:
            title = ""

        return {
            "running": True,
            "url": url,
            "title": title,
            "is_boss_page": "zhipin.com" in url,
            "profile_dir": str(BROWSER_PROFILE_DIR),
        }

    def boss_auth_status(self) -> dict[str, str]:
        return self._submit(self._boss_auth_status)

    def _boss_auth_status(self) -> dict[str, str]:
        page = self._page
        if page is None:
            return {"status": "unknown", "message": "BOSS 浏览器会话尚未启动"}

        state = self._read_boss_page_state(page)
        if state is not None:
            return state
        if "/web/user" in page.url:
            return {"status": "unauthenticated", "message": "当前位于 BOSS 登录页面"}

        authenticated_selector = ".nav-figure, .user-nav, [class*='user-nav']"
        try:
            if page.locator(authenticated_selector).count() > 0:
                return {"status": "authenticated", "message": "已检测到 BOSS 用户会话"}
        except Error:
            pass

        try:
            login_links = page.get_by_text("登录/注册", exact=True)
            if login_links.count() > 0:
                return {"status": "unauthenticated", "message": "BOSS 当前未登录"}
        except Error:
            pass
        return {"status": "unknown", "message": "暂时无法确定 BOSS 登录状态"}

    def search_boss_jobs(
        self,
        keyword: str,
        city_code: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        return self._submit(self._search_boss_jobs, keyword, city_code, limit)

    def _search_boss_jobs(
        self,
        keyword: str,
        city_code: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        page = self._ensure_page()
        params = {"query": keyword}
        if city_code:
            params["city"] = city_code
        search_url = f"{BOSS_HOME_URL}web/geek/job?{urlencode(params)}"
        page.goto(search_url, wait_until="domcontentloaded", timeout=30000)

        state = self._read_boss_page_state(page)
        if state is not None and state["status"] == "blocked":
            raise BrowserOperationError("boss_blocked", state["message"], blocked=True)
        if state is not None and state["status"] == "unauthenticated":
            raise BrowserOperationError("boss_login_required", state["message"])
        if "/web/user" in page.url:
            raise BrowserOperationError("boss_login_required", "请先在 BOSS 官方页面完成登录")

        try:
            page.wait_for_selector(
                ".job-card-wrapper, .job-card-box, .job-list-box",
                timeout=15000,
            )
        except PlaywrightTimeoutError as exc:
            state = self._read_boss_page_state(page)
            if state is not None:
                raise BrowserOperationError(
                    "boss_page_unavailable",
                    state["message"],
                    blocked=state["status"] == "blocked",
                ) from exc
            raise BrowserOperationError(
                "boss_jobs_not_loaded",
                "BOSS 搜索结果未加载，可能需要登录或页面结构已经变化",
            ) from exc

        jobs = page.evaluate(
            """
            (limit) => {
              const text = (root, selectors) => {
                for (const selector of selectors) {
                  const element = root.querySelector(selector);
                  const value = element?.textContent?.trim();
                  if (value) return value;
                }
                return '';
              };
              const links = Array.from(document.querySelectorAll('a[href*="/job_detail/"]'));
              const seen = new Set();
              const results = [];
              for (const link of links) {
                const href = link.getAttribute('href') || '';
                if (!href || seen.has(href)) continue;
                const card = link.closest('.job-card-wrapper, .job-card-box, .job-list-box, li') || link.parentElement;
                if (!card) continue;
                const title = text(card, ['.job-name', '.job-title']) || link.textContent?.trim() || '';
                if (!title) continue;
                seen.add(href);
                results.push({
                  href,
                  title,
                  company: text(card, ['.company-name', '.company-info .name', '.company-text']),
                  location: text(card, ['.job-area', '.job-location', '.company-location']),
                  salary_text: text(card, ['.salary', '.job-salary']),
                  tags: Array.from(card.querySelectorAll('.tag-list li, .job-card-footer span, .job-info-tag span'))
                    .map((item) => item.textContent?.trim() || '')
                    .filter(Boolean)
                    .slice(0, 8),
                });
                if (results.length >= limit) break;
              }
              return results;
            }
            """,
            limit,
        )
        if not jobs:
            raise BrowserOperationError(
                "boss_jobs_empty",
                "BOSS 页面没有可解析的岗位，可能暂无结果或页面结构已经变化",
            )
        return jobs

    def get_boss_job_detail(self, external_id: str) -> dict[str, Any]:
        return self._submit(self._get_boss_job_detail, external_id)

    def _get_boss_job_detail(self, external_id: str) -> dict[str, Any]:
        page = self._ensure_page()
        detail_url = f"{BOSS_HOME_URL}job_detail/{external_id}.html"
        page.goto(detail_url, wait_until="domcontentloaded", timeout=30000)
        state = self._read_boss_page_state(page)
        if state is not None and state["status"] == "blocked":
            raise BrowserOperationError("boss_blocked", state["message"], blocked=True)
        if state is not None and state["status"] == "unauthenticated":
            raise BrowserOperationError("boss_login_required", state["message"])
        if "/web/user" in page.url:
            raise BrowserOperationError("boss_login_required", "请先在 BOSS 官方页面完成登录")

        try:
            page.wait_for_selector("h1, .job-name", timeout=12000)
        except PlaywrightTimeoutError as exc:
            raise BrowserOperationError(
                "boss_detail_not_loaded",
                "BOSS 岗位详情未加载或页面结构已经变化",
            ) from exc

        return page.evaluate(
            """
            () => {
              const pick = (selectors) => {
                for (const selector of selectors) {
                  const value = document.querySelector(selector)?.textContent?.trim();
                  if (value) return value;
                }
                return '';
              };
              return {
                url: window.location.href,
                title: pick(['.name h1', '.job-name', 'h1']),
                company: pick(['.company-info .name', '.company-name', '.sider-company .company-info']),
                location: pick(['.location-address', '.job-address-desc', '.text-desc']),
                salary_text: pick(['.salary', '.job-salary']),
                description: pick(['.job-sec-text', '.job-detail-section', '.job-detail']),
                tags: Array.from(document.querySelectorAll('.job-tags span, .job-tags li, .tag-list li'))
                  .map((item) => item.textContent?.trim() || '')
                  .filter(Boolean)
                  .slice(0, 20),
              };
            }
            """
        )

    @staticmethod
    def _read_boss_page_state(page: Page) -> dict[str, str] | None:
        if page.url == "about:blank":
            return {"status": "blocked", "message": "BOSS 页面被重定向为空白页，请手动检查浏览器"}
        try:
            body = page.locator("body").inner_text(timeout=3000)
        except Error:
            return {"status": "blocked", "message": "无法读取 BOSS 页面状态"}
        blocked_markers = ("安全验证", "访问异常", "请完成验证", "验证码")
        if any(marker in body for marker in blocked_markers):
            return {"status": "blocked", "message": "BOSS 要求安全验证，请在官方页面手动处理"}
        if "当前登录状态已失效" in body:
            return {"status": "unauthenticated", "message": "BOSS 登录状态已失效，请重新登录"}
        return None

    def stop(self) -> dict[str, Any]:
        return self._submit(self._stop)

    def _stop(self) -> dict[str, Any]:
        if self._context is not None:
            self._context.close()
        if self._playwright is not None:
            self._playwright.stop()
        self._context = None
        self._playwright = None
        self._page = None
        return self._status()


browser_controller = BrowserController()
