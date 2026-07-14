import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { checkVerification, listVerifications, startVerification } from "@/lib/verification.functions";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { CheckCircle2, Loader2, ShieldCheck, ExternalLink, Copy } from "lucide-react";

type Account = Database["public"]["Tables"]["discovered_accounts"]["Row"];
type Method = Database["public"]["Enums"]["verification_method"];

interface Props {
  account: Account | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccountUpdated?: () => void;
}

const METHODS: { id: Method; label: string; desc: string; disabled?: string }[] = [
  { id: "bio_code", label: "Add code to profile bio", desc: "We'll generate a short code — paste it into the profile bio, we'll re-scan and verify, then you can remove it." },
  { id: "domain_meta", label: "Add meta tag to your website", desc: "Add a <meta name=\"eterna-verify\"> tag to any page on the confirmed domain." },
  { id: "domain_dns", label: "Add DNS TXT record", desc: "Publish a TXT record on your domain — the strongest domain-based proof." },
  { id: "document", label: "Upload authorization document", desc: "Upload a signed ownership/authorization document for manual review." },
  { id: "admin_review", label: "Request admin review", desc: "Send to a workspace admin for manual approval." },
  { id: "oauth", label: "Sign in to the platform", desc: "OAuth-based verification (coming soon for this platform).", disabled: "Coming soon" },
  { id: "business_email", label: "Business-email verification", desc: "Receive a code at an email on your confirmed domain (coming soon).", disabled: "Coming soon" },
];

export function VerificationDialog({ account, open, onOpenChange, onAccountUpdated }: Props) {
  const qc = useQueryClient();
  const startFn = useServerFn(startVerification);
  const checkFn = useServerFn(checkVerification);
  const listFn = useServerFn(listVerifications);

  const [selected, setSelected] = useState<Method>("bio_code");
  const [domain, setDomain] = useState("");
  const [targetUrl, setTargetUrl] = useState("");

  const verifsQuery = useQuery({
    queryKey: ["account-verifications", account?.id],
    enabled: !!account && open,
    queryFn: () => listFn({ data: { accountId: account!.id } }),
  });

  const activePending = verifsQuery.data?.find((v) => v.state === "pending" && v.method === selected) ?? null;

  const startMut = useMutation({
    mutationFn: () => startFn({
      data: {
        accountId: account!.id,
        method: selected,
        evidence: selected === "domain_dns" ? { domain: domain.trim().toLowerCase() }
          : selected === "domain_meta" ? { url: targetUrl.trim() }
          : {},
      },
    }),
    onSuccess: () => {
      toast.success("Verification started");
      qc.invalidateQueries({ queryKey: ["account-verifications", account?.id] });
      onAccountUpdated?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkMut = useMutation({
    mutationFn: (verificationId: string) => checkFn({ data: { verificationId } }),
    onSuccess: (v) => {
      if (v.state === "passed") toast.success("Ownership verified");
      else if (v.state === "failed") toast.error("We couldn't confirm the token yet — try again");
      else toast.message(`Status: ${v.state}`);
      qc.invalidateQueries({ queryKey: ["account-verifications", account?.id] });
      onAccountUpdated?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!account) return null;
  const method = METHODS.find((m) => m.id === selected)!;
  const domainDefault = account.website_links && Array.isArray(account.website_links) && account.website_links[0]
    ? (typeof account.website_links[0] === "string" ? account.website_links[0] : "") : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" /> Verify ownership
          </DialogTitle>
          <DialogDescription className="text-xs">
            Confirming an account only enables monitoring. Enforcement actions (takedown, copyright, impersonation reports)
            require ownership verification for this account.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1 space-y-1">
            {METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={!!m.disabled}
                onClick={() => setSelected(m.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium border ${
                  selected === m.id ? "bg-primary/10 border-primary/40 text-primary" : "border-transparent hover:bg-accent"
                } ${m.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div>{m.label}</div>
                {m.disabled && <div className="text-[10px] font-normal text-muted-foreground mt-0.5">{m.disabled}</div>}
              </button>
            ))}
          </div>

          <div className="md:col-span-2 space-y-3">
            <div className="text-xs text-muted-foreground">{method.desc}</div>

            {selected === "domain_dns" && (
              <label className="block text-xs font-semibold">Domain
                <input value={domain || domainDefault} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" />
              </label>
            )}
            {selected === "domain_meta" && (
              <label className="block text-xs font-semibold">Page URL to check
                <input value={targetUrl || domainDefault} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://example.com/about" className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" />
              </label>
            )}
            {selected === "document" && (
              <div className="text-xs text-muted-foreground rounded-lg border border-dashed border-border p-3">
                Upload from the Authorization vault in Onboarding → Documents; an admin will link it here for review.
              </div>
            )}
            {selected === "admin_review" && (
              <div className="text-xs text-muted-foreground rounded-lg border border-dashed border-border p-3">
                A workspace admin will review this account and approve or reject verification.
              </div>
            )}

            {!activePending && !method.disabled && (
              <button
                disabled={startMut.isPending}
                onClick={() => startMut.mutate()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-60"
                style={{ background: "var(--gradient-brand)" }}
              >
                {startMut.isPending && <Loader2 className="size-4 animate-spin" />}
                Start verification
              </button>
            )}

            {activePending && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Instructions</div>
                {selected === "bio_code" && (
                  <div className="text-sm">
                    Paste this token anywhere in the profile bio at{" "}
                    <a className="text-primary underline underline-offset-2" href={account.profile_url} target="_blank" rel="noreferrer">
                      {account.profile_url.replace(/^https?:\/\//, "")} <ExternalLink className="inline size-3" />
                    </a>, then click Re-check.
                    <TokenBlock code={activePending.code!} />
                  </div>
                )}
                {selected === "domain_meta" && (
                  <div className="text-sm">
                    Add this tag inside the &lt;head&gt; of the page:
                    <pre className="mt-2 bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto">
{`<meta name="eterna-verify" content="${activePending.code}">`}
                    </pre>
                  </div>
                )}
                {selected === "domain_dns" && (
                  <div className="text-sm">
                    Publish this TXT record on <span className="font-mono">{(activePending.evidence as { domain?: string })?.domain ?? "your domain"}</span>:
                    <TokenBlock code={`eterna-verify=${activePending.code}`} />
                  </div>
                )}

                {["bio_code", "domain_meta", "domain_dns"].includes(selected) && (
                  <button
                    disabled={checkMut.isPending}
                    onClick={() => checkMut.mutate(activePending.id)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60"
                  >
                    {checkMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    Re-check now
                  </button>
                )}
              </div>
            )}

            {verifsQuery.data && verifsQuery.data.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">History</div>
                <div className="space-y-1">
                  {verifsQuery.data.slice(0, 5).map((v) => (
                    <div key={v.id} className="text-xs flex items-center justify-between">
                      <span>{v.method}</span>
                      <span className={
                        v.state === "passed" ? "text-emerald-700 font-semibold" :
                        v.state === "failed" ? "text-rose-700" :
                        v.state === "expired" ? "text-muted-foreground" :
                        "text-amber-700"
                      }>{v.state}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TokenBlock({ code }: { code: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md bg-muted p-2">
      <code className="font-mono text-xs flex-1 select-all break-all">{code}</code>
      <button
        type="button"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-background border border-border text-xs hover:bg-accent"
        onClick={() => { navigator.clipboard.writeText(code); toast.success("Copied"); }}
      >
        <Copy className="size-3" /> Copy
      </button>
    </div>
  );
}
