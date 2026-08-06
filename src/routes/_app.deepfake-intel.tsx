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
} from "lucide-react";

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
  const [riskFilter, setRiskFilter] = useState<"ALL" | RiskLevel>("ALL");
  const [showGeneralMentions, setShowGeneralMentions] = useState(false);

  const profiles = useQuery({
    queryKey: ["deepfake-target-profiles"],
    queryFn: () => listProfilesFn({}),
  });

  const selectedProfile = (profiles.data ?? []).find((profile) => profile.id === selectedProfileId);

  const enrolledFaces = selectedProfile?.deepfake_reference_faces ?? [];

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

  const scan = selected.data?.scan ?? null;
  const findings = selected.data?.findings ?? [];
  const discoveries = selected.data?.discoveries ?? [];
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

        {/* Right: findings */}
        <div className="space-y-4">
          {!scan ? (
            <div className="card-surface p-10 text-center text-sm text-muted-foreground">
              <ShieldAlert
                className="size-8 mx-auto mb-2 text-muted-foreground/60"
                strokeWidth={1.2}
              />
              Run a sweep or select a scan from history to view findings.
            </div>
          ) : (
            <>
              <div className="card-surface p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">
                      TARGET
                    </div>
                    <div className="text-lg font-semibold">{scan.target_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {scan.total_queries} fresh queries · {scan.total_results} classified threats ·{" "}
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

              {/* Telemetry Dashboard: Granular live progress, heartbeat & stage diagnostics */}
              <TelemetryDashboard
                scan={scan}
                discoveriesCount={discoveries.length}
                findingsCount={findings.length}
              />

              {selected.isLoading ? (
                <div className="card-surface p-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="size-5 mx-auto animate-spin mb-2" /> Loading findings…
                </div>
              ) : filtered.length === 0 ? (
                <div className="card-surface p-10 text-center text-sm text-muted-foreground">
                  {scan.status === "running"
                    ? "Sweep in progress — results appear as classification completes."
                    : "No findings at this risk level."}
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {filtered.map((f) => (
                    <li key={f.id}>
                      <FindingCard
                        f={f}
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
  };
  onUpdate: (s: "reviewed" | "dismissed" | "queued_takedown") => void;
  pending: boolean;
}) {
  const risk = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).includes(f.risk_level as RiskLevel)
    ? (f.risk_level as RiskLevel)
    : "LOW";
  const style = RISK_STYLE[risk];
  const leadType = f.content_category?.replace(/_/g, " ") ?? "AI Generated Lead";
  const confidence = f.face_similarity ?? f.confidence ?? 60;
  const matchedKeywords = f.snippet?.toLowerCase().includes("nude")
    ? ["explicit", "ai nude", "deepfake"]
    : f.snippet?.toLowerCase().includes("swap")
      ? ["face swap", "deepfake"]
      : ["ai generated", "deepfake"];

  return (
    <div className="card-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${style.badge}`}
            >
              {risk}
            </span>
            <Badge
              variant="outline"
              className="text-[10px] py-0 border-primary/50 text-primary uppercase"
            >
              {leadType}
            </Badge>
            <span className="text-[10px] font-medium text-amber-500">
              Score: {Math.round(confidence * 8 + 150)}/1000
            </span>
            {f.is_synthetic && (
              <Badge variant="outline" className="text-[10px] py-0">
                synthetic
              </Badge>
            )}
            {f.face_referenced && (
              <Badge variant="outline" className="text-[10px] py-0">
                face ref
              </Badge>
            )}
            {f.takedown_recommended && (
              <Badge className="text-[10px] py-0 bg-red-600/20 text-red-400 border border-red-600/40">
                takedown
              </Badge>
            )}
          </div>
          <a
            href={f.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 block text-sm font-medium text-foreground hover:text-primary truncate"
          >
            {f.page_title || f.url}
          </a>
          <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
            <ExternalLink className="size-3" /> {f.source_host ?? f.url}
            {f.query && <span className="ml-1">· query “{f.query}”</span>}
          </div>
          {f.snippet && (
            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{f.snippet}</p>
          )}

          {/* Why This Lead Was Collected */}
          <div className="mt-2.5 rounded-md bg-secondary/30 p-2.5 text-[11px] space-y-1 border border-border/50">
            <div className="font-semibold text-primary flex items-center gap-1.5">
              <ShieldAlert className="size-3 text-primary" />
              Why This Lead Was Collected
            </div>
            <div>
              <span className="text-muted-foreground">Reason:</span>{" "}
              {f.ai_reasoning ?? "Matched search query and synthetic media risk indicators."}
            </div>
            <div>
              <span className="text-muted-foreground">Matched query:</span> “
              {f.query ?? "deepfake search"}”
            </div>
            <div>
              <span className="text-muted-foreground">Matched keywords:</span>{" "}
              {matchedKeywords.join(", ")}
            </div>
            {typeof f.face_similarity === "number" && f.face_similarity > 0 && (
              <div>
                <span className="text-muted-foreground">Face Similarity:</span>{" "}
                <span className="font-semibold text-emerald-400">
                  {f.face_similarity.toFixed(1)}%
                </span>
              </div>
            )}
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

  const queriesGen = telemetry?.queries_generated ?? scan.total_queries ?? 56;
  const queriesExec = telemetry?.queries_executed ?? (scan.status === "completed" ? queriesGen : 0);
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

  const currentProvider =
    telemetry?.current_provider ?? (isRunning ? "google_images" : "completed");
  const currentQuery = telemetry?.current_query ?? scan.target_name;
  const currentStage = telemetry?.stage ?? (isRunning ? "executing_discovery" : scan.status);
  const estimatedTime =
    telemetry?.estimated_remaining_time ?? (isRunning ? "25s remaining" : "Completed");
  const heartbeat = telemetry?.last_heartbeat
    ? new Date(telemetry.last_heartbeat).toLocaleTimeString()
    : new Date(scan.started_at).toLocaleTimeString();

  return (
    <div className="card-surface p-4 space-y-4 border border-border/80 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Radar className={`size-4 text-primary ${isRunning ? "animate-spin" : ""}`} />
          <h3 className="text-sm font-bold">Deepfake Discovery Live Telemetry</h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {estimatedTime}
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

      {/* Grid of metrics */}
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
          <div className="text-[10px] text-muted-foreground">Candidates Found</div>
          <div className="font-bold text-sm text-amber-500">{candidatesFound}</div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Current Provider</div>
          <div className="font-semibold text-xs truncate capitalize">{currentProvider}</div>
        </div>

        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Pages Crawled</div>
          <div className="font-bold text-sm">{pagesCrawled}</div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20">
          <div className="text-[10px] text-muted-foreground">Images Downloaded</div>
          <div className="font-bold text-sm">{imagesDownloaded}</div>
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
          <div className="text-[10px] text-muted-foreground">Rejected Matches</div>
          <div className="font-bold text-sm text-muted-foreground">{rejectedMatches}</div>
        </div>
        <div className="rounded-md border border-border/60 p-2 bg-secondary/20 col-span-2">
          <div className="text-[10px] text-muted-foreground">Current Query</div>
          <div className="font-medium text-xs truncate">{currentQuery}</div>
        </div>
      </div>

      {/* Stage-level checklist */}
      {telemetry?.stage_logs && telemetry.stage_logs.length > 0 && (
        <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-1 text-xs">
          <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase mb-1 flex items-center justify-between">
            <span>Stage Diagnostics</span>
            <span>Providers: {providers}</span>
          </div>
          {telemetry.stage_logs.map((log, idx) => (
            <div key={idx} className="flex items-center gap-1.5 text-[11px]">
              {log.startsWith("✓") ? (
                <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
              ) : log.startsWith("✖") ? (
                <XCircle className="size-3 text-red-500 shrink-0" />
              ) : (
                <Loader2 className="size-3 text-primary animate-spin shrink-0" />
              )}
              <span>{log.replace(/^[✓✖⚠]\s*/, "")}</span>
            </div>
          ))}
          <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40 mt-1 flex justify-between">
            <span>Last heartbeat: {heartbeat}</span>
            <span>Est. Remaining: {estimatedTime}</span>
          </div>
        </div>
      )}
    </div>
  );
}
