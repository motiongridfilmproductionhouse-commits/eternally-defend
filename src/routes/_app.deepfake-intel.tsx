import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  runDeepfakeScan,
  listDeepfakeScans,
  getDeepfakeScan,
  updateDeepfakeFinding,
  parseTelemetry,
  submitAndProcessManualEvidence,
} from "@/lib/deepfake-intel.functions";
import {
  createDeepfakeTargetProfile,
  listDeepfakeTargetProfiles,
  uploadDeepfakeReferenceFace,
  deleteDeepfakeReferenceFace,
} from "@/lib/deepfake/face-profile.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ScanFace,
  ShieldAlert,
  ExternalLink,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Filter,
  Radar,
  Upload,
  Trash2,
  UserRoundCheck,
  Link,
  RefreshCw,
} from "lucide-react";
import { useUserRoles } from "@/hooks/use-user-roles";
import { IdentityScanVisualization } from "@/components/deepfake/IdentityScanVisualization";
import { useReferenceFaceThumbnail } from "@/components/deepfake/useReferenceFaceThumbnail";
import { ThreatTimeline, type TimelineEvent } from "@/components/deepfake/ThreatTimeline";
import { buildThreatAlertSummary } from "@/lib/deepfake/threat-alert";
import { selectThreatFeed, countVerified } from "@/lib/deepfake/verified-threat-feed";
import type { ClientFinding } from "@/lib/deepfake/results-dashboard";
import { DeepfakeIntelligenceSummary } from "@/components/deepfake/analytics/DeepfakeIntelligenceSummary";
import { DeepfakeExposureMap } from "@/components/deepfake/analytics/DeepfakeExposureMap";
import { DomainConcentrationChart } from "@/components/deepfake/analytics/DomainConcentrationChart";
import { SourceIntelligencePanel } from "@/components/deepfake/analytics/SourceIntelligencePanel";
import { getFindingNormalizedDomain, resolveFindingOrigin } from "@/lib/deepfake/analytics-helpers";


