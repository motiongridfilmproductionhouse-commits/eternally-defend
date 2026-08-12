import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ScanFace, ShieldCheck, Trash2, Upload } from "lucide-react";
import {
  listProtectedFaceReferences,
  manualFaceScan,
  deactivateProtectedFace,
} from "@/lib/face-protection/protected-faces.functions";
import { scannerToneForVerdict } from "@/lib/face-protection/protected-face-registry";

type ScanState =
  | { phase: "idle" }
  | { phase: "scanning"; step: string }
  | {
      phase: "done";
      verdict: "MATCH" | "NO_MATCH" | "NEEDS_REVIEW";
      similarity: number | null;
      faceDetected: boolean;
      threshold: number;
    };

const TONE_CLASS: Record<"blue" | "amber" | "red", string> = {
  blue: "border-sky-400/60 shadow-[0_0_40px_-12px_rgb(56_189_248/0.7)]",
  amber: "border-amber-400/70 shadow-[0_0_40px_-12px_rgb(251_191_36/0.7)]",
  red: "border-red-500/70 shadow-[0_0_40px_-12px_rgb(239_68_68/0.7)]",
};

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

export function ProtectedFacesPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listProtectedFaceReferences);
  const scanFn = useServerFn(manualFaceScan);
  const deactivateFn = useServerFn(deactivateProtectedFace);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState>({ phase: "idle" });
  const fileRef = useRef<HTMLInputElement | null>(null);

  const query = useQuery({
    queryKey: ["protected-face-references"],
    queryFn: () => listFn(),
  });

  const faces = query.data?.faces ?? [];
  const active = faces.filter((f) => f.status === "ACTIVE");
  const selected = active.find((f) => f.id === selectedId) ?? active[0] ?? null;

  const scanMut = useMutation({
    mutationFn: async (file: File) => {
      if (!selected) throw new Error("Select a protected face first.");
      setScan({ phase: "scanning", step: "Reading image…" });
      const dataUrl = await readAsBase64(file);
      const contentType = (file.type || "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";
      setScan({ phase: "scanning", step: "Comparing against protected reference…" });
      return scanFn({
        data: {
          protectedFaceId: selected.id,
          imageBase64: dataUrl,
          contentType: ["image/jpeg", "image/png", "image/webp"].includes(contentType)
            ? contentType
            : "image/jpeg",
        },
      });
    },
    onSuccess: (r) => {
      setScan({
        phase: "done",
        verdict: r.verdict,
        similarity: r.similarity,
        faceDetected: r.faceDetected,
        threshold: r.threshold,
      });
      qc.invalidateQueries({ queryKey: ["face-matches"] });
      qc.invalidateQueries({ queryKey: ["protected-face-references"] });
    },
    onError: (e: Error) => {
      setScan({ phase: "idle" });
      toast.error(e.message);
    },
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => deactivateFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Protected face deactivated");
      qc.invalidateQueries({ queryKey: ["protected-face-references"] });
      qc.invalidateQueries({ queryKey: ["protected-faces"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tone = scannerToneForVerdict(scan.phase === "done" ? scan.verdict : "SCANNING");

  return (
    <section className="card-surface p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="size-4" /> Protected Faces ({faces.length})
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Enrolled references are reused by automatic monitoring and manual scans.
        </span>
      </div>

      {query.isLoading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : faces.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No protected faces yet. Complete Face Protection enrollment to create one.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {faces.map((f) => {
            const isSelected = selected?.id === f.id;
            const isActive = f.status === "ACTIVE";
            return (
              <div
                key={f.id}
                className={`rounded-xl border p-3 flex gap-3 ${isSelected ? "border-primary/60 bg-primary/5" : "border-border"}`}
              >
                <div className="size-16 shrink-0 rounded-full overflow-hidden border border-border bg-muted grid place-items-center">
                  {f.thumbnailUrl ? (
                    <img
                      src={f.thumbnailUrl}
                      alt={`${f.label ?? "Protected"} reference thumbnail`}
                      className="size-full object-cover"
                    />
                  ) : (
                    <ScanFace className="size-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1 text-xs space-y-1">
                  <div className="font-medium truncate">
                    {f.label ?? query.data?.displayName ?? "Protected reference"}
                  </div>
                  <div
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      isActive
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isActive ? "ACTIVE · FACE SHIELD" : "INACTIVE"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Enrolled {new Date(f.created_at).toLocaleDateString()}
                  </div>
                  {f.lastActivity && (
                    <div className="text-[10px] text-muted-foreground">
                      Last match {new Date(f.lastActivity.at).toLocaleDateString()}
                      {typeof f.lastActivity.similarity === "number"
                        ? ` · ${f.lastActivity.similarity.toFixed(1)}%`
                        : ""}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    {isActive && (
                      <button
                        onClick={() => {
                          setSelectedId(f.id);
                          setScan({ phase: "idle" });
                        }}
                        className="text-[11px] font-medium text-primary"
                      >
                        Run Manual Scan
                      </button>
                    )}
                    <button
                      onClick={() => deactivateMut.mutate(f.id)}
                      disabled={!isActive || deactivateMut.isPending}
                      className="inline-flex items-center gap-1 text-destructive text-[11px] disabled:opacity-40"
                    >
                      <Trash2 className="size-3" /> Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-border p-4 flex flex-col sm:flex-row items-center gap-5">
          <div className={`relative size-32 rounded-full border-2 overflow-hidden ${TONE_CLASS[tone]}`}>
            {selected.thumbnailUrl ? (
              <img
                src={selected.thumbnailUrl}
                alt="Protected identity reference"
                className="size-full object-cover"
              />
            ) : (
              <div className="size-full grid place-items-center bg-muted">
                <ScanFace className="size-8 text-muted-foreground" />
              </div>
            )}
            {scan.phase === "scanning" && (
              <div className="absolute inset-x-0 h-0.5 bg-sky-400/90 animate-[scanline_1.6s_linear_infinite]" />
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Protected Identity
            </div>
            <div className="text-sm font-semibold truncate">
              {selected.label ?? query.data?.displayName ?? "Protected reference"}
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) scanMut.mutate(file);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={scanMut.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
            >
              {scanMut.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              Choose Image
            </button>

            {scan.phase === "scanning" && (
              <p className="text-[11px] text-sky-500">{scan.step}</p>
            )}

            {scan.phase === "done" && (
              <div className="text-xs space-y-1">
                {scan.verdict === "MATCH" && (
                  <>
                    <div className="font-semibold text-red-500">MATCH DETECTED</div>
                    <div className="text-muted-foreground">
                      Similarity: {scan.similarity?.toFixed(1)}% (threshold {scan.threshold}%)
                    </div>
                  </>
                )}
                {scan.verdict === "NEEDS_REVIEW" && (
                  <>
                    <div className="font-semibold text-amber-500">NEEDS REVIEW</div>
                    <div className="text-muted-foreground">
                      {scan.similarity === null
                        ? "Image quality was too low for a confident decision."
                        : `Similarity: ${scan.similarity.toFixed(1)}% — below the ${scan.threshold}% match gate.`}
                    </div>
                  </>
                )}
                {scan.verdict === "NO_MATCH" && (
                  <>
                    <div className="font-semibold text-sky-500">NO MATCH</div>
                    <div className="text-muted-foreground">
                      {scan.faceDetected
                        ? "No protected-face match detected."
                        : "No face detected in this image."}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
