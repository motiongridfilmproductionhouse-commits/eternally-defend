import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProviderStatus } from "@/lib/mm/mm.functions";
import { testAllMultimediaProviders } from "@/lib/mm/health.functions";
import { runRetentionCleanup, getRetentionPreview } from "@/lib/mm/retention.functions";
import { PageCard } from "@/components/dashboard/PageCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminGuard } from "@/components/AdminGuard";
import { CheckCircle2, XCircle, ShieldAlert, PlayCircle, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_app/admin/provider-activation")({
  head: () => ({ meta: [{ title: "Provider Activation — Eterna AI" }] }),
  component: () => <AdminGuard><ProviderActivationPage /></AdminGuard>,
});

interface ProviderSpec {
  key: string;
  label: string;
  flag: string;
  currentModeKey: keyof any;
  requiredCredentials: { name: string; kind: "api_key" | "service_account" | "bucket" }[];
  activateBy: string;
  liveWhen: (cfg: any) => boolean;
}

const PROVIDERS: ProviderSpec[] = [
  {
    key: "fact_check", label: "Fact Check Tools", flag: "MM_PROVIDER_FACT_CHECK",
    currentModeKey: "factCheck",
    requiredCredentials: [{ name: "FACT_CHECK_API_KEY", kind: "api_key" }],
    activateBy: "Set MM_PROVIDER_FACT_CHECK=google_api_key",
    liveWhen: (c) => c.hasFactCheckKey && c.factCheck !== "stub",
  },
  {
    key: "translation", label: "Google Translation", flag: "MM_PROVIDER_TRANSLATION",
    currentModeKey: "translation",
    requiredCredentials: [{ name: "GOOGLE_API_KEY", kind: "api_key" }],
    activateBy: "Set MM_PROVIDER_TRANSLATION=google_api_key",
    liveWhen: (c) => c.hasTranslationKey && c.translation !== "stub",
  },
  {
    key: "video_intelligence", label: "Video Intelligence", flag: "MM_PROVIDER_VIDEO_INTELLIGENCE",
    currentModeKey: "videoIntelligence",
    requiredCredentials: [
      { name: "GOOGLE_APPLICATION_CREDENTIALS_JSON", kind: "service_account" },
      { name: "GOOGLE_CLOUD_PROJECT_ID", kind: "api_key" },
      { name: "GOOGLE_CLOUD_STORAGE_BUCKET", kind: "bucket" },
    ],
    activateBy: "Set MM_PROVIDER_VIDEO_INTELLIGENCE=google_service_account",
    liveWhen: (c) => c.hasServiceAccount && c.videoIntelligence === "google_service_account",
  },
  {
    key: "speech_to_text", label: "Speech-to-Text", flag: "MM_PROVIDER_SPEECH_TO_TEXT",
    currentModeKey: "speechToText",
    requiredCredentials: [{ name: "GOOGLE_APPLICATION_CREDENTIALS_JSON", kind: "service_account" }],
    activateBy: "Set MM_PROVIDER_SPEECH_TO_TEXT=google_service_account",
    liveWhen: (c) => c.hasServiceAccount && c.speechToText === "google_service_account",
  },
  {
    key: "vision", label: "Cloud Vision", flag: "MM_PROVIDER_VISION",
    currentModeKey: "vision",
    requiredCredentials: [{ name: "GOOGLE_APPLICATION_CREDENTIALS_JSON", kind: "service_account" }],
    activateBy: "Set MM_PROVIDER_VISION=google_service_account",
    liveWhen: (c) => c.hasServiceAccount && c.vision === "google_service_account",
  },
];

