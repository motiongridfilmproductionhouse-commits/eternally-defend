import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listInvites, createInvite, setInviteStatus } from "@/lib/invites/invites.functions";
import { PageCard } from "@/components/dashboard/PageCard";
import { AdminGuard } from "@/components/AdminGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, KeyRound, Ban, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/_app/admin/invites")({
  head: () => ({
    meta: [
      { title: "Invitation Codes — Eterna Sentinel" },
      {
        name: "description",
        content: "Create, monitor and revoke Eterna invitation codes that unlock account signup.",
      },
    ],
  }),
  component: () => (
    <AdminGuard>
      <InvitesPage />
    </AdminGuard>
  ),
});

function InvitesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listInvites);
  const createFn = useServerFn(createInvite);
  const statusFn = useServerFn(setInviteStatus);

  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [assignedEmail, setAssignedEmail] = useState("");
  const [accountType, setAccountType] = useState("");
  const [issued, setIssued] = useState<string | null>(null);

  const invites = useQuery({ queryKey: ["signup-invites"], queryFn: () => listFn() });

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          label,
          maxUses: Number(maxUses) || 1,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          assignedEmail: assignedEmail || null,
          accountType: accountType || null,
        },
      }),
    onSuccess: (res) => {
      setIssued(res.code);
      setLabel("");
      setAssignedEmail("");
      setAccountType("");
      setExpiresAt("");
      setMaxUses("1");
      qc.invalidateQueries({ queryKey: ["signup-invites"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeStatus = useMutation({
    mutationFn: (vars: { id: string; status: "active" | "revoked" }) => statusFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signup-invites"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <PageCard
        title="INVITATION CODES"
        sub="Only holders of a valid invitation code can create an Eterna account. Codes are stored hashed — the plaintext is shown once, at creation."
      >
        <div className="grid gap-3 md:grid-cols-5">
          <Input placeholder="Label (e.g. Client — Motiongrid)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input placeholder="Max uses" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          <Input placeholder="Expires at" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          <Input placeholder="Bind to email (optional)" value={assignedEmail} onChange={(e) => setAssignedEmail(e.target.value)} />
          <Input placeholder="Account type (optional)" value={accountType} onChange={(e) => setAccountType(e.target.value)} />
        </div>
        <div className="mt-3">
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <KeyRound className="size-4 mr-2" />
            {create.isPending ? "Generating…" : "Generate invitation code"}
          </Button>
        </div>

        {issued ? (
          <div className="mt-4 rounded-xl border border-border p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              New code — copy it now, it cannot be retrieved again
            </div>
            <div className="mt-2 flex items-center gap-3">
              <code className="text-lg font-mono">{issued}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(issued);
                  toast.success("Copied");
                }}
              >
                <Copy className="size-4 mr-2" />
                Copy
              </Button>
            </div>
          </div>
        ) : null}
      </PageCard>

      <PageCard title="ISSUED CODES" sub="Usage, expiry and status of every invitation.">
        {invites.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !invites.data?.invites.length ? (
          <div className="text-sm text-muted-foreground">No invitation codes yet.</div>
        ) : (
          <div className="space-y-2">
            {invites.data.invites.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{inv.label ?? "Untitled invitation"}</span>
                    <Badge variant={inv.status === "active" ? "default" : "secondary"}>{inv.status}</Badge>
                    {inv.account_type ? <Badge variant="outline">{inv.account_type}</Badge> : null}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {inv.use_count}/{inv.max_uses} used
                    {inv.assigned_email ? ` · bound to ${inv.assigned_email}` : ""}
                    {inv.expires_at ? ` · expires ${new Date(inv.expires_at).toLocaleString()}` : " · no expiry"}
                    {inv.last_used_at ? ` · last used ${new Date(inv.last_used_at).toLocaleString()}` : ""}
                  </div>
                </div>
                {inv.status === "active" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => changeStatus.mutate({ id: inv.id, status: "revoked" })}
                  >
                    <Ban className="size-4 mr-2" />
                    Revoke
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => changeStatus.mutate({ id: inv.id, status: "active" })}
                  >
                    <RotateCcw className="size-4 mr-2" />
                    Reactivate
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </PageCard>
    </div>
  );
}
