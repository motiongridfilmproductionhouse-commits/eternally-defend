from fastapi import FastAPI
from app.services.crawl4ai_service import crawl_service

app = FastAPI(title="Eterna Crawler API")

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/crawl")
async def crawl(url: str):
    return await crawl_service.crawl(url)
