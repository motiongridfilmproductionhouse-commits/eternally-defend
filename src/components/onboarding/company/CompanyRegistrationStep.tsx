import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, FileCheck2, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  getCompanyAuthorization,
  removeCompanyRegistrationProof,
  uploadCompanyRegistrationProof,
} from "@/lib/onboarding/company-authorization.functions";
import { CompanyLetterPdfViewer } from "./CompanyLetterPdfViewer";
import {
  COMPANY_REGISTRATION_DOC_LABELS,
  COMPANY_REGISTRATION_DOC_TYPES,
  type CompanyRegistrationDocType,
} from "@/lib/onboarding/company-config";

const GHOST_BUTTON =
  "border border-sky-500/30 bg-slate-950/60 text-sky-100 hover:bg-slate-900/80 hover:text-white";

/**
 * Company Registration Proof (required) + review of the automatically
 * generated Eterna Sentinel authorization letter.
 */
export function CompanyRegistrationStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void | Promise<void>;
}) {
  const fetchAuthorization = useServerFn(getCompanyAuthorization);
  const upload = useServerFn(uploadCompanyRegistrationProof);
  const removeProof = useServerFn(removeCompanyRegistrationProof);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["company-authorization"],
    queryFn: () => fetchAuthorization(),
  });

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [docType, setDocType] = useState<CompanyRegistrationDocType>(
    "certificate_of_incorporation",
  );
  const [busy, setBusy] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const proof = data?.registration_proof ?? null;
  const companyName = data?.company?.name?.trim() || "the company";

  const handleFile = async (file: File | null) => {
    if (!file) return;
    const mime = file.type;
    if (!["application/pdf", "image/png", "image/jpeg", "image/jpg"].includes(mime)) {
      toast.error("Upload a PDF, PNG or JPG/JPEG file.");
      return;
    }
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
          mime_type: mime as "application/pdf",
          file_base64: base64,
        },
      });
      await refetch();
      toast.success("Company registration proof uploaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload document");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    try {
      await removeProof({});
      await refetch();
      toast.success("Registration document removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove document");
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = async () => {
    if (!confirmed || advancing) return;
    setAdvancing(true);
    try {
      await onNext();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to continue");
      setAdvancing(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Company Registration & Authorization</CardTitle>
        <CardDescription className="text-white/60">
          Upload your official registration document — your Eterna Sentinel authorization letter is
          then generated automatically from the details you provided.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-blue-400" />
          </div>
        ) : (
          <>
            {/* 1. Registration proof — optional */}
            <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
              <div>
                <div className="text-sm font-semibold">
                  Company Registration Proof{" "}
                  <span className="ml-1 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/70">
                    Optional
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-white/55">
                  You can upload an official document showing that the company is legally registered
                  (PDF, PNG or JPG/JPEG), or add it later — it isn't required to continue.
                </div>

              </div>

              <div className="space-y-2">
                <Label className="text-xs text-white/75">Document type</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {COMPANY_REGISTRATION_DOC_TYPES.map((value) => {
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
                        {COMPANY_REGISTRATION_DOC_LABELS[value]}
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
                {proof ? "Replace document" : "Upload registration document"}
              </Button>

              {proof && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-400/25 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                  <FileCheck2 className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {proof.filename} — {proof.label} · submitted for review
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={handleRemove}
                    className="border-rose-400/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20 hover:text-white"
                  >
                    <Trash2 className="mr-1.5 size-3.5" /> Remove
                  </Button>
                </div>
              )}


              <p className="text-[11px] leading-relaxed text-white/40">
                A registration document evidences that the company exists. It is not treated as
                proof that you are authorized to represent the company.
              </p>
            </div>

            {/* 2 + 3. Generated authorization letter and review */}
            <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Review Authorization</div>
                  <div className="mt-0.5 text-xs text-white/55">
                    Generated automatically from your onboarding details — nothing to upload.
                  </div>
                </div>
              </div>

              <div className="max-h-80 space-y-3 overflow-y-auto rounded-md border border-white/10 bg-[#060C1F] p-4">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-sky-300/80">
                  <FileText className="size-3.5" /> {data?.letter.provider}
                </div>
                <div className="text-sm font-semibold text-white">{data?.letter.title}</div>
                <div className="space-y-1.5">
                  {data?.letter.fields.map((field) => (
                    <div
                      key={field.label}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                    >
                      <span className="text-white/45">{field.label}</span>
                      <span className="max-w-[24rem] truncate text-right text-white/85">
                        {field.value}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 border-t border-white/10 pt-3">
                  {data?.letter.paragraphs.map((paragraph, index) => (
                    <p key={index} className="text-xs leading-relaxed text-white/70">
                      {paragraph}
                    </p>
                  ))}
                </div>
                <div className="text-[10px] text-white/30">
                  Version {data?.letter.version} · SHA-256 {data?.letter.sha256.slice(0, 16)}…
                </div>
              </div>

              <CompanyLetterPdfViewer height={520} />

              <div
                role="button"
                tabIndex={0}
                onClick={() => setConfirmed((prev) => !prev)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    setConfirmed((prev) => !prev);
                  }
                }}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-white/10 bg-white/5 p-3"
              >
                <Checkbox
                  checked={confirmed}
                  tabIndex={-1}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                  className="pointer-events-none mt-0.5 border-sky-400/40 data-[state=checked]:bg-blue-600"
                />
                <span className="text-xs leading-relaxed text-white/75">
                  I confirm that I am authorized to act on behalf of {companyName} and that the
                  information provided is accurate.
                </span>
              </div>

            </div>
          </>
        )}

        <div className="flex justify-between border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="mr-1 size-4" /> Back
          </Button>
          <Button
            type="button"
            onClick={handleContinue}
            disabled={isLoading || !confirmed || advancing}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            {advancing ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {advancing ? "Opening Electronic Signature…" : "Continue to Electronic Signature"}
            {!advancing ? <ChevronRight className="ml-1 size-4" /> : null}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
