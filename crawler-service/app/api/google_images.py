from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.google_images_service import collect_google_images

router = APIRouter()


class GoogleImagesRequest(BaseModel):
    queries: list[str] = Field(default_factory=list)
    max_images_per_query: int = 120
    max_queries: int = 12


@router.post("/google-images")
async def google_images(payload: GoogleImagesRequest):
    result = await collect_google_images(
        payload.queries,
        max_images_per_query=payload.max_images_per_query,
        max_queries=payload.max_queries,
    )
    return result
