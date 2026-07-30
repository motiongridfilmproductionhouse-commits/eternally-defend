import os
import uuid
from fastapi import UploadFile

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

class UploadService:
    async def save(self, file: UploadFile):
        asset_id = str(uuid.uuid4())

        filename = f"{asset_id}_{file.filename}"
        filepath = os.path.join(UPLOAD_DIR, filename)

        contents = await file.read()

        with open(filepath, "wb") as f:
            f.write(contents)

        return {
            "asset_id": asset_id,
            "filename": filename,
            "path": filepath,
            "status": "uploaded"
        }

upload_service = UploadService()
