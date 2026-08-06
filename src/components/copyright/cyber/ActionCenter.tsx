import { CheckCircle2, Copy, Download, ExternalLink, FileText, Gavel, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  draftLegalNotice,
  enforcementContactBlock,
  type DomainIntel,
} from "@/lib/copyright/domain-intel";

export type ActionCenterProps = {
  intel: DomainIntel;
  workTitle: string;
  matchId?: string | null;
  onMarkResolved?: (matchId: string) => void;
  onEscalate?: (matchId: string) => void;
};

function downloadText(fileName: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function openPrintableDossier(intel: DomainIntel, workTitle: string) {
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Allow pop-ups to export the evidence dossier.");
    return;
  }
  const body = `${draftLegalNotice(intel, workTitle)}\n\n---\n\n${enforcementContactBlock(intel)}`;
  win.document.write(
    `<!doctype html><html><head><title>Eterna evidence dossier — ${intel.domain}</title>` +
      `<style>body{font:12px/1.6 ui-monospace,monospace;padding:32px;white-space:pre-wrap}h1{font:600 18px system-ui}</style>` +
      `</head><body><h1>Eterna evidence dossier — ${intel.domain}</h1>${body.replace(/</g, "&lt;")}</body></html>`,
  );
  win.document.close();
  win.focus();
  win.print();
}

/** One-click enforcement actions for a detected source. */
export function ActionCenter({
  intel,
  workTitle,
  matchId,
  onMarkResolved,
  onEscalate,
}: ActionCenterProps) {
  const copyContacts = async () => {
    try {
      await navigator.clipboard.writeText(enforcementContactBlock(intel));
      toast.success("Abuse contacts copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <section className="cyber-panel rounded-2xl p-4">
      <header className="flex items-center gap-2">
        <Gavel className="h-4 w-4 text-sky-300" />
        <h4 className="text-sm font-semibold text-slate-100">Action center</h4>
      </header>
      <p className="mt-1 text-[11px] text-slate-500">
        Evidence preparation only — nothing is submitted automatically.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            downloadText(
              `dmca-package-${intel.domain}.txt`,
              `${draftLegalNotice(intel, workTitle)}\n\n---\n\n${enforcementContactBlock(intel)}`,
            )
          }
        >
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          Generate DMCA package
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            downloadText(`legal-notice-${intel.domain}.txt`, draftLegalNotice(intel, workTitle))
          }
        >
          <Scale className="mr-1.5 h-3.5 w-3.5" />
          Generate legal notice
        </Button>
        {intel.removal.registrarComplaintUrl && (
          <Button size="sm" variant="outline" asChild>
            <a href={intel.removal.registrarComplaintUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open registrar complaint
            </a>
          </Button>
        )}
        {(intel.removal.hostingAbuseForm ?? intel.removal.hostingAbuseEmail) && (
          <Button size="sm" variant="outline" asChild>
            <a
              href={
                intel.removal.hostingAbuseForm ??
                `mailto:${intel.removal.hostingAbuseEmail}?subject=${encodeURIComponent(
                  `Copyright infringement report — ${intel.domain}`,
                )}`
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open hosting complaint
            </a>
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={copyContacts}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copy abuse contacts
        </Button>
        <Button size="sm" variant="outline" onClick={() => openPrintableDossier(intel, workTitle)}>
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          Export evidence PDF
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            downloadText(
              `evidence-${intel.domain}.json`,
              JSON.stringify({ workTitle, ...intel }, null, 2),
              "application/json",
            )
          }
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Download evidence bundle
        </Button>
        {matchId && onMarkResolved && (
          <Button size="sm" variant="ghost" onClick={() => onMarkResolved(matchId)}>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Mark resolved
          </Button>
        )}
        {matchId && onEscalate && (
          <Button
            size="sm"
            variant="ghost"
            className="text-red-300 hover:text-red-200"
            onClick={() => onEscalate(matchId)}
          >
            <Gavel className="mr-1.5 h-3.5 w-3.5" />
            Escalate to legal
          </Button>
        )}
      </div>
    </section>
  );
}

export default ActionCenter;
