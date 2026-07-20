import { useState, lazy, Suspense } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import "@aws-amplify/ui-react-liveness/styles.css";
import { Loader2, ChevronRight, ChevronLeft, ShieldCheck, CheckCircle2, UserCircle, RefreshCcw, Trash2, Clock, AlertTriangle } from "lucide-react";
import {
  recordBiometricConsent,
  createLivenessSession,
  finalizeLiveness,
  revokeBiometrics,
  deferFaceEnrollment,
  resumeFaceEnrollment,
} from "@/lib/onboarding/face-enrollment.functions";

const LazyFaceLivenessDetector = lazy(async () => {
  const { FaceLivenessDetectorCore } = await import("@aws-amplify/ui-react-liveness");
  return { default: FaceLivenessDetectorCore };
});

const CONSENT_VERSION = "1.0";

const CONSENTS = [
  { id: "processing", text: "I consent to the collection, processing, and storage of my biometric data (facial geometry) for the sole purpose of identity verification and digital impersonation protection." },
  { id: "usage", text: "I understand that my verified face profile will be used as a secure reference to monitor, detect, and enforce against unauthorized use of my likeness across digital platforms." },
  { id: "revocable", text: "I acknowledge that I can revoke this consent and request the deletion of my biometric data at any time from my account settings." },
  { id: "own_face", text: "I confirm that I am enrolling my own face, and I am the legal owner of the identity being protected." }
] as const;

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
    processing: false, usage: false, revocable: false, own_face: false
  });
  const [technicalError, setTechnicalError] = useState<string | null>(null);
  
  const [busy, setBusy] = useState(false);
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

  const recordConsent = useServerFn(recordBiometricConsent);
  const createSession = useServerFn(createLivenessSession);
  const finalize = useServerFn(finalizeLiveness);
  const revoke = useServerFn(revokeBiometrics);
  const defer = useServerFn(deferFaceEnrollment);
  const resume = useServerFn(resumeFaceEnrollment);

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

  const status = enrollmentStatus?.status ?? "CONSENT_REQUIRED";
  const allChecked = CONSENTS.every((c) => checks[c.id as keyof typeof checks]);

  const handleConsent = async () => {
    setBusy(true);
    setProcessingText("Saving consent...");
    try {
      await recordConsent({ data: { consents: checks, consent_version: CONSENT_VERSION } });
      toast.success("Biometric consent recorded securely.");
      
      setProcessingText("Creating secure face session...");
      const data = await createSession();
      setLivenessData({
        sessionId: data.sessionId,
        region: data.region ?? "us-east-1",
        credentials: data.credentials
      });
      await onRefetch();
    } catch (e: any) {
      const isTech = /temporarily unavailable|permissions|credential|region|expired|throttl/i.test(String(e?.message));
      if (isTech) setTechnicalError(e.message);
      toast.error(e?.message ?? "Failed to save consent or start session");
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
      setLivenessData({
        sessionId: data.sessionId,
        region: data.region ?? "us-east-1",
        credentials: data.credentials
      });
      await onRefetch();
    } catch (e: any) {
      const isTech = /temporarily unavailable|permissions|credential|region|expired|throttl/i.test(String(e?.message));
      if (isTech) setTechnicalError(e.message);
      toast.error(e?.message ?? "Failed to start liveness session");
    } finally {
      setBusy(false);
      setProcessingText("");
    }
  };

  const handleAnalysisComplete = async () => {
    if (!livenessData) return;
    setBusy(true);
    setProcessingText("Analyzing liveness and securing face profile...");
    try {
      const res: any = await finalize({ data: { sessionId: livenessData.sessionId } });
      if (res.ok) {
        toast.success("Face Protection Profile established!");
        await onRefetch();
        onNext();
      } else {
        const reason = res.reason || "Liveness verification failed. Please try again.";
        if (res.technical) {
          setTechnicalError(reason);
        }
        toast.error(reason);
        setLivenessData(null);
        await onRefetch();
      }
    } catch (e: any) {
      const msg = e?.message ?? "Error finalizing liveness";
      setTechnicalError(msg);
      toast.error(msg);
      setLivenessData(null);
      await onRefetch();
    } finally {
      setBusy(false);
      setProcessingText("");
    }
  };

  const handleRevoke = async () => {
    if (!confirm("Are you sure you want to revoke consent and delete your biometric data? This will disable face protection features.")) return;
    setBusy(true);
    try {
      await revoke();
      setChecks({ processing: false, usage: false, revocable: false, own_face: false });
      setLivenessData(null);
      await onRefetch();
      toast.success("Biometric data and consent revoked successfully.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to revoke biometrics");
    } finally {
      setBusy(false);
    }
  };

  // 0. Deferred success screen
  if (status === "DEFERRED") {
    return (
      <Card className="bg-[#0A1128] border-amber-500/30 text-white shadow-2xl shadow-amber-500/10">
        <CardHeader>
          <CardTitle className="text-xl text-amber-300 flex items-center gap-2">
            <Clock className="size-5" /> Face Protection Deferred
          </CardTitle>
          <CardDescription className="text-white/60">
            You chose to complete Face Protection later. You can finish this at any time from your dashboard under "Complete Your Protection Setup".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-white/70">
            Deepfake and impersonation detection tied to your face will remain <span className="text-amber-300 font-medium">inactive</span> until you complete enrollment.
          </div>
          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
              <ChevronLeft className="size-4 mr-1" /> Back
            </Button>
            <Button onClick={onNext} className="bg-blue-600 hover:bg-blue-500 text-white border-0">
              Continue <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // 1. Consent Screen
  if (status === "CONSENT_REQUIRED" || status === "DELETED") {
    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
        <CardHeader>
          <CardTitle className="text-xl">Biometric Protection Consent</CardTitle>
          <CardDescription className="text-white/60">
            To actively scan the internet for impersonation and deepfakes, we need to create a secure, encrypted reference map of your face.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {technicalError && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>{technicalError}</span>
            </div>
          )}
          <div className="space-y-3 bg-white/5 border border-white/10 p-4 rounded-xl">
            {CONSENTS.map((c) => (
              <label key={c.id} className="flex gap-3 items-start cursor-pointer hover:bg-white/5 p-2 rounded-md transition-colors">
                <Checkbox 
                  checked={checks[c.id]} 
                  onCheckedChange={(v) => setChecks({ ...checks, [c.id]: !!v })} 
                  className="mt-0.5 border-white/30 data-[state=checked]:bg-blue-500 data-[state=checked]:text-white" 
                />
                <span className="text-sm text-white/80 leading-relaxed">{c.text}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap justify-between gap-2 pt-4">
            <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
              <ChevronLeft className="size-4 mr-1" /> Back
            </Button>
            <div className="flex gap-2">
              {isKycApproved && (
                <Button variant="outline" onClick={handleDefer} disabled={busy} className="border-white/20 text-white hover:bg-white/10">
                  <Clock className="size-4 mr-1" /> Do It Later
                </Button>
              )}
              <Button 
                disabled={!allChecked || busy} 
                onClick={handleConsent} 
                className="bg-blue-600 hover:bg-blue-500 text-white border-0"
              >
                {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Start Face Protection <ChevronRight className="size-4 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // 2. Active Liveness Scanner (AWS Component)
  if (livenessData && !busy) {
    const credentialProvider = async () => {
      if (!livenessData.credentials) {
        throw new Error("Temporary credentials not available");
      }
      return {
        accessKeyId: livenessData.credentials.accessKeyId,
        secretAccessKey: livenessData.credentials.secretAccessKey,
        sessionToken: livenessData.credentials.sessionToken,
        expiration: new Date(livenessData.credentials.expiration),
      };
    };

    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50 overflow-hidden">
        <CardContent className="p-0">
          <div className="w-full max-w-lg mx-auto relative h-[600px] bg-black">
            <Suspense fallback={<div className="flex flex-col items-center justify-center h-full text-white space-y-2"><Loader2 className="size-8 animate-spin text-blue-500" /><p className="text-xs text-white/60">Initializing camera...</p></div>}>
              <LazyFaceLivenessDetector
                sessionId={livenessData.sessionId}
                region={livenessData.region}
                config={{ credentialProvider }}
                onAnalysisComplete={handleAnalysisComplete}
                onError={(error) => {
                  const stateStr = String(error?.state ?? "");
                  const isTech = /CAMERA|PERMISSION|SERVER|TIMEOUT|CONNECTION/i.test(stateStr);
                  if (isTech) {
                    setTechnicalError("Face Protection is temporarily unavailable. You can retry or complete this setup later.");
                  }
                  toast.error(`Scanner error: ${stateStr || "unknown"}`);
                  setLivenessData(null);
                  onRefetch();
                }}
              />
            </Suspense>
          </div>
        </CardContent>
      </Card>
    );
  }

  // 3. Loading / Processing State
  if (busy) {
    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
        <CardContent className="p-12 flex flex-col items-center justify-center space-y-4">
          <div className="relative">
            <div className="size-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
            <ShieldCheck className="size-6 text-blue-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <p className="text-sm font-medium text-white/80">{processingText || "Processing..."}</p>
        </CardContent>
      </Card>
    );
  }

  // 4. Success State
  if (status === "FACE_VERIFIED") {
    return (
      <Card className="bg-[#0A1128] border-emerald-500/30 text-white shadow-2xl shadow-emerald-500/10">
        <CardHeader>
          <CardTitle className="text-xl text-emerald-400 flex items-center gap-2">
            <ShieldCheck className="size-6" /> Protected Face Profile Established
          </CardTitle>
          <CardDescription className="text-white/60">
            Your biometric reference has been securely encrypted and indexed. Eterna AI is now actively protecting your likeness.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="border border-white/10 rounded-xl p-6 bg-white/5 space-y-3">
            <div className="flex items-center gap-3 text-sm text-white/80">
              <CheckCircle2 className="size-5 text-emerald-400" /> Face Verified
            </div>
            <div className="flex items-center gap-3 text-sm text-white/80">
              <CheckCircle2 className="size-5 text-emerald-400" /> Real Human Verified
            </div>
            <div className="flex items-center gap-3 text-sm text-white/80">
              <CheckCircle2 className="size-5 text-emerald-400" /> Protected Face Profile Created
            </div>
            <div className="flex items-center gap-3 text-sm text-white/80">
              <CheckCircle2 className="size-5 text-emerald-400" /> Identity Protection Ready
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 justify-between pt-4">
            <Button variant="ghost" onClick={handleRevoke} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs">
              <Trash2 className="size-3.5 mr-1" /> Revoke Consent & Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onBack} className="border-white/20 text-white hover:bg-white/10">
                <ChevronLeft className="size-4 mr-1" /> Back
              </Button>
              <Button onClick={onNext} className="bg-blue-600 hover:bg-blue-500 text-white border-0">
                Continue <ChevronRight className="size-4 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // 5. Ready to Scan / Failed State
  const failedTech = !!technicalError;
  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
      <CardHeader>
        <CardTitle className="text-xl">
          {failedTech ? "Face Protection Temporarily Unavailable" : status === "LIVENESS_FAILED" || status === "QUALITY_FAILED" ? "Verification Failed" : "Biometric Scan Ready"}
        </CardTitle>
        <CardDescription className="text-white/60">
          {failedTech
            ? "Face Protection is temporarily unavailable. You can retry or complete this setup later."
            : status === "LIVENESS_FAILED" || status === "QUALITY_FAILED"
            ? (enrollmentStatus?.failure_reason ?? "We couldn't verify your liveness. Please ensure you are in a well-lit area and remove masks or heavy glasses.")
            : "Your consent is recorded. You are ready to perform the secure liveness scan."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {(failedTech || enrollmentStatus?.failure_code) && (enrollmentStatus?.failure_reason || technicalError) && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {enrollmentStatus?.failure_code && <div className="font-mono text-[10px] opacity-70">{enrollmentStatus.failure_code}</div>}
              <div>{technicalError || enrollmentStatus?.failure_reason}</div>
            </div>
          </div>
        )}
        <div className="border border-white/10 rounded-xl p-8 bg-white/5 flex flex-col items-center text-center space-y-4">
          <UserCircle className="size-16 text-blue-400/50" />
          <p className="text-sm text-white/70 max-w-sm">
            When you click start, your camera will activate. Center your face in the oval and follow the on-screen prompts.
          </p>
          <Button onClick={startLiveness} className="bg-blue-600 hover:bg-blue-500 text-white border-0 mt-2">
            {failedTech || status === "LIVENESS_FAILED" ? <><RefreshCcw className="size-4 mr-2" /> Retry Face Scan</> : "Start Liveness Scan"}
          </Button>
        </div>

        <div className="flex flex-wrap justify-between gap-2 pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="size-4 mr-1" /> Back
          </Button>
          <div className="flex gap-2">
            {isKycApproved && (
              <Button variant="outline" onClick={handleDefer} disabled={busy} className="border-white/20 text-white hover:bg-white/10">
                <Clock className="size-4 mr-1" /> Do It Later
              </Button>
            )}
            <Button variant="ghost" onClick={handleRevoke} className="text-white/40 hover:text-red-400 hover:bg-white/5 text-xs">
              Revoke Consent
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
