import os

from app.services.image_hash_service import image_hash_service
from app.services.image_similarity_service import image_similarity_service
from app.services.image_downloader_service import image_downloader_service


class ImageMatchService:

    async def find_matches(self, reference_image, image_urls):

        reference = image_hash_service.generate(reference_image)

        matches = []

        for url in image_urls:

            try:

                downloaded = await image_downloader_service.download(url)

                candidate = image_hash_service.generate(downloaded)

                score = image_similarity_service.compare(
                    reference["phash"],
                    candidate["phash"],
                )

                matches.append({
                    "url": url,
                    "similarity": score["similarity"],
                    "distance": score["distance"],
                })

                if os.path.exists(downloaded):
                    os.remove(downloaded)

            except Exception:
                continue

        matches.sort(
            key=lambda x: x["similarity"],
            reverse=True,
        )

        return matches


image_match_service = ImageMatchService()
