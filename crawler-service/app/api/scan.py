from fastapi import APIRouter, UploadFile, File, Form
import tempfile
import shutil
import os

from app.services.discovery_service import discovery_service

router = APIRouter()


@router.post("/scan")
async def scan(
    queries: str = Form(...),
    reference_image: UploadFile = File(...),
):

    temp = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")

    try:
        shutil.copyfileobj(reference_image.file, temp)
        temp.close()

        query_list = [q.strip() for q in queries.split(",") if q.strip()]

        results = await discovery_service.discover(
            query_list,
            temp.name,
        )

        return {
            "total_queries": len(query_list),
            "results": results,
        }

    finally:
        if os.path.exists(temp.name):
            os.remove(temp.name)
