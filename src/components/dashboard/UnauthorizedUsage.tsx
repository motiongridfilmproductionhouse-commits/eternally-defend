import { ShieldAlert, Facebook, Youtube, Music2, Instagram, Twitter, Globe } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/mm/dashboard.functions";
import { useSession } from "@/hooks/use-session";

const PLATFORM_ICON: Record<string, { icon: typeof Facebook; bg: string; fg: string }> = {
  YouTube: { icon: Youtube, bg: "bg-red-100", fg: "text-red-600" },
  Facebook: { icon: Facebook, bg: "bg-blue-100", fg: "text-blue-600" },
  Instagram: { icon: Instagram, bg: "bg-pink-100", fg: "text-pink-600" },
  TikTok: { icon: Music2, bg: "bg-gray-100", fg: "text-gray-800" },
  X: { icon: Twitter, bg: "bg-sky-100", fg: "text-sky-600" },
};

export function UnauthorizedUsage() {
  const fn = useServerFn(getDashboardStats);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fn({}),
    refetchInterval: 30_000,
  });
  const u = data?.unauthorized;
  const platforms = (u?.platforms ?? []).slice(0, 4);

  return (
    <div className="card-surface p-5 flex flex-col">
      <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">UNAUTHORIZED USAGE</div>
      <div className="text-xs text-muted-foreground/80 mb-4">Brand & image misuse</div>

      <div className="flex items-center gap-3">
        <div className="size-12 rounded-xl grid place-items-center bg-primary/10 text-primary shrink-0">
          <ShieldAlert className="size-6" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold font-display leading-none">{isLoading ? "…" : u?.detected ?? 0}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Unauthorized Uses</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[10px] tracking-widest text-muted-foreground mb-2">Platforms</div>
        {platforms.length === 0 ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <div className="size-9 rounded-lg grid place-items-center bg-secondary text-muted-foreground">
              <Globe className="size-4" />
            </div>
            No detections yet
          </div>
        ) : (
          <div className="flex gap-2">
            {platforms.map((p) => {
              const meta = PLATFORM_ICON[p.name] ?? { icon: Globe, bg: "bg-secondary", fg: "text-muted-foreground" };
              const Icon = meta.icon;
              return (
                <div key={p.name} className={`size-9 rounded-lg grid place-items-center ${meta.bg} ${meta.fg} relative`} title={`${p.name}: ${p.count}`}>
                  <Icon className="size-4" />
                  <span className="absolute -top-1 -right-1 text-[9px] font-bold bg-rose-500 text-white rounded-full min-w-[16px] h-4 px-1 grid place-items-center">
                    {p.count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-border">
        <div className="text-[10px] tracking-widest text-muted-foreground">Est. Revenue Lost</div>
        <div className="text-xl font-bold font-display text-rose-500 mt-1">
          ${(u?.revenueLost ?? 0).toLocaleString()}
        </div>
      </div>

      <a
        href="/intelligence"
        className="mt-4 w-full text-sm font-semibold py-2 rounded-lg border border-border hover:bg-accent transition text-center"
      >
        View Cases
      </a>
    </div>
  );
}
