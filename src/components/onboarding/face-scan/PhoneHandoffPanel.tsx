import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Loader2, QrCode, Smartphone, RefreshCcw, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { createFaceHandoff } from "@/lib/onboarding/face-handoff.functions";

/**
 * Desktop-side hand-off: shows a QR for a short-lived one-time mobile link and
 * polls the real enrollment status until the phone finishes AWS Face Liveness.
 */
export function PhoneHandoffPanel({
  onRefetch,
  highlight,
}: {
  onRefetch: () => Promise<void>;
  highlight?: boolean;
}) {
  const create = useServerFn(createFaceHandoff);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const generate = async () => {
    setLoading(true);
    try {
      const res: any = await create();
      // Always use the server-issued public URL (PUBLIC_APP_URL); never window.location.origin.
      const link: string = res.url;
      if (!link) throw new Error("Secure phone link unavailable — please retry");

      const QRCode = (await import("qrcode")).default;
      const dataUrl = await QRCode.toDataURL(link, {
        margin: 1,
        width: 320,
        color: { dark: "#0b1220", light: "#ffffff" },
      });
      setUrl(link);
      setQr(dataUrl);

      setExpiresAt(res.expiresAt);
      stopPolling();
      // Desktop polls the real backend enrollment status — never a fake signal.
      pollRef.current = setInterval(() => void onRefetch(), 4000);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the secure phone link");
    } finally {
      setLoading(false);
    }
  };

  const minutesLeft = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60000))
    : null;

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 ${
        highlight
          ? "border-sky-400/40 bg-sky-500/10"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-start gap-2">
        <Smartphone className="size-4 mt-0.5 text-sky-300 shrink-0" />
        <div className="space-y-1">
          <p className="text-sm text-white/85">No camera available? Continue securely on your phone.</p>
          <p className="text-[11px] text-white/50">
            You will complete the same secure AWS Face Liveness check on your phone. This page updates
            automatically when enrollment succeeds.
          </p>
        </div>
      </div>

      {!qr ? (
        <Button
          onClick={generate}
          disabled={loading}
          variant="outline"
          className="w-full sm:w-auto bg-slate-950/60 border-sky-500/30 text-sky-100 hover:bg-sky-950/40 hover:text-white"
        >
          {loading ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <QrCode className="size-4 mr-2" />
          )}
          Continue on Phone
        </Button>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <img
            src={qr}
            alt="QR code linking to the secure mobile Face Protection page"
            className="size-36 rounded-lg bg-white p-1.5"
          />
          <div className="space-y-2 text-center sm:text-left">
            <p className="text-xs text-white/60">
              Scan with your phone camera.{" "}
              {minutesLeft !== null && (
                <span className="text-sky-200">Expires in ~{minutesLeft} min · single use.</span>
              )}
            </p>
            <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
              <Button
                size="sm"
                variant="outline"
                className="bg-slate-950/60 border-sky-500/30 text-sky-100 hover:bg-sky-950/40 hover:text-white"
                onClick={async () => {
                  if (!url) return;
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    toast.error("Could not copy the link");
                  }
                }}
              >
                {copied ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
                Copy link
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-white/60 hover:text-white hover:bg-white/10"
                onClick={generate}
                disabled={loading}
              >
                <RefreshCcw className="size-3.5 mr-1" /> New code
              </Button>
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-white/40">
              <Loader2 className="size-3 animate-spin" /> Waiting for phone enrollment…
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