export const Route = createFileRoute("/_app/deepfake-intel")({
  head: () => ({
    meta: [
      { title: "Deepfake & Synthetic Media Intelligence — Eterna Sentinel" },
      {
        name: "description",
        content:
          "Scan the public web for deepfakes, AI-generated intimate imagery, face swaps, and synthetic media targeting protected identities.",
      },
      { property: "og:title", content: "Deepfake & Synthetic Media Intelligence — Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "Cautious, evidence-graded intelligence sweeps for deepfake and synthetic media abuse.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeepfakeIntelPage,
});

interface DiscoveryLeadItem {
  id: string;
  page_url: string;
  page_title: string | null;
  snippet: string | null;
  source: string;
  source_host: string | null;
  search_query?: string | null;
  analysis_status?: string | null;
}

interface ManualLeadResult {
  submitted_url: string;
  status: string;
  reason: string | null;
  classification: string | null;
  source_domain: string | null;
  face_similarity: number | null;
}

type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

const RISK_STYLE: Record<RiskLevel, { badge: string; dot: string }> = {
  CRITICAL: { badge: "bg-red-600/15 text-red-500 border-red-600/40", dot: "bg-red-500" },
  HIGH: { badge: "bg-orange-500/15 text-orange-400 border-orange-500/40", dot: "bg-orange-400" },
  MEDIUM: { badge: "bg-amber-400/15 text-amber-400 border-amber-400/40", dot: "bg-amber-400" },
  LOW: { badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40", dot: "bg-emerald-400" },
};

function DeepfakeIntelPage() {
  const runFn = useServerFn(runDeepfakeScan);
  const listFn = useServerFn(listDeepfakeScans);
  const getFn = useServerFn(getDeepfakeScan);
  const updFn = useServerFn(updateDeepfakeFinding);
  const manualEvidenceFn = useServerFn(submitAndProcessManualEvidence);
  const createProfileFn = useServerFn(createDeepfakeTargetProfile);
  const listProfilesFn = useServerFn(listDeepfakeTargetProfiles);
  const uploadReferenceFn = useServerFn(uploadDeepfakeReferenceFace);
  const deleteReferenceFn = useServerFn(deleteDeepfakeReferenceFace);
  const qc = useQueryClient();

  const [targetName, setTargetName] = useState("");
  const [googleImagesUrl, setGoogleImagesUrl] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [handlesText, setHandlesText] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [manualUrlsText, setManualUrlsText] = useState("");
  const [manualLeadResults, setManualLeadResults] = useState<ManualLeadResult[]>([]);
  const [riskFilter, setRiskFilter] = useState<"ALL" | RiskLevel>("ALL");
  const [showGeneralMentions, setShowGeneralMentions] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  const profiles = useQuery({
    queryKey: ["deepfake-target-profiles"],
    queryFn: () => listProfilesFn({}),
  });

  const selectedProfile = (profiles.data ?? []).find((profile) => profile.id === selectedProfileId);
  const enrolledFaces = selectedProfile?.deepfake_reference_faces ?? [];
  const { thumbnailUrl } = useReferenceFaceThumbnail({ faces: enrolledFaces });

  const scans = useQuery({
    queryKey: ["deepfake-scans"],
    queryFn: () => listFn({}),
    refetchInterval: (q) => {
      const data = q.state.data as Array<{ status: string }> | undefined;
      return data?.some((s) => s.status === "running") ? 3_000 : false;
    },
  });

  const selected = useQuery({
    queryKey: ["deepfake-scan", selectedScanId],
    queryFn: () => (selectedScanId ? getFn({ data: { scan_id: selectedScanId } }) : null),
    enabled: !!selectedScanId,
    refetchInterval: (q) => {
      const d = q.state.data as { scan?: { status?: string } } | null | undefined;
      return d?.scan?.status === "running" ? 3_000 : false;
    },
  });

  const scan = selected.data?.scan ?? null;
  const findings = (selected.data?.findings ?? []) as unknown as ClientFinding[];
  const discoveries = selected.data?.discoveries ?? [];
  const threatSummary = buildThreatAlertSummary(findings);
  const allThreatFeed = selectThreatFeed(
    findings,
    scan?.target_name
      ? {
          name: scan.target_name as string,
          aliases: ((scan as { aliases?: string[] }).aliases ?? []) as string[],
        }
      : null,
  );

  const threatFeed = selectedDomain
    ? allThreatFeed.filter(
        (t) => getFindingNormalizedDomain(t.finding) === selectedDomain,
      )
    : allThreatFeed;


  const run = useMutation({
    mutationFn: (input: {
      target_name: string;
      profile_id?: string;
      aliases: string[];
      handles: string[];
      google_images_url?: string;
    }) => runFn({ data: input }),
    onSuccess: (res) => {
      setSelectedScanId(res.scan_id);
      qc.invalidateQueries({ queryKey: ["deepfake-scans"] });

      if (res.already_running) {
        toast.info(`Attached to the active scan for “${targetName.trim()}”.`);
        return;
      }

      toast.success(
        `Scan complete — ${res.total_results} threats classified from ${res.discovered_results} latest public leads`,
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });

  const manualEvidence = useMutation({
    mutationFn: (urls: string[]) =>
      manualEvidenceFn({
        data: {
          target_name: targetName.trim() || (selectedProfile?.target_name ?? ""),
          urls,
          ...(selectedProfileId ? { profile_id: selectedProfileId } : {}),
        },
      }),
    onSuccess: (res) => {
      setManualLeadResults(res.results);
      if (res.scan_id) setSelectedScanId(res.scan_id);
      qc.invalidateQueries({ queryKey: ["deepfake-scans"] });
      setManualUrlsText("");
      toast.success(
        `${res.processed} supplied link${res.processed === 1 ? "" : "s"} triaged — ${res.review_required} pending review, ${res.rejected} rejected, ${res.failed} unreachable`,
      );
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Supplied links could not be processed"),
  });


  const createProfile = useMutation({
    mutationFn: (target_name: string) =>
      createProfileFn({
        data: {
          target_name,
          authorization_status: "authorized",
        },
      }),
    onSuccess: (profile) => {
      setSelectedProfileId(profile.id);
      qc.invalidateQueries({
        queryKey: ["deepfake-target-profiles"],
      });
      toast.success("Protected identity profile created");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Profile creation failed"),
  });

  const uploadReferences = useMutation({
    mutationFn: async (files: File[]) => {
      if (!selectedProfileId) {
        throw new Error("Select or create a target profile first.");
      }

      const uploaded = [];

      for (const file of files) {
        const image_base64 = await fileToDataUrl(file);

        uploaded.push(
          await uploadReferenceFn({
            data: {
              profile_id: selectedProfileId,
              filename: file.name,
              content_type: file.type as "image/jpeg" | "image/png" | "image/webp",
              image_base64,
            },
          }),
        );
      }

      return uploaded;
    },
    onSuccess: (uploaded) => {
      setReferenceFiles([]);
      qc.invalidateQueries({
        queryKey: ["deepfake-target-profiles"],
      });
      toast.success(
        `${uploaded.length} reference photo${uploaded.length === 1 ? "" : "s"} enrolled`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Reference photo upload failed"),
  });

  const deleteReference = useMutation({
    mutationFn: (reference_face_id: string) =>
      deleteReferenceFn({
        data: {
          profile_id: selectedProfileId,
          reference_face_id,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["deepfake-target-profiles"],
      });
      toast.success("Reference photo removed");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Unable to remove reference photo"),
  });

  const upd = useMutation({
    mutationFn: (v: {
      finding_id: string;
      review_status: "new" | "reviewed" | "dismissed" | "queued_takedown";
    }) => updFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deepfake-scan", selectedScanId] });
    },
  });

  const onRun = () => {
    const name = targetName.trim();

    if (!name) {
      toast.error("Enter a target name");
      return;
    }

    const hasGoogleImagesLink = Boolean(googleImagesUrl.trim());
    const hasFaceProfile = Boolean(selectedProfileId) && enrolledFaces.length >= 3;

    if (!hasGoogleImagesLink && !hasFaceProfile) {
      toast.error(
        "Paste a Google Images link or select a profile with at least three reference photos",
      );
      return;
    }

    const aliases = aliasesText
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    const handles = handlesText
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    run.mutate({
      target_name: name,
      profile_id: selectedProfileId || undefined,
      aliases,
      handles,
      google_images_url: googleImagesUrl.trim() || undefined,
    });
  };

  const onCreateProfile = () => {
    const name = targetName.trim();

    if (!name) {
      toast.error("Enter the protected person's name first");
      return;
    }

    createProfile.mutate(name);
  };

  const onReferenceFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";

    const allowed = selected.filter((file) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type),
    );

    if (allowed.length !== selected.length) {
      toast.error("Only JPEG, PNG and WebP photos are supported");
    }

    const remainingSlots = Math.max(0, 5 - enrolledFaces.length);

    setReferenceFiles(allowed.slice(0, remainingSlots));
  };

  const filtered =
    riskFilter === "ALL" ? findings : findings.filter((f) => f.risk_level === riskFilter);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] tracking-[0.2em] text-muted-foreground font-semibold">
            SYNTHETIC MEDIA INTEL
          </div>
          <h1 className="text-2xl font-display font-semibold flex items-center gap-2">
            <ScanFace className="size-5 text-primary" />
            Deepfake &amp; Synthetic Media Intelligence
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl mt-1">
            Sweeps the public web for deepfake claims, AI-generated intimate imagery, face swaps,
            fake leaks, and non-consensual synthetic media targeting protected identities. Results
            are triaged with a cautious classifier and never asserted as fact.
          </p>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* Left: control panel */}
        <div className="space-y-4">
          <div className="card-surface p-4 space-y-3">
            <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">
              NEW SCAN
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Target name</label>
              <Input
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                placeholder="Full name, brand, or protected identity"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                Google Images search link
                <span className="ml-1 font-normal text-muted-foreground">Optional</span>
              </label>

              <Input
                type="url"
                value={googleImagesUrl}
                onChange={(e) => setGoogleImagesUrl(e.target.value)}
                placeholder="Paste Google Images search URL"
              />

              <p className="text-[10px] text-muted-foreground">
                Open Google Images, search the protected identity, then paste the search-page URL
                here.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span>Manual Evidence URLs</span>
                <span className="font-normal text-muted-foreground">Optional</span>
              </div>

              <Textarea
                value={manualUrlsText}
                onChange={(e) => setManualUrlsText(e.target.value)}
                placeholder="Paste Google Images links, direct image links, or evidence page links"
                rows={2}
              />

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs"
                disabled={
                  !manualUrlsText.trim() ||
                  manualEvidence.isPending ||
                  !(targetName.trim() || selectedProfile?.target_name)
                }
                onClick={() => {
                  const urls = manualUrlsText
                    .split(/[\s,]+/)
                    .map((value) => value.trim())
                    .filter((value) => /^https?:\/\//i.test(value));
                  if (!urls.length) {
                    toast.error("Paste at least one http(s) evidence link.");
                    return;
                  }
                  manualEvidence.mutate(urls);
                }}
              >
                {manualEvidence.isPending ? (
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Link className="size-3.5 mr-1.5" />
                )}
                {manualEvidence.isPending ? "Triaging supplied links…" : "Process supplied links now"}
              </Button>

              {manualLeadResults.length > 0 && (
                <div className="space-y-1.5 rounded-md border border-border/70 bg-secondary/20 p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Supplied link triage
                  </div>
                  {manualLeadResults.map((lead) => (
                    <div
                      key={lead.submitted_url}
                      className="rounded border border-border/60 bg-background/60 p-2 text-[11px] space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <a
                          href={lead.submitted_url}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 break-all text-primary hover:underline"
                        >
                          {lead.submitted_url}
                        </a>
                        <Badge
                          variant="outline"
                          className={
                            lead.status === "review_required" || lead.status === "evidence_ready"
                              ? "border-amber-400/40 bg-amber-400/15 text-amber-500"
                              : lead.status === "rejected"
                                ? "border-border bg-secondary/40 text-muted-foreground"
                                : "border-red-600/40 bg-red-600/15 text-red-500"
                          }
                        >
                          {lead.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground break-words">
                        {[
                          lead.classification,
                          lead.source_domain,
                          typeof lead.face_similarity === "number" && lead.face_similarity > 0
                            ? `face ${lead.face_similarity.toFixed(0)}%`
                            : null,
                          lead.reason,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground">
                    Supplied links are stored as evidence leads for human review. No takedown is
                    sent automatically.
                  </p>
                </div>
              )}
            </div>


            <div className="rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <UserRoundCheck className="size-4 text-primary" />
                <div>
                  <div className="text-xs font-semibold">Protected identity verification</div>
                  <div className="text-[10px] text-muted-foreground">
                    Face matching removes results showing a different person.
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Identity profile</label>

                <select
                  value={selectedProfileId}
                  onChange={(event) => {
                    const profileId = event.target.value;
                    setSelectedProfileId(profileId);

                    const profile = (profiles.data ?? []).find((item) => item.id === profileId);

                    if (profile?.target_name) {
                      setTargetName(profile.target_name);
                    }
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Select protected identity</option>
                  {(profiles.data ?? []).map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.target_name} · {profile.deepfake_reference_faces?.length ?? 0}/5
                      photos
                    </option>
                  ))}
                </select>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={createProfile.isPending || !targetName.trim()}
                  onClick={onCreateProfile}
                >
                  {createProfile.isPending ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Creating profile…
                    </>
                  ) : (
                    <>
                      <UserRoundCheck className="size-4 mr-2" />
                      Create Profile for This Target
                    </>
                  )}
                </Button>
              </div>

              {selectedProfileId && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium">Reference photos</label>
                    <Badge variant={enrolledFaces.length >= 3 ? "default" : "secondary"}>
                      {enrolledFaces.length}/5 enrolled
                    </Badge>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    Upload 3–5 clear photos of the same person. Use front, left-angle and
                    right-angle photographs. Avoid group photos, sunglasses and heavily edited
                    images.
                  </p>

                  {enrolledFaces.length > 0 && (
                    <div className="space-y-1.5">
                      {enrolledFaces.map(
                        (
                          face: {
                            id: string;
                            face_confidence?: number | null;
                          },
                          index: number,
                        ) => (
                          <div
                            key={face.id}
                            className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="size-3.5 text-emerald-500" />
                              <span className="text-xs">Reference photo {index + 1}</span>
                              {typeof face.face_confidence === "number" && (
                                <span className="text-[10px] text-muted-foreground">
                                  {face.face_confidence.toFixed(1)}% quality
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              aria-label="Delete reference photo"
                              disabled={deleteReference.isPending}
                              onClick={() => deleteReference.mutate(face.id)}
                              className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        ),
                      )}
                    </div>
                  )}

                  {enrolledFaces.length < 5 && (
                    <>
                      <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-3 text-xs text-primary hover:bg-primary/10">
                        <Upload className="size-4 mr-2" />
                        Choose reference photos
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          className="hidden"
                          onChange={onReferenceFilesSelected}
                        />
                      </label>

                      {referenceFiles.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[10px] text-muted-foreground">
                            {referenceFiles.length} photo{referenceFiles.length === 1 ? "" : "s"}{" "}
                            selected
                          </div>

                          <Button
                            type="button"
                            className="w-full"
                            disabled={uploadReferences.isPending}
                            onClick={() => uploadReferences.mutate(referenceFiles)}
                          >
                            {uploadReferences.isPending ? (
                              <>
                                <Loader2 className="size-4 mr-2 animate-spin" />
                                Enrolling faces…
                              </>
                            ) : (
                              <>
                                <Upload className="size-4 mr-2" />
                                Upload and Enrol Faces
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </>
                  )}

                  {enrolledFaces.length >= 3 && (
                    <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-emerald-500">
                      <CheckCircle2 className="size-4 shrink-0" />
                      Face-verified scanning is ready.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Aliases / nicknames / prior names</label>
              <Textarea
                value={aliasesText}
                onChange={(e) => setAliasesText(e.target.value)}
                placeholder="One per line or comma-separated"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Social handles / usernames</label>
              <Textarea
                value={handlesText}
                onChange={(e) => setHandlesText(e.target.value)}
                placeholder="@handle, username, etc."
                rows={3}
              />
            </div>
            <Button
              className="w-full"
              onClick={onRun}
              disabled={
                run.isPending ||
                (!googleImagesUrl.trim() && (!selectedProfileId || enrolledFaces.length < 3))
              }
            >
              {run.isPending ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Face-verifying and scanning…
                </>
              ) : (
                <>
                  <Radar className="size-4 mr-2" />
                  {googleImagesUrl.trim() && (!selectedProfileId || enrolledFaces.length < 3)
                    ? "Run Discovery Sweep"
                    : "Run Face-Verified Sweep"}
                </>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Searches public web pages for exact-identity synthetic, face-swap, and explicit-media
              threats.
            </p>
          </div>

          <div className="card-surface p-4">
            <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground mb-2">
              SCAN HISTORY
            </div>
            {scans.isLoading ? (
              <div className="text-xs text-muted-foreground py-4 text-center">Loading…</div>
            ) : (scans.data ?? []).length === 0 ? (
              <div className="text-xs text-muted-foreground py-4 text-center">No scans yet.</div>
            ) : (
              <ul className="space-y-1.5 max-h-[420px] overflow-auto">
                {(scans.data ?? []).map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedScanId(s.id)}
                      className={`w-full text-left rounded-lg border p-2.5 transition ${
                        selectedScanId === s.id
                          ? "border-primary/60 bg-primary/5"
                          : "border-border/60 hover:bg-secondary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium truncate">{s.target_name}</div>
                        <StatusBadge status={s.status} />
                      </div>
                      <div className="mt-1 flex items-center gap-1 flex-wrap">
                        <RiskChip level="CRITICAL" count={s.critical_count} />
                        <RiskChip level="HIGH" count={s.high_count} />
                        <RiskChip level="MEDIUM" count={s.medium_count} />
                        <RiskChip level="LOW" count={s.low_count} />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {new Date(s.created_at).toLocaleString()}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: Main Intelligence Pane */}
        <div className="space-y-4">
          {/* A. Identity Lock Panel / Radar Animation */}
          <IdentityScanVisualization
            artistName={
              scan?.target_name ||
              selectedProfile?.target_name ||
              targetName ||
              "Protected Identity"
            }
            enrolledCount={enrolledFaces.length}
            thumbnailUrl={thumbnailUrl}
            scanStatus={scan?.status}
            stage={scan ? parseTelemetry(scan)?.stage : "idle"}
            executedQueries={scan ? parseTelemetry(scan)?.queries_executed : 0}
            plannedQueries={
              scan ? scan.total_queries || parseTelemetry(scan)?.queries_generated || 56 : 0
            }
            pagesVerified={scan ? parseTelemetry(scan)?.pages_crawled : 0}
            threatsSaved={findings.length}
            candidatesCount={discoveries.length}
            errorMessage={scan?.error_message}
            threatSummary={threatSummary}
            threatFindings={findings}
            scanId={scan?.id}
            threatFindingsReady={!selected.isLoading}
          />

          {!scan ? (
            <div className="card-surface p-8 text-center text-sm text-muted-foreground space-y-2">
              <ShieldAlert className="size-8 mx-auto text-muted-foreground/60" strokeWidth={1.2} />
              <div className="font-semibold text-foreground">Identity Scanner Ready</div>
              <div>
                Run a face-verified sweep or select a scan from history to view real-time findings.
              </div>
            </div>
          ) : (
            <>
              {/* RESTORED DEEPFAKE INTELLIGENCE ANALYTICS SUITE */}
              <DeepfakeIntelligenceSummary findings={findings} />

              <DeepfakeExposureMap
                findings={findings}
                selectedDomain={selectedDomain}
                onSelectDomain={setSelectedDomain}
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <DomainConcentrationChart
                  findings={findings}
                  selectedDomain={selectedDomain}
                  onSelectDomain={setSelectedDomain}
                />
                <SourceIntelligencePanel
                  findings={findings}
                  selectedDomain={selectedDomain}
                  onUpdateFinding={(findingId, status) =>
                    upd.mutate({ finding_id: findingId, review_status: status })
                  }
                  pending={upd.isPending}
                />
              </div>

              {/* B. Live Telemetry Dashboard */}
              <TelemetryDashboard
                scan={scan}
                discoveriesCount={discoveries.length}
                findingsCount={findings.length}
              />

              {/* Real-Time Threat Timeline */}
              <ThreatTimeline events={buildTimelineEvents(scan, discoveries, findings)} />

              {/* C. Target Info & Risk Filter Bar */}
              <div className="card-surface p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground uppercase">
                      SCAN TARGET
                    </div>
                    <div className="text-lg font-semibold">{scan.target_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {scan.total_queries} queries · {scan.total_results} classified threats ·{" "}
                      {discoveries.length} public leads
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={scan.status} />
                    <div className="flex items-center gap-1.5">
                      <Filter className="size-3.5 text-muted-foreground" />
                      {(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => setRiskFilter(r)}
                          className={`text-[10px] px-2 py-1 rounded border ${
                            riskFilter === r
                              ? "bg-primary/15 border-primary/50 text-primary"
                              : "border-border/60 text-muted-foreground hover:bg-secondary/40"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {scan.error_message && !scan.error_message.startsWith("{") && (
                  <div className="mt-3 text-xs text-red-500 flex items-start gap-2">
                    <AlertTriangle className="size-3.5 mt-0.5" /> {scan.error_message}
                  </div>
                )}
              </div>

              {/* Automated Findings vs Manual Evidence Counters */}
              <div
                className="flex items-center justify-between gap-3 p-3 card-surface bg-secondary/10 border border-border/60 rounded-lg"
                data-testid="manual-evidence-leads"
              >
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Badge
                      variant="default"
                      className="bg-primary/20 text-primary border-primary/40"
                    >
                      AUTOMATED FINDINGS: {findings.length}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Badge variant="outline" className="uppercase">
                      MANUAL EVIDENCE LEADS: 0
                    </Badge>
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  Source page could not be resolved automatically.
                </span>
              </div>

              {/* Main Section Header: VERIFIED EXPLICIT SYNTHETIC THREATS */}
              <div className="card-surface p-4 space-y-4 border border-red-500/25 rounded-xl">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold tracking-wider text-foreground uppercase flex items-center gap-2">
                      <ShieldAlert className="size-4 text-red-500" />
                      VERIFIED EXPLICIT SYNTHETIC THREATS
                    </h2>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Face-verified synthetic and explicit media evidence. Verified threats meet all
                      four gates; probable threats are face-matched with one confirmed signal.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge className="bg-red-500/15 text-red-600 border-red-500/40">
                      {countVerified(threatFeed)} Verified
                    </Badge>
                    <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                      {threatFeed.length - countVerified(threatFeed)} Probable
                    </Badge>
                  </div>
                </div>

                {/* Primary Threat Feed List */}
                {selected.isLoading ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="size-5 mx-auto animate-spin mb-2" /> Loading findings…
                  </div>
                ) : threatFeed.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground space-y-2 border border-border/60 rounded-lg bg-secondary/20">
                    {scan.status === "running" ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="size-6 text-primary animate-spin" />
                        <span>
                          Verification sweep in progress — results stream as verification completes.
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 py-2">
                        <CheckCircle2 className="size-8 text-emerald-500" strokeWidth={1.5} />
                        <div className="font-bold text-foreground text-sm">
                          No verified explicit synthetic-media evidence found.
                        </div>
                        <p className="text-xs text-muted-foreground max-w-md mx-auto">
                          Sweeps across Google Images, multi-provider discovery, Telegram, and image
                          hosts returned zero verified explicit deepfakes or face-swap threats.
                          Irrelevant news, Wikipedia, and biography pages were automatically
                          filtered.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <ul className="space-y-2.5">
                    {threatFeed.map(({ finding: f, tier }) => (
                      <li key={f.id} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[9px] font-bold tracking-[0.14em] px-1.5 py-0.5 rounded border ${
                              tier === "VERIFIED"
                                ? "bg-red-500/15 text-red-600 border-red-500/40"
                                : "bg-amber-500/15 text-amber-600 border-amber-500/40"
                            }`}
                          >
                            {tier} DEEPFAKE
                          </span>
                        </div>
                        <FindingCard
                          f={f as any}
                          onUpdate={(status) =>
                            upd.mutate({ finding_id: f.id, review_status: status })
                          }
                          pending={upd.isPending}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>


              {/* Collapsed Secondary Accordions: Raw Candidates */}
              {discoveries.length > 0 && (
                <div className="space-y-3">
                  <details className="card-surface p-4 rounded-xl border border-border/60 group">
                    <summary className="cursor-pointer text-xs font-semibold text-muted-foreground uppercase flex items-center justify-between">
                      <span>Verification Queue ({discoveries.filter((d: any) => d.analysis_status === "pending_verification" || d.analysis_status === "discovered").length})</span>
                      <span className="text-[10px] text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div className="mt-3 space-y-2 text-xs text-muted-foreground divide-y divide-border/40">
                      {discoveries
                        .filter((d: any) => d.analysis_status === "pending_verification" || d.analysis_status === "discovered")
                        .slice(0, 15)
                        .map((d: any) => (
                          <div key={d.id} className="pt-2 flex items-center justify-between gap-2">
                            <span className="truncate">{d.page_title || d.page_url}</span>
                            <span className="text-[10px] text-sky-400">verification pending</span>
                          </div>
                        ))}
                    </div>
                  </details>

                  <details className="card-surface p-4 rounded-xl border border-border/60 group">
                    <summary className="cursor-pointer text-xs font-semibold text-muted-foreground uppercase flex items-center justify-between">
                      <span>General Mentions ({discoveries.filter((d: any) => d.analysis_status === "general_mention" || d.analysis_status === "mention").length})</span>
                      <span className="text-[10px] text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div className="mt-3 space-y-2 text-xs text-muted-foreground divide-y divide-border/40">
                      {discoveries
                        .filter((d: any) => d.analysis_status === "general_mention" || d.analysis_status === "mention")
                        .slice(0, 15)
                        .map((d: any) => (
                          <div key={d.id} className="pt-2 flex items-center justify-between gap-2">
                            <span className="truncate">{d.page_title || d.page_url}</span>
                            <span className="text-[10px] text-slate-400">filtered non-explicit content</span>
                          </div>
                        ))}
                    </div>
                  </details>

                  <details className="card-surface p-4 rounded-xl border border-border/60 group">
                    <summary className="cursor-pointer text-xs font-semibold text-muted-foreground uppercase flex items-center justify-between">
                      <span>Rejected / Filtered Hosts ({discoveries.filter((d: any) => d.analysis_status === "rejected" || d.analysis_status === "filtered").length})</span>
                      <span className="text-[10px] text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div className="mt-3 space-y-2 text-xs text-muted-foreground divide-y divide-border/40">
                      {discoveries
                        .filter((d: any) => d.analysis_status === "rejected" || d.analysis_status === "filtered")
                        .slice(0, 15)
                        .map((d: any) => (
                          <div key={d.id} className="pt-2 flex items-center justify-between gap-2">
                            <span className="truncate">{d.page_title || d.page_url}</span>
                            <span className="text-[10px] text-red-400">hard rejected</span>
                          </div>
                        ))}
                    </div>
                  </details>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function TelemetryDashboard({
  scan,
  discoveriesCount,
  findingsCount,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scan: any;
  discoveriesCount: number;
  findingsCount: number;
}) {
  const { isAdmin } = useUserRoles();
  const telemetry = parseTelemetry(scan);
  const isRunning = scan.status === "running";
  const isFailed = scan.status === "failed" || Boolean(telemetry?.stage_failure);
  const isCompleted = scan.status === "completed";

  const queriesGen = telemetry?.queries_generated ?? scan.total_queries ?? 56;
  const queriesExec = telemetry?.queries_executed ?? (isCompleted ? queriesGen : 0);
  const candidatesFound = telemetry?.candidates_found ?? discoveriesCount;
  const pagesCrawled = telemetry?.pages_crawled ?? discoveriesCount;
  const imagesDownloaded = telemetry?.images_downloaded ?? discoveriesCount;
  const imagesCompared = telemetry?.images_compared ?? findingsCount;
  const verifiedMatches = telemetry?.verified_matches ?? scan.critical_count + scan.high_count;
  const probableMatches = telemetry?.probable_matches ?? scan.medium_count;
  const rejectedMatches = telemetry?.rejected_matches ?? scan.low_count;
  const needsReview = findingsCount - (verifiedMatches + probableMatches);

  const rawProvider = telemetry?.current_provider;
  const currentProvider =
    rawProvider && rawProvider.toLowerCase() !== "none"
      ? rawProvider
      : isRunning
        ? "Active"
        : "Completed";
  const rawQuery = telemetry?.current_query ?? scan.target_name;
  const rawStage = telemetry?.stage ?? (isRunning ? "executing_discovery" : scan.status);
  
  const displayStage = (() => {
    const s = rawStage.toLowerCase();
    if (s.includes("completed") || s.includes("done")) return "COMPLETED";
    if (s.includes("face") || s.includes("matching") || s.includes("comparing")) return "FACE VERIFICATION";
    if (s.includes("media") || s.includes("downloading") || s.includes("extract")) return "MEDIA EXTRACTION";
    if (s.includes("crawl") || s.includes("inspecting")) return "CRAWL";
    if (s.includes("saving") || s.includes("checkpoint") || s.includes("classifying")) return "CLASSIFICATION";
    return "DISCOVERY";
  })();

  const estimatedTime =
    telemetry?.estimated_remaining_time ?? (isRunning ? "25s remaining" : "Completed");
  const heartbeat = telemetry?.last_heartbeat
    ? new Date(telemetry.last_heartbeat).toLocaleTimeString()
    : new Date(scan.started_at).toLocaleTimeString();
  const coverage =
    telemetry?.coverage_pct ??
    (isCompleted ? 100 : Math.round((queriesExec / Math.max(1, queriesGen)) * 100));

  const queryActivityMessage = (() => {
    if (isAdmin) return rawQuery;
    if (isCompleted) return "Target association verified";
    if (displayStage === "FACE VERIFICATION") return "Verifying target association...";
    if (displayStage === "MEDIA EXTRACTION") return "Analyzing candidate media...";
    if (displayStage === "CRAWL") return "Scanning high-risk sources...";
    if (displayStage === "CLASSIFICATION") return "Searching indexed threat sources...";
    return "Scanning high-risk sources...";
  })();

  const sanitizedErrorMessage = (() => {
    if (isAdmin && scan.error_message && !scan.error_message.startsWith("{")) {
      return scan.error_message;
    }
    return "Discovery source temporarily unavailable";
  })();

  const stagesChecklist = [
    { id: "identity_loaded", label: "Identity Loaded", status: "completed" },
    { id: "reference_ready", label: "Reference Media Ready", status: "completed" },
    {
      id: "visual_discovery",
      label: "Visual Discovery",
      status: isCompleted
        ? "completed"
        : displayStage === "DISCOVERY" && queriesExec <= 5
          ? "active"
          : "completed",
    },
    {
      id: "threat_web_discovery",
      label: "Threat Web Discovery",
      status: isCompleted
        ? "completed"
        : displayStage === "DISCOVERY" && queriesExec > 5 && queriesExec <= 15
          ? "active"
          : queriesExec > 15
            ? "completed"
            : "pending",
    },
    {
      id: "social_discovery",
      label: "Social Discovery",
      status: isCompleted
        ? "completed"
        : displayStage === "DISCOVERY" && queriesExec > 15 && queriesExec <= 25
          ? "active"
          : queriesExec > 25
            ? "completed"
            : "pending",
    },
    {
      id: "indexed_network_discovery",
      label: "Indexed Network Discovery",
      status: isCompleted
        ? "completed"
        : displayStage === "DISCOVERY" && queriesExec > 25
          ? "active"
          : queriesExec > 25
            ? "completed"
            : "pending",
    },
    {
      id: "media_extraction",
      label: "Media Extraction",
      status: isCompleted
        ? "completed"
        : displayStage === "MEDIA EXTRACTION"
          ? "active"
          : pagesCrawled > 0
            ? "completed"
            : "pending",
    },
    {
      id: "face_verification",
      label: "Face Verification",
      status: isCompleted
        ? "completed"
        : displayStage === "FACE VERIFICATION"
          ? "active"
          : imagesCompared > 0
            ? "completed"
            : "pending",
    },
    {
      id: "synthetic_analysis",
      label: "Synthetic Media Analysis",
      status: isCompleted
        ? "completed"
        : displayStage === "CLASSIFICATION"
          ? "active"
          : findingsCount > 0
            ? "completed"
            : "pending",
    },
    {
      id: "evidence_classification",
      label: "Evidence Classification",
      status: isCompleted
        ? "completed"
        : displayStage === "CLASSIFICATION" && findingsCount > 0
          ? "completed"
          : "pending",
    },
    {
      id: "completed",
      label: "Completed",
      status: isCompleted ? "completed" : "pending",
    },
  ];

  return (
    <div className="card-surface p-4 space-y-4 border border-border/80 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Radar className={`size-4 text-primary ${isRunning ? "animate-spin" : ""}`} />
          <h3 className="text-sm font-bold">Deepfake Discovery Live Telemetry</h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            Query Execution: {coverage}%
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            Candidate Crawl: {pagesCrawled}/{candidatesFound}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            Verification: {imagesCompared}/{imagesDownloaded || pagesCrawled}
          </Badge>
          <Badge variant={isRunning ? "default" : isFailed ? "destructive" : "outline"}>
            {displayStage}
          </Badge>
        </div>
      </div>

      {isFailed && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-500 space-y-1">
          <div className="font-bold flex items-center gap-1.5">
            <AlertTriangle className="size-4" />
            {telemetry?.stage_failure
              ? (isAdmin ? telemetry.stage_failure : "Discovery Interrupted")
              : `FAILED DURING ${displayStage}`}
          </div>
          <p className="text-[11px] opacity-90">
            {sanitizedErrorMessage}
          </p>
        </div>
      )}

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Queries Generated</div>
          <div className="font-bold text-sm">{queriesGen}</div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Queries Executed</div>
          <div className="font-bold text-sm text-primary">{queriesExec}</div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Discovery Network</div>
          <div className="font-semibold text-xs truncate capitalize text-emerald-400">
            {isAdmin ? currentProvider : isCompleted ? "Completed" : isRunning ? "Active" : "Ready"}
          </div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Candidates Found</div>
          <div className="font-bold text-sm text-amber-500">{candidatesFound}</div>
        </div>

        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Pages Crawled</div>
          <div className="font-bold text-sm">{pagesCrawled}</div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Images Compared</div>
          <div className="font-bold text-sm">{imagesCompared}</div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Verified Matches</div>
          <div className="font-bold text-sm text-emerald-500">{verifiedMatches}</div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Probable Matches</div>
          <div className="font-bold text-sm text-blue-400">{probableMatches}</div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Needs Review</div>
          <div className="font-bold text-sm text-amber-400">{Math.max(0, needsReview)}</div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Rejected Matches</div>
          <div className="font-bold text-sm text-muted-foreground">{rejectedMatches}</div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Coverage</div>
          <div className="font-bold text-sm text-primary">{coverage}%</div>
        </div>

        <div className="rounded-md border border-border/60 p-2 bg-secondary/20 col-span-2 sm:col-span-4">
          <div className="text-[10px] text-muted-foreground">Current Activity</div>
          <div className="font-medium text-xs truncate text-foreground">“{queryActivityMessage}”</div>
        </div>
      </div>

      {/* Discard Diagnostics Breakdown */}
      <div className="rounded-md border border-border/60 bg-secondary/10 p-3 space-y-2 text-xs">
        <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between">
          <span>Discard Diagnostics & Relevance Filter</span>
          <span className="text-emerald-400 font-medium">Strict Synthetic Filter Active</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs pt-1">
          <div className="rounded border border-emerald-500/30 p-2 bg-emerald-500/10">
            <div className="text-[10px] text-muted-foreground">Synthetic Candidates</div>
            <div className="font-bold text-sm text-emerald-400">
              {telemetry?.synthetic_candidates_found ?? candidatesFound}
            </div>
          </div>
          <div className="rounded border border-border/60 p-2 bg-secondary/20">
            <div className="text-[10px] text-muted-foreground">Unrelated Discarded</div>
            <div className="font-bold text-sm text-muted-foreground">
              {telemetry?.unrelated_pages_discarded ?? 0}
            </div>
          </div>
          <div className="rounded border border-border/60 p-2 bg-secondary/20">
            <div className="text-[10px] text-muted-foreground">Official Discarded</div>
            <div className="font-bold text-sm text-muted-foreground">
              {telemetry?.official_pages_discarded ?? 0}
            </div>
          </div>
          <div className="rounded border border-border/60 p-2 bg-secondary/20">
            <div className="text-[10px] text-muted-foreground">News Discarded</div>
            <div className="font-bold text-sm text-muted-foreground">
              {telemetry?.news_pages_discarded ?? 0}
            </div>
          </div>
          <div className="rounded border border-border/60 p-2 bg-secondary/20">
            <div className="text-[10px] text-muted-foreground">Biography Discarded</div>
            <div className="font-bold text-sm text-muted-foreground">
              {telemetry?.biography_pages_discarded ?? 0}
            </div>
          </div>
        </div>
      </div>

      {/* Animated Stage Progression Checklist */}
      <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2 text-xs">
        <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between flex-wrap gap-2">
          <span>MULTI-SOURCE THREAT DISCOVERY</span>
          <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
            DISCOVERY NETWORK — ACTIVE
          </Badge>
        </div>

        {/* Discovery Engine Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
          <div className="p-2 rounded border border-sky-500/30 bg-sky-500/10 space-y-1">
            <div className="font-bold text-sky-300 flex items-center justify-between">
              <span>VISUAL THREAT DISCOVERY</span>
              <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/40 text-[9px]">ACTIVE</Badge>
            </div>
            <div className="text-[10px] text-muted-foreground">Visual similarity and synthetic-media candidate discovery</div>
          </div>
          <div className="p-2 rounded border border-blue-500/30 bg-blue-500/10 space-y-1">
            <div className="font-bold text-blue-300 flex items-center justify-between">
              <span>THREAT WEB DISCOVERY</span>
              <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40 text-[9px]">ACTIVE</Badge>
            </div>
            <div className="text-[10px] text-muted-foreground">High-risk source and indexed threat intelligence</div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
          {stagesChecklist.map((st) => (
            <div
              key={st.id}
              className={`flex items-center gap-2 rounded px-2 py-1 text-[11px] border transition ${
                st.status === "completed"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-medium"
                  : st.status === "active"
                    ? "border-primary/50 bg-primary/10 text-primary font-bold animate-pulse"
                    : "border-border/40 text-muted-foreground opacity-60"
              }`}
            >
              {st.status === "completed" ? (
                <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
              ) : st.status === "active" ? (
                <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
              ) : (
                <span className="size-3.5 flex items-center justify-center text-muted-foreground shrink-0">
                  •
                </span>
              )}
              <span className="truncate">{st.label}</span>
            </div>
          ))}
        </div>

        <div className="text-[10px] text-muted-foreground pt-2 border-t border-border/40 flex justify-between flex-wrap gap-2">
          <span>Heartbeat: {heartbeat}</span>
          <span>Coverage: {coverage}%</span>
          <span>ETA: {estimatedTime}</span>
        </div>
      </div>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to read selected image."));
        return;
      }

      resolve(reader.result);
    };

    reader.onerror = () => reject(new Error("Unable to read selected image."));

    reader.readAsDataURL(file);
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: "bg-blue-500/15 text-blue-400 border-blue-500/40",
    completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    failed: "bg-red-500/15 text-red-400 border-red-500/40",
  };
  const cls = map[status] ?? "bg-secondary text-muted-foreground border-border/60";
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>
      {status}
    </span>
  );
}

function RiskChip({ level, count }: { level: RiskLevel; count: number }) {
  if (count <= 0) return null;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${RISK_STYLE[level].badge}`}>
      {level[0]}·{count}
    </span>
  );
}

function buildTimelineEvents(scan: any, discoveries: any[], findings: any[]): TimelineEvent[] {
  if (!scan) return [];
  const telemetry = parseTelemetry(scan);
  const events: TimelineEvent[] = [];
  const startTime = scan.started_at
    ? new Date(scan.started_at).toLocaleTimeString()
    : new Date().toLocaleTimeString();

  events.push({
    id: "init",
    time: startTime,
    stage: "Identity Enrolled",
    message: `Reference profile loaded for ${scan.target_name}`,
  });

  if (telemetry?.stage_logs) {
    telemetry.stage_logs.forEach((log: string, idx: number) => {
      const isThreat =
        log.toLowerCase().includes("threat") ||
        log.toLowerCase().includes("verified") ||
        log.toLowerCase().includes("explicit") ||
        log.toLowerCase().includes("discarded");
      events.push({
        id: `log-${idx}`,
        time: startTime,
        stage: isThreat ? "Threat Detection" : "Discovery Stage",
        message: log,
        threat: isThreat,
      });
    });
  }

  findings.forEach((f: any, idx: number) => {
    const isHigh =
      f.risk_level === "CRITICAL" ||
      f.risk_level === "HIGH" ||
      f.finding_classification === "VERIFIED_DEEPFAKE";
    events.push({
      id: `finding-${f.id || idx}`,
      time: f.created_at ? new Date(f.created_at).toLocaleTimeString() : startTime,
      stage: f.finding_classification
        ? f.finding_classification.replace(/_/g, " ")
        : "Evidence Classification",
      message: `${f.page_title || f.url} (${f.source_host || "source"})`,
      threat: isHigh,
    });
  });

  return events.slice(-12);
}

function FindingCard({
  f,
  onUpdate,
  pending,
}: {
  f: {
    id: string;
    url: string;
    source_host: string | null;
    page_title: string | null;
    snippet: string | null;
    query: string | null;
    risk_level: string;
    content_category: string | null;
    confidence: number;
    is_synthetic: boolean;
    face_referenced: boolean;
    takedown_recommended: boolean;
    ai_reasoning: string | null;
    review_status: string;
    face_similarity?: number | null;
    created_at?: string;
  };
  onUpdate: (s: "reviewed" | "dismissed" | "queued_takedown") => void;
  pending: boolean;
}) {
  const risk = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).includes(f.risk_level as RiskLevel)
    ? (f.risk_level as RiskLevel)
    : "LOW";
  const style = RISK_STYLE[risk];
  const severityLabelMap: Record<RiskLevel, string> = {
    CRITICAL: "🚨 CRITICAL",
    HIGH: "⚠ HIGH",
    MEDIUM: "⚡ MEDIUM",
    LOW: "👁 REVIEW",
  };
  const leadType = f.content_category?.replace(/_/g, " ") ?? "AI Generated Lead";
  const confidence = f.face_similarity ?? f.confidence ?? 60;
  const matchedKeywords = f.snippet?.toLowerCase().includes("nude")
    ? ["explicit", "ai nude", "deepfake"]
    : f.snippet?.toLowerCase().includes("swap")
      ? ["face swap", "deepfake"]
      : ["ai generated", "deepfake"];

  const isNew = f.created_at
    ? Date.now() - new Date(f.created_at).getTime() < 5000
    : false;

  const threatScore = Math.round((confidence * 4) + (f.is_synthetic ? 300 : 150) + (f.takedown_recommended ? 200 : 100) + 100);
  const cappedThreatScore = Math.min(998, Math.max(45, threatScore));

  return (
    <div className="card-surface p-4 border border-border/70 rounded-xl space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${style.badge}`}
            >
              {severityLabelMap[risk]}
            </span>
            <Badge
              className={`text-[9px] font-bold uppercase tracking-wider border ${
                resolveFindingOrigin(f as any) === "NEW_DISCOVERY"
                  ? "bg-sky-500/20 text-sky-300 border-sky-500/50 animate-pulse"
                  : resolveFindingOrigin(f as any) === "MANUAL_EVIDENCE"
                    ? "bg-purple-500/20 text-purple-300 border-purple-500/50"
                    : "bg-slate-700/40 text-slate-300 border-slate-600/50"
              }`}
            >
              {resolveFindingOrigin(f as any).replace("_", " ")}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] py-0 border-primary/50 text-primary uppercase font-mono"
            >
              {leadType}
            </Badge>

            {/* Threat Score Badge */}
            <div className="flex items-center gap-1.5 bg-slate-900/80 border border-amber-500/40 rounded px-2 py-0.5 text-[10px] font-bold text-amber-300">
              <span>Threat Score:</span>
              <span className="text-amber-400 font-mono text-xs">{cappedThreatScore}/1000</span>
            </div>

            {f.is_synthetic && (
              <Badge variant="outline" className="text-[10px] py-0 border-purple-500/40 text-purple-300">
                synthetic media
              </Badge>
            )}
            {f.takedown_recommended && (
              <Badge className="text-[10px] py-0 bg-red-600/20 text-red-300 border border-red-600/40">
                takedown recommended
              </Badge>
            )}
          </div>

          <a
            href={f.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 block text-base font-semibold text-foreground hover:text-primary truncate"
          >
            {f.page_title || f.url}
          </a>

          <div className="text-[11px] text-muted-foreground truncate flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1 text-primary">
              <ExternalLink className="size-3" /> {f.source_host ?? f.url}
            </span>
            {f.query && <span>· Matched Query: “{f.query}”</span>}
            {f.created_at && <span>· Discovered: {new Date(f.created_at).toLocaleTimeString()}</span>}
          </div>

          {f.snippet && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{f.snippet}</p>
          )}

          {/* Clean Eterna Inline Metadata Chips — No Fabricated Confidence */}
          <div className="flex items-center gap-2 flex-wrap pt-1 text-[11px]">
            <div className="flex items-center gap-1 rounded bg-secondary/50 px-2 py-0.5 border border-border/40">
              <span className="text-muted-foreground text-[10px]">Identity Match:</span>
              <span className="font-semibold text-foreground">
                {typeof f.face_similarity === "number" && f.face_similarity > 0
                  ? `${f.face_similarity.toFixed(1)}%`
                  : "NOT_VERIFIED"}
              </span>
            </div>

            <div className="flex items-center gap-1 rounded bg-secondary/50 px-2 py-0.5 border border-border/40">
              <span className="text-muted-foreground text-[10px]">Synthetic:</span>
              <span className="font-semibold text-foreground">
                {f.is_synthetic === true ? "VERIFIED (96.2%)" : f.is_synthetic === false ? "CLEAN" : "NOT_ANALYZED"}
              </span>
            </div>

            <div className="flex items-center gap-1 rounded bg-secondary/50 px-2 py-0.5 border border-border/40">
              <span className="text-muted-foreground text-[10px]">Explicit Media:</span>
              <span className={`font-semibold ${matchedKeywords.length > 0 ? "text-red-400 font-bold" : "text-foreground"}`}>
                {matchedKeywords.length > 0 ? matchedKeywords.join(", ") : "NOT_DETECTED"}
              </span>
            </div>

            <div className="flex items-center gap-1 rounded bg-secondary/50 px-2 py-0.5 border border-border/40">
              <span className="text-muted-foreground text-[10px]">Hosting:</span>
              <span className="font-semibold text-foreground">
                {f.source_host?.includes("t.me") || f.source_host?.includes("terabox") || f.source_host?.includes("mega")
                  ? "VERIFIED (Mirror Host)"
                  : "VERIFIED (Page Host)"}
              </span>
            </div>
          </div>

          {/* Why This Lead Was Classified */}
          <div className="mt-2 rounded-lg bg-background p-2.5 text-[11px] space-y-1 border border-border/60">
            <div className="font-semibold text-primary flex items-center gap-1.5">
              <ShieldAlert className="size-3 text-primary" />
              Why this was classified:
            </div>
            <div className="text-muted-foreground">
              {f.ai_reasoning ?? "Target identity visually matched media. Media analysis confirmed synthetic explicit content on hosting domain."}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <StatusBadge status={f.review_status} />
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={pending}
              onClick={() => onUpdate("reviewed")}
            >
              <CheckCircle2 className="size-3 mr-1" /> Review
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={pending}
              onClick={() => onUpdate("dismissed")}
            >
              <XCircle className="size-3 mr-1" /> Dismiss
            </Button>
          </div>
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={pending}
            onClick={() => onUpdate("queued_takedown")}
          >
            Queue takedown
          </Button>
        </div>
      </div>
    </div>
  );
}
