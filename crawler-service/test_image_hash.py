from app.services.image_hash_service import image_hash_service

result = image_hash_service.generate("images.jpeg")

print(result)
