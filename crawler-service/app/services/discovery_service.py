from app.services.search_service import search_service
from app.services.crawl4ai_service import crawl_service
from app.services.risk_analyzer_service import risk_analyzer
from app.services.evidence_service import evidence_service
from app.services.image_extractor_service import image_extractor_service
from app.services.image_match_service import image_match_service


class DiscoveryService:

    async def discover(self, queries: list[str], reference_image: str | None = None):
        results = []

        for query in queries:
            urls = await search_service.search(query)

            pages = []

            for url in urls:
                try:
                    page = await crawl_service.crawl(url)

                    risk = risk_analyzer.analyze(page)
                    evidence = evidence_service.extract(page)

                    image_matches = []

                    if reference_image:
                        markdown = page.get("markdown", "")
                        image_urls = image_extractor_service.extract(markdown)

                        if image_urls:
                            image_matches = await image_match_service.find_matches(
                                reference_image,
                                image_urls,
                            )

                    pages.append({
                        "url": page.get("url"),
                        "title": page.get("title"),
                        "description": page.get("description"),
                        "risk": risk,
                        "evidence": evidence,
                        "image_matches": image_matches,
                    })

                except Exception as e:
                    print(f"Error crawling {url}: {e}")
                    continue

            results.append({
                "query": query,
                "count": len(pages),
                "pages": pages,
            })

        return results


discovery_service = DiscoveryService()
