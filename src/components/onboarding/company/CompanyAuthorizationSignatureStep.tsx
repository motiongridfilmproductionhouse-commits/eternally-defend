import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getCompanyAuthorization,
  signCompanyAuthorizationLetter,
} from "@/lib/onboarding/company-authorization.functions";
import { CompanyLetterPdfViewer } from "./CompanyLetterPdfViewer";
import { CompanyStatusSummary } from "./CompanyStatusSummary";

const FIELD =
  "border-white/10 bg-[#060C1F] text-white placeholder:text-white/30 focus-visible:ring-blue-500/40";

/** Typed electronic signature of the generated company authorization letter. */
export function CompanyAuthorizationSignatureStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const fetchAuthorization = useServerFn(getCompanyAuthorization);
  const sign = useServerFn(signCompanyAuthorizationLetter);
  const qc = useQueryClient();

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["company-authorization"],
    queryFn: () => fetchAuthorization(),
  });

  const [legalName, setLegalName] = useState("");
  const [title, setTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setLegalName((prev) => prev || data.signature?.legal_name || data.company.representative_name);
    setTitle((prev) => prev || data.signature?.title || data.company.representative_title || "");
    setCompanyName((prev) => prev || data.signature?.company_name || data.company.name);
  }, [data]);

  const signed = data?.signature ?? null;
  const canSign = Boolean(legalName.trim() && title.trim() && companyName.trim() && agreed);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await sign({
        data: {
          legal_name: legalName.trim(),
          title: title.trim(),
          company_name: companyName.trim(),
          agreed: true,
        },
      });
      await refetch();
      await qc.invalidateQueries({ queryKey: ["company-onboarding"] });
      toast.success(`Authorization signed at ${new Date(result.signed_at).toLocaleString()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to record the signature");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Electronic Signature</CardTitle>
        <CardDescription className="text-white/60">
          Sign the generated authorization letter. We record the exact document version accepted and
          the acceptance timestamp.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-blue-400" />
          </div>
        ) : (
          <>
            <div className="space-y-4 rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/75">Typed legal name</Label>
                  <Input
                    value={legalName}
                    onChange={(event) => setLegalName(event.target.value)}
                    disabled={Boolean(signed)}
                    placeholder="Full legal name"
                    className={FIELD}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/75">Title / role</Label>
                  <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={Boolean(signed)}
                    placeholder="e.g. Director"
                    className={FIELD}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs text-white/75">Company name</Label>
                  <Input
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                    disabled={Boolean(signed)}
                    placeholder="Legal company name"
                    className={FIELD}
                  />
                </div>
              </div>

              {!signed && (
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-white/10 bg-white/5 p-3">
                  <Checkbox
                    checked={agreed}
                    onCheckedChange={(value) => setAgreed(value === true)}
                    className="mt-0.5 border-sky-400/40 data-[state=checked]:bg-blue-600"
                  />
                  <span className="text-xs leading-relaxed text-white/75">
                    I agree to the Eterna Sentinel authorization letter shown in the previous step
                    and sign it electronically on behalf of the company.
                  </span>
                </label>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {!signed ? (
                  <Button
                    onClick={submit}
                    disabled={!canSign || busy}
                    className="bg-blue-600 text-white hover:bg-blue-500"
                  >
                    {busy ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <PenLine className="mr-2 size-4" />
                    )}
                    Sign authorization
                  </Button>
                ) : (
                  <div className="rounded-md border border-emerald-400/25 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                    Signed on {new Date(signed.signed_at ?? "").toLocaleString()} · version{" "}
                    {signed.letter_version} · SHA-256 {signed.letter_sha256?.slice(0, 16)}…
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <CompanyLetterPdfViewer height={460} />
            </div>

            {signed && data?.status_summary && <CompanyStatusSummary status={data.status_summary} />}
          </>
        )}

        <div className="flex justify-between border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="mr-1 size-4" /> Back
          </Button>
          <Button
            onClick={onNext}
            disabled={!signed}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            Continue <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
