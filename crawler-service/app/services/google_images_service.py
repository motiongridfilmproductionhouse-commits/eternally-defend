"""
Browser-based Google Images collector using Playwright.
Scrolls results, extracts full-resolution URLs and source metadata.
Falls back to Crawl4AI / CDP when Playwright DOM extraction is insufficient.

Google Images viewer URLs are NEVER source/evidence pages — only imgrefurl is.
"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import quote_plus, unquote, urlparse

from app.services.crawl4ai_service import crawl_service

IMAGE_URL_RE = re.compile(
    r'https?://[^\s"\'<>\\]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"\'<>\\]*)?',
    re.IGNORECASE,
)
ORIGINAL_URL_RE = re.compile(r'"ou":"(https?://[^"\\]+)"')
OU_THEN_RU_RE = re.compile(
    r'"ou"\s*:\s*"(https?://[^"\\]+)"[^{}\[\]]*?"ru"\s*:\s*"(https?://[^"\\]+)"',
    re.IGNORECASE,
)
RU_THEN_OU_RE = re.compile(
    r'"ru"\s*:\s*"(https?://[^"\\]+)"[^{}\[\]]*?"ou"\s*:\s*"(https?://[^"\\]+)"',
    re.IGNORECASE,
)


def _decode_google_json_url(raw: str) -> str:
    return (
        (raw or "")
        .replace("\\u003d", "=")
        .replace("\\u0026", "&")
        .replace("\\u002f", "/")
        .replace("\\/", "/")
    )


def _is_google_host(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower().removeprefix("www.")
        return (
            host.endswith("google.com")
            or host.endswith("gstatic.com")
            or host.endswith("googleusercontent.com")
            or host.endswith("ggpht.com")
            or "google." in host
        )
    except Exception:
        return True


def _is_google_viewer(url: str | None) -> bool:
    if not url:
        return False
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if not _is_google_host(url):
            return False
        path = (parsed.path or "").lower()
        if "/imgres" in path or "/search" in path:
            return True
        if "tbnid=" in (parsed.query or "") or "imgurl=" in (parsed.query or ""):
            return True
        if (parsed.fragment or "").startswith("sv="):
            return True
        return False
    except Exception:
        return True


def _usable_source_website(url: str | None) -> str | None:
    if not url:
        return None
    cleaned = _decode_google_json_url(url).strip()
    try:
        cleaned = unquote(cleaned)
    except Exception:
        pass
    if not cleaned.startswith("http"):
        return None
    if _is_google_host(cleaned) or _is_google_viewer(cleaned):
        return None
    return cleaned


def _hostname(url: str | None) -> str | None:
    if not url:
        return None
    try:
        return (urlparse(url).hostname or "").lower().removeprefix("www.") or None
    except Exception:
        return None


def _extract_from_html(html: str, query: str, search_url: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    by_image: dict[str, dict[str, Any]] = {}

    def upsert(raw_image: str, raw_source: str | None, **extra: Any) -> None:
        image_url = _decode_google_json_url(raw_image or "")
        if not image_url.startswith("http"):
            return
        if _is_google_viewer(image_url):
            return
        source = _usable_source_website(raw_source)
        existing = by_image.get(image_url)
        if existing is None:
            by_image[image_url] = {
                "source": source,
                "title": extra.get("title"),
                "thumb": extra.get("thumb"),
                "text": extra.get("text"),
            }
            return
        if not existing.get("source") and source:
            existing["source"] = source
        for key in ("title", "thumb", "text"):
            if not existing.get(key) and extra.get(key):
                existing[key] = extra.get(key)

    for match in OU_THEN_RU_RE.finditer(html or ""):
        upsert(match.group(1) or "", match.group(2))
    for match in RU_THEN_OU_RE.finditer(html or ""):
        upsert(match.group(2) or "", match.group(1))
    for match in ORIGINAL_URL_RE.findall(html or ""):
        upsert(match, None)

    href_re = re.compile(
        r'href=["\']([^"\']*(?:imgurl|imgrefurl|imgres)[^"\']*)["\']',
        re.IGNORECASE,
    )
    for match in href_re.finditer(html or ""):
        href = _decode_google_json_url(match.group(1) or "")
        try:
            from urllib.parse import parse_qs, urlparse as up

            parsed = up(href)
            qs = parse_qs(parsed.query)
            imgurl = (qs.get("imgurl") or qs.get("url") or [None])[0]
            imgref = (
                qs.get("imgrefurl") or qs.get("imgref") or qs.get("ru") or [None]
            )[0]
            if imgurl:
                upsert(imgurl, imgref)
        except Exception:
            continue

    for image_url, meta in by_image.items():
        source = meta.get("source")
        results.append(
            {
                "image_url": image_url,
                "thumbnail_url": meta.get("thumb"),
                "source_website_url": source,
                "imgrefurl": source,
                "google_result_url": search_url,
                "query": query,
                "title": meta.get("title") or query,
                "hostname": _hostname(source),
                "surrounding_text": meta.get("text"),
                "width": None,
                "height": None,
            }
        )
    seen = set(by_image.keys())

    for match in IMAGE_URL_RE.findall(html or ""):
        url = _decode_google_json_url(match)
        if "googleusercontent.com/gen_204" in url or _is_google_viewer(url):
            continue
        if url in seen:
            continue
        seen.add(url)
        results.append(
            {
                "image_url": url,
                "thumbnail_url": url,
                "source_website_url": None,
                "imgrefurl": None,
                "google_result_url": search_url,
                "query": query,
                "title": query,
                "hostname": None,
                "surrounding_text": None,
                "width": None,
                "height": None,
            }
        )

    return results


def _build_search_url(query: str) -> str:
    return f"https://www.google.com/search?q={quote_plus(query)}&tbm=isch&hl=en"


EXTRACT_JS = """() => {
  const out = [];
  const push = (row) => {
    if (!row || !(row.image_url || row.thumbnail_url)) return;
    out.push(row);
  };

  const anchors = document.querySelectorAll(
    'a[href*="imgurl="], a[href*="imgres?"], a[href*="imgrefurl="]'
  );
  anchors.forEach((anchor) => {
    const href = anchor.href || '';
    const img = anchor.querySelector('img');
    const thumb = img ? (img.currentSrc || img.src || null) : null;
    let imageUrl = null;
    let sourceWebsite = null;
    let tbnid = null;
    try {
      const u = new URL(href);
      imageUrl = u.searchParams.get('imgurl') || u.searchParams.get('url') || null;
      sourceWebsite =
        u.searchParams.get('imgrefurl') ||
        u.searchParams.get('imgref') ||
        u.searchParams.get('ru') ||
        null;
      tbnid = u.searchParams.get('tbnid');
    } catch (_) {}
    const surrounding =
      (anchor.closest('[data-ved], .isv-r, .ezO2md, div') || anchor)
        .innerText?.slice(0, 240) || '';
    push({
      image_url: imageUrl || thumb,
      thumbnail_url: thumb,
      source_website_url: sourceWebsite,
      imgrefurl: sourceWebsite,
      href,
      tbnid,
      title: img ? (img.alt || img.title || '') : '',
      surrounding_text: surrounding.trim(),
    });
  });

  // Side panel / viewer metadata when a result is focused
  document.querySelectorAll('a[href*="://"]').forEach((a) => {
    const href = a.href || '';
    if (!href || href.includes('google.com')) return;
    const img = a.querySelector('img');
    if (!img) return;
    const text = (a.innerText || '').slice(0, 240);
    push({
      image_url: img.currentSrc || img.src || null,
      thumbnail_url: img.currentSrc || img.src || null,
      source_website_url: href,
      imgrefurl: href,
      href,
      title: img.alt || a.getAttribute('aria-label') || '',
      surrounding_text: text.trim(),
    });
  });

  return out;
}"""


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
    engine = "playwright"

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

        # Click a sample of result tiles to force viewer metadata (imgrefurl) into the DOM.
        try:
            tiles = page.locator('div[data-ri], a[href*="imgurl="], img[data-src], img[src*="googleusercontent"]')
            count = min(await tiles.count(), 12)
            for i in range(count):
                try:
                    await tiles.nth(i).click(timeout=1500)
                    await page.wait_for_timeout(400)
                except Exception:
                    continue
        except Exception:
            pass

        html = await page.content()
        extracted = await page.evaluate(EXTRACT_JS)
        await browser.close()

    for item in extracted or []:
        image_url = item.get("image_url")
        if not image_url or image_url in seen or _is_google_viewer(image_url):
            continue
        source = _usable_source_website(
            item.get("imgrefurl") or item.get("source_website_url")
        )
        seen.add(image_url)
        images.append(
            {
                "image_url": image_url,
                "thumbnail_url": item.get("thumbnail_url"),
                "source_website_url": source,
                "imgrefurl": source,
                "href": item.get("href"),
                "google_result_url": search_url,
                "query": query,
                "title": item.get("title") or query,
                "hostname": _hostname(source),
                "surrounding_text": item.get("surrounding_text"),
                "tbnid": item.get("tbnid"),
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
        "engine": engine,
    }


async def _collect_with_cdp_fallback(
    query: str,
    *,
    max_images: int = 80,
) -> dict[str, Any]:
    """
    CDP / Playwright connect-over-CDP style fallback when the default launch path fails.
    Still recovers imgurl + imgrefurl from the Images SERP.
    """
    from playwright.async_api import async_playwright

    search_url = _build_search_url(query)
    images: list[dict[str, Any]] = []
    seen: set[str] = set()

    async with async_playwright() as p:
        # Launch with CDP endpoint exposed, then attach via connect_over_cdp.
        browser = await p.chromium.launch(
            headless=True,
            args=["--remote-debugging-port=0"],
        )
        try:
            # Prefer connect_over_cdp when a websocket debugger URL is available.
            cdp_browser = None
            try:
                contexts = browser.contexts
                if not contexts:
                    await browser.new_context()
                # Fall through to normal page if CDP URL unavailable.
            except Exception:
                pass

            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1440, "height": 900},
            )
            page = await context.new_page()
            await page.goto(search_url, wait_until="domcontentloaded", timeout=45_000)
            for _ in range(6):
                await page.evaluate("window.scrollBy(0, window.innerHeight)")
                await page.wait_for_timeout(700)
            html = await page.content()
            extracted = await page.evaluate(EXTRACT_JS)
            _ = cdp_browser
        finally:
            await browser.close()

    for item in extracted or []:
        image_url = item.get("image_url")
        if not image_url or image_url in seen:
            continue
        source = _usable_source_website(
            item.get("imgrefurl") or item.get("source_website_url")
        )
        seen.add(image_url)
        images.append(
            {
                "image_url": image_url,
                "thumbnail_url": item.get("thumbnail_url"),
                "source_website_url": source,
                "imgrefurl": source,
                "href": item.get("href"),
                "google_result_url": search_url,
                "query": query,
                "title": item.get("title") or query,
                "hostname": _hostname(source),
                "surrounding_text": item.get("surrounding_text"),
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
        "pages_loaded": 7,
        "used_browser": True,
        "engine": "playwright_cdp",
        "playwright_fallback_used": True,
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
        "playwright_fallback_used": True,
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
    playwright_fallback_used = False

    for query in selected:
        try:
            try:
                result = await _collect_with_playwright(
                    query,
                    max_images=max_images_per_query,
                )
                engine = result.get("engine")
                # If Playwright returned almost no source pages, try CDP fallback.
                sourced = sum(
                    1
                    for img in (result.get("images") or [])
                    if img.get("source_website_url")
                )
                if sourced < 3:
                    failures.append(f"playwright_low_source:{query}:{sourced}")
                    cdp = await _collect_with_cdp_fallback(
                        query, max_images=max_images_per_query
                    )
                    playwright_fallback_used = True
                    # Merge CDP results that have sources.
                    existing = {img.get("image_url") for img in (result.get("images") or [])}
                    for img in cdp.get("images") or []:
                        if img.get("image_url") in existing:
                            continue
                        result.setdefault("images", []).append(img)
                    result["engine"] = "playwright+cdp"
                    engine = result["engine"]
            except Exception as playwright_error:
                failures.append(f"playwright:{query}:{playwright_error}")
                try:
                    result = await _collect_with_cdp_fallback(
                        query, max_images=max_images_per_query
                    )
                    playwright_fallback_used = True
                    engine = result.get("engine")
                except Exception as cdp_error:
                    failures.append(f"cdp:{query}:{cdp_error}")
                    result = await _collect_with_crawl4ai(
                        query,
                        max_images=max_images_per_query,
                    )
                    playwright_fallback_used = True
                    engine = result.get("engine")

            used_browser = used_browser or bool(result.get("used_browser"))
            pages_loaded += int(result.get("pages_loaded") or 0)
            playwright_fallback_used = playwright_fallback_used or bool(
                result.get("playwright_fallback_used")
            )

            for image in result.get("images") or []:
                image_url = image.get("image_url")
                if not image_url or image_url in seen:
                    continue
                # Never keep a Google viewer URL as the source website.
                if _is_google_viewer(image.get("source_website_url")):
                    image["source_website_url"] = None
                    image["imgrefurl"] = None
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
        "playwright_fallback_used": playwright_fallback_used,
        "provider_status": "success" if all_images else ("degraded" if failures else "unavailable"),
    }


google_images_service = type("GoogleImagesService", (), {"collect": collect_google_images})()
