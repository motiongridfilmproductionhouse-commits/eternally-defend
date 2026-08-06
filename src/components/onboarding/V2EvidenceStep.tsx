import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft, ChevronRight, FileCheck2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getV2Evidence, submitV2Evidence } from "@/lib/onboarding/v2-evidence.functions";
import {
  primaryEvidenceTypeForAccount,
  type V2AccountType,
  type V2EvidenceType,
} from "@/lib/onboarding/v2-config";

const COPY: Record<
  Exclude<V2EvidenceType, "representative" | "authorization">,
  { title: string; description: string; placeholder: string }
> = {
  official_contact: {
    title: "Official Contact / Evidence",
    description:
      "Submit an official website, verified public profile, agency page, or recognized publication that establishes your public identity.",
    placeholder: "https://official-site.com/profile",
  },
  company: {
    title: "Company Evidence",
    description:
      "Provide an official company reference and a registration, authorization, or representative document.",
    placeholder: "Company registry or official website URL",
  },
  rights: {
    title: "Rights Evidence",
    description:
      "Provide an official catalogue reference and a document showing production or catalogue rights.",
    placeholder: "Catalogue, studio or rights-holder URL",
  },
};

export function V2EvidenceStep({
  accountType,
  onBack,
  onNext,
}: {
  accountType: Exclude<V2AccountType, "individual">;
  onBack: () => void;
  onNext: () => void;
}) {
  const fetchEvidence = useServerFn(getV2Evidence);
  const submitEvidence = useServerFn(submitV2Evidence);
  const {
    data: evidence = [],
    refetch,
    isLoading,
  } = useQuery({
    queryKey: ["onboarding-v2-evidence"],
    queryFn: () => fetchEvidence(),
  });
  const evidenceType = primaryEvidenceTypeForAccount(accountType);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = evidenceType ? COPY[evidenceType] : null;
  const existing = evidenceType
    ? evidence.find((item) => item.evidence_type === evidenceType)
    : undefined;

  const submit = async () => {
    if (!evidenceType) return;
    setBusy(true);
    try {
      let fileBase64: string | null = null;
      if (file) {
        fileBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Unable to read document"));
          reader.readAsDataURL(file);
        });
      }
      await submitEvidence({
        data: {
          evidence_type: evidenceType,
          reference_value: reference || null,
          filename: file?.name ?? null,
          mime_type: file?.type ?? null,
          file_base64: fileBase64,
        },
      });
      await refetch();
      toast.success("Evidence submitted for review.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit evidence");
    } finally {
      setBusy(false);
    }
  };

  if (!evidenceType || !copy) return null;

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">{copy.title}</CardTitle>
        <CardDescription className="text-white/60">{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-blue-400" />
          </div>
        ) : existing ? (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-4">
            <CheckCircle2 className="mt-0.5 size-5 text-emerald-400" />
            <div>
              <div className="font-semibold text-emerald-300">Evidence submitted</div>
              <div className="mt-1 text-xs text-white/55">
                Status: {existing.status.replace(/_/g, " ")}
              </div>
            </div>
          </div>
        ) : (
          <>
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder={copy.placeholder}
              className="border-white/10 bg-[#0F172A] text-white"
            />
            <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-white/20 bg-white/5 text-center hover:bg-white/10">
              <FileCheck2 className="mb-2 size-6 text-blue-300" />
              <span className="text-sm">{file?.name ?? "Upload supporting document"}</span>
              <span className="mt-1 text-[11px] text-white/40">PDF or image, up to 10 MB</span>
              <input
                type="file"
                accept="application/pdf,image/*"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <Button
              onClick={submit}
              disabled={busy || (!reference.trim() && !file)}
              className="w-full bg-blue-600 text-white hover:bg-blue-500"
            >
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Submit evidence
            </Button>
          </>
        )}
        <div className="flex justify-between border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="mr-1 size-4" /> Back
          </Button>
          <Button
            onClick={onNext}
            disabled={!existing}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            Continue <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
