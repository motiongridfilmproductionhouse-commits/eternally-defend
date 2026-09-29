import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useServerFn } from "@tanstack/react-start";
import {
  createEnforcementRequest,
  getRemovalVerificationDocuments,
  uploadRemovalVerificationDocument,
} from "@/lib/scan-actions.functions";
import { useAuthorization } from "@/hooks/use-authorization";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  IdCard,
  Loader2,
  LockKeyhole,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ActionTarget = {
  id: string;
  title: string;
  url: string;
  source: string;
  platform: string;
  threatScore: number | null;
  evidenceCount: number;
  status: string | null;
  requestId?: string | null;
  author?: string | null;
};

type VerificationDocumentType = "client_identity" | "signed_authorization";

const SUBMITTED_STATUSES = new Set(["queued", "sent", "approved", "submitted", "under_review"]);

const ACTIONS_BY_PLATFORM: Record<string, string[]> = {
  YouTube: [
    "Copyright / DMCA Review",
    "Impersonation Report",
    "Privacy Complaint",
    "Harassment Report",
    "Trademark Report",
    "Deepfake / Synthetic Media Review",
    "Add to Legal Review",
  ],
  Instagram: [
    "Copyright Report",
    "Impersonation / Fake Account",
    "Trademark Report",
    "Harassment Report",
    "Privacy Report",
  ],
  Facebook: [
    "Copyright Report",
    "Impersonation / Fake Account",
    "Trademark Report",
    "Harassment Report",
    "Privacy Report",
  ],
  TikTok: ["Copyright Report", "Impersonation Report", "Trademark Report", "Harassment Report"],
  X: ["Impersonation Report", "Trademark Report", "Harassment / Abuse Report", "Privacy Report"],
  Reddit: ["Report Post", "Moderator Contact Package", "Copyright Review", "Harassment Review"],
  News: [
    "Publisher Contact",
    "Correction Request",
    "Right-of-Reply Package",
    "Copyright Notice",
    "Legal Review",
  ],
  Blogs: ["Publisher Contact", "Correction Request", "Copyright Notice", "Legal Review"],
  Archive: ["Preserve as Evidence", "Link to Existing Case", "Generate Historical Evidence Record"],
};

function actionsFor(platform: string): string[] {
  if (ACTIONS_BY_PLATFORM[platform]) return ACTIONS_BY_PLATFORM[platform];
  const p = (platform || "").toLowerCase();
  if (p.includes("youtube")) return ACTIONS_BY_PLATFORM.YouTube;
  if (p.includes("insta")) return ACTIONS_BY_PLATFORM.Instagram;
  if (p.includes("face")) return ACTIONS_BY_PLATFORM.Facebook;
  if (p.includes("tiktok")) return ACTIONS_BY_PLATFORM.TikTok;
  if (p === "x" || p.includes("twitter")) return ACTIONS_BY_PLATFORM.X;
  if (p.includes("reddit")) return ACTIONS_BY_PLATFORM.Reddit;
  if (p.includes("news")) return ACTIONS_BY_PLATFORM.News;
  if (p.includes("blog")) return ACTIONS_BY_PLATFORM.Blogs;
  if (p.includes("archive")) return ACTIONS_BY_PLATFORM.Archive;
  return ["Publisher Contact", "Legal Review", "Add to Case"];
}

