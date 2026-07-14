import { useState } from "react";
import { Youtube, Instagram, Music2, MessageCircle, Newspaper, Twitter, ExternalLink, Eye, ThumbsUp, MessageSquare, Shield, AlertTriangle, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type PlatformKey = "youtube" | "instagram" | "tiktok" | "reddit" | "news" | "x";

const items: {
  key: PlatformKey;
  icon: any;
  name: string;
  count: number;
  color: string;
}[] = [
  { key: "youtube", icon: Youtube, name: "YouTube", count: 67, color: "#FF4D4D" },
  { key: "instagram", icon: Instagram, name: "Instagram", count: 32, color: "#E879F9" },
  { key: "tiktok", icon: Music2, name: "TikTok", count: 18, color: "#22D3EE" },
  { key: "reddit", icon: MessageCircle, name: "Reddit", count: 15, color: "#FB923C" },
  { key: "news", icon: Newspaper, name: "News Sites", count: 24, color: "#3B82F6" },
  { key: "x", icon: Twitter, name: "X (Twitter)", count: 11, color: "#93C5FD" },
];

type Finding = {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  severity: "critical" | "high" | "medium" | "low";
  type: string;
  detectedAt: string;
  metrics: { views?: string; likes?: string; comments?: string; shares?: string };
  url: string;
};

const MOCK: Record<PlatformKey, Finding[]> = {
  youtube: [
    { id: "y1", title: "AI-generated deepfake impersonation compilation", author: "@ViralClipsHQ", thumbnail: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&h=225&fit=crop", severity: "critical", type: "Deepfake", detectedAt: "2h ago", metrics: { views: "1.2M", likes: "48K", comments: "3.2K" }, url: "#" },
    { id: "y2", title: "Unauthorized use of likeness in product promotion", author: "@TrendReviews", thumbnail: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400&h=225&fit=crop", severity: "high", type: "Unauthorized Usage", detectedAt: "5h ago", metrics: { views: "342K", likes: "12K", comments: "890" }, url: "#" },
    { id: "y3", title: "Fabricated interview clip with synthetic voice", author: "@NewsMashup", thumbnail: "https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=400&h=225&fit=crop", severity: "high", type: "Voice Clone", detectedAt: "8h ago", metrics: { views: "89K", likes: "4.1K", comments: "512" }, url: "#" },
    { id: "y4", title: "Face-swap montage on entertainment channel", author: "@EntertainDaily", thumbnail: "https://images.unsplash.com/photo-1493804714600-6edb1cd93080?w=400&h=225&fit=crop", severity: "medium", type: "Deepfake", detectedAt: "1d ago", metrics: { views: "56K", likes: "2.3K", comments: "180" }, url: "#" },
    { id: "y5", title: "Misleading thumbnail using edited likeness", author: "@ClickbaitCentral", thumbnail: "https://images.unsplash.com/photo-1522542550221-31fd19575a2d?w=400&h=225&fit=crop", severity: "medium", type: "Misinformation", detectedAt: "1d ago", metrics: { views: "128K", likes: "5.9K", comments: "740" }, url: "#" },
  ],
  instagram: [
    { id: "i1", title: "Reel featuring AI-generated likeness endorsement", author: "@luxe.deals", thumbnail: "https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&h=400&fit=crop", severity: "critical", type: "Fake Endorsement", detectedAt: "1h ago", metrics: { views: "780K", likes: "62K", comments: "1.8K" }, url: "#" },
    { id: "i2", title: "Impersonation account posing as verified profile", author: "@official.eterna.fake", thumbnail: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=400&fit=crop", severity: "high", type: "Impersonation", detectedAt: "3h ago", metrics: { likes: "8.4K", comments: "420" }, url: "#" },
    { id: "i3", title: "Story highlight using unlicensed brand footage", author: "@stylefeed", thumbnail: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&h=400&fit=crop", severity: "medium", type: "IP Violation", detectedAt: "6h ago", metrics: { views: "34K", likes: "1.9K" }, url: "#" },
    { id: "i4", title: "Carousel post with edited likeness", author: "@fanpage.hub", thumbnail: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop", severity: "low", type: "Unauthorized Usage", detectedAt: "1d ago", metrics: { likes: "3.2K", comments: "89" }, url: "#" },
  ],
  tiktok: [
    { id: "t1", title: "Viral deepfake dance trend using synthetic likeness", author: "@dancewave", thumbnail: "https://images.unsplash.com/photo-1516251193007-45ef944ab0c6?w=400&h=600&fit=crop", severity: "high", type: "Deepfake", detectedAt: "4h ago", metrics: { views: "2.4M", likes: "180K", shares: "12K" }, url: "#" },
    { id: "t2", title: "Voice clone in reaction sound trend", author: "@sounds.daily", thumbnail: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=600&fit=crop", severity: "medium", type: "Voice Clone", detectedAt: "9h ago", metrics: { views: "410K", likes: "23K", shares: "1.4K" }, url: "#" },
    { id: "t3", title: "Face-swap comedy skit", author: "@lol.factory", thumbnail: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&h=600&fit=crop", severity: "low", type: "Deepfake", detectedAt: "2d ago", metrics: { views: "88K", likes: "4.6K", shares: "310" }, url: "#" },
  ],
  reddit: [
    { id: "r1", title: "Thread compiling AI-generated fake statements", author: "u/leaks_watcher", thumbnail: "https://images.unsplash.com/photo-1495020689067-958852a7765e?w=400&h=225&fit=crop", severity: "high", type: "Misinformation", detectedAt: "3h ago", metrics: { likes: "4.2K", comments: "820" }, url: "#" },
    { id: "r2", title: "Cross-post of unauthorized deepfake to r/videos", author: "u/reposter", thumbnail: "https://images.unsplash.com/photo-1526628953301-3e589a6a8b74?w=400&h=225&fit=crop", severity: "medium", type: "Deepfake", detectedAt: "1d ago", metrics: { likes: "1.1K", comments: "230" }, url: "#" },
  ],
  news: [
    { id: "n1", title: "Article citing fabricated quote as primary source", author: "dailyfeed.example.com", thumbnail: "https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&h=225&fit=crop", severity: "critical", type: "Fabricated Quote", detectedAt: "2h ago", metrics: { views: "58K" }, url: "#" },
    { id: "n2", title: "Opinion piece using AI-generated header image", author: "opinionwire.example.com", thumbnail: "https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=400&h=225&fit=crop", severity: "medium", type: "Synthetic Media", detectedAt: "1d ago", metrics: { views: "22K" }, url: "#" },
  ],
  x: [
    { id: "x1", title: "Viral post with AI-generated screenshot of statement", author: "@breaking_hub", thumbnail: "https://images.unsplash.com/photo-1611605698335-8b1569810432?w=400&h=225&fit=crop", severity: "high", type: "Misinformation", detectedAt: "1h ago", metrics: { views: "1.8M", likes: "42K", shares: "18K" }, url: "#" },
    { id: "x2", title: "Impersonation account with paid verification", author: "@eterna_ai_official", thumbnail: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&h=225&fit=crop", severity: "critical", type: "Impersonation", detectedAt: "5h ago", metrics: { views: "230K", likes: "9.1K" }, url: "#" },
  ],
};

const severityStyle: Record<Finding["severity"], string> = {
  critical: "bg-red-500/10 text-red-600 border-red-500/20",
  high: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  medium: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  low: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
};

export function PlatformIntelligence() {
  const [active, setActive] = useState<PlatformKey | null>(null);
  const activeItem = items.find((i) => i.key === active) ?? null;
  const findings = active ? MOCK[active] : [];

  return (
    <>
      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">PLATFORM INTELLIGENCE</div>
            <div className="text-xs text-muted-foreground/80">Findings by platform · click to view results</div>
          </div>
          <button className="text-xs font-semibold text-primary" onClick={() => setActive("youtube")}>View All</button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {items.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.name}
                onClick={() => setActive(p.key)}
                className="border border-border rounded-xl p-3 flex items-center gap-2.5 bg-card/40 hover:bg-card hover:border-primary/40 hover:shadow-sm transition-all text-left"
              >
                <div className="size-9 rounded-lg grid place-items-center" style={{ background: `color-mix(in oklab, ${p.color} 18%, transparent)`, color: p.color }}>
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground"><span className="font-semibold text-foreground">{p.count}</span> Findings</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={active !== null} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col p-0">
          {activeItem && (
            <>
              <DialogHeader className="px-6 py-4 border-b border-border flex-row items-center gap-3 space-y-0">
                <div className="size-10 rounded-xl grid place-items-center" style={{ background: `color-mix(in oklab, ${activeItem.color} 18%, transparent)`, color: activeItem.color }}>
                  <activeItem.icon className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <DialogTitle className="text-base">{activeItem.name} — Results</DialogTitle>
                  <div className="text-xs text-muted-foreground">{activeItem.count} findings detected · showing {findings.length}</div>
                </div>
              </DialogHeader>

              <div className="overflow-y-auto p-5 bg-background/40">
                <div className={`grid gap-4 ${active === "tiktok" || active === "instagram" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 md:grid-cols-2"}`}>
                  {findings.map((f) => (
                    <FindingCard key={f.id} f={f} platform={activeItem} />
                  ))}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FindingCard({ f, platform }: { f: Finding; platform: { icon: any; name: string; color: string } }) {
  const Icon = platform.icon;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:shadow-md hover:border-primary/40 transition-all">
      <div className="relative aspect-video bg-muted overflow-hidden">
        <img src={f.thumbnail} alt="" className="w-full h-full object-cover" />
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <Badge className={`text-[10px] border ${severityStyle[f.severity]}`}>
            <AlertTriangle className="size-2.5 mr-1" />
            {f.severity.toUpperCase()}
          </Badge>
        </div>
        <div className="absolute top-2 right-2">
          <div className="size-7 rounded-lg grid place-items-center backdrop-blur-md" style={{ background: `color-mix(in oklab, ${platform.color} 25%, rgba(0,0,0,0.5))`, color: "#fff" }}>
            <Icon className="size-3.5" />
          </div>
        </div>
      </div>
      <div className="p-3.5 space-y-2.5">
        <div>
          <div className="text-sm font-semibold leading-snug line-clamp-2">{f.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{f.author} · {f.detectedAt}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-[10px]">{f.type}</Badge>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1 border-t border-border">
          {f.metrics.views && <span className="flex items-center gap-1"><Eye className="size-3" /> {f.metrics.views}</span>}
          {f.metrics.likes && <span className="flex items-center gap-1"><ThumbsUp className="size-3" /> {f.metrics.likes}</span>}
          {f.metrics.comments && <span className="flex items-center gap-1"><MessageSquare className="size-3" /> {f.metrics.comments}</span>}
          {f.metrics.shares && <span className="flex items-center gap-1"><ExternalLink className="size-3" /> {f.metrics.shares}</span>}
        </div>
        <div className="flex items-center gap-1.5 pt-1">
          <Button size="sm" variant="outline" className="h-7 text-xs flex-1" asChild>
            <a href={f.url} target="_blank" rel="noreferrer"><ExternalLink className="size-3 mr-1" /> View</a>
          </Button>
          <Button size="sm" className="h-7 text-xs flex-1">
            <Shield className="size-3 mr-1" /> Take Action
          </Button>
        </div>
      </div>
    </div>
  );
}
