import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  listWaitlist,
  approveWaitlistSignup,
  declineWaitlistSignup,
} from "@/lib/waitlist/waitlist-admin.functions";
import { PageCard } from "@/components/dashboard/PageCard";
import { AdminGuard } from "@/components/AdminGuard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, MailCheck, Ban } from "lucide-react";

export const Route = createFileRoute("/_app/admin/waitlist")({
  head: () => ({
    meta: [
      { title: "Waitlist Review — Eterna Sentinel" },
      {
        name: "description",
        content:
          "Review stored Eterna Priority Access registrations and issue login-creation links to approved people.",
      },
      { property: "og:title", content: "Waitlist Review — Eterna Sentinel" },
      {
        property: "og:description",
        content: "Approve waitlist registrations and send invitation-based account creation links.",
      },
    ],
  }),
  component: () => (
    <AdminGuard>
      <WaitlistAdminPage />
    </AdminGuard>
  ),
});

type Filter = "PENDING" | "APPROVED" | "DECLINED" | "ALL";

function WaitlistAdminPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWaitlist);
  const approveFn = useServerFn(approveWaitlistSignup);
  const declineFn = useServerFn(declineWaitlistSignup);

  const [filter, setFilter] = useState<Filter>("PENDING");
  const [issued, setIssued] = useState<{ email: string; code: string; url: string } | null>(null);

  const list = useQuery({ queryKey: ["admin-waitlist"], queryFn: () => listFn() });

  const approve = useMutation({
    mutationFn: (vars: { id: string; email: string }) => approveFn({ data: { id: vars.id } }),
    onSuccess: (res, vars) => {
      setIssued({ email: vars.email, code: res.code, url: res.signupUrl });
      if (res.emailSent) toast.success(`Login creation link emailed to ${vars.email}`);
      else toast.error(`Invitation created, but email failed: ${res.emailError}`);
      qc.invalidateQueries({ queryKey: ["admin-waitlist"] });
      qc.invalidateQueries({ queryKey: ["signup-invites"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decline = useMutation({
    mutationFn: (vars: { id: string }) => declineFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-waitlist"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (list.data?.rows ?? []).filter((r) => filter === "ALL" || r.status === filter);
  const counts = list.data?.counts;

  return (
    <div className="space-y-5">
      <PageCard
        title="WAITLIST REGISTRATIONS"
        sub="Every /waitinglist submission is stored here. Approving a person issues a single-use invitation bound to their email and sends them a login-creation link."
      >
        <div className="flex flex-wrap items-center gap-2">
          {(["PENDING", "APPROVED", "DECLINED", "ALL"] as Filter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f}
              {counts && f !== "ALL"
                ? ` (${f === "PENDING" ? counts.pending : f === "APPROVED" ? counts.approved : counts.declined})`
                : counts && f === "ALL"
                  ? ` (${counts.total})`
                  : ""}
            </Button>
          ))}
        </div>

        {issued ? (
          <div className="mt-4 rounded-xl border border-border p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Invitation issued for {issued.email} — shown once
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="font-mono text-sm break-all">{issued.url}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(issued.url);
                  toast.success("Link copied");
                }}
              >
                <Copy className="size-4 mr-2" />
                Copy link
              </Button>
            </div>
          </div>
        ) : null}
      </PageCard>

      <PageCard title="ENTRIES" sub="Newest first.">
        {list.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !rows.length ? (
          <div className="text-sm text-muted-foreground">No entries in this view.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium truncate">{r.full_name}</span>
                    <Badge variant="outline">{r.waitlist_id}</Badge>
                    <Badge
                      variant={
                        r.status === "APPROVED"
                          ? "default"
                          : r.status === "DECLINED"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {r.status}
                    </Badge>
                    {r.persona ? <Badge variant="outline">{r.persona}</Badge> : null}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {r.email} · {r.phone}
                    {r.organization ? ` · ${r.organization}` : ""} ·{" "}
                    {new Date(r.created_at).toLocaleString()}
                    {r.invite_sent_at
                      ? ` · link sent ${new Date(r.invite_sent_at).toLocaleString()}`
                      : ""}
                    {r.invite_email_error ? ` · email error: ${r.invite_email_error}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate({ id: r.id, email: r.email })}
                  >
                    <MailCheck className="size-4 mr-2" />
                    {r.status === "APPROVED" ? "Resend link" : "Approve & send link"}
                  </Button>
                  {r.status !== "DECLINED" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decline.isPending}
                      onClick={() => decline.mutate({ id: r.id })}
                    >
                      <Ban className="size-4 mr-2" />
                      Decline
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageCard>
    </div>
  );
}
