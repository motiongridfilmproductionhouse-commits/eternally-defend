import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import { PageCard } from "@/components/dashboard/PageCard";
import { useSession } from "@/hooks/use-session";
import {
  downloadSignedAuthorization,
  getSignedAuthorization,
} from "@/lib/profile/signed-authorization.functions";

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function SignedAuthorizationCard() {
  const { session, ready } = useSession();
  const userId = session?.user.id ?? null;
  const fetchSummary = useServerFn(getSignedAuthorization);
  const fetchDownload = useServerFn(downloadSignedAuthorization);
  const [downloading, setDownloading] = useState(false);

  const summaryQuery = useQuery({
    // Keyed by account so no cached document metadata leaks across logins.
    queryKey: ["signed-authorization", userId ?? "anon"],
    queryFn: () => fetchSummary(),
    enabled: ready && !!userId,
  });

  const summary = summaryQuery.data;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetchDownload();
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Signed authorization downloaded");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "We couldn't prepare your signed authorization. Please try again.",
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <PageCard
      title="SIGNED AUTHORIZATION"
      sub="Your electronically signed authorization agreement"
    >
      {summaryQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading your signed authorization…
        </div>
      ) : summaryQuery.isError ? (
        <div className="text-sm text-destructive">
          We couldn't load your authorization status.{" "}
          <button className="underline" onClick={() => summaryQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : !summary?.available ? (
        <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
          No signed authorization available. It becomes available here once you complete
          onboarding and electronically sign your authorization agreement.
        </div>
      ) : (
        <div className="rounded-xl border border-border p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="size-4 text-primary" />
            Electronically signed
          </div>

          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Signed by (typed name)
              </dt>
              <dd className="font-medium">{summary.typed_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Signature method
              </dt>
              <dd className="font-medium">
                Electronic — {summary.signature_method ?? "typed name"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Signed on
              </dt>
              <dd className="font-medium">{formatDateTime(summary.signed_at)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Agreement version
              </dt>
              <dd className="font-medium">
                {summary.auth_number ?? "—"}
                {summary.agreement_version != null ? ` · v${summary.agreement_version}` : ""}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-border disabled:opacity-50"
              style={{ background: "var(--gradient-soft)" }}
            >
              {downloading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Download Signed Authorization
            </button>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileCheck2 className="size-3.5" />
              Includes the signed agreement and your electronic signature record.
            </span>
          </div>
        </div>
      )}
    </PageCard>
  );
}
