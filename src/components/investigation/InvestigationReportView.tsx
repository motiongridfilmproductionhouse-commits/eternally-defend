import type { ReactNode } from "react";
import { Copy, Download, ExternalLink, ShieldAlert } from "lucide-react";
import type { WebsiteInvestigationResult } from "@/lib/investigation/website-investigation";
import { Button } from "@/components/ui/button";

type InvestigationReportViewProps = {
  result: WebsiteInvestigationResult;
  onClose: () => void;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">{title}</h3>
      <div className="space-y-1.5 text-sm text-zinc-200">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <span className="min-w-[140px] text-zinc-500">{label}</span>
      <span className="min-w-0 flex-1 break-words">{value ?? "—"}</span>
    </div>
  );
}

function ListBlock({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-zinc-500">{empty}</p>;
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function riskTone(level: string): string {
  const normalized = level.toLowerCase();
  if (normalized.includes("critical") || normalized.includes("high")) {
    return "text-red-400";
  }
  if (normalized.includes("medium")) return "text-amber-400";
  return "text-emerald-400";
}

export function InvestigationReportView({ result, onClose }: InvestigationReportViewProps) {
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(result.url);
    } catch {
      /* ignore */
    }
  };

  const saveEvidence = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `website-investigation-${result.domain}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="flex h-[600px] flex-col text-white">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 pb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Website Investigation Report</h1>
          <p className="mt-1 truncate text-sm text-zinc-400">{result.url}</p>
          <p className="text-xs text-zinc-500">
            Investigated {new Date(result.investigatedAt).toLocaleString()}
          </p>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-bold ${riskTone(result.riskLevel)}`}>
            {result.threatScore}
          </div>
          <div className={`text-sm font-semibold uppercase ${riskTone(result.riskLevel)}`}>
            {result.riskLevel}
          </div>
        </div>
      </div>

      <div className="grid flex-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2">
        <Section title="Target">
          <Row label="URL" value={result.url} />
          <Row label="Domain" value={result.domain} />
          <Row label="Page title" value={result.pageTitle} />
          <Row
            label="Reachability"
            value={
              result.reachable
                ? `Reachable (${result.pageStatus ?? "OK"})`
                : `Unreachable${result.pageStatus ? ` (${result.pageStatus})` : ""}`
            }
          />
          <Row label="Classification" value={result.classification} />
        </Section>

        <Section title="WHOIS & Registration">
          <Row label="Registrar" value={result.whoisRegistrar} />
          <Row label="Created" value={result.whoisCreatedAt} />
          <Row label="Updated" value={result.whoisUpdatedAt} />
          <Row label="Expires" value={result.whoisExpiresAt} />
          <Row label="Abuse email" value={result.whoisAbuseEmail} />
          <Row
            label="Nameservers"
            value={result.whoisNameservers.length ? result.whoisNameservers.join(", ") : null}
          />
        </Section>

        <Section title="Infrastructure">
          <Row label="Hosting" value={result.hostingProvider} />
          <Row label="IP address" value={result.ipAddress} />
          <Row
            label="Location"
            value={[result.city, result.country].filter(Boolean).join(", ") || null}
          />
          <Row label="CDN" value={result.cdn} />
          <Row label="WAF" value={result.waf} />
          <Row label="CMS" value={result.cms} />
          <Row label="Framework" value={result.framework} />
          <Row label="SSL" value={result.sslStatus} />
        </Section>

        <Section title="Distribution indicators">
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs uppercase text-zinc-500">Embedded players</p>
              <ListBlock items={result.embeddedPlayers} empty="None detected" />
            </div>
            <div>
              <p className="mb-1 text-xs uppercase text-zinc-500">Download links</p>
              <ListBlock items={result.downloadLinks} empty="None detected" />
            </div>
            <div>
              <p className="mb-1 text-xs uppercase text-zinc-500">File-host links</p>
              <ListBlock items={result.fileHostLinks} empty="None detected" />
            </div>
            <div>
              <p className="mb-1 text-xs uppercase text-zinc-500">Torrent / magnet</p>
              <ListBlock items={result.torrentIndicators} empty="None detected" />
            </div>
            <div>
              <p className="mb-1 text-xs uppercase text-zinc-500">Evidence findings</p>
              <ListBlock items={result.evidenceFindings} empty="No additional evidence logged" />
            </div>
          </div>
        </Section>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
        <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-500">
          <a href={result.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Website
          </a>
        </Button>
        <Button size="sm" variant="secondary" onClick={copyUrl}>
          <Copy className="mr-2 h-4 w-4" />
          Copy URL
        </Button>
        <Button size="sm" variant="secondary" onClick={saveEvidence}>
          <Download className="mr-2 h-4 w-4" />
          Save Evidence
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

export default InvestigationReportView;
