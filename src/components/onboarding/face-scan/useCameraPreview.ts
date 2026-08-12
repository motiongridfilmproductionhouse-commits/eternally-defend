import { useCallback, useEffect, useRef, useState } from "react";

export type CameraState = "idle" | "requesting" | "ready" | "denied" | "unavailable";

export type CameraDiagnostics = {
  errorName?: string;
  errorMessage?: string;
  /** Running inside an iframe whose permissions policy blocks the camera. */
  blockedByFrame: boolean;
  /** Page is not a secure context (getUserMedia is unavailable). */
  insecureContext: boolean;
};

function detectFrameBlock(): boolean {
  if (typeof window === "undefined") return false;
  let inFrame = false;
  try {
    inFrame = window.self !== window.top;
  } catch {
    inFrame = true;
  }
  if (!inFrame) return false;
  // If the Permissions Policy API is available, trust it.
  const anyDoc = document as any;
  if (typeof anyDoc.featurePolicy?.allowsFeature === "function") {
    try {
      return !anyDoc.featurePolicy.allowsFeature("camera");
    } catch {
      /* ignore */
    }
  }
  return true;
}

/**
 * Local preview only (Phase 1). The stream is released before the AWS liveness
 * detector mounts so it can take exclusive control of the camera.
 */
export function useCameraPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [diagnostics, setDiagnostics] = useState<CameraDiagnostics>({
    blockedByFrame: false,
    insecureContext: false,
  });

  const stop = useCallback(() => {
    const tracks = streamRef.current?.getTracks() ?? [];
    tracks.forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    const insecureContext =
      typeof window !== "undefined" && typeof window.isSecureContext === "boolean"
        ? !window.isSecureContext
        : false;
    const blockedByFrame = detectFrameBlock();

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setDiagnostics({ blockedByFrame, insecureContext, errorName: "Unavailable" });
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
      setDiagnostics({ blockedByFrame: false, insecureContext: false });
      setState("ready");
      return true;
    } catch (err: any) {
      setDiagnostics({
        blockedByFrame,
        insecureContext,
        errorName: err?.name,
        errorMessage: err?.message,
      });
      setState("denied");
      return false;
    }
  }, []);

  useEffect(() => stop, [stop]);

  return { videoRef, state, start, stop, diagnostics };
}
