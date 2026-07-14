import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { searchYouTubeChannels, type YTChannel } from "@/lib/youtube.functions";
import { Search, Youtube, ExternalLink, CheckCircle2, RotateCcw, Users, PlaySquare, Eye, Loader2 } from "lucide-react";

function compact(n: number | null): string {
  if (n == null) return "—";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function YouTubeChannelPicker({ onConfirm, onCancel }: {
  onConfirm: (ch: YTChannel) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<YTChannel[] | null>(null);
  const [strategy, setStrategy] = useState<string | null>(null);
  const search = useServerFn(searchYouTubeChannels);

  const runSearch = async (max = 5) => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await search({ data: { input: query.trim(), max } });
      setResults(res.channels);
      setStrategy(res.strategy);
      if (res.channels.length === 0) {
        toast.error("No matching YouTube channel was found. Check the channel URL, handle or spelling.");
      } else if (res.channels.length > 1 && res.strategy === "search") {
        toast.info("Multiple matching channels were found. Select the official channel.");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "YouTube lookup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border p-4 bg-accent/20">
      <div className="flex items-center gap-2">
        <Youtube className="size-4 text-red-500" />
        <div className="text-sm font-semibold">Verify YouTube channel</div>
      </div>
      <div className="text-xs text-muted-foreground">
        Paste a channel URL, @handle, channel ID (UC…), or channel name. We'll resolve it through the YouTube Data API before saving.
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="@handle, youtube.com/@name, UC…, or channel name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
          disabled={loading}
        />
        <Button onClick={() => runSearch()} disabled={loading || !query.trim()} size="sm">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          <span className="ml-1">Search</span>
        </Button>
      </div>

      {results && results.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>{results.length} candidate{results.length === 1 ? "" : "s"} · matched by {strategy}</span>
            {strategy === "search" && results.length < 10 && (
              <button className="underline" onClick={() => runSearch(10)}>Show more matches</button>
            )}
          </div>
          {results.map((c) => (
            <ChannelCard key={c.channel_id} channel={c} onConfirm={onConfirm} />
          ))}
        </div>
      )}

      {results && results.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-lg">
          No matching YouTube channel was found. Check the channel URL, handle or spelling.
        </div>
      )}

      <div className="flex justify-between pt-1">
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        ) : <span />}
        {results && (
          <Button variant="outline" size="sm" onClick={() => { setResults(null); setQuery(""); }}>
            <RotateCcw className="size-3.5 mr-1" /> Search again
          </Button>
        )}
      </div>
    </div>
  );
}

function ChannelCard({ channel, onConfirm }: { channel: YTChannel; onConfirm: (c: YTChannel) => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(channel); } finally { setBusy(false); }
  };
  const subs = channel.hidden_subscriber_count ? "Subscriber count hidden" : `${compact(channel.subscriber_count)} subscribers`;
  return (
    <div className="border border-border rounded-lg p-3 bg-background flex gap-3">
      {channel.profile_image_url ? (
        <img src={channel.profile_image_url} alt="" className="size-14 rounded-full object-cover shrink-0 border border-border" />
      ) : (
        <div className="size-14 rounded-full bg-muted grid place-items-center shrink-0"><Youtube className="size-6 text-muted-foreground" /></div>
      )}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-start gap-2 flex-wrap">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{channel.channel_title}</div>
            <div className="text-xs text-muted-foreground truncate">
              {channel.channel_handle ?? channel.channel_id}
              {channel.country && ` · ${channel.country}`}
            </div>
          </div>
          <Badge variant="secondary" className="ml-auto text-[10px]">
            match {Math.round(channel.match_confidence * 100)}%
          </Badge>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Users className="size-3" /> {subs}</span>
          <span className="flex items-center gap-1"><PlaySquare className="size-3" /> {compact(channel.video_count)} videos</span>
          <span className="flex items-center gap-1"><Eye className="size-3" /> {compact(channel.total_view_count)} views</span>
        </div>
        {channel.description && (
          <div className="text-xs text-muted-foreground line-clamp-2">{channel.description}</div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" asChild>
            <a href={channel.channel_url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5 mr-1" /> Open channel
            </a>
          </Button>
          <Button size="sm" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="size-3.5 mr-1" />}
            Confirm this channel
          </Button>
        </div>
      </div>
    </div>
  );
}

export function YouTubeAssetCard({ asset, onRefresh, onRemove }: {
  asset: { id: string; label: string; value: string | null; url: string | null; metadata: any };
  onRefresh: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"refresh" | "remove" | null>(null);
  const m = (asset.metadata ?? {}) as Partial<YTChannel> & { confirmation_status?: string; verification_status?: string; last_synced_at?: string };
  const subs = m.hidden_subscriber_count ? "Subscriber count hidden" : `${compact(m.subscriber_count ?? null)} subscribers`;
  const status = m.confirmation_status === "user_confirmed" ? "User confirmed" : "Pending";
  const verif = m.verification_status === "verified" ? "Verified" : "Ownership pending";
  return (
    <div className="border border-border rounded-xl p-4 bg-background">
      <div className="flex gap-3">
        {m.profile_image_url ? (
          <img src={m.profile_image_url} alt="" className="size-14 rounded-full object-cover border border-border shrink-0" />
        ) : (
          <div className="size-14 rounded-full bg-muted grid place-items-center shrink-0"><Youtube className="size-6 text-muted-foreground" /></div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-red-500/10 text-red-600 border border-red-500/20 text-[10px]"><Youtube className="size-3 mr-1" /> YouTube</Badge>
            <div className="font-semibold text-sm truncate">{m.channel_title ?? asset.label}</div>
          </div>
          <div className="text-xs text-muted-foreground truncate">{m.channel_handle ?? asset.value ?? m.channel_id}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
            <span className="flex items-center gap-1"><Users className="size-3" /> {subs}</span>
            <span className="flex items-center gap-1"><PlaySquare className="size-3" /> {compact(m.video_count ?? null)} videos</span>
            <span className="flex items-center gap-1"><Eye className="size-3" /> {compact(m.total_view_count ?? null)} views</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="secondary" className="text-[10px]">Status: {status}</Badge>
            <Badge variant="outline" className="text-[10px]">{verif}</Badge>
            <Badge variant="outline" className="text-[10px]">Monitoring: Active</Badge>
          </div>
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            {asset.url && (
              <Button size="sm" variant="outline" asChild>
                <a href={asset.url} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5 mr-1" /> Open channel</a>
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={async () => {
              setBusy("refresh");
              try { await onRefresh(asset.id); toast.success("Channel data refreshed"); }
              catch (e: any) { toast.error(e?.message ?? "Refresh failed"); }
              finally { setBusy(null); }
            }}>
              {busy === "refresh" ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <RotateCcw className="size-3.5 mr-1" />}
              Refresh
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={async () => {
              setBusy("remove");
              try { await onRemove(asset.id); }
              finally { setBusy(null); }
            }}>Remove</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
