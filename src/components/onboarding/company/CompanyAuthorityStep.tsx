import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  getCompanyOnboarding,
  uploadCompanyAuthorityDocument,
} from "@/lib/onboarding/company.functions";
import {
  COMPANY_AUTHORITY_DOC_LABELS,
  COMPANY_AUTHORITY_DOC_TYPES,
  COMPANY_AUTHORITY_LABELS,
  COMPANY_ENFORCEMENT_BLOCKED_MESSAGE,
  companyCanEnforce,
  type CompanyAuthorityDocType,
} from "@/lib/onboarding/company-config";

const GHOST_BUTTON =
  "border border-sky-500/30 bg-slate-950/60 text-sky-100 hover:bg-slate-900/80 hover:text-white";

export function CompanyAuthorityStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const fetchCompany = useServerFn(getCompanyOnboarding);
  const upload = useServerFn(uploadCompanyAuthorityDocument);
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["company-onboarding"],
    queryFn: () => fetchCompany(),
  });

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [docType, setDocType] = useState<CompanyAuthorityDocType>("authorization_letter");
  const [busy, setBusy] = useState(false);

  const status = data?.authority_status ?? "AUTHORITY_PENDING";
  const canEnforce = companyCanEnforce(status);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Unable to read file"));
        reader.readAsDataURL(file);
      });
      await upload({
        data: {
          doc_type: docType,
          filename: file.name,
          mime_type: file.type || null,
          file_base64: base64,
          note: null,
        },
      });
      await refetch();
      toast.success("Authority document uploaded for review.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload document");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Company Authority Verification</CardTitle>
        <CardDescription className="text-white/60">
          We confirm that you are authorized to act for this company. Selecting a company account is
          not authority on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-blue-400" />
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-3">
                <ShieldCheck
                  className={`size-5 ${canEnforce ? "text-emerald-400" : "text-amber-300"}`}
                />
                <div>
                  <div className="text-sm font-semibold">{COMPANY_AUTHORITY_LABELS[status]}</div>
                  <div className="mt-0.5 text-xs text-white/55">
                    {canEnforce
                      ? "Enforcement and takedown actions are available for this company."
                      : COMPANY_ENFORCEMENT_BLOCKED_MESSAGE}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <Signal
                label="Business email verified"
                ok={Boolean(data?.profile.business_email_verified)}
              />
              <Signal
                label="Registration number on file"
                ok={Boolean(data?.profile.registration_number)}
              />
              <Signal
                label="Work email on company domain"
                ok={
                  !!data?.representative.work_email &&
                  !!data?.profile.website &&
                  data.authority_status === "AUTHORIZED_REPRESENTATIVE"
                }
              />
            </div>

            <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
              <div>
                <div className="text-sm font-semibold">Company documents (optional)</div>
                <div className="mt-0.5 text-xs text-white/55">
                  Upload a document that shows your authority. This speeds up full authorization.
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-white/75">Document type</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {COMPANY_AUTHORITY_DOC_TYPES.map((value) => {
                    const active = docType === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setDocType(value)}
                        className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                          active
                            ? "border-blue-400 bg-blue-500/15 text-white"
                            : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                        }`}
                      >
                        {COMPANY_AUTHORITY_DOC_LABELS[value]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className={GHOST_BUTTON}
              >
                {busy ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 size-4" />
                )}
                Upload document
              </Button>

              {data?.authority_document && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-400/25 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                  <FileCheck2 className="size-4 shrink-0" />
                  <span className="truncate">
                    {data.authority_document.filename} — submitted for review
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex justify-between border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="mr-1 size-4" /> Back
          </Button>
          <Button onClick={onNext} className="bg-blue-600 text-white hover:bg-blue-500">
            Continue <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Signal({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className={`rounded-lg border p-3 text-xs ${
        ok
          ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
          : "border-white/10 bg-white/5 text-white/55"
      }`}
    >
      {label}
    </div>
  );
}
