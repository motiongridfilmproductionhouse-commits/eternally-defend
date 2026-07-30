import os
import uuid
import httpx


class ImageDownloaderService:

    DOWNLOAD_DIR = "downloads"

    def __init__(self):
        os.makedirs(self.DOWNLOAD_DIR, exist_ok=True)

    async def download(self, url: str):

        filename = str(uuid.uuid4())

        ext = os.path.splitext(url)[1]

        if not ext:
            ext = ".jpg"

        path = os.path.join(self.DOWNLOAD_DIR, filename + ext)

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/138.0 Safari/537.36"
            ),
            "Accept": "image/*,*/*;q=0.8",
            "Referer": "https://www.google.com/"
        }

        async with httpx.AsyncClient(
            headers=headers,
            follow_redirects=True,
            timeout=30
        ) as client:

            response = await client.get(url)

            response.raise_for_status()

            with open(path, "wb") as f:
                f.write(response.content)

        return path


image_downloader_service = ImageDownloaderService()
