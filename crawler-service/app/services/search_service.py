import httpx

from app.config import BRAVE_API_KEY


class SearchService:
    BASE_URL = "https://api.search.brave.com/res/v1/web/search"

    async def search(self, query: str, count: int = 10):
        headers = {
            "Accept": "application/json",
            "X-Subscription-Token": BRAVE_API_KEY,
        }

        params = {
            "q": query,
            "count": count,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                self.BASE_URL,
                headers=headers,
                params=params,
            )

            response.raise_for_status()

            data = response.json()

        urls = []

        for item in data.get("web", {}).get("results", []):
            url = item.get("url")
            if url:
                urls.append(url)

        return urls


search_service = SearchService()
