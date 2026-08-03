"""
Browser-based Google Images collector using Playwright.
Scrolls results, extracts full-resolution URLs and source metadata.
Falls back to Crawl4AI when Playwright is unavailable.
"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import quote_plus

from app.services.crawl4ai_service import crawl_service

IMAGE_URL_RE = re.compile(
    r'https?://[^\s"\'<>\\]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"\'<>\\]*)?',
    re.IGNORECASE,
)
ORIGINAL_URL_RE = re.compile(r'"ou":"(https?://[^"\\]+)"')
THUMB_URL_RE = re.compile(r'"(https?://[^"\\]*googleusercontent\.com/[^"\\]+)"')


def _build_search_url(query: str) -> str:
    return f"https://www.google.com/search?q={quote_plus(query)}&tbm=isch&hl=en"


def _extract_from_html(html: str, query: str, search_url: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    for match in ORIGINAL_URL_RE.findall(html or ""):
        url = match.replace("\\u003d", "=").replace("\\u0026", "&")
        if url in seen:
            continue
        seen.add(url)
        results.append(
            {
                "image_url": url,
                "thumbnail_url": None,
                "source_website_url": None,
                "google_result_url": search_url,
                "query": query,
                "title": query,
                "width": None,
                "height": None,
            }
        )

    for match in IMAGE_URL_RE.findall(html or ""):
        url = match.replace("\\u003d", "=").replace("\\u0026", "&")
        if "googleusercontent.com/gen_204" in url:
            continue
        if url in seen:
            continue
        seen.add(url)
        results.append(
            {
                "image_url": url,
                "thumbnail_url": url,
                "source_website_url": None,
                "google_result_url": search_url,
                "query": query,
                "title": query,
                "width": None,
                "height": None,
            }
        )

    return results


async def _collect_with_playwright(
    query: str,
    *,
    max_images: int = 120,
    scroll_passes: int = 8,
) -> dict[str, Any]:
    from playwright.async_api import async_playwright

    search_url = _build_search_url(query)
    images: list[dict[str, Any]] = []
    seen: set[str] = set()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
        )
        page = await context.new_page()
        await page.goto(search_url, wait_until="domcontentloaded", timeout=45_000)

        for _ in range(scroll_passes):
            await page.evaluate("window.scrollBy(0, window.innerHeight * 1.2)")
            await page.wait_for_timeout(900)

        html = await page.content()

        extracted = await page.evaluate(
            """() => {
              const out = [];
              const anchors = document.querySelectorAll('a[href*="imgurl="], a[href*="imgres?"]');
              anchors.forEach((anchor) => {
                const href = anchor.href || '';
                const img = anchor.querySelector('img');
                const thumb = img ? (img.currentSrc || img.src || null) : null;
                let source = null;
                try {
                  const u = new URL(href);
                  source = u.searchParams.get('imgurl') || u.searchParams.get('url') || null;
                } catch (_) {}
                if (thumb || source) {
                  out.push({
                    image_url: source || thumb,
                    thumbnail_url: thumb,
                    source_website_url: source,
                    title: img ? (img.alt || '') : '',
                  });
                }
              });

              document.querySelectorAll('img[src*="googleusercontent"], img[data-src]').forEach((img) => {
                const src = img.currentSrc || img.src || img.getAttribute('data-src');
                if (!src) return;
                out.push({
                  image_url: src,
                  thumbnail_url: src,
                  source_website_url: null,
                  title: img.alt || '',
                });
              });
              return out;
            }"""
        )

        await browser.close()

    for item in extracted or []:
        image_url = item.get("image_url")
        if not image_url or image_url in seen:
            continue
        seen.add(image_url)
        images.append(
            {
                "image_url": image_url,
                "thumbnail_url": item.get("thumbnail_url"),
                "source_website_url": item.get("source_website_url"),
                "google_result_url": search_url,
                "query": query,
                "title": item.get("title") or query,
                "width": None,
                "height": None,
            }
        )
        if len(images) >= max_images:
            break

    if len(images) < max_images // 2:
        for row in _extract_from_html(html, query, search_url):
            if row["image_url"] in seen:
                continue
            seen.add(row["image_url"])
            images.append(row)
            if len(images) >= max_images:
                break

    return {
        "query": query,
        "search_url": search_url,
        "images": images[:max_images],
        "pages_loaded": scroll_passes + 1,
        "used_browser": True,
        "engine": "playwright",
    }


async def _collect_with_crawl4ai(query: str, *, max_images: int = 80) -> dict[str, Any]:
    search_url = _build_search_url(query)
    rendered = await crawl_service.crawl(search_url)
    blob = f"{rendered.get('markdown') or ''}\n{json.dumps(rendered.get('media') or [])}"
    images = _extract_from_html(blob, query, search_url)[:max_images]
    return {
        "query": query,
        "search_url": search_url,
        "images": images,
        "pages_loaded": 1,
        "used_browser": True,
        "engine": "crawl4ai",
    }


async def collect_google_images(
    queries: list[str],
    *,
    max_images_per_query: int = 120,
    max_queries: int = 12,
) -> dict[str, Any]:
    selected = [q.strip() for q in queries if q and q.strip()][:max_queries]
    all_images: list[dict[str, Any]] = []
    seen: set[str] = set()
    pages_loaded = 0
    used_browser = False
    engine = None
    failures: list[str] = []

    for query in selected:
        try:
            try:
                result = await _collect_with_playwright(
                    query,
                    max_images=max_images_per_query,
                )
                engine = result.get("engine")
            except Exception as playwright_error:
                failures.append(f"playwright:{query}:{playwright_error}")
                result = await _collect_with_crawl4ai(
                    query,
                    max_images=max_images_per_query,
                )
                engine = result.get("engine")

            used_browser = used_browser or bool(result.get("used_browser"))
            pages_loaded += int(result.get("pages_loaded") or 0)

            for image in result.get("images") or []:
                image_url = image.get("image_url")
                if not image_url or image_url in seen:
                    continue
                seen.add(image_url)
                all_images.append(image)
        except Exception as error:
            failures.append(f"{query}:{error}")

    return {
        "queries_executed": len(selected),
        "pages_loaded": pages_loaded,
        "images": all_images,
        "images_discovered": len(all_images),
        "used_browser": used_browser,
        "engine": engine,
        "failures": failures,
        "provider_status": "success" if all_images else ("degraded" if failures else "unavailable"),
    }


google_images_service = type("GoogleImagesService", (), {"collect": collect_google_images})()
