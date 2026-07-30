from PIL import Image
import imagehash


class ImageHashService:

    def generate(self, image_path: str):

        image = Image.open(image_path)

        return {
            "phash": str(imagehash.phash(image)),
            "average_hash": str(imagehash.average_hash(image)),
            "dhash": str(imagehash.dhash(image)),
            "whash": str(imagehash.whash(image)),
            "width": image.width,
            "height": image.height,
        }


image_hash_service = ImageHashService()
