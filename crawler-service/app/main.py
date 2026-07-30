from fastapi import FastAPI

from app.services.crawl4ai_service import crawl_service
from app.services.search_service import search_service
from app.api.upload import router as upload_router
from app.api.scan import router as scan_router

app = FastAPI(title="Eterna Crawler API")

app.include_router(upload_router)
app.include_router(scan_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/crawl")
async def crawl(url: str):
    return await crawl_service.crawl(url)
@app.get("/search")
async def search(query: str):
    urls = await search_service.search(query)

    return {
        "query": query,
        "count": len(urls),
        "urls": urls
    }
