import re


class ImageExtractorService:
    IMAGE_REGEX = r'https?://[^\s")]+?\.(?:jpg|jpeg|png|webp|gif)'

    def extract(self, markdown: str):
        urls = re.findall(self.IMAGE_REGEX, markdown or "")
        return list(dict.fromkeys(urls))


image_extractor_service = ImageExtractorService()
