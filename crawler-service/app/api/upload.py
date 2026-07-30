from fastapi import APIRouter, UploadFile, File
from app.services.upload_service import upload_service

router = APIRouter()

@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    return await upload_service.save(file)
