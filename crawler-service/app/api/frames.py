from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import httpx

from app.media.frame_extractor import extract_keyframes_from_bytes

router = APIRouter()

MAX_BYTES = 200 * 1024 * 1024


class FramesUrlRequest(BaseModel):
    url: str
    max_frames: int = Field(default=40, ge=1, le=200)
    min_interval_seconds: float = Field(default=1.0, ge=0.1, le=30.0)
    # Off by default: existing callers (protected-asset fingerprinting) only
    # need hashes. Deepfake video-candidate face verification sets this to
    # true and should also pass a small max_frames (e.g. 5) to bound payload
    # size and downstream Rekognition/Vision cost.
    include_thumbnails: bool = False


@router.post("/frames")
async def frames_from_url(payload: FramesUrlRequest):
    """Download a video (e.g. a signed S3 URL) and return per-frame hashes."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=120.0) as client:
            response = await client.get(payload.url)
            response.raise_for_status()
            data = response.content
    except Exception as exc:  # network / http failure
        return JSONResponse({"error": f"download failed: {exc}"}, status_code=502)

    if not data:
        return JSONResponse({"error": "empty video body"}, status_code=400)
    if len(data) > MAX_BYTES:
        return JSONResponse({"error": "video too large"}, status_code=413)

    try:
        result = extract_keyframes_from_bytes(
            data,
            max_frames=payload.max_frames,
            min_interval_seconds=payload.min_interval_seconds,
            include_thumbnails=payload.include_thumbnails,
        )
    except Exception as exc:
        return JSONResponse({"error": f"extraction failed: {exc}"}, status_code=422)

    result["source_url"] = payload.url
    result["bytes"] = len(data)
    return result


@router.post("/frames/upload")
async def frames_from_upload(
    video: UploadFile = File(...),
    max_frames: int = Form(40),
    min_interval_seconds: float = Form(1.0),
):
    data = await video.read()
    if not data:
        return JSONResponse({"error": "empty upload"}, status_code=400)
    if len(data) > MAX_BYTES:
        return JSONResponse({"error": "video too large"}, status_code=413)
    try:
        result = extract_keyframes_from_bytes(
            data,
            suffix=f".{(video.filename or 'video.mp4').split('.')[-1]}",
            max_frames=max_frames,
            min_interval_seconds=min_interval_seconds,
        )
    except Exception as exc:
        return JSONResponse({"error": f"extraction failed: {exc}"}, status_code=422)
    result["filename"] = video.filename
    result["bytes"] = len(data)
    return result
