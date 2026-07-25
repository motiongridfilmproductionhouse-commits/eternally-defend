import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  runDeepfakeScan,
  listDeepfakeScans,
  getDeepfakeScan,
  updateDeepfakeFinding,
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
  ScanFace, ShieldAlert, ExternalLink, Loader2, AlertTriangle,
  CheckCircle2, XCircle, Filter, Radar, Upload, Trash2,
  UserRoundCheck,
} from "lucide-react";

export const Route = createFileRoute("/_app/deepfake-intel")({
  head: () => ({
    meta: [
      { title: "Deepfake & Synthetic Media Intelligence — Eterna" },
      { name: "description", content: "Scan the public web for deepfakes, AI-generated intimate imagery, face swaps, and synthetic media targeting protected identities." },
      { property: "og:title", content: "Deepfake & Synthetic Media Intelligence — Eterna" },
      { property: "og:description", content: "Cautious, evidence-graded intelligence sweeps for deepfake and synthetic media abuse." },
    ],
  }),
  component: DeepfakeIntelPage,
});

type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

const RISK_STYLE: Record<RiskLevel, { badge: string; dot: string }> = {
  CRITICAL: { badge: "bg-red-600/15 text-red-500 border-red-600/40", dot: "bg-red-500" },
  HIGH:     { badge: "bg-orange-500/15 text-orange-400 border-orange-500/40", dot: "bg-orange-400" },
  MEDIUM:   { badge: "bg-amber-400/15 text-amber-400 border-amber-400/40", dot: "bg-amber-400" },
  LOW:      { badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40", dot: "bg-emerald-400" },
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

  const profiles = useQuery({
    queryKey: ["deepfake-target-profiles"],
    queryFn: () => listProfilesFn({}),
  });

  const selectedProfile = (profiles.data ?? []).find(
    (profile) => profile.id === selectedProfileId,
  );

  const enrolledFaces =
    selectedProfile?.deepfake_reference_faces ?? [];

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
    queryFn: () => selectedScanId ? getFn({ data: { scan_id: selectedScanId } }) : null,
    enabled: !!selectedScanId,
    refetchInterval: (q) => {
      const d = q.state.data as { scan?: { status?: string } } | null | undefined;
      return d?.scan?.status === "running" ? 3_000 : false;
    },
  });

  const run = useMutation({
    mutationFn: (input: {
      target_name: string;
      profile_id: string;
      aliases: string[];
      handles: string[];
      google_images_url?: string;
    }) => runFn({ data: input }),
    onSuccess: (res) => {
      toast.success(`Scan complete — ${res.total_results} public results classified`);
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
      toast.error(
        error instanceof Error
          ? error.message
          : "Profile creation failed",
      ),
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
              content_type: file.type as
                | "image/jpeg"
                | "image/png"
                | "image/webp",
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
        `${uploaded.length} reference photo${
          uploaded.length === 1 ? "" : "s"
        } enrolled`,
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Reference photo upload failed",
      ),
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
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to remove reference photo",
      ),
  });

  const upd = useMutation({
    mutationFn: (v: { finding_id: string; review_status: "new" | "reviewed" | "dismissed" | "queued_takedown" }) =>
      updFn({ data: v }),
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

    if (!selectedProfileId) {
      toast.error("Create or select a protected identity profile");
      return;
    }

    if (enrolledFaces.length < 3) {
      toast.error(
        "Upload at least three clear reference photos before scanning",
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
      profile_id: selectedProfileId,
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

  const onReferenceFilesSelected = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";

    const allowed = selected.filter((file) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type),
    );

    if (allowed.length !== selected.length) {
      toast.error("Only JPEG, PNG and WebP photos are supported");
    }

    const remainingSlots = Math.max(
      0,
      5 - enrolledFaces.length,
    );

    setReferenceFiles(allowed.slice(0, remainingSlots));
  };

  const scan = selected.data?.scan ?? null;
  const findings = selected.data?.findings ?? [];
  const filtered = riskFilter === "ALL" ? findings : findings.filter((f) => f.risk_level === riskFilter);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] tracking-[0.2em] text-muted-foreground font-semibold">SYNTHETIC MEDIA INTEL</div>
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
            <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">NEW SCAN</div>
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
                <span className="ml-1 font-normal text-muted-foreground">
                  Optional
                </span>
              </label>

              <Input
                type="url"
                value={googleImagesUrl}
                onChange={(e) => setGoogleImagesUrl(e.target.value)}
                placeholder="Paste Google Images search URL"
              />

              <p className="text-[10px] text-muted-foreground">
                Open Google Images, search the protected identity, then paste
                the search-page URL here.
              </p>
            </div>

            <div className="rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <UserRoundCheck className="size-4 text-primary" />
                <div>
                  <div className="text-xs font-semibold">
                    Protected identity verification
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Face matching removes results showing a different person.
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Identity profile
                </label>

                <select
                  value={selectedProfileId}
                  onChange={(event) => {
                    const profileId = event.target.value;
                    setSelectedProfileId(profileId);

                    const profile = (profiles.data ?? []).find(
                      (item) => item.id === profileId,
                    );

                    if (profile?.target_name) {
                      setTargetName(profile.target_name);
                    }
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Select protected identity</option>
                  {(profiles.data ?? []).map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.target_name} · {
                        profile.deepfake_reference_faces?.length ?? 0
                      }/5 photos
                    </option>
                  ))}
                </select>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={
                    createProfile.isPending ||
                    !targetName.trim()
                  }
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
                    <label className="text-xs font-medium">
                      Reference photos
                    </label>
                    <Badge
                      variant={
                        enrolledFaces.length >= 3
                          ? "default"
                          : "secondary"
                      }
                    >
                      {enrolledFaces.length}/5 enrolled
                    </Badge>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    Upload 3–5 clear photos of the same person. Use front,
                    left-angle and right-angle photographs. Avoid group photos,
                    sunglasses and heavily edited images.
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
                              <span className="text-xs">
                                Reference photo {index + 1}
                              </span>
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
                              onClick={() =>
                                deleteReference.mutate(face.id)
                              }
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
                            {referenceFiles.length} photo{
                              referenceFiles.length === 1 ? "" : "s"
                            } selected
                          </div>

                          <Button
                            type="button"
                            className="w-full"
                            disabled={uploadReferences.isPending}
                            onClick={() =>
                              uploadReferences.mutate(referenceFiles)
                            }
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
                !selectedProfileId ||
                enrolledFaces.length < 3
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
                  Run Face-Verified Sweep
                </>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Reddit is excluded. Site-scoped queries cover X, Twitter, Instagram, TikTok,
              YouTube, Vimeo, Facebook, Threads, Imgur, Medium, and GitHub.
            </p>
          </div>

          <div className="card-surface p-4">
            <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground mb-2">SCAN HISTORY</div>
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
              <ShieldAlert className="size-8 mx-auto mb-2 text-muted-foreground/60" strokeWidth={1.2} />
              Run a sweep or select a scan from history to view findings.
            </div>
          ) : (
            <>
              <div className="card-surface p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">TARGET</div>
                    <div className="text-lg font-semibold">{scan.target_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {scan.total_queries} queries · {scan.total_results} classified results
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
                            riskFilter === r ? "bg-primary/15 border-primary/50 text-primary" : "border-border/60 text-muted-foreground hover:bg-secondary/40"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {scan.error_message && (
                  <div className="mt-3 text-xs text-red-500 flex items-start gap-2">
                    <AlertTriangle className="size-3.5 mt-0.5" /> {scan.error_message}
                  </div>
                )}
              </div>

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
                        onUpdate={(status) => upd.mutate({ finding_id: f.id, review_status: status })}
                        pending={upd.isPending}
                      />
                    </li>
                  ))}
                </ul>
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

    reader.onerror = () =>
      reject(new Error("Unable to read selected image."));

    reader.readAsDataURL(file);
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running:   "bg-blue-500/15 text-blue-400 border-blue-500/40",
    completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    failed:    "bg-red-500/15 text-red-400 border-red-500/40",
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
    id: string; url: string; source_host: string | null; page_title: string | null;
    snippet: string | null; query: string | null; risk_level: string; content_category: string | null;
    confidence: number; is_synthetic: boolean; face_referenced: boolean; takedown_recommended: boolean;
    ai_reasoning: string | null; review_status: string;
  };
  onUpdate: (s: "reviewed" | "dismissed" | "queued_takedown") => void;
  pending: boolean;
}) {
  const risk = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).includes(f.risk_level as RiskLevel)
    ? (f.risk_level as RiskLevel) : "LOW";
  const style = RISK_STYLE[risk];
  return (
    <div className="card-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${style.badge}`}>{risk}</span>
            {f.content_category && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {f.content_category.replace(/_/g, " ")}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">· conf {f.confidence}%</span>
            {f.is_synthetic && <Badge variant="outline" className="text-[10px] py-0">synthetic</Badge>}
            {f.face_referenced && <Badge variant="outline" className="text-[10px] py-0">face ref</Badge>}
            {f.takedown_recommended && <Badge className="text-[10px] py-0 bg-red-600/20 text-red-400 border border-red-600/40">takedown</Badge>}
          </div>
          <a href={f.url} target="_blank" rel="noreferrer noopener"
             className="mt-1.5 block text-sm font-medium text-foreground hover:text-primary truncate">
            {f.page_title || f.url}
          </a>
          <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
            <ExternalLink className="size-3" /> {f.source_host ?? f.url}
            {f.query && <span className="ml-1">· query “{f.query}”</span>}
          </div>
          {f.snippet && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{f.snippet}</p>}
          {f.ai_reasoning && (
            <p className="text-[11px] text-muted-foreground/90 italic mt-1.5 line-clamp-2">
              {f.ai_reasoning}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <StatusBadge status={f.review_status} />
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                    disabled={pending} onClick={() => onUpdate("reviewed")}>
              <CheckCircle2 className="size-3 mr-1" /> Review
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                    disabled={pending} onClick={() => onUpdate("dismissed")}>
              <XCircle className="size-3 mr-1" /> Dismiss
            </Button>
          </div>
          <Button size="sm" className="h-7 px-2 text-[11px]"
                  disabled={pending} onClick={() => onUpdate("queued_takedown")}>
            Queue takedown
          </Button>
        </div>
      </div>
    </div>
  );
}
