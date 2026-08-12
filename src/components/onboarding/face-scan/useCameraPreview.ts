import { useCallback, useEffect, useRef, useState } from "react";

export type CameraState = "idle" | "requesting" | "ready" | "denied" | "unavailable";

/**
 * Local preview only (Phase 1). The stream is released before the AWS liveness
 * detector mounts so it can take exclusive control of the camera.
 */
export function useCameraPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("idle");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return false;
    }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setState("ready");
      return true;
    } catch {
      setState("denied");
      return false;
    }
  }, []);

  useEffect(() => stop, [stop]);

  return { videoRef, state, start, stop };
}
