from fastapi import FastAPI

from app.services.crawl4ai_service import crawl_service
from app.api.upload import router as upload_router

app = FastAPI(title="Eterna Crawler API")

app.include_router(upload_router)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/crawl")
async def crawl(url: str):
    return await crawl_service.crawl(url)