function ProviderActivationPage() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getProviderStatus);
  const testAllFn = useServerFn(testAllMultimediaProviders);
  const cleanupFn = useServerFn(runRetentionCleanup);
  const retentionFn = useServerFn(getRetentionPreview);
  const status = useQuery({ queryKey: ["mm-providers"], queryFn: () => statusFn() });
  const retention = useQuery({ queryKey: ["retention-preview"], queryFn: () => retentionFn() });
  const testAll = useMutation({ mutationFn: () => testAllFn(), onSuccess: () => qc.invalidateQueries({ queryKey: ["mm-providers"] }) });
  const cleanupDry = useMutation({ mutationFn: () => cleanupFn({ data: { dryRun: true } }) });
  const cleanupRun = useMutation({ mutationFn: () => cleanupFn({ data: { dryRun: false } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["retention-preview"] }) });

  const cfg = status.data;

  return (
    <div className="space-y-5">
      <PageCard title="PROVIDER ACTIVATION" sub="Enable real Google Cloud providers by setting environment variables. No code changes required."
        actions={<Button onClick={() => testAll.mutate()} disabled={testAll.isPending}>
          <PlayCircle className="size-4 mr-2" />{testAll.isPending ? "Validating…" : "Validate credentials"}
        </Button>}>
        {!cfg ? <div className="text-sm text-muted-foreground">Loading…</div> : (
          <div className="space-y-3">
            {PROVIDERS.map((p) => {
              const isLive = p.liveWhen(cfg);
              const mode = (cfg as any)[p.currentModeKey];
              return (
                <div key={p.key} className="border border-border rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-sm">{p.label}</div>
                        {isLive ? (
                          <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30" variant="outline">
                            <CheckCircle2 className="size-3 mr-1" />Live
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30" variant="outline">
                            <ShieldAlert className="size-3 mr-1" />Stubbed
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Feature flag <code className="bg-muted px-1 rounded">{p.flag}</code> = <code className="bg-muted px-1 rounded">{mode}</code>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3">
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">Required credentials</div>
                      <ul className="space-y-1 text-xs">
                        {p.requiredCredentials.map((c) => {
                          const present = credentialPresent(c.name, cfg);
                          return (
                            <li key={c.name} className="flex items-center gap-2">
                              {present ? <CheckCircle2 className="size-3 text-emerald-500" /> : <XCircle className="size-3 text-muted-foreground" />}
                              <code className="text-[11px] bg-muted px-1 rounded">{c.name}</code>
                              <span className="text-[10px] text-muted-foreground">({c.kind.replace("_", " ")})</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1">Activation</div>
                      <div className="text-xs">{p.activateBy}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Then click <b>Validate credentials</b> above. No code deployment required.
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageCard>

      <PageCard title="RETENTION & CLEANUP" sub="Scheduled cleanup of temporary media, transcripts and processing artefacts. Audit logs are always retained."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => cleanupDry.mutate()} disabled={cleanupDry.isPending}>Preview cleanup</Button>
            <Button onClick={() => cleanupRun.mutate()} disabled={cleanupRun.isPending}>
              <Trash2 className="size-4 mr-2" />{cleanupRun.isPending ? "Running…" : "Run cleanup"}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
          {(retention.data?.buckets ? Object.entries(retention.data.buckets) : []).map(([k, v]) => (
            <div key={k} className="border border-border rounded-lg p-2 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">{k.replace(/_/g, " ")}</div>
              <div className="font-semibold">{String(v)}</div>
            </div>
          ))}
        </div>
        {cleanupDry.data && (
          <div className="text-xs bg-muted/40 rounded p-2">
            Preview: {cleanupDry.data.jobsMatched} job(s) eligible.
            Retention buckets: {JSON.stringify(cleanupDry.data.summary)}.
          </div>
        )}
        {cleanupRun.data && !cleanupRun.data.dryRun && (
          <div className="text-xs text-emerald-600 mt-2">
            Deleted: {JSON.stringify(cleanupRun.data.deleted)}.
          </div>
        )}
        <div className="mt-3 text-[11px] text-muted-foreground space-y-0.5">
          <div><b>Immediate:</b> purged when job finishes.</div>
          <div><b>7 / 30 days:</b> temp media &amp; transcripts cleaned after window.</div>
          <div><b>Case closure:</b> retained until linked case is closed.</div>
          <div><b>Legal hold:</b> never cleaned.</div>
          <div>Always retained: job records, audit history, extracted claims, fact-check matches, narrative clusters.</div>
        </div>
      </PageCard>
    </div>
  );
}

function credentialPresent(name: string, cfg: any): boolean {
  switch (name) {
    case "FACT_CHECK_API_KEY": return !!cfg.hasFactCheckKey;
    case "GOOGLE_API_KEY": return !!cfg.hasTranslationKey;
    case "GOOGLE_APPLICATION_CREDENTIALS_JSON": return !!cfg.hasServiceAccount;
    case "GOOGLE_CLOUD_PROJECT_ID": return !!cfg.projectId;
    case "GOOGLE_CLOUD_STORAGE_BUCKET": return !!cfg.bucket;
    default: return false;
  }
}
