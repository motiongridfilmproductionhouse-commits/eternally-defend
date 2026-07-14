import { useState } from "react";
import { CheckCircle2, XCircle, HelpCircle, ShieldCheck, ShieldQuestion, ExternalLink, ChevronDown, ChevronUp, BadgeCheck } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { PLATFORM_LABEL, type Platform } from "@/lib/discovery/scoring";
import { Badge } from "@/components/ui/badge";

type AccountRow = Database["public"]["Tables"]["discovered_accounts"]["Row"];

const STATUS_STYLE: Record<AccountRow["status"], { label: string; bg: string; fg: string }> = {
  discovered: { label: "Discovered", bg: "bg-slate-100", fg: "text-slate-700" },
  likely_official: { label: "Likely official", bg: "bg-sky-100", fg: "text-sky-700" },
  user_confirmed: { label: "You confirmed", bg: "bg-emerald-100", fg: "text-emerald-700" },
  ownership_pending: { label: "Verification pending", bg: "bg-amber-100", fg: "text-amber-800" },
  verified: { label: "Ownership verified", bg: "bg-emerald-600", fg: "text-white" },
  rejected: { label: "Rejected", bg: "bg-rose-100", fg: "text-rose-700" },
};

interface Props {
  account: AccountRow;
  onDecide: (decision: "confirmed" | "not_mine" | "unsure") => void;
  onVerify: () => void;
  busy?: boolean;
}

function formatCount(n: number | null): string {
  if (n == null) return "";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function AccountCard({ account, onDecide, onVerify, busy }: Props) {
  const [showSignals, setShowSignals] = useState(false);
  const status = STATUS_STYLE[account.status];
  const platform = account.platform as Platform;

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {account.profile_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.profile_image_url} alt="" className="size-12 rounded-full object-cover shrink-0 bg-muted" />
        ) : (
          <div className="size-12 rounded-full bg-primary/10 grid place-items-center text-primary shrink-0 text-lg font-bold">
            {(account.display_name ?? account.handle ?? "?")[0]?.toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">{PLATFORM_LABEL[platform]}</div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${status.bg} ${status.fg}`}>{status.label}</span>
            {account.platform_verified && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700"><BadgeCheck className="size-3" /> Platform verified</span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
            <div className="font-semibold truncate">{account.display_name ?? account.handle ?? "Unknown"}</div>
            {account.handle && <div className="text-xs text-muted-foreground truncate">@{account.handle}</div>}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            {account.follower_count != null && <span>{formatCount(account.follower_count)} followers</span>}
            <a href={account.profile_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary underline underline-offset-2">
              {new URL(account.profile_url).hostname.replace(/^www\./, "")} <ExternalLink className="size-3" />
            </a>
          </div>
          {account.bio && <div className="mt-2 text-xs text-muted-foreground line-clamp-2">{account.bio}</div>}
        </div>

        <div className="w-24 shrink-0 text-right">
          <div className="text-xs text-muted-foreground">Confidence</div>
          <div className="mt-0.5 flex items-center gap-1 justify-end">
            <div className="text-lg font-display font-bold">{account.confidence}</div>
            <div className="text-xs text-muted-foreground">/100</div>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${account.confidence}%` }} />
          </div>
        </div>
      </div>

      {account.match_reasons.length > 0 && (
        <button
          type="button"
          onClick={() => setShowSignals((v) => !v)}
          className="self-start text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          {showSignals ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          Why this match?
        </button>
      )}
      {showSignals && (
        <div className="flex flex-wrap gap-1.5">
          {account.match_reasons.map((r) => (
            <Badge key={r} variant="secondary" className="text-[10px] font-medium">{r}</Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
        {account.status !== "verified" && account.status !== "rejected" && (
          <>
            <button
              disabled={busy}
              onClick={() => onDecide("confirmed")}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
            >
              <CheckCircle2 className="size-3.5" /> Confirm official
            </button>
            <button
              disabled={busy}
              onClick={() => onDecide("not_mine")}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent disabled:opacity-60"
            >
              <XCircle className="size-3.5" /> Not my account
            </button>
            <button
              disabled={busy}
              onClick={() => onDecide("unsure")}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent disabled:opacity-60"
            >
              <HelpCircle className="size-3.5" /> Unsure
            </button>
          </>
        )}
        {(account.status === "user_confirmed" || account.status === "ownership_pending") && (
          <button
            disabled={busy}
            onClick={onVerify}
            className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-60"
            style={{ background: "var(--gradient-brand)" }}
          >
            <ShieldQuestion className="size-3.5" /> Verify ownership
          </button>
        )}
        {account.status === "verified" && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="size-3.5" /> Ownership verified
          </span>
        )}
      </div>
    </div>
  );
}
