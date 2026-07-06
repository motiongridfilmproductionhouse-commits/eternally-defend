import { createFileRoute } from "@tanstack/react-router";
import { PageCard, Pill } from "@/components/dashboard/PageCard";
import { AlertTriangle, ShieldCheck, Send, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_app/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Eterna AI" }] }),
  component: NotificationsPage,
});

const notes = [
  { icon: AlertTriangle, title: "Critical deepfake detected", body: "YouTube — Deepfake Video Spreading. Confidence 92%.", time: "2m ago", tone: "oklch(0.63 0.24 25)", tag: "Critical" },
  { icon: Send, title: "Takedown accepted", body: "Instagram removed impersonation account @fake-you.", time: "1h ago", tone: "oklch(0.68 0.16 155)", tag: "Success" },
  { icon: ShieldCheck, title: "New asset protected", body: "Podcast Ep. 42 Audio fingerprinted and registered.", time: "Today", tone: "oklch(0.55 0.22 295)", tag: "Info" },
  { icon: Sparkles, title: "Weekly digest ready", body: "Your protection summary for last week is available.", time: "Yesterday", tone: "oklch(0.65 0.18 240)", tag: "Digest" },
];

function NotificationsPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <PageCard title="INBOX" sub="Latest alerts and updates">
        <div className="space-y-3">
          {notes.map((n) => {
            const Icon = n.icon;
            return (
              <div key={n.title} className="flex gap-3 p-3 rounded-xl border border-border hover:bg-accent/30">
                <div className="size-10 rounded-xl grid place-items-center shrink-0" style={{ background: `color-mix(in oklab, ${n.tone} 14%, white)`, color: n.tone }}>
                  <Icon className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-sm">{n.title}</div>
                    <Pill color={n.tone}>{n.tag}</Pill>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{n.body}</div>
                </div>
                <div className="text-[11px] text-muted-foreground shrink-0">{n.time}</div>
              </div>
            );
          })}
        </div>
      </PageCard>
    </div>
  );
}
