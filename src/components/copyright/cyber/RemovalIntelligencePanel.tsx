import { Copy, Gavel, Mail, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  enforcementContactBlock,
  intelValue,
  PRIVACY_PLACEHOLDER,
  type DomainIntel,
} from "@/lib/copyright/domain-intel";

export type RemovalIntelligencePanelProps = {
  intel: DomainIntel;
};

function Row({
  label,
  value,
  href,
  privacy,
}: {
  label: string;
  value: string | null;
  href?: string | null;
  privacy?: boolean;
}) {
  const display = intelValue(value, { privacy });
  const unknown = display === PRIVACY_PLACEHOLDER || display === "Not available";
  return (
    <div className="flex items-start justify-between gap-3 border-b border-sky-400/10 py-1.5 last:border-0">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span>
      {href && !unknown ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-[60%] truncate text-right text-xs text-sky-300 hover:underline"
        >
          {display}
        </a>
      ) : (
        <span
          className={`max-w-[60%] truncate text-right text-xs ${unknown ? "italic text-slate-500" : "text-slate-200"}`}
        >
          {display}
        </span>
      )}
    </div>
  );
}

/** Removal Intelligence: every enforcement contact route for a detected source. */
export function RemovalIntelligencePanel({ intel }: RemovalIntelligencePanelProps) {
  const r = intel.removal;

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(enforcementContactBlock(intel));
      toast.success("All enforcement contacts copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <section className="cyber-panel rounded-2xl p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gavel className="h-4 w-4 text-sky-300" />
          <h4 className="text-sm font-semibold text-slate-100">Removal intelligence</h4>
        </div>
        <Button size="sm" variant="outline" onClick={copyAll}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copy all contacts
        </Button>
      </header>

      <div className="mt-3 grid gap-x-6 gap-y-0 md:grid-cols-2">
        <div>
          <Row label="Hosting company" value={r.hostingCompany} />
          <Row
            label="Hosting abuse email"
            value={r.hostingAbuseEmail}
            href={r.hostingAbuseEmail ? `mailto:${r.hostingAbuseEmail}` : null}
          />
          <Row label="Hosting abuse form" value={r.hostingAbuseForm} href={r.hostingAbuseForm} />
          <Row label="Registrar" value={r.registrar} />
          <Row
            label="Registrar abuse email"
            value={r.registrarAbuseEmail}
            href={r.registrarAbuseEmail ? `mailto:${r.registrarAbuseEmail}` : null}
          />
          <Row
            label="Registrar complaint"
            value={r.registrarComplaintUrl}
            href={r.registrarComplaintUrl}
          />
        </div>
        <div>
          <Row label="DMCA page" value={r.dmcaPageUrl} href={r.dmcaPageUrl} />
          <Row
            label="Copyright complaint"
            value={r.copyrightComplaintUrl}
            href={r.copyrightComplaintUrl}
          />
          <Row
            label="Legal contact"
            value={r.legalContact}
            href={r.legalContact?.includes("@") ? `mailto:${r.legalContact}` : r.legalContact}
          />
          <Row label="WHOIS contact" value={r.whoisContact} privacy={r.whoisPrivacy} />
          <Row label="Country jurisdiction" value={r.country} />
          <Row label="Applicable regime" value={r.regime} />
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-sky-400/20 bg-sky-500/5 p-3">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-sky-300/80">
          <ShieldQuestion className="h-3.5 w-3.5" />
          Estimated takedown path
        </div>
        <ol className="mt-2 space-y-1 text-xs text-slate-300">
          {r.takedownPath.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-500">
          <Mail className="mt-0.5 h-3 w-3 shrink-0" />
          {r.note}
        </p>
      </div>
    </section>
  );
}

export default RemovalIntelligencePanel;
