import React, { useEffect, useState } from "react";

const steps = [
  "> Connecting to target...",
  "✓ Connected",

  "> Resolving DNS...",
  "✓ DNS Complete",

  "> Querying RDAP...",
  "✓ RDAP Complete",

  "> Querying WHOIS...",
  "✓ WHOIS Complete",

  "> Downloading webpage...",
  "✓ HTML Downloaded",

  "> Detecting CMS...",
  "✓ WordPress detected",

  "> Detecting Framework...",
  "✓ Framework analyzed",

  "> Detecting CDN...",
  "✓ Cloudflare detected",

  "> Detecting Hosting...",
  "✓ Cloudflare Inc.",

  "> Finding download links...",
  "✓ Download links detected",

  "> Searching embedded player...",
  "✓ Analysis complete",

  "> Calculating Threat Score...",
  "✓ Investigation Complete"
];

export default function InvestigationTerminal() {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    let i = 0;

    const timer = setInterval(() => {
      setLines((prev) => [...prev, steps[i]]);
      i++;

      if (i >= steps.length) {
        clearInterval(timer);
      }
    }, 300);

    return () => clearInterval(timer);
  }, []);

  const progress = Math.round((lines.length / steps.length) * 100);

  return (
    <div className="bg-black rounded-xl p-6 text-green-400 font-mono h-[600px] overflow-auto">

      <div className="text-xl font-bold mb-4">
        ETERNA CYBER INVESTIGATION
      </div>

      <div className="mb-6 text-green-500">
        Digital Infrastructure Intelligence Engine
      </div>

      {lines.map((line, index) => (
        <div key={index} className="mb-1">
          {line}
        </div>
      ))}

      <div className="mt-10">

        <div className="w-full h-3 bg-zinc-800 rounded">

          <div
            className="bg-green-500 h-3 rounded transition-all duration-300"
            style={{ width: `${progress}%` }}
          />

        </div>

        <div className="mt-2 text-green-300">
          {progress}% Complete
        </div>

      </div>

    </div>
  );
}
