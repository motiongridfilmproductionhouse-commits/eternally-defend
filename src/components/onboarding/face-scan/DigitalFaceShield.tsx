import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, ScanFace } from "lucide-react";
import { getFaceProtectionStats } from "@/lib/face-scan.functions";
import { listProtectedFaces } from "@/lib/face-protection.functions";
import {
  SHIELD_STAGES,
  isShieldComplete,
  shieldProgress,
  shieldStatusLine,
  shieldTone,
  completedStages,
  type ShieldSignals,
} from "@/lib/onboarding/face-shield";
import { hasRealLandmarks } from "@/lib/onboarding/face-scan-progress";
import { FaceScanRing } from "./FaceScanRing";
import { FaceMeshOverlay } from "./FaceMeshOverlay";

/**
 * DIGITAL FACE SHIELD — a post-enrollment protection visualization.
 * It does not perform or alter AWS enrollment: it renders the already
 * enrolled reference face plus real protection status from the backend.
 */
export function DigitalFaceShield({
  referenceImage,
  landmarks,
  onComplete,
}: {
  referenceImage: string | null | undefined;
  landmarks: unknown;
  onComplete?: () => void;
}) {
  const facesFn = useServerFn(listProtectedFaces);
  const statsFn = useServerFn(getFaceProtectionStats);

  const facesQuery = useQuery({ queryKey: ["shield-protected-faces"], queryFn: () => facesFn() });
  const statsQuery = useQuery({ queryKey: ["shield-protection-stats"], queryFn: () => statsFn() });

  // The mesh stage resolves once the real landmark payload has been evaluated
  // (present or explicitly absent) and its animation has been rendered.
  const [meshResolved, setMeshResolved] = useState(false);
  const meshReal = hasRealLandmarks(landmarks);
  useEffect(() => {
    if (!referenceImage) return;
    const edges = meshReal ? 1400 : 400;
    const t = setTimeout(() => setMeshResolved(true), edges);
    return () => clearTimeout(t);
  }, [referenceImage, meshReal]);

  const signals: ShieldSignals = {
    hasReferenceImage: !!referenceImage,
    meshResolved,
    protectedFaces: facesQuery.data ? facesQuery.data.length : null,
    statusChecked: !!statsQuery.data,
  };

  const stats = statsQuery.data;
  const threats = stats
    ? {
        confirmedThreats:
          (stats.impersonationAlerts7d ?? 0) + (stats.fakeEndorsements7d ?? 0),
        pendingReview: stats.faceMatches24h ?? 0,
      }
    : null;

  const progress = shieldProgress(signals);
  const complete = isShieldComplete(signals);
  const tone = shieldTone(signals, threats);
  const status = shieldStatusLine(signals, threats);
  const done = completedStages(signals);

  useEffect(() => {
    if (complete) onComplete?.();
  }, [complete, onComplete]);

  const ringTone = tone === "red" ? "amber" : tone === "cyan" ? "cyan" : tone;
  const accent =
    tone === "red"
      ? "text-red-400"
      : tone === "amber"
        ? "text-amber-300"
        : tone === "emerald"
          ? "text-emerald-400"
          : "text-sky-400";
  const scanColor =
    tone === "red"
      ? "rgb(248 113 113)"
      : tone === "amber"
        ? "rgb(251 191 36)"
        : tone === "emerald"
          ? "rgb(52 211 153)"
          : "rgb(56 189 248)";

  return (
    <div className="space-y-6" data-testid="digital-face-shield">
      <div className="relative">
        <FaceScanRing progress={progress} tone={ringTone as never} active={!complete}>
          {referenceImage ? (
            <div className="relative size-full">
              <img
                src={referenceImage}
                alt="Your protected facial reference"
                className="size-full object-cover"
              />
              <FaceMeshOverlay landmarks={landmarks} pulse />
              <div
                className="pointer-events-none absolute inset-x-0 h-14 face-scan-sweep"
                style={{
                  background: `linear-gradient(to bottom, transparent, ${scanColor}66, transparent)`,
                  animationPlayState: complete ? "paused" : "running",
                }}
              />
              <div
                className="pointer-events-none absolute inset-0"
                style={{ boxShadow: `inset 0 0 60px -18px ${scanColor}` }}
              />
            </div>
          ) : (
            <div className="grid place-items-center size-full">
              <ScanFace className="size-16 text-sky-400/70" />
            </div>
          )}
        </FaceScanRing>
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span
            className={`rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[10px] font-mono tracking-[0.2em] ${accent}`}
          >
            DIGITAL FACE SHIELD
          </span>
        </div>
      </div>

      <div className="max-w-sm mx-auto text-center space-y-1">
        <div className={`flex items-center justify-center gap-2 text-sm font-semibold ${accent}`}>
          {complete ? (
            tone === "red" || tone === "amber" ? (
              <ShieldAlert className="size-4" />
            ) : (
              <ShieldCheck className="size-4" />
            )
          ) : (
            <Loader2 className="size-4 animate-spin" />
          )}
          {status.headline}
        </div>
        <p className="text-xs text-white/55">{status.detail}</p>
      </div>

      <div className="max-w-sm mx-auto space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-4">
        {SHIELD_STAGES.map((s) => {
          const isDone = done.includes(s.id);
          return (
            <div key={s.id} className="flex items-center gap-2 text-sm">
              {isDone ? (
                <CheckCircle2 className="size-4 text-emerald-400" />
              ) : (
                <Loader2 className="size-4 animate-spin text-sky-400/70" />
              )}
              <span className={isDone ? "text-white/80" : "text-white/45"}>{s.label}</span>
            </div>
          );
        })}
        <p className="pt-1 text-[11px] text-white/40">
          {meshReal
            ? "Facial map rendered from AWS Rekognition landmark coordinates."
            : "AWS returned no landmark coordinates for this capture, so no facial map is drawn."}
        </p>
        {stats && (
          <p className="text-[11px] text-white/40">
            Protected references: {stats.protectedFaces} · Matches in last 24h:{" "}
            {stats.faceMatches24h} · Confirmed misuse cases (7d):{" "}
            {(stats.impersonationAlerts7d ?? 0) + (stats.fakeEndorsements7d ?? 0)}
          </p>
        )}
      </div>
    </div>
  );
}
