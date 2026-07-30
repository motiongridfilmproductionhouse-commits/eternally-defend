import React, { useEffect, useState } from "react";
import InvestigationTerminal from "./InvestigationTerminal";

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

  useEffect(() => {
    if (!open) return;

    setFinished(false);

    const timer = setTimeout(() => {
      setFinished(true);
    }, 8000);

    return () => clearTimeout(timer);
  }, [open]);

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

                  <p>Provider: Cloudflare Inc.</p>
                  <p>ASN: AS13335</p>
                  <p>CDN: Cloudflare</p>
                  <p>HTTP: 200 OK</p>
                  <p>CMS: WordPress</p>

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
