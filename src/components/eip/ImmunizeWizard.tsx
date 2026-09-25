import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UploadCloud, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuthorization } from "@/hooks/use-authorization";
import { useSession } from "@/hooks/use-session";
import { eipDb, sha256Hex, type EipJob } from "@/lib/eip/eip-data";

type Check = { label: string; state: "READY" | "WARNING" | "BLOCKED"; note: string };
const STATE_CLS = {
  READY: "text-success border-success/30 bg-success/10",
  WARNING: "text-warning border-warning/30 bg-warning/10",
  BLOCKED: "text-danger border-danger/30 bg-danger/10",
} as const;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

export function ImmunizeWizard({ onCreated, onCancel }: { onCreated: (j: EipJob) => void; onCancel: () => void }) {
  const { session } = useSession();
  const authz = useAuthorization();
  const qc = useQueryClient();
  const rec = (authz.state?.authorization ?? null) as { id: string; legal_name?: string } | null;
  const authorized = !!rec && (authz.status === "authorized" || authz.status === "enterprise_authorized" || authz.state?.clientAuthorizationStatus === "signed" || authz.completed);
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setDims({ w: 0, h: 0 });
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const checks: Check[] = useMemo(() => {
    if (!file || !dims) return [];
    const valid = ACCEPT.includes(file.type) && dims.w > 0;
    const minSide = Math.min(dims.w, dims.h);
    return [
      { label: "Image", state: valid ? "READY" : "BLOCKED", note: valid ? file.type : "Invalid image" },
      {
        label: "Resolution",
        state: !valid ? "BLOCKED" : minSide < 512 ? "WARNING" : "READY",
        note: `${dims.w} × ${dims.h}${minSide < 512 ? " — below 512px, non-optimal" : ""}`,
      },
      {
        label: "Image quality",
        state: file.size < 60_000 ? "WARNING" : "READY",
        note: file.size < 60_000 ? "Small file — may be heavily compressed" : "Acceptable",
      },
      {
        label: "Face detected",
        state: "WARNING",
        note: "Confirmed by the EIP engine during validation; images without a single clear face will be blocked",
      },
      {
        label: "Authorization linked",
        state: authorized ? "READY" : "BLOCKED",
        note: authorized ? rec!.id : "Authorization missing",
      },
    ];
  }, [file, dims, authorized, rec]);
  const blocked = checks.some((c) => c.state === "BLOCKED");

  async function start() {
    if (!file || !dims || !session || !rec) return;
    setBusy(true);
    try {
      const hash = await sha256Hex(file);
      const ext = file.name.split(".").pop() ?? "img";
      const path = `${session.user.id}/${crypto.randomUUID()}.${ext}`;
      const up = await eipDb.storage.from("eip-uploads").upload(path, file, { contentType: file.type });
      if (up.error) throw up.error;
      const { data, error } = await eipDb
        .from("eip_jobs")
        .insert({
          user_id: session.user.id,
          image_name: file.name,
          storage_path: path,
          mime_type: file.type,
          width: dims.w,
          height: dims.h,
          size_bytes: file.size,
          original_sha256: hash,
          authorization_ref: rec.id,
          authorized_identity: rec.legal_name ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["eip"] });
      onCreated(data as EipJob);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start immunization");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2 text-xs">
        {["Authorization", "Upload", "Preflight", "Confirm"].map((s, i) => (
          <li
            key={s}
            className={`rounded-full border px-3 py-1 ${step === i + 1 ? "border-primary text-primary bg-primary/5" : "border-border text-muted-foreground"}`}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section className="space-y-4">
          <h3 className="font-display text-lg font-bold">Confirm Authorization</h3>
          {authz.loading ? (
            <p className="text-sm text-muted-foreground">Checking authorization…</p>
          ) : authorized ? (
            <dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Account</dt>
              <dd className="break-words">{session?.user.email}</dd>
              <dt className="text-muted-foreground">Authorized identity</dt>
              <dd>{rec?.legal_name ?? "—"}</dd>
              <dt className="text-muted-foreground">Authorization ID</dt>
              <dd className="font-mono text-xs break-all">{rec?.id}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-success font-semibold">Active</dd>
            </dl>
          ) : (
            <p className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
              Authorization required before Image Immunization can begin.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button disabled={!authorized} onClick={() => setStep(2)}>Continue</Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <h3 className="font-display text-lg font-bold">Upload Image</h3>
          <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card p-8 text-center cursor-pointer hover:border-primary/40 transition">
            <UploadCloud className="size-7 text-primary" />
            <span className="text-sm text-foreground">Upload the image you intend to publish or distribute.</span>
            <span className="text-xs text-muted-foreground">JPEG, PNG or WebP · up to 25 MB</span>
            <input
              type="file"
              accept={ACCEPT.join(",")}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && f.size > 25 * 1024 * 1024) return toast.error("File is larger than 25 MB");
                setDims(null);
                setFile(f ?? null);
              }}
            />
          </label>
          {file && preview && (
            <div className="flex items-center gap-4">
              <img src={preview} alt="" className="size-24 rounded-lg object-cover border border-border" />
              <div className="text-sm min-w-0">
                <div className="font-medium truncate">{file.name}</div>
                <div className="text-muted-foreground">
                  {dims ? `${dims.w} × ${dims.h}` : "Reading…"} · {(file.size / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button disabled={!file || !dims} onClick={() => setStep(3)}>Run preflight</Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <h3 className="font-display text-lg font-bold">Preflight Check</h3>
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{c.label}</div>
                  <div className="text-xs text-muted-foreground break-words">{c.note}</div>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATE_CLS[c.state]}`}>
                  {c.state}
                </span>
              </li>
            ))}
          </ul>
          <div className={`text-sm font-semibold ${blocked ? "text-danger" : "text-success"}`}>
            {blocked ? "Blocked — resolve the items above" : "Ready for EIP"}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
            <Button disabled={blocked} onClick={() => setStep(4)}>Continue</Button>
          </div>
        </section>
      )}

      {step === 4 && file && (
        <section className="space-y-4">
          <h3 className="font-display text-lg font-bold flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" /> Ready for Image Immunization
          </h3>
          <dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Selected asset</dt>
            <dd className="truncate">{file.name}</dd>
            <dt className="text-muted-foreground">Authorization ID</dt>
            <dd className="font-mono text-xs break-all">{rec?.id}</dd>
            <dt className="text-muted-foreground">EIP engine version</dt>
            <dd>Assigned by the EIP engine when processing starts</dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            Your image is stored privately in your account and processed only for Image Immunization. It is never
            shared or published by Eterna.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
            <Button disabled={busy} onClick={start}>{busy ? "Starting…" : "Start Immunization"}</Button>
          </div>
        </section>
      )}
    </div>
  );
}
