import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CheckCircle2,
  Info,
  Instagram,
  Link2,
  Loader2,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addPublicReferenceAccount,
  listSocialAccounts,
  removeSocialAccount,
  type SocialAccountRow,
} from "@/lib/social/accounts.functions";
import { getInstagramConnectStatus, startInstagramAuthorization } from "@/lib/social/instagram-connect.functions";
import { protectFromLink } from "@/lib/social/import-from-link.functions";

const PANEL = "rounded-xl border border-border bg-card p-4 space-y-3";

/**
 * Hybrid social asset protection. Protection never requires an Instagram login:
 * MODE B (public reference + link/upload protection) works on its own, and an
 * authorized connection is presented as an optional upgrade.
 */
export function SocialAssetProtectionPanel({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const fetchAccounts = useServerFn(listSocialAccounts);
  const fetchConnect = useServerFn(getInstagramConnectStatus);
  const addAccount = useServerFn(addPublicReferenceAccount);
  const dropAccount = useServerFn(removeSocialAccount);
  const startAuth = useServerFn(startInstagramAuthorization);
  const importLink = useServerFn(protectFromLink);

  const accountsQuery = useQuery({ queryKey: ["social_accounts"], queryFn: () => fetchAccounts() });
  const connectQuery = useQuery({
    queryKey: ["instagram_connect_status"],
    queryFn: () => fetchConnect(),
  });

  const [profileUrl, setProfileUrl] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [postName, setPostName] = useState("");

  const accounts = (accountsQuery.data?.accounts ?? []) as SocialAccountRow[];
  const igConfigured = connectQuery.data?.configured ?? false;

  const save = useMutation({
    mutationFn: () => addAccount({ data: { profileUrl } }),
    onSuccess: () => {
      setProfileUrl("");
      qc.invalidateQueries({ queryKey: ["social_accounts"] });
      qc.invalidateQueries({ queryKey: ["instagram_connect_status"] });
      toast.success("Official profile registered as a trusted reference.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => dropAccount({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social_accounts"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const connect = useMutation({
    mutationFn: () => startAuth({ data: { profileUrl: profileUrl || accounts[0]?.profile_url || "" } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["social_accounts"] });
      if (result.status === "ready" && result.authorizationUrl) {
        window.location.href = result.authorizationUrl;
        return;
      }
      toast.info(result.message ?? "Authorization is not available yet.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const protectLink = useMutation({
    mutationFn: () => importLink({ data: { url: postUrl, name: postName || undefined } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["protected_assets"] });
      if (result.status === "manual_upload_required") {
        toast.warning(result.message ?? "Upload the original file instead.");
        return;
      }
      const created = result.results.filter((r) => r.status === "created").length;
      const enrolled = result.results.filter((r) => r.enrolled).length;
      setPostUrl("");
      setPostName("");
      toast.success(
        created
          ? `${created} item${created === 1 ? "" : "s"} protected · ${enrolled} enrolled in continuous scanning.`
          : "That media is already protected.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className={compact ? "space-y-4" : "space-y-4"}>
      <div className={PANEL}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
              <ShieldCheck className="size-4 text-primary" /> Social Profile Protection
            </div>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Add your official public profile. No login, no password and no account connection is
              required — this is stored as a self-declared trusted reference so monitoring can tell
              your real presence apart from impersonators.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
            {accounts.length} registered
          </Badge>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={profileUrl}
              onChange={(e) => setProfileUrl(e.target.value)}
              placeholder="https://instagram.com/yourname"
              className="pl-8"
            />
          </div>
          <Button onClick={() => save.mutate()} disabled={!profileUrl.trim() || save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
            Add profile
          </Button>
        </div>

        {accountsQuery.isLoading ? (
          <div className="grid place-items-center py-4">
            <Loader2 className="size-4 animate-spin text-primary" />
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No official profiles registered yet.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <Instagram className="size-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {account.handle ? `@${account.handle}` : account.profile_url}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{account.profile_url}</div>
                </div>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {account.mode === "AUTHORIZED_CONNECTED" ? "Authorized" : "Self-declared"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate(account.id)}
                  aria-label="Remove profile"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={PANEL}>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
          <Link2 className="size-4 text-primary" /> Protect a post or reel by link
        </div>
        <p className="text-xs text-muted-foreground">
          Paste a link to your own public post. Eterna reads only what the platform publishes
          publicly, fingerprints the media, records its original post link as provenance and starts
          continuous scanning. If the platform does not expose it publicly, upload the original file
          instead — protection is identical.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://instagram.com/p/..."
            className="flex-1"
          />
          <Input
            value={postName}
            onChange={(e) => setPostName(e.target.value)}
            placeholder="Asset name (optional)"
            className="sm:w-56"
          />
          <Button onClick={() => protectLink.mutate()} disabled={!postUrl.trim() || protectLink.isPending}>
            {protectLink.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Protect
          </Button>
        </div>
      </div>

      <div className={PANEL}>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
          <Lock className="size-4 text-primary" /> Optional: authorized connection
        </div>
        <p className="text-xs text-muted-foreground">
          Connecting through Instagram&apos;s own authorization screen lets Eterna import your
          eligible posts and reels automatically. We never ask for or store your password, and you
          can skip this entirely — public reference protection stays fully active.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => connect.mutate()}
            disabled={connect.isPending || (!profileUrl.trim() && accounts.length === 0)}
          >
            {connect.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Instagram className="mr-2 size-4" />
            )}
            {igConfigured ? "Connect Instagram" : "Connection unavailable"}
          </Button>
          {connectQuery.data?.connected && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <CheckCircle2 className="size-3.5" /> Connected
            </span>
          )}
        </div>
        {!igConfigured && connectQuery.data?.unavailableReason && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{connectQuery.data.unavailableReason}</span>
          </div>
        )}
      </div>
    </div>
  );
}
