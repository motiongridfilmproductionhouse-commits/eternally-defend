import os
import re


class QueryGeneratorService:

    def generate(self, filename: str):
        # Remove extension
        title = os.path.splitext(filename)[0]

        # Replace separators
        title = title.replace("_", " ").replace("-", " ")

        # Remove extra spaces
        title = re.sub(r"\s+", " ", title).strip()

        queries = [
            title,
            f"{title} full movie",
            f"{title} watch online",
            f"{title} download",
            f"{title} HD",
            f"{title} 1080p",
            f"{title} Telegram",
            f"{title} torrent",
            f"{title} leaked",
            f"{title} CAMRip",
            f"{title} poster",
            f"{title} trailer"
        ]

        return list(dict.fromkeys(queries))


query_generator_service = QueryGeneratorService()
