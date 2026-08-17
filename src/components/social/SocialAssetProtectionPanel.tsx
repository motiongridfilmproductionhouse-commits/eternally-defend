import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Info,
  Instagram,
  Link2,
  Loader2,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
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
import { prepareSocialMediaUpload, protectFromUpload } from "@/lib/social/upload-media.functions";
import { listSocialProtectedAssets, type SocialAssetStatusRow } from "@/lib/social/asset-status.functions";
import { blockedRetrievalMessage, SOCIAL_STATUS_LABEL, type SocialStatus } from "@/lib/social/status";
import { BulkProtectPanel } from "./BulkProtectPanel";

/** Registry views for protected social media. */
const REGISTRY_FILTERS = ["all", "processing", "protected", "failed"] as const;
type RegistryFilter = (typeof REGISTRY_FILTERS)[number];

function matchesRegistryFilter(status: SocialStatus, filter: RegistryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "processing") return status === "processing" || status === "fingerprint_ready";
  if (filter === "protected") return status === "protection_active";
  return status === "failed" || status === "upload_required" || status === "waiting_for_authorization";
}


const PANEL = "rounded-xl border border-border bg-card p-4 space-y-3";

const STATUS_TONE: Record<SocialStatus, string> = {
  public_reference: "border-border text-muted-foreground",
  processing: "border-sky-500/40 text-sky-400",
  fingerprint_ready: "border-sky-500/40 text-sky-300",
  protection_active: "border-emerald-500/40 text-emerald-400",
  waiting_for_authorization: "border-amber-500/40 text-amber-400",
  upload_required: "border-amber-500/40 text-amber-400",
  failed: "border-destructive/40 text-destructive",
};

/**
 * Hybrid social asset protection — MODE B only in production. Protection never
 * requires an Instagram login: a self-declared public reference plus link import
 * or manual upload delivers the full protection pipeline, and an authorized
 * connection (MODE A) stays dormant until platform credentials exist.
 */
