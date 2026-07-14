import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageCard, Pill } from "@/components/dashboard/PageCard";
import { AlertTriangle, ShieldCheck, Send, Sparkles, Loader2, Inbox } from "lucide-react";
import { getNotifications } from "@/lib/command-center.functions";

export const Route = createFileRoute("/_app/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Eterna AI" }] }),
  component: NotificationsPage,
});

const iconFor = {
  threat: AlertTriangle,
  enforcement: Send,
  asset: ShieldCheck,
  digest: Sparkles,
} as const;

function timeAgo(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  const days = Math.floor(d / 86400);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function NotificationsPage() {
  const fetchNotes = useServerFn(getNotifications);
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => fetchNotes(),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-5 max-w-3xl">
      <PageCard title="INBOX" sub="Latest alerts and updates">
        {q.isLoading ? (
          <div className="py-8 grid place-items-center text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
        ) : !q.data || q.data.notes.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
            <Inbox className="size-8 opacity-60" />
            <div className="text-sm">No notifications — you're all caught up.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {q.data.notes.map((n) => {
              const Icon = iconFor[n.kind] ?? Sparkles;
              return (
                <div key={n.id} className="flex gap-3 p-3 rounded-xl border border-border hover:bg-accent/30 transition">
                  <div className="size-10 rounded-xl grid place-items-center shrink-0" style={{ background: `color-mix(in oklab, ${n.tone} 14%, white)`, color: n.tone }}>
                    <Icon className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-sm truncate">{n.title}</div>
                      <Pill color={n.tone}>{n.tag}</Pill>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.body}</div>
                  </div>
                  <div className="text-[11px] text-muted-foreground shrink-0">{timeAgo(n.time)}</div>
                </div>
              );
            })}
          </div>
        )}
      </PageCard>
    </div>
  );
}
