import hashlib
import os

from PIL import Image
import imagehash


class FingerprintService:
    def generate(self, filepath: str):
        with open(filepath, "rb") as f:
            file_bytes = f.read()

        sha256 = hashlib.sha256(file_bytes).hexdigest()

        image = Image.open(filepath)

        phash = str(imagehash.phash(image))

        width, height = image.size

        size = os.path.getsize(filepath)

        return {
            "sha256": sha256,
            "phash": phash,
            "width": width,
            "height": height,
            "size": size,
        }


fingerprint_service = FingerprintService()
