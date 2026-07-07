from __future__ import annotations

from pathlib import Path
from threading import RLock
from typing import Any

from playwright.sync_api import BrowserContext, Error, Page, Playwright, sync_playwright


BOSS_HOME_URL = "https://www.zhipin.com/"
ROOT_DIR = Path(__file__).resolve().parents[1]
BROWSER_PROFILE_DIR = ROOT_DIR / "data" / "browser-profile"


class BrowserController:
    def __init__(self) -> None:
        self._lock = RLock()
        self._playwright: Playwright | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

    def start(self) -> dict[str, Any]:
        with self._lock:
            if self._context is not None:
                return self.status()

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
            return self.status()

    def open_boss(self) -> dict[str, Any]:
        with self._lock:
            if self._context is None or self._page is None:
                self.start()
            assert self._page is not None
            self._page.goto(BOSS_HOME_URL, wait_until="domcontentloaded", timeout=30000)
            return self.status()

    def status(self) -> dict[str, Any]:
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
        title = ""
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

    def stop(self) -> dict[str, Any]:
        with self._lock:
            if self._context is not None:
                self._context.close()
            if self._playwright is not None:
                self._playwright.stop()
            self._context = None
            self._playwright = None
            self._page = None
            return self.status()


browser_controller = BrowserController()