export function SocialAssetProtectionPanel({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const fetchAccounts = useServerFn(listSocialAccounts);
  const fetchConnect = useServerFn(getInstagramConnectStatus);
  const fetchAssets = useServerFn(listSocialProtectedAssets);
  const addAccount = useServerFn(addPublicReferenceAccount);
  const dropAccount = useServerFn(removeSocialAccount);
  const startAuth = useServerFn(startInstagramAuthorization);
  const importLink = useServerFn(protectFromLink);
  const prepareUpload = useServerFn(prepareSocialMediaUpload);
  const finishUpload = useServerFn(protectFromUpload);

  const accountsQuery = useQuery({ queryKey: ["social_accounts"], queryFn: () => fetchAccounts() });
  const connectQuery = useQuery({
    queryKey: ["instagram_connect_status"],
    queryFn: () => fetchConnect(),
  });
  const assetsQuery = useQuery({
    queryKey: ["social_protected_assets"],
    queryFn: () => fetchAssets(),
  });

  const [profileUrl, setProfileUrl] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [postName, setPostName] = useState("");
  const [uploadRequired, setUploadRequired] = useState<{ platform: string | null; message: string } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const accounts = (accountsQuery.data?.accounts ?? []) as SocialAccountRow[];
  const assets = (assetsQuery.data?.assets ?? []) as SocialAssetStatusRow[];
  const igConfigured = connectQuery.data?.configured ?? false;

  const refreshAssets = () => {
    qc.invalidateQueries({ queryKey: ["social_protected_assets"] });
    qc.invalidateQueries({ queryKey: ["protected_assets"] });
  };

  const save = useMutation({
    mutationFn: () => addAccount({ data: { profileUrl } }),
    onSuccess: () => {
      setProfileUrl("");
      qc.invalidateQueries({ queryKey: ["social_accounts"] });
      qc.invalidateQueries({ queryKey: ["instagram_connect_status"] });
      toast.success("Profile added as a public reference — not connected.");
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
    mutationFn: () => {
      // A profile URL has no media behind it — guide the user instead of failing silently.
      if (!/\/(p|reel|reels|tv|status|video|shorts|watch)\/|youtu\.be\/|[?&]v=/i.test(postUrl)) {
        throw new Error(
          "Paste a link to a single public post or reel (e.g. instagram.com/p/…), not a profile page. To protect a whole profile, add it under Social Profile Protection.",
        );
      }
      return importLink({ data: { url: postUrl, name: postName || undefined } });
    },
    onSuccess: (result) => {
      refreshAssets();
      if (result.status === "manual_upload_required") {
        const message = blockedRetrievalMessage(result.platform);
        setUploadRequired({ platform: result.platform, message });
        toast.info(message);
        return;
      }
      setUploadRequired(null);
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

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const prepared = await prepareUpload({
        data: {
          fileName: file.name,
          contentType: file.type as never,
          size: file.size,
        },
      });
      const put = await fetch(prepared.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed. Please try again.");
      return finishUpload({
        data: {
          key: prepared.key,
          name: postName || file.name,
          contentType: file.type as never,
          ...(postUrl.trim() ? { sourcePostUrl: postUrl.trim() } : {}),
        },
      });
    },
    onSuccess: (result) => {
      refreshAssets();
      setUploadRequired(null);
      setPostName("");
      if (result.result.status === "duplicate") {
        toast.info("That media is already protected.");
        return;
      }
      toast.success(
        result.result.enrolled
          ? "Media protected and enrolled in continuous scanning."
          : "Media protected and fingerprinted. Scanning activates with your authorization.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Please upload a file under 15 MB.");
      return;
    }
    upload.mutate(file);
  };

  return (
    <div className="space-y-4">
      <div className={PANEL}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
              <ShieldCheck className="size-4 text-primary" /> Social Profile Protection
            </div>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Eterna can use your public profile as a protection reference. To protect specific
              photos or videos, add a public post link or upload the original media. No login,
              password or account connection is ever required.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
            {accounts.length} added
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
          <p className="text-xs text-muted-foreground">
            No public profiles added yet — this step is optional and never blocks onboarding.
          </p>
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
                    {account.handle ? `@${account.handle}` : account.profile_url} profile added
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{account.profile_url}</div>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
                  {account.mode === "AUTHORIZED_CONNECTED"
                    ? "Authorized connection"
                    : "Public reference — not connected"}
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
          <Link2 className="size-4 text-primary" /> Protect a photo or video
        </div>
        <p className="text-xs text-muted-foreground">
          Paste a link to your own public post, or upload the original file. Either way Eterna
          fingerprints the media, records its provenance and starts continuous scanning. Eterna reads
          only what a platform publishes publicly.
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
            {protectLink.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Protect from link
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
            className="hidden"
            onChange={(e) => {
              onPickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}
            Upload photos/videos
          </Button>
          <span className="text-[11px] text-muted-foreground">JPG, PNG, WEBP, GIF, MP4, MOV up to 15 MB</span>
        </div>

        {uploadRequired && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-400">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <div className="space-y-1">
              <div className="font-medium uppercase tracking-wide">
                {SOCIAL_STATUS_LABEL.upload_required}
              </div>
              <p>{uploadRequired.message}</p>
            </div>
          </div>
        )}
      </div>

      <BulkProtectPanel />

      {!compact && (
        <div className={PANEL}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
              <ShieldCheck className="size-4 text-primary" /> Protected social media
            </div>
            <div className="flex flex-wrap gap-1">
              {REGISTRY_FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRegistryFilter(value)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wide transition ${
                    registryFilter === value
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          {assetsQuery.isLoading ? (
            <div className="grid place-items-center py-4">
              <Loader2 className="size-4 animate-spin text-primary" />
            </div>
          ) : visibleAssets.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {assets.length === 0
                ? "Nothing protected from social yet. Add a post link or upload the original media."
                : "No protected media in this view."}
            </p>
          ) : (
            <div className="space-y-2">
              {visibleAssets.map((asset) => (
                <div key={asset.id} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{asset.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {asset.platform ?? "other"} ·{" "}
                        {asset.import_method === "PUBLIC_LINK" ? "public link" : "manual upload"}
                        {asset.source_post_url ? ` · ${asset.source_post_url}` : ""}
                      </div>
                    </div>
                    <Badge variant="outline" className={`shrink-0 text-[10px] uppercase ${STATUS_TONE[asset.status]}`}>
                      {asset.label}
                    </Badge>
                  </div>
                  {asset.reason && (
                    <p className="mt-1 text-[11px] text-muted-foreground">{asset.reason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      <div className={PANEL}>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
          <Lock className="size-4 text-primary" /> Optional: authorized connection
        </div>
        <p className="text-xs text-muted-foreground">
          A future Instagram-authorized connection would let Eterna import eligible posts and reels
          automatically. It is not available yet, we never ask for or store your password, and you
          lose nothing by skipping it — public reference protection stays fully active.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => connect.mutate()}
            disabled={!igConfigured || connect.isPending || (!profileUrl.trim() && accounts.length === 0)}
          >
            {connect.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Instagram className="mr-2 size-4" />
            )}
            {igConfigured ? "Connect Instagram" : "Connection unavailable"}
          </Button>
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
