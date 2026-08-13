import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShieldCheck, ScanFace, AlertTriangle, Lock } from "lucide-react";
import "@aws-amplify/ui-react-liveness/styles.css";
import {
  getFaceHandoffSession,
  handoffRecordConsent,
  handoffCreateLivenessSession,
  handoffFinalizeLiveness,
} from "@/lib/onboarding/face-handoff.functions";

const LazyFaceLivenessDetector = lazy(async () => {
  const { FaceLivenessDetectorCore } = await import("@aws-amplify/ui-react-liveness");
  return { default: FaceLivenessDetectorCore };
});

const CONSENT_VERSION = "1.0";
const CONSENTS = [
  {
    id: "processing",
    text: "I consent to the collection, processing, and storage of my biometric data (facial geometry) for identity verification and digital impersonation protection.",
  },
  {
    id: "usage",
    text: "I understand my verified face profile is used as a secure reference to detect unauthorized use of my likeness.",
  },
  {
    id: "revocable",
    text: "I can revoke this consent and request deletion of my biometric data at any time.",
  },
  { id: "own_face", text: "I confirm I am enrolling my own face." },
] as const;

export const Route = createFileRoute("/face-handoff/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Secure Face Protection — Eterna Sentinel" },
      {
        name: "description",
        content:
          "Complete your Eterna Sentinel Face Protection enrollment securely on your phone using a one-time link.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Secure Face Protection — Eterna Sentinel" },
      {
        property: "og:description",
        content: "One-time secure mobile Face Protection enrollment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FaceHandoffPage,
});

type Phase = "loading" | "invalid" | "consent" | "ready" | "scanning" | "saving" | "done";

function FaceHandoffPage() {
  const { token } = Route.useParams();
  const resolve = useServerFn(getFaceHandoffSession);
  const consentFn = useServerFn(handoffRecordConsent);
  const createSession = useServerFn(handoffCreateLivenessSession);
  const finalize = useServerFn(handoffFinalizeLiveness);

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [liveness, setLiveness] = useState<{
    sessionId: string;
    region: string;
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
      expiration: string;
    };
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res: any = await resolve({ data: { token } });
      setName(res.displayName ?? null);
      if (res.enrollmentStatus === "FACE_VERIFIED") setPhase("done");
      else setPhase(res.needsConsent ? "consent" : "ready");
    } catch (e: any) {
      setError(String(e?.message ?? "This secure link is not valid.").replace(/^HANDOFF_\w+:\s*/, ""));
      setPhase("invalid");
    }
  }, [resolve, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const allChecked = CONSENTS.every((c) => checks[c.id]);

  const acceptConsent = async () => {
    setBusy(true);
    try {
      await consentFn({ data: { token, consents: checks, consent_version: CONSENT_VERSION } });
      setPhase("ready");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save consent");
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    setBusy(true);
    try {
      const data: any = await createSession({ data: { token } });
      setLiveness({
        sessionId: data.sessionId,
        region: data.region ?? "us-east-1",
        credentials: data.credentials,
      });
      setPhase("scanning");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start the secure face scan");
    } finally {
      setBusy(false);
    }
  };

  const onAnalysisComplete = async () => {
    if (!liveness) return;
    setPhase("saving");
    try {
      const res: any = await finalize({ data: { token, sessionId: liveness.sessionId } });
      if (res.ok) {
        setPhase("done");
      } else {
        setError(res.reason ?? "Face enrollment could not be completed.");
        setLiveness(null);
        setPhase("ready");
        toast.error(res.reason ?? "Face enrollment could not be completed.");
      }
    } catch (e: any) {
      setError(e?.message ?? "Face enrollment could not be completed.");
      setLiveness(null);
      setPhase("ready");
    }
  };

  const credentialProvider = liveness?.credentials
    ? async () => ({
        accessKeyId: liveness.credentials!.accessKeyId,
        secretAccessKey: liveness.credentials!.secretAccessKey,
        sessionToken: liveness.credentials!.sessionToken,
        expiration: new Date(liveness.credentials!.expiration),
      })
    : undefined;

  return (
    <main className="min-h-dvh bg-[#050A18] text-white px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-5">
        <header className="text-center space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Secure Face Protection</h1>
          <p className="text-xs text-white/50">
            {name ? `Enrolling ${name}` : "One-time secure enrollment link"}
          </p>
        </header>

        {phase === "loading" && (
          <div className="grid place-items-center py-16">
            <Loader2 className="size-6 animate-spin text-sky-400" />
          </div>
        )}

        {phase === "invalid" && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100 flex gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <div>
              {error}
              <p className="mt-1 text-xs text-amber-200/70">
                Return to your computer and generate a new QR code.
              </p>
            </div>
          </div>
        )}

        {phase === "consent" && (
          <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            {CONSENTS.map((c) => (
              <label key={c.id} className="flex gap-3 text-xs text-white/70 leading-relaxed">
                <Checkbox
                  checked={!!checks[c.id]}
                  onCheckedChange={(v) => setChecks((p) => ({ ...p, [c.id]: !!v }))}
                />
                <span>{c.text}</span>
              </label>
            ))}
            <Button
              className="w-full bg-blue-600 hover:bg-blue-500 text-white border-0"
              disabled={!allChecked || busy}
              onClick={acceptConsent}
            >
              {busy && <Loader2 className="size-4 animate-spin mr-2" />} Continue
            </Button>
          </div>
        )}

        {phase === "ready" && (
          <div className="space-y-4">
            {error && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                {error}
              </div>
            )}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70 space-y-2">
              <p className="flex items-center gap-2 text-white/85">
                <ScanFace className="size-4 text-sky-400" /> Live face scan required
              </p>
              <p className="text-xs">
                Hold your phone at eye level in good lighting and follow the on-screen prompts. This
                uses the same secure AWS Face Liveness check as the desktop flow.
              </p>
            </div>
            <Button
              className="w-full bg-sky-600 hover:bg-sky-500 text-white border-0"
              disabled={busy}
              onClick={startScan}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <ScanFace className="size-4 mr-2" />
              )}
              Start Face Scan
            </Button>
          </div>
        )}

        {phase === "scanning" && liveness && (
          <div className="rounded-2xl overflow-hidden border border-sky-500/20 bg-black">
            <Suspense
              fallback={
                <div className="grid place-items-center py-20">
                  <Loader2 className="size-6 animate-spin text-sky-400" />
                </div>
              }
            >
              <LazyFaceLivenessDetector
                sessionId={liveness.sessionId}
                region={liveness.region}
                config={{ credentialProvider }}
                onAnalysisComplete={onAnalysisComplete}
                onError={(err: unknown) => {
                  setError(
                    "The face scan stopped before analysis completed. Please retry in good lighting.",
                  );
                  setLiveness(null);
                  setPhase("ready");
                  void err;
                }}
              />
            </Suspense>
          </div>
        )}

        {phase === "saving" && (
          <div className="grid place-items-center py-16 gap-3 text-sm text-white/60">
            <Loader2 className="size-6 animate-spin text-sky-400" />
            Registering protected facial reference…
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
            <ShieldCheck className="size-10 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-medium">Face Protection Registered</h2>
            <p className="text-xs text-white/60">
              You can close this page and continue onboarding on your computer — it updates
              automatically.
            </p>
          </div>
        )}

        <p className="flex items-center justify-center gap-1.5 text-[11px] text-white/35">
          <Lock className="size-3" /> This link is single-use and expires shortly.
        </p>
      </div>
    </main>
  );
}
