import React, { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import InvestigationTerminal from "./InvestigationTerminal";
import { investigateUrl } from "@/lib/investigation.functions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  match: any;
};

export default function InvestigationModal({
  open,
  onOpenChange,
  match,
}: Props) {
const [finished, setFinished] = useState(false);
const [report, setReport] = useState<any>(null);
const [loading, setLoading] = useState(false);
const runInvestigation = useServerFn(investigateUrl);

  useEffect(() => {
  if (!open || !match?.url) return;

  setFinished(false);
  setLoading(true);

  runInvestigation({ data: { url: match.url } })
    .then((result: unknown) => {
      setReport(result);
    })
    .catch((err: unknown) => {
      console.error(err);
    })
    .finally(() => {
      setLoading(false);
    });


  const timer = setTimeout(() => {
    setFinished(true);
  }, 8000);

  return () => clearTimeout(timer);
}, [open, match]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">

      <div className="bg-zinc-950 rounded-xl border border-zinc-800 shadow-2xl w-[1100px] max-w-[95vw] h-[700px] overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">

          <div>

            <h2 className="text-white text-xl font-bold">
              Website Investigation
            </h2>

            <p className="text-zinc-400 text-sm">
              Digital Infrastructure Intelligence
            </p>

          </div>

          <button
            onClick={() => onOpenChange(false)}
            className="text-white hover:text-red-400"
          >
            ✕
          </button>

        </div>

        <div className="p-6">

          {!finished ? (

            <InvestigationTerminal />

          ) : (

            <div className="text-white">

              <h1 className="text-3xl font-bold mb-6">
                Investigation Complete
              </h1>

              <div className="grid grid-cols-2 gap-6">

                <div className="rounded-lg bg-zinc-900 p-4">

                  <h3 className="text-lg font-semibold mb-3">
                    Infrastructure
                  </h3>

                  <p>Provider: {report?.provider?.name ?? "-"}</p>

<p>ASN: {report?.provider?.asn ?? "-"}</p>

<p>CDN: {report?.cdn?.provider ?? "-"}</p>

<p>Registrar: {report?.whois?.registrar ?? "-"}</p>

<p>Abuse Email: {report?.provider?.abuseEmail ?? report?.whois?.abuseEmail ?? "-"}</p>

                </div>

                <div className="rounded-lg bg-zinc-900 p-4">

                  <h3 className="text-lg font-semibold mb-3">
                    Threat Score
                  </h3>

                  <div className="text-red-400 text-5xl font-bold">
                    90
                  </div>

                  <div className="mt-2">
                    HIGH RISK
                  </div>

                </div>

              </div>
<div className="mt-6 rounded-lg bg-zinc-900 p-4">
  <h3 className="text-lg font-semibold mb-3">
    Public Contacts
  </h3>

  {report?.contacts?.contacts?.length ? (
    report.contacts.contacts.map((contact: any) => (
      <div
        key={contact.email}
        className="border-b border-zinc-800 py-2"
      >
        <div className="font-semibold">
          {contact.category}
        </div>

        <div>{contact.email}</div>

        <div className="text-xs text-zinc-400">
          {contact.source}
        </div>
      </div>
    ))
  ) : (
    <div className="text-zinc-500">
      No public contacts found.
    </div>
  )}
</div>

              <div className="mt-8 flex gap-3">

                <button className="px-4 py-2 rounded bg-blue-600 text-white">
                  Export PDF
                </button>

                <button className="px-4 py-2 rounded bg-red-600 text-white">
                  Generate DMCA
                </button>

                <button className="px-4 py-2 rounded bg-zinc-700 text-white">
                  Copy Evidence
                </button>

              </div>

            </div>

          )}

        </div>

      </div>

    </div>
  );
}
