"""
Crawl4AI extraction service — warm browser, per-stage timings, circuit breaker.

Why this file looks the way it does
-----------------------------------
The previous implementation did `async with AsyncWebCrawler() as crawler:` inside
every request. That launches (and tears down) a fresh Chromium per /crawl call.
With the scan pipeline issuing 6 concurrent extractions, the box was running up
to 6 simultaneous cold browser launches, so nearly all requests spent their
entire budget in browser startup and were killed by the client's 15s abort
(observed: 204/210 navigation timeouts).

Fixes here:
  * ONE warm AsyncWebCrawler (browser + context) for the process lifetime,
    started during app startup and reused by every request.
  * A concurrency semaphore so we render a bounded number of pages in parallel
    instead of thrashing the shared browser.
  * Images/fonts/media are not loaded and heavy tags are excluded — for text
    extraction they are pure latency.
  * `domcontentloaded` + a small settle delay instead of full `networkidle`.
  * Per-stage timings returned on every response (`timings_ms`).
  * A circuit breaker: after repeated hard failures the service fails fast with
    503 so the caller falls back to plain fetch immediately rather than burning
    its whole timeout budget.

Nothing here raises the client timeout; the goal is a warm render well under it.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Dict, Optional

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

# ---------------------------------------------------------------------------
# Tunables (env-overridable, safe defaults for a 1–2 vCPU container)
# ---------------------------------------------------------------------------
MAX_CONCURRENCY = int(os.getenv("CRAWL_MAX_CONCURRENCY", "4"))
PAGE_TIMEOUT_MS = int(os.getenv("CRAWL_PAGE_TIMEOUT_MS", "12000"))
SETTLE_MS = int(os.getenv("CRAWL_SETTLE_MS", "400"))
QUEUE_WAIT_TIMEOUT_S = float(os.getenv("CRAWL_QUEUE_WAIT_TIMEOUT_S", "8"))
HARD_TIMEOUT_S = float(os.getenv("CRAWL_HARD_TIMEOUT_S", "20"))

# Circuit breaker
BREAKER_FAILURE_THRESHOLD = int(os.getenv("CRAWL_BREAKER_THRESHOLD", "8"))
BREAKER_OPEN_SECONDS = float(os.getenv("CRAWL_BREAKER_OPEN_SECONDS", "60"))
BREAKER_HALF_OPEN_PROBES = int(os.getenv("CRAWL_BREAKER_PROBES", "2"))


class CircuitOpen(Exception):
    """Raised when the breaker is open and the request should fail fast."""


class CircuitBreaker:
    """Consecutive-failure breaker with a half-open probe window."""

    def __init__(self) -> None:
        self.state = "closed"  # closed | open | half_open
        self.consecutive_failures = 0
        self.opened_at: float = 0.0
        self.probes_left = 0
        self.trips = 0

    def before_request(self) -> None:
        if self.state == "open":
            if time.monotonic() - self.opened_at >= BREAKER_OPEN_SECONDS:
                self.state = "half_open"
                self.probes_left = BREAKER_HALF_OPEN_PROBES
            else:
                raise CircuitOpen(
                    f"crawler circuit open for another "
                    f"{max(0, BREAKER_OPEN_SECONDS - (time.monotonic() - self.opened_at)):.0f}s"
                )
        if self.state == "half_open":
            if self.probes_left <= 0:
                raise CircuitOpen("crawler circuit half-open, probe budget exhausted")
            self.probes_left -= 1

    def record_success(self) -> None:
        self.consecutive_failures = 0
        self.state = "closed"

    def record_failure(self) -> None:
        self.consecutive_failures += 1
        if self.state == "half_open":
            self._open()
        elif self.consecutive_failures >= BREAKER_FAILURE_THRESHOLD:
            self._open()

    def _open(self) -> None:
        self.state = "open"
        self.opened_at = time.monotonic()
        self.trips += 1

    def snapshot(self) -> Dict[str, Any]:
        return {
            "state": self.state,
            "consecutive_failures": self.consecutive_failures,
            "trips": self.trips,
            "open_seconds": BREAKER_OPEN_SECONDS,
            "failure_threshold": BREAKER_FAILURE_THRESHOLD,
        }


def _browser_config() -> BrowserConfig:
    return BrowserConfig(
        browser_type="chromium",
        headless=True,
        text_mode=True,  # skips images/fonts at the browser level
        light_mode=True,
        verbose=False,
        extra_args=[
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-features=TranslateUI,BackForwardCache",
            "--metrics-recording-only",
            "--mute-audio",
            "--no-first-run",
        ],
    )


def _run_config() -> CrawlerRunConfig:
    return CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=PAGE_TIMEOUT_MS,
        wait_until="domcontentloaded",
        delay_before_return_html=SETTLE_MS / 1000,
        exclude_all_images=True,
        exclude_external_images=True,
        excluded_tags=["script", "style", "noscript", "svg", "iframe", "video", "audio"],
        remove_overlay_elements=True,
        scan_full_page=False,
        verbose=False,
    )


class CrawlService:
    """Owns the single warm crawler and all extraction telemetry."""

    def __init__(self) -> None:
        self._crawler: Optional[AsyncWebCrawler] = None
        self._start_lock = asyncio.Lock()
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
        self._run_config = _run_config()
        self.breaker = CircuitBreaker()
        self.browser_started_at: Optional[float] = None
        self.browser_launch_ms: Optional[float] = None
        self.stats: Dict[str, Any] = {
            "requests": 0,
            "success": 0,
            "failed": 0,
            "rejected_circuit_open": 0,
            "rejected_queue_timeout": 0,
            "browser_launches": 0,
            "warm_reuses": 0,
            "total_render_ms": 0.0,
        }

    # -- lifecycle ---------------------------------------------------------
    async def start(self) -> None:
        """Launch the warm browser once. Safe to call repeatedly."""
        if self._crawler is not None:
            return
        async with self._start_lock:
            if self._crawler is not None:
                return
            t0 = time.perf_counter()
            crawler = AsyncWebCrawler(config=_browser_config())
            await crawler.start()
            self._crawler = crawler
            self.browser_launch_ms = (time.perf_counter() - t0) * 1000
            self.browser_started_at = time.time()
            self.stats["browser_launches"] += 1

    async def close(self) -> None:
        crawler, self._crawler = self._crawler, None
        if crawler is not None:
            try:
                await crawler.close()
            except Exception:
                pass

    async def _recycle(self) -> None:
        """Tear down and relaunch the browser after a fatal browser-level error."""
        await self.close()
        await self.start()

    # -- extraction --------------------------------------------------------
    async def crawl(self, url: str) -> Dict[str, Any]:
        timings: Dict[str, float] = {}
        t_start = time.perf_counter()
        self.stats["requests"] += 1

        try:
            self.breaker.before_request()
        except CircuitOpen as e:
            self.stats["rejected_circuit_open"] += 1
            return self._failure(url, "circuit_open", str(e), timings, t_start, status=503)

        # Stage: browser (warm reuse should be ~0ms)
        t = time.perf_counter()
        already_warm = self._crawler is not None
        await self.start()
        timings["browser_ms"] = round((time.perf_counter() - t) * 1000, 1)
        if already_warm:
            self.stats["warm_reuses"] += 1

        # Stage: queue wait (concurrency admission)
        t = time.perf_counter()
        try:
            await asyncio.wait_for(self._semaphore.acquire(), timeout=QUEUE_WAIT_TIMEOUT_S)
        except asyncio.TimeoutError:
            timings["queue_ms"] = round((time.perf_counter() - t) * 1000, 1)
            self.stats["rejected_queue_timeout"] += 1
            self.breaker.record_failure()
            return self._failure(
                url, "queue_timeout", "crawler saturated; try fallback", timings, t_start, status=503
            )
        timings["queue_ms"] = round((time.perf_counter() - t) * 1000, 1)

        try:
            # Stage: navigate + render + extract (Crawl4AI does these together)
            t = time.perf_counter()
            assert self._crawler is not None
            try:
                result = await asyncio.wait_for(
                    self._crawler.arun(url=url, config=self._run_config),
                    timeout=HARD_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                timings["render_ms"] = round((time.perf_counter() - t) * 1000, 1)
                self.breaker.record_failure()
                self.stats["failed"] += 1
                return self._failure(
                    url, "navigation_timeout", f"exceeded {HARD_TIMEOUT_S}s", timings, t_start
                )
            timings["render_ms"] = round((time.perf_counter() - t) * 1000, 1)

            # Stage: serialize
            t = time.perf_counter()
            markdown = getattr(result, "markdown", "") or ""
            if not isinstance(markdown, str):
                markdown = str(getattr(markdown, "raw_markdown", "") or "")
            metadata = getattr(result, "metadata", None) or {}
            payload = {
                "success": bool(getattr(result, "success", False)),
                "url": getattr(result, "url", url) or url,
                "title": metadata.get("title") or "",
                "description": metadata.get("description") or "",
                "markdown": markdown,
                "links": getattr(result, "links", None) or {},
                "media": getattr(result, "media", None) or {},
            }
            timings["extract_ms"] = round((time.perf_counter() - t) * 1000, 1)

            if payload["success"] and markdown.strip():
                self.breaker.record_success()
                self.stats["success"] += 1
            else:
                self.breaker.record_failure()
                self.stats["failed"] += 1
                payload["failure_reason"] = (
                    getattr(result, "error_message", None) or "empty_rendered_content"
                )

            timings["total_ms"] = round((time.perf_counter() - t_start) * 1000, 1)
            self.stats["total_render_ms"] += timings["total_ms"]
            payload["timings_ms"] = timings
            payload["warm"] = already_warm
            return payload

        except Exception as e:  # browser-level fault → recycle so we don't wedge
            self.breaker.record_failure()
            self.stats["failed"] += 1
            message = f"{type(e).__name__}: {e}"
            if any(k in message.lower() for k in ("browser", "target closed", "connection closed")):
                try:
                    await self._recycle()
                except Exception:
                    pass
            return self._failure(url, "crawl_error", message, timings, t_start)
        finally:
            self._semaphore.release()

    # -- helpers -----------------------------------------------------------
    def _failure(
        self,
        url: str,
        category: str,
        reason: str,
        timings: Dict[str, float],
        t_start: float,
        status: int = 200,
    ) -> Dict[str, Any]:
        timings["total_ms"] = round((time.perf_counter() - t_start) * 1000, 1)
        return {
            "success": False,
            "url": url,
            "title": "",
            "description": "",
            "markdown": "",
            "links": {},
            "media": {},
            "failure_category": category,
            "failure_reason": reason[:300],
            "timings_ms": timings,
            "_status": status,
        }

    def diagnostics(self) -> Dict[str, Any]:
        requests = max(1, self.stats["success"] + self.stats["failed"])
        return {
            "browser": {
                "warm": self._crawler is not None,
                "launches": self.stats["browser_launches"],
                "launch_ms": round(self.browser_launch_ms or 0, 1),
                "uptime_s": round(time.time() - self.browser_started_at, 1)
                if self.browser_started_at
                else None,
            },
            "concurrency": {
                "max": MAX_CONCURRENCY,
                "queue_wait_timeout_s": QUEUE_WAIT_TIMEOUT_S,
            },
            "timeouts": {
                "page_timeout_ms": PAGE_TIMEOUT_MS,
                "hard_timeout_s": HARD_TIMEOUT_S,
                "settle_ms": SETTLE_MS,
            },
            "circuit_breaker": self.breaker.snapshot(),
            "counters": dict(self.stats),
            "avg_total_ms": round(self.stats["total_render_ms"] / requests, 1),
        }


crawl_service = CrawlService()
