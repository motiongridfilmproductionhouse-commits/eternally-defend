import { useState, lazy, Suspense, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import "@aws-amplify/ui-react-liveness/styles.css";
import {
  Loader2,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  CheckCircle2,
  RefreshCcw,
  Trash2,
  Clock,
  AlertTriangle,
  Camera,
  Lock,
  ScanFace,
} from "lucide-react";
import {
  recordBiometricConsent,
  createLivenessSession,
  finalizeLiveness,
  revokeBiometrics,
  deferFaceEnrollment,
  resumeFaceEnrollment,
} from "@/lib/onboarding/face-enrollment.functions";
import {
  isScanActive,
  milestoneProgress,
  hasRealLandmarks,
  SCAN_GUIDANCE,
  type FaceScanMilestone,
} from "@/lib/onboarding/face-scan-progress";
import { FaceScanRing } from "./face-scan/FaceScanRing";
import { FaceMeshOverlay } from "./face-scan/FaceMeshOverlay";
import { useCameraPreview } from "./face-scan/useCameraPreview";

const LazyFaceLivenessDetector = lazy(async () => {
  const { FaceLivenessDetectorCore } = await import("@aws-amplify/ui-react-liveness");
  return { default: FaceLivenessDetectorCore };
});

const CONSENT_VERSION = "1.0";

const CONSENTS = [
  {
    id: "processing",
    text: "I consent to the collection, processing, and storage of my biometric data (facial geometry) for the sole purpose of identity verification and digital impersonation protection.",
  },
  {
    id: "usage",
    text: "I understand that my verified face profile will be used as a secure reference to monitor, detect, and enforce against unauthorized use of my likeness across digital platforms.",
  },
  {
    id: "revocable",
    text: "I acknowledge that I can revoke this consent and request the deletion of my biometric data at any time from my account settings.",
  },
  {
    id: "own_face",
    text: "I confirm that I am enrolling my own face, and I am the legal owner of the identity being protected.",
  },
] as const;

type EnrollResult = {
  confidence: number;
  landmarks?: unknown;
  referenceImage?: string | null;
  quality?: { sharpness?: number; brightness?: number } | null;
};

const PRIVACY_NOTE = "Your camera is used only for face protection enrollment.";

function ScanShell({
  title,
  subtitle,
  children,
  footer,
  tone = "default",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  tone?: "default" | "success" | "error";
}) {
  const border =
    tone === "success"
      ? "border-emerald-500/30"
      : tone === "error"
        ? "border-amber-500/30"
        : "border-white/10";
  return (
    <Card className={`bg-[#050A18] ${border} text-white shadow-2xl shadow-black/60 overflow-hidden`}>
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-xl sm:text-2xl tracking-tight">{title}</CardTitle>
        {subtitle && <CardDescription className="text-white/55">{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-6 pb-8">
        {children}
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-white/40">
          <Lock className="size-3" /> {PRIVACY_NOTE}
        </p>
        {footer}
      </CardContent>
    </Card>
  );
}

export function FaceEnrollmentStep({
  enrollmentStatus,
  isKycApproved,
  onRefetch,
  onBack,
  onNext,
  onDefer,
}: {
  enrollmentStatus: any;
  isKycApproved: boolean;
  onRefetch: () => Promise<void>;
  onBack: () => void;
  onNext: () => void;
  onDefer: () => void;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({
    processing: false,
    usage: false,
    revocable: false,
    own_face: false,
  });
  const [technicalError, setTechnicalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [milestone, setMilestone] = useState<FaceScanMilestone>("idle");
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [livenessData, setLivenessData] = useState<{
    sessionId: string;
    region: string;
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
      expiration: string;
    };
  } | null>(null);
  const [processingText, setProcessingText] = useState("");

  const camera = useCameraPreview();

  const recordConsent = useServerFn(recordBiometricConsent);
  const createSession = useServerFn(createLivenessSession);
  const finalize = useServerFn(finalizeLiveness);
  const revoke = useServerFn(revokeBiometrics);
  const defer = useServerFn(deferFaceEnrollment);
  const resume = useServerFn(resumeFaceEnrollment);

  const status = enrollmentStatus?.status ?? "CONSENT_REQUIRED";
  const allChecked = CONSENTS.every((c) => checks[c.id as keyof typeof checks]);

  useEffect(() => {
    if (status === "FACE_VERIFIED") setMilestone("enrolled");
  }, [status]);

  const handleResume = async () => {
    setBusy(true);
    setTechnicalError(null);
    setProcessingText("Preparing face scan...");
    try {
      await resume();
      await onRefetch();
      toast.success("Face Protection ready. Please complete the scan.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to resume face enrollment");
    } finally {
      setBusy(false);
      setProcessingText("");
    }
  };

  const handleDefer = async () => {
    if (!isKycApproved) {
      toast.error("Complete Identity Verification first.");
      return;
    }
    setBusy(true);
    try {
      await defer();
      await onRefetch();
      toast.success("Face Protection deferred. You can complete it later from your dashboard.");
      onDefer();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to defer face protection");
    } finally {
      setBusy(false);
    }
  };

  const handleConsent = async () => {
    setBusy(true);
    setProcessingText("Saving consent...");
    try {
      await recordConsent({ data: { consents: checks, consent_version: CONSENT_VERSION } });
      toast.success("Biometric consent recorded securely.");
      await onRefetch();
    } catch (e: any) {
      const isTech = /temporarily unavailable|permissions|credential|region|expired|throttl/i.test(
        String(e?.message),
      );
      if (isTech) setTechnicalError(e.message);
      toast.error(e?.message ?? "Failed to save consent");
    } finally {
      setBusy(false);
      setProcessingText("");
    }
  };

  const startLiveness = async () => {
    setBusy(true);
    setTechnicalError(null);
    setProcessingText("Creating secure session...");
    try {
      const data = await createSession();
      camera.stop(); // release preview so AWS detector owns the camera
      setMilestone("session_created");
      setLivenessData({
        sessionId: data.sessionId,
        region: data.region ?? "us-east-1",
        credentials: data.credentials,
      });
      setMilestone("liveness_capturing");
      await onRefetch();
    } catch (e: any) {
      const isTech = /temporarily unavailable|permissions|credential|region|expired|throttl/i.test(
        String(e?.message),
      );
      if (isTech) setTechnicalError(e.message);
      setMilestone("failed");
      toast.error(e?.message ?? "Failed to start liveness session");
    } finally {
      setBusy(false);
      setProcessingText("");
    }
  };

  const handleEnableCamera = async () => {
    const ok = await camera.start();
    if (ok) setMilestone("camera_ready");
  };

  const handleAnalysisComplete = async () => {
    if (!livenessData) return;
    setBusy(true);
    setMilestone("liveness_analyzed");
    setProcessingText("Registering protected facial reference");
    try {
      setMilestone("indexing");
      const res: any = await finalize({ data: { sessionId: livenessData.sessionId } });
      if (res.ok) {
        setResult({
          confidence: res.confidence,
          landmarks: res.landmarks,
          referenceImage: res.referenceImage ?? null,
          quality: res.quality ?? null,
        });
        setMilestone("enrolled");
        setLivenessData(null);
        await onRefetch();
      } else {
        const reason = res.reason || "Face enrollment couldn't be completed. Please try again.";
        if (res.technical) setTechnicalError(reason);
        setMilestone("failed");
        toast.error(reason);
        setLivenessData(null);
        await onRefetch();
      }
    } catch (e: any) {
      const msg = e?.message ?? "Face enrollment couldn't be completed. Please try again.";
      setTechnicalError(msg);
      setMilestone("failed");
      toast.error(msg);
      setLivenessData(null);
      await onRefetch();
    } finally {
      setBusy(false);
      setProcessingText("");
    }
  };

  const handleRevoke = async () => {
    if (
      !confirm(
        "Are you sure you want to revoke consent and delete your biometric data? This will disable face protection features.",
      )
    )
      return;
    setBusy(true);
    try {
      await revoke();
      setChecks({ processing: false, usage: false, revocable: false, own_face: false });
      setLivenessData(null);
      setResult(null);
      setMilestone("idle");
      await onRefetch();
      toast.success("Biometric data and consent revoked successfully.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to revoke biometrics");
    } finally {
      setBusy(false);
    }
  };

  // 0. Deferred
  if (status === "DEFERRED") {
    return (
      <ScanShell
        title="Face Protection Deferred"
        subtitle="You chose to complete Face Protection later. You can finish now or complete it from your dashboard."
        tone="error"
        footer={
          <div className="flex flex-col sm:flex-row justify-between gap-2">
            <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
              <ChevronLeft className="size-4 mr-1" /> Back
            </Button>
            <div className="flex gap-2">
              <Button
                onClick={handleResume}
                disabled={busy}
                className="bg-blue-600 hover:bg-blue-500 text-white border-0"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <ShieldCheck className="size-4 mr-2" />
                )}
                Start Face Scan Now
              </Button>
              <Button
                onClick={onNext}
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
              >
                Continue <ChevronRight className="size-4 ml-1" />
              </Button>
            </div>
          </div>
        }
      >
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-white/70">
          Deepfake and impersonation detection tied to your face will remain{" "}
          <span className="text-amber-300 font-medium">inactive</span> until you complete enrollment.
        </div>
      </ScanShell>
    );
  }

  // 1. Consent
  if (status === "CONSENT_REQUIRED" || status === "DELETED") {
    return (
      <ScanShell
        title="Biometric Protection Consent"
        subtitle="To scan the internet for impersonation and deepfakes, Eterna creates a secure facial reference."
        footer={
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
              <ChevronLeft className="size-4 mr-1" /> Back
            </Button>
            <div className="flex gap-2">
              {isKycApproved && (
                <Button
                  variant="outline"
                  onClick={handleDefer}
                  disabled={busy}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  <Clock className="size-4 mr-1" /> Do It Later
                </Button>
              )}
              <Button
                disabled={!allChecked || busy}
                onClick={handleConsent}
                className="bg-blue-600 hover:bg-blue-500 text-white border-0"
              >
                {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Continue <ChevronRight className="size-4 ml-1" />
              </Button>
            </div>
          </div>
        }
      >
        {technicalError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{technicalError}</span>
          </div>
        )}
        <div className="space-y-3 bg-white/[0.04] border border-white/10 p-4 rounded-xl">
          {CONSENTS.map((c) => (
            <label
              key={c.id}
              className="flex gap-3 items-start cursor-pointer hover:bg-white/5 p-2 rounded-md transition-colors"
            >
              <Checkbox
                checked={checks[c.id]}
                onCheckedChange={(v) => setChecks({ ...checks, [c.id]: !!v })}
                className="mt-0.5 border-white/30 data-[state=checked]:bg-blue-500 data-[state=checked]:text-white"
              />
              <span className="text-sm text-white/80 leading-relaxed">{c.text}</span>
            </label>
          ))}
        </div>
      </ScanShell>
    );
  }

  // 2. Active AWS liveness capture
  if (livenessData && !busy) {
    const credentialProvider = async () => {
      if (!livenessData.credentials) throw new Error("Temporary credentials not available");
      return {
        accessKeyId: livenessData.credentials.accessKeyId,
        secretAccessKey: livenessData.credentials.secretAccessKey,
        sessionToken: livenessData.credentials.sessionToken,
        expiration: new Date(livenessData.credentials.expiration),
      };
    };

    return (
      <ScanShell
        title="360° Face Enrollment"
        subtitle={SCAN_GUIDANCE.liveness_capturing}
        footer={
          <p className="text-center text-[11px] text-white/40">
            Progress advances only when AWS confirms each capture stage.
          </p>
        }
      >
        <div className="rounded-2xl border border-sky-500/20 bg-black overflow-hidden">
          <div className="w-full max-w-lg mx-auto relative h-[560px] bg-black">
            <Suspense
              fallback={
                <div className="flex flex-col items-center justify-center h-full text-white space-y-2">
                  <Loader2 className="size-8 animate-spin text-sky-400" />
                  <p className="text-xs text-white/60">Initializing camera...</p>
                </div>
              }
            >
              <LazyFaceLivenessDetector
                sessionId={livenessData.sessionId}
                region={livenessData.region}
                config={{ credentialProvider }}
                onAnalysisComplete={handleAnalysisComplete}
                onError={(error) => {
                  const stateStr = String(error?.state ?? "");
                  const isCamera = /CAMERA|PERMISSION/i.test(stateStr);
                  setTechnicalError(
                    isCamera
                      ? "Camera access is required for face protection enrollment. Enable camera permission and try again."
                      : "Face enrollment couldn't be completed. Please try again.",
                  );
                  setMilestone("failed");
                  toast.error(`Scanner error: ${stateStr || "unknown"}`);
                  setLivenessData(null);
                  onRefetch();
                }}
              />
            </Suspense>
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-white/50">
          <ScanFace className="size-3.5 text-sky-400" /> Keep your face centered and follow the
          on-screen prompts.
        </div>
      </ScanShell>
    );
  }

  // 3. Processing (real backend stages)
  if (busy && isScanActive(milestone)) {
    const stages = [
      { label: "Liveness capture completed", done: true },
      {
        label: "Image quality validated",
        done: milestone === "indexing" || milestone === "enrolled",
      },
      { label: "Facial reference generated", done: milestone === "enrolled" },
      { label: "Protection enrollment registered", done: milestone === "enrolled" },
    ];
    return (
      <ScanShell title="Registering protected facial reference" subtitle={processingText || undefined}>
        <FaceScanRing progress={milestoneProgress(milestone)} active>
          <div className="grid place-items-center size-full">
            <ScanFace className="size-16 text-sky-400/70" />
          </div>
        </FaceScanRing>
        <div className="max-w-sm mx-auto space-y-2">
          {stages.map((s) => (
            <div key={s.label} className="flex items-center gap-2 text-sm">
              {s.done ? (
                <CheckCircle2 className="size-4 text-emerald-400" />
              ) : (
                <Loader2 className="size-4 animate-spin text-sky-400/70" />
              )}
              <span className={s.done ? "text-white/80" : "text-white/45"}>{s.label}</span>
            </div>
          ))}
        </div>
      </ScanShell>
    );
  }

  if (busy) {
    return (
      <ScanShell title="Preparing secure scan" subtitle={processingText || undefined}>
        <FaceScanRing progress={milestoneProgress(milestone)} active>
          <div className="grid place-items-center size-full">
            <Loader2 className="size-10 animate-spin text-sky-400" />
          </div>
        </FaceScanRing>
      </ScanShell>
    );
  }

  // 4. Success — only reached from a real backend FACE_VERIFIED result
  if (status === "FACE_VERIFIED") {
    const landmarksReal = hasRealLandmarks(result?.landmarks);
    return (
      <ScanShell
        title="Face Protection Registered"
        subtitle="Your facial reference has been securely enrolled for identity protection."
        tone="success"
        footer={
          <div className="flex flex-col sm:flex-row gap-3 justify-between">
            <Button
              variant="ghost"
              onClick={handleRevoke}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs"
            >
              <Trash2 className="size-3.5 mr-1" /> Revoke Consent & Delete
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={onBack}
                className="border-white/20 text-white hover:bg-white/10"
              >
                <ChevronLeft className="size-4 mr-1" /> Back
              </Button>
              <Button
                onClick={onNext}
                data-testid="face-continue"
                className="bg-blue-600 hover:bg-blue-500 text-white border-0"
              >
                Continue <ChevronRight className="size-4 ml-1" />
              </Button>
            </div>
          </div>
        }
      >
        <div className="relative">
          <FaceScanRing progress={100} tone="emerald">
            {result?.referenceImage ? (
              <div className="relative size-full">
                <img
                  src={result.referenceImage}
                  alt="Your enrolled facial reference"
                  className="size-full object-cover"
                />
                <FaceMeshOverlay landmarks={result.landmarks} pulse />
              </div>
            ) : (
              <div className="grid place-items-center size-full">
                <ShieldCheck className="size-16 text-emerald-400" />
              </div>
            )}
          </FaceScanRing>
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="size-24 rounded-full border border-emerald-400/40 face-success-pulse" />
          </div>
        </div>

        <div className="max-w-sm mx-auto space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <Row label="Face detected & indexed (AWS Rekognition)" />
          <Row label="Liveness verified by AWS Face Liveness" />
          {typeof result?.confidence === "number" && (
            <Row label={`Liveness confidence ${result.confidence.toFixed(1)}%`} />
          )}
          <Row label="Protected face profile created" />
          <p className="pt-1 text-[11px] text-white/40">
            {landmarksReal
              ? "Facial map rendered from AWS Rekognition landmark coordinates."
              : "Facial landmark coordinates were not returned for this capture, so no facial map is displayed."}
          </p>
        </div>
      </ScanShell>
    );
  }

  // 5. Ready to scan / retry
  const failed = !!technicalError || status === "LIVENESS_FAILED" || status === "QUALITY_FAILED";
  const failureMessage =
    technicalError ||
    enrollmentStatus?.failure_reason ||
    "Face enrollment couldn't be completed. Please try again.";

  return (
    <ScanShell
      title="Face Protection Enrollment"
      subtitle="Create your protected facial reference"
      tone={failed ? "error" : "default"}
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="size-4 mr-1" /> Back
          </Button>
          <div className="flex gap-2">
            {isKycApproved && (
              <Button
                variant="outline"
                onClick={handleDefer}
                disabled={busy}
                className="border-white/20 text-white hover:bg-white/10"
              >
                <Clock className="size-4 mr-1" /> Do It Later
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={handleRevoke}
              className="text-white/40 hover:text-red-400 hover:bg-white/5 text-xs"
            >
              Revoke Consent
            </Button>
          </div>
        </div>
      }
    >
      {failed && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex gap-2 max-w-md mx-auto">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {enrollmentStatus?.failure_code && (
              <div className="font-mono text-[10px] opacity-70">{enrollmentStatus.failure_code}</div>
            )}
            <div>{failureMessage}</div>
          </div>
        </div>
      )}

      <FaceScanRing progress={milestoneProgress(milestone)} active={camera.state === "ready"}>
        <video
          ref={camera.videoRef}
          playsInline
          muted
          autoPlay
          className={`size-full object-cover scale-x-[-1] ${camera.state === "ready" ? "" : "opacity-0"}`}
        />
        {camera.state !== "ready" && (
          <div className="absolute inset-0 grid place-items-center text-center px-6">
            {camera.state === "requesting" ? (
              <Loader2 className="size-8 animate-spin text-sky-400" />
            ) : camera.state === "denied" ? (
              <p className="text-xs text-amber-200">
                Camera access is required for face protection enrollment.
              </p>
            ) : (
              <ScanFace className="size-14 text-sky-400/50" />
            )}
          </div>
        )}
      </FaceScanRing>

      <div className="text-center space-y-1">
        <p className="text-sm text-white/80">Position your face inside the circle</p>
        <p className="text-xs text-white/45 max-w-sm mx-auto">
          Keep your face centered and slowly turn your head as instructed.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
        {camera.state !== "ready" && (
          <Button
            onClick={handleEnableCamera}
            variant="outline"
            className="border-sky-500/30 bg-slate-950/60 text-sky-50 hover:bg-sky-950/40 hover:border-sky-400/40"
          >
            <Camera className="size-4 mr-2" />
            {camera.state === "denied" ? "Retry camera access" : "Enable camera preview"}
          </Button>
        )}
        <Button
          onClick={startLiveness}
          data-testid="start-face-scan"
          className="bg-sky-600 hover:bg-sky-500 text-white border-0"
        >
          {failed ? (
            <>
              <RefreshCcw className="size-4 mr-2" /> Retry Face Scan
            </>
          ) : (
            <>
              <ScanFace className="size-4 mr-2" /> Start Face Scan
            </>
          )}
        </Button>
      </div>
    </ScanShell>
  );
}

function Row({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-white/80">
      <CheckCircle2 className="size-4 text-emerald-400 shrink-0" /> {label}
    </div>
  );
}
