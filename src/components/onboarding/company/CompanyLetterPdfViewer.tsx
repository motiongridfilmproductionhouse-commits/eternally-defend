import { useEffect, useState } from "react";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { previewCompanyAuthorizationLetter } from "@/lib/onboarding/company-authorization.functions";

const GHOST_BUTTON =
  "border border-sky-500/30 bg-slate-950/60 text-sky-100 hover:bg-slate-900/80 hover:text-white";

function base64ToBlobUrl(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

/**
 * Renders the generated authorization letter PDF inline, in-section.
 *
 * The PDF bytes come from the server function and are turned into a same-origin
 * blob URL, so no external storage tab is opened (extensions block those).
 */
export function CompanyLetterPdfViewer({ height = 520 }: { height?: number }) {
  const preview = useServerFn(previewCompanyAuthorizationLetter);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setLoading(true);
    setError(null);
    preview({})
      .then((result) => {
        if (cancelled) return;
        created = base64ToBlobUrl(result.pdf_base64);
        setBlobUrl(created);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to render the letter");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const download = () => {
    if (!blobUrl) return;
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = "Eterna_Company_Authorization.pdf";
    anchor.click();
    toast.success("Authorization letter downloaded.");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-sky-300/80">
          <FileText className="size-3.5" /> Authorization letter PDF
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setReloadKey((value) => value + 1)}
            disabled={loading}
            className={GHOST_BUTTON}
          >
            <RefreshCw className={`mr-1.5 size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={download}
            disabled={!blobUrl}
            className={GHOST_BUTTON}
          >
            <Download className="mr-1.5 size-3.5" /> Download
          </Button>
        </div>
      </div>

      <div
        className="overflow-hidden rounded-md border border-white/10 bg-[#060C1F]"
        style={{ height }}
      >
        {loading ? (
          <div className="grid h-full place-items-center text-xs text-white/50">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-blue-400" /> Generating letter…
            </span>
          </div>
        ) : error ? (
          <div className="grid h-full place-items-center px-6 text-center text-xs text-rose-200/80">
            {error}
          </div>
        ) : (
          <object
            data={`${blobUrl}#view=FitH`}
            type="application/pdf"
            title="Eterna Sentinel company authorization letter"
            className="h-full w-full"
          >
            <div className="grid h-full place-items-center gap-3 px-6 text-center">
              <p className="text-xs leading-relaxed text-white/60">
                Inline PDF preview isn’t supported in this browser view. The full letter is shown
                above and can be downloaded here.
              </p>
              <Button type="button" size="sm" onClick={download} disabled={!blobUrl}>
                <Download className="mr-1.5 size-3.5" /> Download authorization letter
              </Button>
            </div>
          </object>
        )}
      </div>

      {/* Always-visible actions under the preview, so they are reachable even
          when the embedded PDF viewer takes over the frame. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={download}
          disabled={!blobUrl}
          className={GHOST_BUTTON}
        >
          <Download className="mr-1.5 size-3.5" /> Download PDF
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setReloadKey((value) => value + 1)}
          disabled={loading}
          className={GHOST_BUTTON}
        >
          <RefreshCw className={`mr-1.5 size-3.5 ${loading ? "animate-spin" : ""}`} /> Regenerate
        </Button>
      </div>
    </div>
  );
}
