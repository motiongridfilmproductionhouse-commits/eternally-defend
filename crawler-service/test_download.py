import asyncio

from app.services.image_downloader_service import image_downloader_service


async def main():

    path = await image_downloader_service.download(
        "https://upload.wikimedia.org/wikipedia/en/0/0c/Spider-Man_No_Way_Home_poster.jpg"
    )

    print(path)


asyncio.run(main())
