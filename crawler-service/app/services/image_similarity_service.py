import imagehash


class ImageSimilarityService:

    def compare(self, hash1: str, hash2: str):

        h1 = imagehash.hex_to_hash(hash1)
        h2 = imagehash.hex_to_hash(hash2)

        distance = int(h1 - h2)

        similarity = float(round((64 - distance) / 64 * 100, 2))

        return {
            "distance": distance,
            "similarity": similarity,
        }


image_similarity_service = ImageSimilarityService()
