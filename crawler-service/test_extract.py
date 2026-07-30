from app.services.image_extractor_service import image_extractor_service

markdown = """
https://upload.wikimedia.org/wikipedia/en/3/35/Amazing_Fantasy_15.jpg

https://upload.wikimedia.org/wikipedia/en/thumb/2/21/Web_of_Spider-Man_Vol_1_129-1.png
"""

print(image_extractor_service.extract(markdown))
