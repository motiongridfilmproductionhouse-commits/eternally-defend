from urllib.parse import urlparse


class RiskAnalyzerService:

    HIGH_RISK_DOMAINS = [
        "1337x", "yts", "thepiratebay", "torrentgalaxy", "torrentz",
        "torrent", "t.me", "telegram", "mega.nz", "mediafire",
        "1fichier", "rapidgator", "kat", "rarbg", "1337xx",
        "watchseries", "fmovies", "123movies", "putlocker", "gomovies",
    ]

    OFFICIAL_DOMAINS = [
        "netflix.com",
        "disneyplus.com",
        "primevideo.com",
        "apple.com",
        "imdb.com",
        "wikipedia.org",
        "marvel.com",
        "sony.com",
    ]

    HIGH_RISK_KEYWORDS = [
        "watch free",
        "watch online",
        "full movie",
        "download",
        "torrent",
        "magnet",
        "camrip",
        "hdrip",
        "dvdrip",
        "webrip",
        "1080p",
        "720p",
        "480p",
        "telegram",
        "leaked",
        "pirated",
        "free streaming",
    ]

    def analyze(self, page):
        score = 0
        reasons = []

        url = (page.get("url") or "").lower()
        title = (page.get("title") or "").lower()
        description = (page.get("description") or "").lower()
        markdown = (page.get("markdown") or "").lower()

        domain = urlparse(url).netloc.lower()

        if any(d in domain for d in self.OFFICIAL_DOMAINS):
            return {
                "score": 0,
                "level": "OFFICIAL",
                "reasons": ["Official website"],
            }

        if any(d in domain for d in self.HIGH_RISK_DOMAINS):
            score += 60
            reasons.append("Known piracy domain")

        text = f"{title} {description} {markdown}"

        for keyword in self.HIGH_RISK_KEYWORDS:
            if keyword in text:
                score += 8
                reasons.append(keyword)

        links = page.get("links") or {}

        external = links.get("external") or []

        if len(external) > 50:
            score += 10
            reasons.append("Many external links")

        media = page.get("media") or {}

        images = media.get("images") or []

        if len(images) > 20:
            score += 5
            reasons.append("Many images")

        if score >= 80:
            level = "HIGH"
        elif score >= 40:
            level = "MEDIUM"
        elif score >= 10:
            level = "LOW"
        else:
            level = "SAFE"

        return {
            "score": score,
            "level": level,
            "reasons": sorted(set(reasons)),
        }


risk_analyzer = RiskAnalyzerService()
