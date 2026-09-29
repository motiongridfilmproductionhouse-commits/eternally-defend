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

const SUBMITTED_STATUSES = new Set(["sent", "approved", "submitted", "under_review"]);

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
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl overflow-hidden border-primary/20 p-0">
          <div className="border-b border-border bg-primary/5 px-6 py-5">
            <div className="mb-4 grid size-11 place-items-center rounded-lg border border-primary/20 bg-background text-primary">
              <FileCheck2 className="size-5" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-xl">Removal Request Already Submitted</DialogTitle>
              <DialogDescription className="pt-2 leading-relaxed">
                Your removal request has already been submitted through the Eterna Central System.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-5 px-6 pb-6">
            <p className="text-sm leading-relaxed text-muted-foreground">
              To complete the client verification process and support the platform submission,
              please upload the following documents:
            </p>

            <div className="space-y-3">
              <VerificationUpload
                number="1"
                title="Client ID Document"
                description="Upload a valid government-issued identity document for verification."
                icon={<IdCard className="size-4" />}
                uploadedName={identityDocument?.filename ?? null}
                busy={uploading === "client_identity"}
                onClick={() => identityInput.current?.click()}
                buttonLabel="Upload ID Document"
              />
              <VerificationUpload
                number="2"
                title="Signed Client Authorization Agreement"
                description="Upload the signed authorization agreement confirming that Eterna Sentinel Defence LLC is authorized to act on behalf of the client."
                icon={<FileCheck2 className="size-4" />}
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

            <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-4 text-xs sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Status:</span>{" "}
                <strong>Removal Request Submitted</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Verification:</span>{" "}
                <strong>Documents Required</strong>
              </div>
            </div>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-primary" />
              Your documents will be handled securely and used only for verification and case
              processing purposes.
            </p>
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
    <div className="rounded-lg border border-border p-4 transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
          {number}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={onClick}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : uploadedName ? (
              <CheckCircle2 className="mr-2 size-4 text-emerald-600" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}
            {uploadedName ? "Replace document" : buttonLabel}
          </Button>
          {uploadedName ? (
            <p className="mt-2 truncate text-xs text-emerald-700">Uploaded: {uploadedName}</p>
          ) : null}
        </div>
        <div className="text-primary">{icon}</div>
      </div>
    </div>
  );
}
