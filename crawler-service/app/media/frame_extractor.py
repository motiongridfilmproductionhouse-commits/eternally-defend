"""Video keyframe extraction + per-frame perceptual hashing.

Uploaded/observed videos are reduced to a small set of representative frames
(uniform sampling plus scene-change frames). Each frame gets real perceptual
hashes (pHash / dHash / aHash via ImageHash) so a re-upload, crop, mirror or
cam-recording can be matched frame-to-frame against a protected original.

No audio fingerprinting here — frames only.
"""

from __future__ import annotations

import hashlib
import math
import os
import tempfile
from dataclasses import dataclass, asdict

import cv2
import imagehash
import numpy as np
from PIL import Image


@dataclass
class FrameHash:
    frame_index: int
    timestamp_seconds: float
    phash: str
    dhash: str
    ahash: str
    whash: str
    sha256: str
    width: int
    height: int
    scene_change: bool


def _hash_frame(frame_bgr, frame_index: int, timestamp: float, scene_change: bool) -> FrameHash:
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    image = Image.fromarray(rgb)
    height, width = frame_bgr.shape[:2]
    return FrameHash(
        frame_index=frame_index,
        timestamp_seconds=round(float(timestamp), 3),
        phash=str(imagehash.phash(image)),
        dhash=str(imagehash.dhash(image)),
        ahash=str(imagehash.average_hash(image)),
        whash=str(imagehash.whash(image)),
        sha256=hashlib.sha256(rgb.tobytes()).hexdigest(),
        width=int(width),
        height=int(height),
        scene_change=scene_change,
    )


def _histogram(frame_bgr) -> np.ndarray:
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    hist = cv2.calcHist([gray], [0], None, [64], [0, 256])
    cv2.normalize(hist, hist)
    return hist.flatten()


def extract_keyframes(
    video_path: str,
    max_frames: int = 40,
    min_interval_seconds: float = 1.0,
    scene_threshold: float = 0.35,
) -> dict:
    """Sample keyframes from a video file and hash each one."""

    if not os.path.exists(video_path):
        raise FileNotFoundError(video_path)

    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        raise ValueError("Video could not be opened / decoded")

    fps = capture.get(cv2.CAP_PROP_FPS) or 0.0
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if fps <= 0 or math.isnan(fps):
        fps = 25.0
    duration = (total_frames / fps) if total_frames else 0.0

    # Uniform sampling stride, but never denser than min_interval_seconds.
    if total_frames and max_frames:
        stride = max(int(total_frames / max_frames), int(fps * min_interval_seconds), 1)
    else:
        stride = max(int(fps * min_interval_seconds), 1)

    frames: list[FrameHash] = []
    previous_hist = None
    index = -1

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        index += 1

        hist = _histogram(frame)
        scene_change = False
        if previous_hist is not None:
            # Correlation drop => scene cut.
            correlation = float(np.dot(previous_hist, hist) /
                               ((np.linalg.norm(previous_hist) * np.linalg.norm(hist)) or 1.0))
            scene_change = (1.0 - correlation) > scene_threshold
        previous_hist = hist

        take = (index % stride == 0) or scene_change
        if not take:
            continue

        timestamp = index / fps
        frames.append(_hash_frame(frame, index, timestamp, scene_change))
        if len(frames) >= max_frames:
            break

    capture.release()

    if not frames:
        raise ValueError("No decodable frames found in video")

    return {
        "fps": round(float(fps), 3),
        "duration_seconds": round(float(duration), 3),
        "total_frames": total_frames,
        "sampled_frames": len(frames),
        "stride_frames": stride,
        "algorithms": ["phash", "dhash", "average_hash", "whash"],
        "frames": [asdict(frame) for frame in frames],
    }


def extract_keyframes_from_bytes(data: bytes, suffix: str = ".mp4", **kwargs) -> dict:
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        temp.write(data)
        temp.close()
        return extract_keyframes(temp.name, **kwargs)
    finally:
        if os.path.exists(temp.name):
            os.remove(temp.name)
