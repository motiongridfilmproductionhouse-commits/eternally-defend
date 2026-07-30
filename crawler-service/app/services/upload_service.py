import os
import uuid

from fastapi import UploadFile

from app.services.fingerprint_service import fingerprint_service
from app.services.query_generator_service import query_generator_service


class UploadService:

    async def save(self, file: UploadFile):

        os.makedirs("uploads", exist_ok=True)

        asset_id = str(uuid.uuid4())

        filepath = f"uploads/{asset_id}_{file.filename}"

        with open(filepath, "wb") as buffer:
            buffer.write(await file.read())

        fingerprint = fingerprint_service.generate(filepath)

        queries = query_generator_service.generate(file.filename)

        return {
            "asset_id": asset_id,
            "filename": file.filename,
            "path": filepath,
            "fingerprint": fingerprint,
            "queries": queries,
            "status": "uploaded"
        }


upload_service = UploadService()
