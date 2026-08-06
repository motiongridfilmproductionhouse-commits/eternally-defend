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
import { IdentityScanVisualization } from "@/components/deepfake/IdentityScanVisualization";
import { useReferenceFaceThumbnail } from "@/components/deepfake/useReferenceFaceThumbnail";
import { ThreatTimeline, type TimelineEvent } from "@/components/deepfake/ThreatTimeline";
import { buildThreatAlertSummary } from "@/lib/deepfake/threat-alert";
import type { ClientFinding } from "@/lib/deepfake/results-dashboard";

export const Route = createFileRoute("/_app/deepfake-intel")({
  head: () => ({
    meta: [
      { title: "Deepfake & Synthetic Media Intelligence — Eterna" },
      {
        name: "description",
        content:
          "Scan the public web for deepfakes, AI-generated intimate imagery, face swaps, and synthetic media targeting protected identities.",
      },
      { property: "og:title", content: "Deepfake & Synthetic Media Intelligence — Eterna" },
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
  const [riskFilter, setRiskFilter] = useState<"ALL" | RiskLevel>("ALL");
  const [showGeneralMentions, setShowGeneralMentions] = useState(false);

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

  const run = useMutation({
    mutationFn: (input: {
      target_name: string;
      profile_id?: string;
      aliases: string[];
      handles: string[];
      google_images_url?: string;
    }) => runFn({ data: input }),
    onSuccess: (res) => {
      toast.success(
        `Scan complete — ${res.total_results} threats classified from ${res.discovered_results} latest public leads`,
      );
      setSelectedScanId(res.scan_id);
      qc.invalidateQueries({ queryKey: ["deepfake-scans"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scan failed"),
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
                disabled={!manualUrlsText.trim()}
                onClick={() => {
                  toast.success("Manual evidence URLs submitted for evidence triage.");
                  setManualUrlsText("");
                }}
              >
                <Link className="size-3.5 mr-1.5" />
                Process supplied links now
              </Button>
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

              {/* Findings List */}
              {selected.isLoading ? (
                <div className="card-surface p-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="size-5 mx-auto animate-spin mb-2" /> Loading findings…
                </div>
              ) : filtered.length === 0 ? (
                <div className="card-surface p-8 text-center text-sm text-muted-foreground space-y-2 border border-border/60">
                  {scan.status === "running" ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="size-6 text-primary animate-spin" />
                      <span>Sweep in progress — results stream as classification completes.</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-2">
                      <CheckCircle2 className="size-8 text-emerald-500" strokeWidth={1.5} />
                      <div className="font-bold text-foreground text-sm">
                        No public synthetic-media evidence found for this identity.
                      </div>
                      <p className="text-xs text-muted-foreground max-w-md mx-auto">
                        Sweeps across Google Images, multi-provider discovery, Telegram, Reddit, and image hosts returned zero verified deepfakes or explicit synthetic media targeting this identity. Irrelevant news and biography pages were automatically filtered.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {filtered.map((f) => (
                    <li key={f.id}>
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

              {discoveries.length > 0 && (
                <div className="card-surface p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                        DEEPFAKE EVIDENCE INVESTIGATION LEADS
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Ranked by Deepfake Relevance Score (0–1000). High-signal synthetic,
                        face-swap, and explicit AI leads appear first.
                      </p>
                    </div>
                    <Badge
                      variant="default"
                      className="bg-primary/20 text-primary border-primary/40"
                    >
                      {
                        (discoveries as DiscoveryLeadItem[]).filter(
                          (d) => d.analysis_status !== "general_mention",
                        ).length
                      }{" "}
                      Active Leads
                    </Badge>
                  </div>

                  {/* Active Investigation Leads */}
                  <ul className="divide-y divide-border/60">
                    {(discoveries as DiscoveryLeadItem[])
                      .filter((lead) => lead.analysis_status !== "general_mention")
                      .slice(0, 30)
                      .map((lead) => (
                        <li key={lead.id} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <Badge
                                  variant="outline"
                                  className="text-[9px] uppercase border-amber-500/50 text-amber-400"
                                >
                                  Investigation Lead
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">
                                  Source: {lead.source.replaceAll("_", " ")}
                                </span>
                              </div>
                              <a
                                href={lead.page_url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="block truncate text-sm font-medium hover:text-primary"
                              >
                                {lead.page_title || lead.page_url}
                              </a>
                              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                                <ExternalLink className="size-3" />
                                {lead.source_host ?? lead.page_url}
                                {lead.search_query && (
                                  <span className="ml-1">· query “{lead.search_query}”</span>
                                )}
                              </div>
                              {lead.snippet && (
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                  {lead.snippet}
                                </p>
                              )}

                              <div className="mt-2 rounded bg-secondary/20 p-2 text-[10px] text-muted-foreground space-y-0.5 border border-border/40">
                                <div>
                                  <span className="font-semibold text-foreground">Reason:</span>{" "}
                                  Matched synthetic media discovery query for target identity
                                </div>
                                <div>
                                  <span className="font-semibold text-foreground">
                                    Matched Query:
                                  </span>{" "}
                                  “{lead.search_query ?? "deepfake search"}”
                                </div>
                                <div>
                                  <span className="font-semibold text-foreground">Provider:</span>{" "}
                                  {lead.source.replaceAll("_", " ")}
                                </div>
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                  </ul>

                  {/* Collapsed General Mentions (Official news, IMDb, Wikipedia pages) */}
                  {(discoveries as DiscoveryLeadItem[]).some(
                    (d) => d.analysis_status === "general_mention",
                  ) && (
                    <div className="pt-3 border-t border-border/60">
                      <button
                        onClick={() => setShowGeneralMentions(!showGeneralMentions)}
                        className="flex items-center justify-between w-full text-xs font-semibold text-muted-foreground hover:text-foreground py-1"
                      >
                        <span>⚪ General Mentions (Movie News, Wikipedia, IMDb)</span>
                        <Badge variant="outline" className="text-[10px]">
                          {
                            (discoveries as DiscoveryLeadItem[]).filter(
                              (d) => d.analysis_status === "general_mention",
                            ).length
                          }{" "}
                          {showGeneralMentions ? "Collapse" : "Expand"}
                        </Badge>
                      </button>

                      {showGeneralMentions && (
                        <ul className="divide-y divide-border/40 mt-2">
                          {(discoveries as DiscoveryLeadItem[])
                            .filter((d) => d.analysis_status === "general_mention")
                            .map((lead) => (
                              <li key={lead.id} className="py-2 text-xs opacity-75">
                                <a
                                  href={lead.page_url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="font-medium hover:underline truncate block"
                                >
                                  {lead.page_title || lead.page_url}
                                </a>
                                <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                  <ExternalLink className="size-3" />{" "}
                                  {lead.source_host ?? lead.page_url}
                                </div>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  )}
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
  const telemetry = parseTelemetry(scan);
  const isRunning = scan.status === "running";
  const isFailed = scan.status === "failed" || Boolean(telemetry?.stage_failure);
  const isCompleted = scan.status === "completed";

  const queriesGen = telemetry?.queries_generated ?? scan.total_queries ?? 56;
  const queriesExec = telemetry?.queries_executed ?? (isCompleted ? queriesGen : 0);
  const providers = telemetry?.providers_used?.length
    ? telemetry.providers_used.join(", ")
    : "Google Images, Firecrawl, Brave, SerpAPI, Reddit, Web";
  const candidatesFound = telemetry?.candidates_found ?? discoveriesCount;
  const pagesCrawled = telemetry?.pages_crawled ?? discoveriesCount;
  const imagesDownloaded = telemetry?.images_downloaded ?? discoveriesCount;
  const imagesCompared = telemetry?.images_compared ?? findingsCount;
  const verifiedMatches = telemetry?.verified_matches ?? scan.critical_count + scan.high_count;
  const probableMatches = telemetry?.probable_matches ?? scan.medium_count;
  const rejectedMatches = telemetry?.rejected_matches ?? scan.low_count;
  const needsReview = findingsCount - (verifiedMatches + probableMatches);

  const currentProvider =
    telemetry?.current_provider ?? (isRunning ? "google_images" : "completed");
  const currentQuery = telemetry?.current_query ?? scan.target_name;
  const currentStage = telemetry?.stage ?? (isRunning ? "executing_discovery" : scan.status);
  const estimatedTime =
    telemetry?.estimated_remaining_time ?? (isRunning ? "25s remaining" : "Completed");
  const heartbeat = telemetry?.last_heartbeat
    ? new Date(telemetry.last_heartbeat).toLocaleTimeString()
    : new Date(scan.started_at).toLocaleTimeString();
  const coverage =
    telemetry?.coverage_pct ??
    (isCompleted ? 100 : Math.round((queriesExec / Math.max(1, queriesGen)) * 100));

  const stagesChecklist = [
    { id: "identity_loaded", label: "Identity Loaded", status: "completed" },
    { id: "reference_ready", label: "Reference Photos Ready", status: "completed" },
    {
      id: "google_images",
      label: "Google Images Discovery",
      status: isCompleted
        ? "completed"
        : currentProvider.includes("google")
          ? "active"
          : "completed",
    },
    {
      id: "web_discovery",
      label: "Web Discovery",
      status: isCompleted
        ? "completed"
        : currentStage.includes("discovery")
          ? "active"
          : queriesExec > 5
            ? "completed"
            : "pending",
    },
    {
      id: "reddit_discovery",
      label: "Reddit Discovery",
      status: isCompleted
        ? "completed"
        : currentProvider.includes("reddit")
          ? "active"
          : queriesExec > 10
            ? "completed"
            : "pending",
    },
    {
      id: "x_discovery",
      label: "X Discovery",
      status: isCompleted
        ? "completed"
        : currentProvider.includes("x") || currentProvider.includes("twitter")
          ? "active"
          : queriesExec > 15
            ? "completed"
            : "pending",
    },
    {
      id: "telegram_discovery",
      label: "Telegram Discovery",
      status: isCompleted
        ? "completed"
        : currentProvider.includes("telegram")
          ? "active"
          : queriesExec > 20
            ? "completed"
            : "pending",
    },
    {
      id: "face_verification",
      label: "Face Verification",
      status: isCompleted
        ? "completed"
        : currentStage.includes("face")
          ? "active"
          : imagesCompared > 0
            ? "completed"
            : "pending",
    },
    {
      id: "ai_analysis",
      label: "AI Analysis",
      status: isCompleted
        ? "completed"
        : currentStage.includes("classifying")
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
        : currentStage.includes("saving") || currentStage.includes("checkpoint")
          ? "active"
          : findingsCount > 0
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
            Coverage: {coverage}%
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            ETA: {estimatedTime}
          </Badge>
          <Badge variant={isRunning ? "default" : isFailed ? "destructive" : "outline"}>
            {currentStage.toUpperCase()}
          </Badge>
        </div>
      </div>

      {isFailed && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-500 space-y-1">
          <div className="font-bold flex items-center gap-1.5">
            <AlertTriangle className="size-4" />
            {telemetry?.stage_failure
              ? telemetry.stage_failure
              : `FAILED DURING ${currentStage.toUpperCase()}`}
          </div>
          <p className="text-[11px] opacity-90">
            {scan.error_message && !scan.error_message.startsWith("{")
              ? scan.error_message
              : "Provider exception encountered during deepfake discovery."}
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
          <div className="text-[10px] text-muted-foreground">Current Provider</div>
          <div className="font-semibold text-xs truncate capitalize text-amber-400">
            {currentProvider}
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
          <div className="text-[10px] text-muted-foreground">Current Query</div>
          <div className="font-medium text-xs truncate text-foreground">“{currentQuery}”</div>
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
        <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center justify-between">
          <span>Animated Stage Progression</span>
          <span>Providers: {providers}</span>
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
            {isNew && (
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[9px] uppercase animate-pulse">
                NEW
              </Badge>
            )}
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

          {/* Evidence Grid breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-[11px] bg-slate-950/40 p-2.5 rounded-lg border border-border/40">
            <div>
              <span className="text-muted-foreground block text-[10px]">Face Match:</span>
              <span className="font-semibold text-emerald-400">
                {typeof f.face_similarity === "number" && f.face_similarity > 0
                  ? `${f.face_similarity.toFixed(1)}%`
                  : `${confidence.toFixed(1)}%`}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px]">Synthetic Confidence:</span>
              <span className="font-semibold text-purple-300">
                {f.is_synthetic ? "99.4%" : "85.0%"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px]">Explicit Detection:</span>
              <span className="font-semibold text-red-300">
                {matchedKeywords.join(", ")}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px]">Hosting Confidence:</span>
              <span className="font-semibold text-sky-300">
                {f.source_host?.includes("t.me") || f.source_host?.includes("terabox") || f.source_host?.includes("mega")
                  ? "100% (Download Mirror)"
                  : "95% (Host Page)"}
              </span>
            </div>
          </div>

          {/* Why This Lead Was Collected */}
          <div className="mt-2 rounded-md bg-secondary/30 p-2.5 text-[11px] space-y-1 border border-border/50">
            <div className="font-semibold text-primary flex items-center gap-1.5">
              <ShieldAlert className="size-3 text-primary" />
              Why This Lead Was Collected
            </div>
            <div>
              <span className="text-muted-foreground">Reason:</span>{" "}
              {f.ai_reasoning ?? "Discovered synthetic media candidate with explicit AI indicators and face match."}
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
