import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCompanyOnboarding } from "@/lib/onboarding/company.functions";
import { getCompanyAuthorization } from "@/lib/onboarding/company-authorization.functions";
import { CompanyStatusSummary } from "./CompanyStatusSummary";
import {
  COMPANY_RELATIONSHIP_LABELS,
  isCompanyRelationship,
} from "@/lib/onboarding/company-config";
import { COMPANY_SOCIAL_LABELS } from "@/lib/onboarding/company-official-profiles";

const GHOST_BUTTON =
  "border border-sky-500/30 bg-slate-950/60 text-sky-100 hover:bg-slate-900/80 hover:text-white";

/** Read-only review of everything the company submitted. */
export function CompanyReviewStep({
  onBack,
  onNext,
  onGoToStep,
}: {
  onBack: () => void;
  onNext: () => void;
  onGoToStep: (step: number) => void;
}) {
  const fetchCompany = useServerFn(getCompanyOnboarding);
  const { data, isLoading } = useQuery({
    queryKey: ["company-onboarding"],
    queryFn: () => fetchCompany(),
  });
  const fetchAuthorization = useServerFn(getCompanyAuthorization);
  const { data: authorization } = useQuery({
    queryKey: ["company-authorization"],
    queryFn: () => fetchAuthorization(),
  });

  const profile = data?.profile;
  const rep = data?.representative;
  const relationship = isCompanyRelationship(rep?.relationship)
    ? COMPANY_RELATIONSHIP_LABELS[rep.relationship]
    : rep?.relationship_other || "—";

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Review Your Information</CardTitle>
        <CardDescription className="text-white/60">
          Confirm the company details before we open your Command Center. You can edit any section.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-blue-400" />
          </div>
        ) : (
          <div className="space-y-4">
            <Section title="Company details" onEdit={() => onGoToStep(2)}>
              <Row label="Legal company name" value={profile?.legal_company_name} />
              <Row label="Brand / trading name" value={profile?.brand_name} />
              <Row label="Website" value={profile?.website} />
              <Row label="Registration number" value={profile?.registration_number} />
              <Row label="Country" value={profile?.country} />
              <Row label="Business address" value={profile?.business_address} />
            </Section>

            <Section title="Representative" onEdit={() => onGoToStep(3)}>
              <Row label="Full name" value={rep?.full_legal_name} />
              <Row label="Role / job title" value={rep?.job_title} />
              <Row label="Work email" value={rep?.work_email} note="Not verified" />
              <Row label="Relationship to company" value={relationship} />
            </Section>

            <Section title="Official social profiles" onEdit={() => onGoToStep(4)}>
              {data?.official_profiles.length ? (
                data.official_profiles.map((link) => (
                  <Row
                    key={link.url}
                    label={COMPANY_SOCIAL_LABELS[link.platform]}
                    value={link.url}
                    note="Official"
                  />
                ))
              ) : (
                <div className="text-xs text-white/45">No official profiles added.</div>
              )}
            </Section>

            <Section title="Registration & authorization" onEdit={() => onGoToStep(5)}>
              {authorization?.registration_proof ? (
                <Row
                  label="Registration proof"
                  value={authorization.registration_proof.filename ?? "Document"}
                  note="Submitted"
                />
              ) : (
                <div className="text-xs text-rose-200/80">
                  Company registration proof is required.
                </div>
              )}
              <Row
                label="Authorization letter"
                value={authorization?.signature ? "Signed electronically" : "Not signed"}
                note={authorization?.signature ? "Signed" : undefined}
              />
              {authorization?.signature?.signed_at && (
                <Row
                  label="Accepted at"
                  value={new Date(authorization.signature.signed_at).toLocaleString()}
                />
              )}
            </Section>

            {authorization?.status_summary && (
              <CompanyStatusSummary status={authorization.status_summary} />
            )}
          </div>
        )}

        <div className="flex justify-between border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="mr-1 size-4" /> Back
          </Button>
          <Button
            onClick={onNext}
            disabled={
              isLoading ||
              !profile?.legal_company_name ||
              !rep?.full_legal_name ||
              !authorization?.registration_proof ||
              !authorization?.signature
            }
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            Confirm &amp; Continue <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{title}</div>
        <Button type="button" variant="outline" size="sm" onClick={onEdit} className={GHOST_BUTTON}>
          <Pencil className="mr-1.5 size-3.5" /> Edit
        </Button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value, note }: { label: string; value?: string | null; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
      <span className="text-white/50">{label}</span>
      <span className="flex items-center gap-2 text-right text-white/85">
        <span className="max-w-[22rem] truncate">{value?.trim() ? value : "—"}</span>
        {note && value?.trim() && (
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
            {note}
          </span>
        )}
      </span>
    </div>
  );
}
