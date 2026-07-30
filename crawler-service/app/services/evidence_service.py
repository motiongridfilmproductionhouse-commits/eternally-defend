import re


class EvidenceService:

    def extract(self, page):
        markdown = (page.get("markdown") or "")
        html = (page.get("html") or "")

        text = markdown + "\n" + html

        evidence = {
            "download_links": [],
            "torrent_links": [],
            "telegram_links": [],
            "video_links": [],
            "emails": [],
        }

        urls = re.findall(r'https?://[^\s\)\"]+', text)

        for url in urls:
            lower = url.lower()

            if lower.endswith((".mp4", ".mkv", ".avi", ".zip", ".rar")):
                evidence["download_links"].append(url)

            if "torrent" in lower or lower.endswith(".torrent"):
                evidence["torrent_links"].append(url)

            if "t.me/" in lower or "telegram.me/" in lower:
                evidence["telegram_links"].append(url)

            if any(x in lower for x in ["youtube", "vimeo", "dailymotion", "player", "embed"]):
                evidence["video_links"].append(url)

        evidence["emails"] = re.findall(
            r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
            text
        )

        return evidence


evidence_service = EvidenceService()
