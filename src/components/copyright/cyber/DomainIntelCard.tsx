import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Globe, Loader2, ShieldAlert, Radar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDomainIntel } from "@/lib/copyright/domain-intel.functions";
import {
  countryFlag,
  intelValue,
  sourceRole,
  threatTone,
  type DomainIntel,
} from "@/lib/copyright/domain-intel";
import { ThreatGauge } from "@/components/copyright/cyber/ThreatGauge";
import { RemovalIntelligencePanel } from "@/components/copyright/cyber/RemovalIntelligencePanel";
import { ActionCenter } from "@/components/copyright/cyber/ActionCenter";
import { EvidenceCollectionTicker } from "@/components/copyright/cyber/EvidenceCollectionTicker";

export type DomainIntelCardProps = {
  url: string;
  domain: string | null;
  workTitle: string;
  classification?: string | null;
  confidence?: number | null;
  matchId?: string | null;
  firstSeen?: string | null;
  lastVerified?: string | null;
  onIntel?: (intel: DomainIntel) => void;
  onMarkResolved?: (matchId: string) => void;
  onEscalate?: (matchId: string) => void;
};

function Field({ label, value }: { label: string; value: string }) {
  const unknown = value === "Not available" || value.startsWith("Protected —");
  return (
    <div className="rounded-lg border border-sky-400/15 bg-slate-950/40 px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`truncate text-xs ${unknown ? "italic text-slate-500" : "text-slate-200"}`}>
        {value}
      </div>
    </div>
  );
}

/** Detected-source intelligence card. Enrichment loads asynchronously and is cached. */
export function DomainIntelCard({
  url,
  domain,
  workTitle,
  classification,
  confidence,
  matchId,
  firstSeen,
  lastVerified,
  onIntel,
  onMarkResolved,
  onEscalate,
}: DomainIntelCardProps) {
  const enrichFn = useServerFn(getDomainIntel);
  const host = domain ?? (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  })();

  const query = useQuery<DomainIntel>({
    queryKey: ["copyright-domain-intel", url],
    queryFn: () => enrichFn({ data: { url, ...(classification ? { classification } : {}) } }),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (query.data && onIntel) onIntel(query.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  const intel = query.data ?? null;
  const inv = intel?.investigation ?? null;
  const score = inv?.threatScore ?? Math.round(confidence ?? 0);
  const tone = threatTone(score);
  const role = sourceRole({
    domain: host,
    embeddedPlayers: inv?.embeddedPlayers,
    downloadLinks: inv?.downloadLinks,
  });

  return (
    <article className="cyber-panel cyber-neon-border relative overflow-hidden rounded-2xl p-4">
      <div className="flex flex-wrap items-start gap-4">
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
          alt={`Favicon for ${host}`}
          loading="lazy"
          className="h-9 w-9 rounded-lg border border-sky-400/20 bg-slate-900 object-contain p-1"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-slate-100">{host}</h4>
            <Badge
              variant="outline"
              className="border-current text-[10px]"
              style={{ color: tone.color }}
            >
              {tone.label} · {score}%
            </Badge>
            <Badge variant="outline" className="text-[10px] text-sky-300">
              {role}
            </Badge>
            {inv && (
              <Badge variant="outline" className="text-[10px] text-slate-300">
                {inv.reachable ? "Live" : "Offline / blocked"}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-[11px] text-slate-400">
            {inv?.pageTitle ?? url}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open source
              </a>
            </Button>
            {query.isError && (
              <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
                <Radar className="mr-1.5 h-3.5 w-3.5" />
                Retry enrichment
              </Button>
            )}
          </div>
        </div>
        <ThreatGauge
          score={score}
          size={112}
          caption={intel ? `Trust ${intel.trustScore}%` : undefined}
        />
      </div>

      {query.isPending && (
        <div className="mt-3">
          <p className="mb-2 flex items-center gap-2 text-xs text-sky-300/80">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Enriching domain ownership and hosting intelligence…
          </p>
          <EvidenceCollectionTicker active compact />
        </div>
      )}

      {query.isError && (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <ShieldAlert className="h-3.5 w-3.5" />
          Ownership and hosting intelligence is unavailable for this domain right now.
        </p>
      )}

      {intel && inv && (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Field label="Domain" value={intel.domain} />
            <Field label="Registrar" value={intelValue(inv.whoisRegistrar)} />
            <Field label="Registered" value={intelValue(inv.whoisCreatedAt)} />
            <Field label="Expires" value={intelValue(inv.whoisExpiresAt)} />
            <Field
              label="Registrant privacy"
              value={intel.removal.whoisPrivacy ? "Privacy protected" : "Publicly disclosed"}
            />
            <Field label="Hosting provider" value={intelValue(inv.hostingProvider)} />
            <Field label="Hosting ASN" value={intelValue(intel.removal.hostingCompany)} />
            <Field label="IP address" value={intelValue(inv.ipAddress)} />
            <Field
              label="Country"
              value={`${countryFlag(inv.country)} ${intelValue(inv.country)}`}
            />
            <Field label="Cloud provider" value={intelValue(inv.hostingProvider)} />
            <Field label="CDN" value={intelValue(inv.cdn)} />
            <Field label="WAF" value={intelValue(inv.waf)} />
            <Field
              label="Nameservers"
              value={inv.whoisNameservers.length ? inv.whoisNameservers.join(", ") : "Not available"}
            />
            <Field label="DNS / reverse IP" value={intelValue(intel.reverseIpHost)} />
            <Field label="SSL issuer / status" value={intelValue(inv.sslStatus)} />
            <Field label="CMS / framework" value={intelValue(inv.cms ?? inv.framework)} />
            <Field
              label="Known mirrors"
              value={intel.mirrorDomains.length ? intel.mirrorDomains.join(", ") : "None observed"}
            />
            <Field
              label="Historical domains"
              value={
                intel.historicalDomains.length ? intel.historicalDomains.join(", ") : "None recorded"
              }
            />
            <Field label="Threat category" value={intel.threatCategory} />
            <Field label="Confidence" value={`${intel.confidence}%`} />
            <Field label="Trust score" value={`${intel.trustScore}%`} />
            <Field label="First seen" value={intelValue(firstSeen)} />
            <Field label="Last verified" value={intelValue(lastVerified ?? intel.cachedAt)} />
            <Field label="Mirror count" value={String(intel.mirrorDomains.length)} />
          </div>

          {(inv.evidenceFindings.length > 0 ||
            inv.downloadLinks.length > 0 ||
            inv.embeddedPlayers.length > 0) && (
            <div className="mt-3 rounded-xl border border-sky-400/20 bg-slate-950/50 p-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-sky-300/80">
                <Globe className="h-3 w-3" />
                Evidence collected
              </div>
              <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-300">
                {[...inv.evidenceFindings, ...inv.downloadLinks, ...inv.embeddedPlayers]
                  .slice(0, 8)
                  .map((item, i) => (
                    <li key={`${item}-${i}`}>• {item}</li>
                  ))}
              </ul>
            </div>
          )}

          <div className="mt-3 grid gap-3">
            <RemovalIntelligencePanel intel={intel} />
            <ActionCenter
              intel={intel}
              workTitle={workTitle}
              matchId={matchId}
              onMarkResolved={onMarkResolved}
              onEscalate={onEscalate}
            />
          </div>
        </>
      )}
    </article>
  );
}

export default DomainIntelCard;
