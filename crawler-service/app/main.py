from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.services.crawl4ai_service import crawl_service
from app.api.upload import router as upload_router
from app.api.scan import router as scan_router
from app.api.google_images import router as google_images_router
from app.api.frames import router as frames_router

try:  # optional module — the service must boot without it
    from app.services.search_service import search_service  # type: ignore
except Exception:  # pragma: no cover
    search_service = None  # type: ignore


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Pay the Chromium launch cost once, at boot, not per request.
    try:
        await crawl_service.start()
    except Exception:
        pass
    yield
    await crawl_service.close()


app = FastAPI(title="Eterna Crawler API", lifespan=lifespan)

app.include_router(upload_router)
app.include_router(scan_router)
app.include_router(google_images_router)
app.include_router(frames_router)


@app.get("/health")
async def health():
    diag = crawl_service.diagnostics()
    return {
        "status": "ok",
        "browser_warm": diag["browser"]["warm"],
        "circuit": diag["circuit_breaker"]["state"],
    }


@app.get("/crawl/diagnostics")
async def crawl_diagnostics():
    return crawl_service.diagnostics()


@app.get("/crawl")
async def crawl(url: str):
    payload = await crawl_service.crawl(url)
    status = payload.pop("_status", 200)
    if status != 200:
        return JSONResponse(payload, status_code=status)
    return payload


@app.get("/search")
async def search(query: str):
    if search_service is None:
        return JSONResponse({"error": "search backend not configured"}, status_code=503)
    urls = await search_service.search(query)
    return {"query": query, "count": len(urls), "urls": urls}
