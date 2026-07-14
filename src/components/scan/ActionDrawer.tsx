import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useServerFn } from "@tanstack/react-start";
import { createEnforcementRequest } from "@/lib/scan-actions.functions";
import { useAuthorization } from "@/hooks/use-authorization";
import { toast } from "sonner";
import { AlertTriangle, ChevronRight, ExternalLink, Loader2, ShieldAlert } from "lucide-react";

export type ActionTarget = {
  id: string;
  title: string;
  url: string;
  source: string;
  platform: string;
  threatScore: number | null;
  evidenceCount: number;
  status: string | null;
  author?: string | null;
};

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
  Instagram: ["Copyright Report", "Impersonation / Fake Account", "Trademark Report", "Harassment Report", "Privacy Report"],
  Facebook: ["Copyright Report", "Impersonation / Fake Account", "Trademark Report", "Harassment Report", "Privacy Report"],
  TikTok: ["Copyright Report", "Impersonation Report", "Trademark Report", "Harassment Report"],
  X: ["Impersonation Report", "Trademark Report", "Harassment / Abuse Report", "Privacy Report"],
  Reddit: ["Report Post", "Moderator Contact Package", "Copyright Review", "Harassment Review"],
  News: ["Publisher Contact", "Correction Request", "Right-of-Reply Package", "Copyright Notice", "Legal Review"],
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
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const actions = useMemo(() => (target ? actionsFor(target.platform || target.source) : []), [target]);

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

  const canRequest = authz.canRequestEnforcement || authz.canTakedown;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Take Action</SheetTitle>
          <SheetDescription>
            Draft a takedown or platform report. Nothing is submitted externally without your approval.
          </SheetDescription>
        </SheetHeader>

        {target && (
          <div className="mt-4 space-y-4 text-sm">
            <div className="rounded-lg border border-border p-3 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Finding</div>
              <div className="font-semibold line-clamp-2">{target.title || "Untitled finding"}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{target.platform || target.source}</span>
                {target.author && <span>· {target.author}</span>}
                {typeof target.threatScore === "number" && <span>· Threat {Math.round(target.threatScore)}</span>}
                <span>· Evidence {target.evidenceCount}</span>
                {target.status && <span>· {target.status}</span>}
              </div>
              {target.url && (
                <a href={target.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary text-[11px] hover:underline">
                  <ExternalLink className="size-3" /> Open source
                </a>
              )}
            </div>

            {!canRequest && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 text-warning-foreground p-3 text-xs flex gap-2">
                <ShieldAlert className="size-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Enforcement unavailable</div>
                  <div>Complete authorization and ownership verification before submitting a takedown. You can still save a draft.</div>
                </div>
              </div>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Available actions for {target.platform || target.source}</div>
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
              This will create a Draft enforcement request. It will not be submitted to any platform until you review and approve it in the Enforcement Center.
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={() => onOpenChange(false)} className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-accent">
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