export function ActionDrawer({
  target,
  open,
  onOpenChange,
  onCreated,
}: {
  target: ActionTarget | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}) {
  const authz = useAuthorization();
  const create = useServerFn(createEnforcementRequest);
  const uploadDocument = useServerFn(uploadRemovalVerificationDocument);
  const getDocuments = useServerFn(getRemovalVerificationDocuments);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<VerificationDocumentType | null>(null);
  const identityInput = useRef<HTMLInputElement | null>(null);
  const authorizationInput = useRef<HTMLInputElement | null>(null);

  const submitted = Boolean(
    target?.requestId && SUBMITTED_STATUSES.has(target.status?.toLowerCase() ?? ""),
  );
  const documentsQuery = useQuery({
    queryKey: ["removal-verification-documents", target?.requestId],
    enabled: open && submitted && Boolean(target?.requestId),
    queryFn: () => {
      if (!target?.requestId) throw new Error("Removal request not found.");
      return getDocuments({ data: { enforcementRequestId: target.requestId } });
    },
  });

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setUploading(null);
    }
  }, [open]);

  const actions = useMemo(
    () => (target ? actionsFor(target.platform || target.source) : []),
    [target],
  );

  const submit = async () => {
    if (!target || !selected) return;
    setBusy(true);
    try {
      await create({ data: { scanHitId: target.id, method: selected } });
      toast.success(`Draft request created — ${selected}`);
      onCreated?.();
      onOpenChange(false);
      setSelected(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create request");
    } finally {
      setBusy(false);
    }
  };

  const handleDocument = async (documentType: VerificationDocumentType, file: File | null) => {
    if (!file || !target?.requestId) return;
    const accepted = ["application/pdf", "image/png", "image/jpeg"];
    if (!accepted.includes(file.type)) {
      toast.error("Upload a PDF, PNG, or JPEG document.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Document must be smaller than 10 MB.");
      return;
    }
    setUploading(documentType);
    try {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Unable to read document."));
        reader.readAsDataURL(file);
      });
      await uploadDocument({
        data: {
          enforcementRequestId: target.requestId,
          documentType,
          filename: file.name,
          mimeType: file.type as "application/pdf" | "image/png" | "image/jpeg",
          fileBase64,
        },
      });
      await documentsQuery.refetch();
      toast.success("Document uploaded securely for review.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload document.");
    } finally {
      setUploading(null);
      if (identityInput.current) identityInput.current.value = "";
      if (authorizationInput.current) authorizationInput.current.value = "";
    }
  };

  const canRequest = authz.canRequestEnforcement || authz.canTakedown;

  if (submitted && target) {
    const identityDocument = documentsQuery.data?.clientIdentity ?? null;
    const authorizationDocument = documentsQuery.data?.signedAuthorization ?? null;
    const steps = ["Request Submitted", "Verification Required", "Platform Review"];
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="rrs-modal max-h-[92vh] max-w-xl overflow-y-auto rounded-[24px] border-primary/10 bg-background/95 p-0 shadow-[0_30px_80px_-30px_color-mix(in_oklab,var(--primary)_35%,transparent)] backdrop-blur-xl">
          <div className="relative overflow-hidden px-7 pb-6 pt-8">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/10 to-transparent" />
            <div className="rrs-stagger relative" style={{ ["--d" as string]: "80ms" }}>
              <div className="relative mb-5 grid size-14 place-items-center">
                <span className="rrs-glow absolute inset-0 rounded-full bg-primary/30 blur-xl" />
                <span className="rrs-pulse relative grid size-14 place-items-center rounded-full bg-gradient-to-br from-primary/15 to-primary/35 text-primary ring-1 ring-primary/20">
                  <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                    <path d="M14 3v5h5" />
                    <path className="rrs-check" d="m9 14 2 2 4-4" />
                  </svg>
                </span>
              </div>
              <DialogHeader className="text-left">
                <DialogTitle className="text-[22px] font-semibold tracking-tight">
                  Removal Request Already Submitted
                </DialogTitle>
                <DialogDescription className="pt-2 leading-relaxed">
                  Your removal request has already been submitted for platform review through
                  Eterna's Express Removal Process.
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="rrs-stagger relative mt-6" style={{ ["--d" as string]: "160ms" }}>
              <div className="relative mx-3 h-[3px] rounded-full bg-muted">
                <div className="rrs-progress absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/60 to-primary" />
              </div>
              <div className="-mt-[9px] grid grid-cols-3">
                {steps.map((step, i) => (
                  <div
                    key={step}
                    className={`flex flex-col gap-2 ${i === 0 ? "items-start" : i === 1 ? "items-center" : "items-end"}`}
                  >
                    <span
                      className={`size-[15px] rounded-full border-2 ${
                        i === 0
                          ? "border-primary bg-primary"
                          : i === 1
                            ? "rrs-current border-primary bg-background"
                            : "border-muted-foreground/30 bg-background"
                      }`}
                    />
                    <span
                      className={`text-[11px] ${i === 1 ? "font-semibold text-primary" : "text-muted-foreground"}`}
                    >
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3 px-7 pb-7">
            <div className="rrs-stagger" style={{ ["--d" as string]: "240ms" }}>
              <VerificationUpload
                number="1"
                title="Identity Verification"
                description="Upload a valid government-issued identification document to complete identity verification."
                icon={<IdCard className="size-5" />}
                uploadedName={identityDocument?.filename ?? null}
                busy={uploading === "client_identity"}
                onClick={() => identityInput.current?.click()}
                buttonLabel="Upload ID Document"
              />
            </div>
            <div className="rrs-stagger" style={{ ["--d" as string]: "320ms" }}>
              <VerificationUpload
                number="2"
                title="Signed Client Authorization"
                description="Upload the signed agreement confirming that Eterna Sentinel Defence LLC is authorized to act on behalf of the client."
                icon={<FileCheck2 className="size-5" />}
                uploadedName={authorizationDocument?.filename ?? null}
                busy={uploading === "signed_authorization"}
                onClick={() => authorizationInput.current?.click()}
                buttonLabel="Upload Authorization Agreement"
              />
            </div>

            <input
              ref={identityInput}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="sr-only"
              onChange={(event) =>
                handleDocument("client_identity", event.target.files?.[0] ?? null)
              }
            />
            <input
              ref={authorizationInput}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="sr-only"
              onChange={(event) =>
                handleDocument("signed_authorization", event.target.files?.[0] ?? null)
              }
            />

            <div
              className="rrs-stagger flex items-start gap-2 pt-2 text-xs leading-relaxed text-muted-foreground"
              style={{ ["--d" as string]: "400ms" }}
            >
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-primary" />
              Your documents are encrypted and used only for verification and case processing.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Take Action</SheetTitle>
          <SheetDescription>
            Draft a takedown or platform report. Nothing is submitted externally without your
            approval.
          </SheetDescription>
        </SheetHeader>

        {target && (
          <div className="mt-4 space-y-4 text-sm">
            <div className="rounded-lg border border-border p-3 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Finding
              </div>
              <div className="font-semibold line-clamp-2">{target.title || "Untitled finding"}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{target.platform || target.source}</span>
                {target.author && <span>· {target.author}</span>}
                {typeof target.threatScore === "number" && (
                  <span>· Threat {Math.round(target.threatScore)}</span>
                )}
                <span>· Evidence {target.evidenceCount}</span>
                {target.status && <span>· {target.status}</span>}
              </div>
              {target.url && (
                <a
                  href={target.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary text-[11px] hover:underline"
                >
                  <ExternalLink className="size-3" /> Open source
                </a>
              )}
            </div>

            {!canRequest && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 text-warning-foreground p-3 text-xs flex gap-2">
                <ShieldAlert className="size-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Enforcement unavailable</div>
                  <div>
                    Complete authorization and ownership verification before submitting a takedown.
                    You can still save a draft.
                  </div>
                </div>
              </div>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Available actions for {target.platform || target.source}
              </div>
              <div className="space-y-1">
                {actions.map((a) => (
                  <button
                    key={a}
                    onClick={() => setSelected(a)}
                    className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-accent transition ${selected === a ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <span>{a}</span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground flex gap-2">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              This will create a Draft enforcement request. It will not be submitted to any platform
              until you review and approve it in the Enforcement Center.
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => onOpenChange(false)}
                className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!selected || busy}
                className="text-xs px-4 py-2 rounded-lg text-white font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                style={{ background: "var(--gradient-brand)" }}
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />} Save Draft
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function VerificationUpload({
  number,
  title,
  description,
  icon,
  uploadedName,
  busy,
  onClick,
  buttonLabel,
}: {
  number: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  uploadedName: string | null;
  busy: boolean;
  onClick: () => void;
  buttonLabel: string;
}) {
  return (
    <div className="group rounded-[18px] border border-border/70 bg-card p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_12px_32px_-16px_color-mix(in_oklab,var(--primary)_45%,transparent)]">
      <div className="flex items-start gap-4">
        <div className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/10 to-primary/25 text-primary">
          {icon}
          <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-background text-[10px] font-semibold text-primary ring-1 ring-primary/20">
            {number}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <LockKeyhole className="size-3" /> Secure upload
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">Accepted formats: JPG, PNG, PDF</p>
          <Button
            type="button"
            size="sm"
            variant={uploadedName ? "outline" : "default"}
            className="mt-3 rounded-full px-4"
            onClick={onClick}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : uploadedName ? (
              <CheckCircle2 className="mr-2 size-4 text-primary" />
            ) : (
              <Upload className="mr-2 size-4 transition-transform duration-300 group-hover:-translate-y-0.5" />
            )}
            {busy ? "Uploading…" : uploadedName ? "Replace document" : buttonLabel}
          </Button>
          {uploadedName ? (
            <p className="mt-2 truncate text-xs text-primary">Uploaded: {uploadedName}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
