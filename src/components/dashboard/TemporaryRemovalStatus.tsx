import { useEffect, useState } from "react";
import { Check, Clock3, MessageSquare, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const DISMISS_KEY = "eterna:rafmoh-status-notice:nov-2026";

export function TemporaryRemovalStatus() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(sessionStorage.getItem(DISMISS_KEY) !== "dismissed");
    } catch {
      setOpen(true);
    }
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      try { sessionStorage.setItem(DISMISS_KEY, "dismissed"); } catch { /* Dismissal still works when storage is unavailable. */ }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg rounded-lg border-border bg-card p-6 text-card-foreground sm:p-8">
        <DialogHeader className="text-left">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase text-primary">
            <ShieldCheck className="h-4 w-4" /> Removal status update
          </div>
          <DialogTitle className="pr-6 font-display text-2xl tracking-normal">Rafmoh Gold</DialogTitle>
          <DialogDescription className="pt-2">Your submitted posts are currently under review.</DialogDescription>
        </DialogHeader>
        <ol className="my-3">
          {[
            { title: "Submitted", detail: "Removal request submitted", Icon: Check, state: "done" },
            { title: "Communication completed", detail: "Communication stage completed", Icon: MessageSquare, state: "done" },
            { title: "Review", detail: "Currently in progress", Icon: Clock3, state: "current" },
            { title: "Posts removal expected soon", detail: "Pending review outcome and platform confirmation", Icon: Clock3, state: "pending" },
          ].map(({ title, detail, Icon, state }, index) => (
            <li key={title} className="relative flex min-h-20 gap-4 pb-5 last:min-h-0 last:pb-0" aria-current={state === "current" ? "step" : undefined}>
              {index < 3 && <span aria-hidden="true" className="absolute bottom-0 left-4 top-8 w-px bg-border" />}
              <span className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-full border ${state === "done" ? "border-success/25 bg-success/10 text-success" : state === "current" ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"}`}>
                {state === "current" && <span className="absolute inset-0 rounded-full border border-primary/30 motion-safe:animate-ping" />}
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 pt-1">
                <p className={`text-sm font-semibold ${state === "pending" ? "text-muted-foreground" : "text-foreground"}`}>{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-border pt-4">
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">Removal is not yet confirmed. Final timing depends on the platform’s review.</p>
          <Button className="w-full" onClick={() => onOpenChange(false)}>Continue to dashboard</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}