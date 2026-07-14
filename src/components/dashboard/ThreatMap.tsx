import { ShieldCheck, Globe, Target, Radar, Plus, Minus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/mm/dashboard.functions";
import { useSession } from "@/hooks/use-session";

const CATEGORY_COLORS: Record<string, string> = {
  "Deepfake Detection": "oklch(0.6 0.24 295)",
  "News Attacks": "oklch(0.63 0.24 25)",
  "Viral Content": "oklch(0.7 0.2 40)",
  "Impersonation": "oklch(0.68 0.16 155)",
  "Unauthorized Ads": "oklch(0.75 0.16 70)",
  "Copyright Violation": "oklch(0.65 0.18 240)",
};

// Rough coords by country code / name — used only for visual placement.
const COORDS: Record<string, { top: string; left: string }> = {
  US: { top: "42%", left: "22%" }, USA: { top: "42%", left: "22%" }, "United States": { top: "42%", left: "22%" },
  CA: { top: "28%", left: "20%" }, Canada: { top: "28%", left: "20%" },
  MX: { top: "52%", left: "20%" }, Mexico: { top: "52%", left: "20%" },
  BR: { top: "68%", left: "32%" }, Brazil: { top: "68%", left: "32%" },
  GB: { top: "26%", left: "46%" }, UK: { top: "26%", left: "46%" }, "United Kingdom": { top: "26%", left: "46%" },
  DE: { top: "30%", left: "50%" }, Germany: { top: "30%", left: "50%" },
  FR: { top: "32%", left: "48%" }, France: { top: "32%", left: "48%" },
  ES: { top: "36%", left: "46%" }, Spain: { top: "36%", left: "46%" },
  IT: { top: "36%", left: "50%" }, Italy: { top: "36%", left: "50%" },
  AE: { top: "48%", left: "62%" }, UAE: { top: "48%", left: "62%" },
  SA: { top: "50%", left: "58%" },
  IN: { top: "52%", left: "70%" }, India: { top: "52%", left: "70%" },
  CN: { top: "42%", left: "76%" }, China: { top: "42%", left: "76%" },
  JP: { top: "42%", left: "84%" }, Japan: { top: "42%", left: "84%" },
  KR: { top: "42%", left: "82%" },
  AU: { top: "76%", left: "82%" }, Australia: { top: "76%", left: "82%" },
  ZA: { top: "78%", left: "54%" },
  RU: { top: "22%", left: "62%" }, Russia: { top: "22%", left: "62%" },
  NG: { top: "58%", left: "48%" },
};

function coordFor(label: string, i: number) {
  return (
    COORDS[label] ??
    COORDS[label.toUpperCase()] ?? {
      top: `${30 + ((i * 13) % 45)}%`,
      left: `${20 + ((i * 17) % 60)}%`,
    }
  );
}

function DottedWorld() {
  return (
    <div
      className="absolute inset-0 opacity-70"
      style={{
        backgroundImage: "radial-gradient(circle, oklch(0.75 0.03 285 / 0.55) 1px, transparent 1.2px)",
        backgroundSize: "10px 10px",
        maskImage:
          "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 50%22><path fill=%22black%22 d=%22M10,20 Q15,10 25,15 T45,18 Q55,12 65,18 T85,20 Q90,25 85,32 T60,38 Q50,42 35,38 T15,32 Q8,28 10,20Z%22/></svg>')",
        WebkitMaskImage:
          "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 50%22><path fill=%22black%22 d=%22M10,20 Q15,10 25,15 T45,18 Q55,12 65,18 T85,20 Q90,25 85,32 T60,38 Q50,42 35,38 T15,32 Q8,28 10,20Z%22/></svg>')",
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
        maskRepeat: "no-repeat",
      }}
    />
  );
}

export function ThreatMap() {
  const { session } = useSession();
  const fn = useServerFn(getDashboardStats);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fn({}),
    enabled: !!session,
    refetchInterval: 30_000,
  });

  const hotspots = (data?.hotspots ?? []).map((h, i) => ({
    ...h,
    ...coordFor(h.label, i),
    color: CATEGORY_COLORS[h.category] ?? "oklch(0.6 0.24 295)",
  }));

  const legend = Object.entries(CATEGORY_COLORS).map(([label, color]) => ({ label, color }));

  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg grid place-items-center bg-primary/10 text-primary">
            <ShieldCheck className="size-4" />
          </div>
          <div>
            <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">LIVE GLOBAL THREAT MAP</div>
            <div className="text-xs text-muted-foreground/80">Real-time threat intelligence</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <span className="size-2 rounded-full bg-primary animate-pulse" /> Live
        </div>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-6">
        <div className="space-y-3">
          {legend.map((l) => (
            <div key={l.label} className="flex items-center gap-2.5 text-sm">
              <span className="size-2.5 rounded-full" style={{ background: l.color }} />
              <span className="text-foreground/80">{l.label}</span>
            </div>
          ))}
          <div className="flex gap-2 pt-4">
            {[Globe, Target, Radar].map((I, i) => (
              <button key={i} className="size-9 grid place-items-center rounded-lg border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition">
                <I className="size-4" />
              </button>
            ))}
          </div>
        </div>

        <div className="relative h-[300px] rounded-xl overflow-hidden">
          <DottedWorld />
          {!session ? (
            <EmptyOverlay msg="Sign in to view live threat locations" />
          ) : isLoading ? (
            <EmptyOverlay msg="Loading live threats…" />
          ) : hotspots.length === 0 ? (
            <EmptyOverlay msg="No geo-tagged threats detected yet" />
          ) : (
            hotspots.map((h) => (
              <div key={h.label} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ top: h.top, left: h.left }}>
                <div className="relative">
                  <span className="absolute inset-0 -m-4 rounded-full animate-ping opacity-40" style={{ background: h.color }} />
                  <span className="relative block size-3 rounded-full ring-4" style={{ background: h.color, boxShadow: `0 0 24px ${h.color}` }} />
                </div>
                <div className="absolute left-5 -top-6 whitespace-nowrap bg-white border border-border rounded-lg px-2.5 py-1.5 shadow-md">
                  <div className="text-xs font-semibold">{h.label}</div>
                  <div className="text-[10px]" style={{ color: h.color }}>{h.count} Threats</div>
                </div>
              </div>
            ))
          )}
          <div className="absolute bottom-3 right-3 flex flex-col gap-1">
            <button className="size-8 grid place-items-center bg-white/90 border border-border rounded-md"><Plus className="size-3.5" /></button>
            <button className="size-8 grid place-items-center bg-white/90 border border-border rounded-md"><Minus className="size-3.5" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyOverlay({ msg }: { msg: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
      {msg}
    </div>
  );
}
