from crawl4ai import AsyncWebCrawler

class CrawlService:
    async def crawl(self, url: str):
        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(
                url=url,
                bypass_cache=True
            )

            return {
                "success": result.success,
                "url": result.url,
                "title": result.metadata.get("title") if result.metadata else "",
                "description": result.metadata.get("description") if result.metadata else "",
                "markdown": result.markdown,
                "links": result.links,
                "media": result.media,
            }

crawl_service = CrawlService()
