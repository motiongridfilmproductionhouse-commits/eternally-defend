import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getCompanyOnboarding,
  saveCompanyRepresentative,
} from "@/lib/onboarding/company.functions";
import {
  COMPANY_RELATIONSHIPS,
  COMPANY_RELATIONSHIP_LABELS,
  type CompanyRelationship,
} from "@/lib/onboarding/company-config";

const INPUT = "border-white/10 bg-[#0F172A] text-white";

export function CompanyRepresentativeStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const fetchCompany = useServerFn(getCompanyOnboarding);
  const save = useServerFn(saveCompanyRepresentative);
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["company-onboarding"],
    queryFn: () => fetchCompany(),
  });

  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    full_legal_name: "",
    job_title: "",
    work_email: "",
    phone: "",
    relationship: "" as "" | CompanyRelationship,
    relationship_other: "",
  });

  useEffect(() => {
    const rep = data?.representative;
    if (!rep) return;
    setForm({
      full_legal_name: rep.full_legal_name,
      job_title: rep.job_title,
      work_email: rep.work_email,
      phone: rep.phone,
      relationship: (rep.relationship as CompanyRelationship) || "",
      relationship_other: rep.relationship_other,
    });
  }, [data?.representative]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const valid =
    form.full_legal_name.trim().length > 1 &&
    form.job_title.trim().length > 0 &&
    /.+@.+\..+/.test(form.work_email.trim()) &&
    form.relationship !== "" &&
    (form.relationship !== "other" || form.relationship_other.trim().length > 1);

  const submit = async () => {
    if (!valid || form.relationship === "") return;
    setBusy(true);
    try {
      await save({
        data: {
          full_legal_name: form.full_legal_name,
          job_title: form.job_title,
          work_email: form.work_email,
          phone: form.phone || null,
          relationship: form.relationship,
          relationship_other: form.relationship_other || null,
        },
      });
      await refetch();
      toast.success("Authorized representative saved.");
      onNext();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save representative");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Authorized Representative</CardTitle>
        <CardDescription className="text-white/60">
          The person signing this authorization on behalf of the company. No personal identity
          document is requested here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-blue-400" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Full legal name" required>
                <Input
                  value={form.full_legal_name}
                  onChange={set("full_legal_name")}
                  className={INPUT}
                />
              </Field>
              <Field label="Job title / role" required>
                <Input value={form.job_title} onChange={set("job_title")} className={INPUT} />
              </Field>
              <Field label="Work email" required>
                <Input
                  type="email"
                  value={form.work_email}
                  onChange={set("work_email")}
                  className={INPUT}
                />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={set("phone")} className={INPUT} />
              </Field>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-white/75">
                Relationship to company<span className="text-blue-300"> *</span>
              </Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {COMPANY_RELATIONSHIPS.map((value) => {
                  const active = form.relationship === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setForm((c) => ({ ...c, relationship: value }))}
                      className={`rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                        active
                          ? "border-blue-400 bg-blue-500/15 text-white"
                          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                      }`}
                    >
                      {COMPANY_RELATIONSHIP_LABELS[value]}
                    </button>
                  );
                })}
              </div>
              {form.relationship === "other" && (
                <Input
                  value={form.relationship_other}
                  onChange={set("relationship_other")}
                  placeholder="Describe the relationship"
                  className={INPUT}
                />
              )}
            </div>
          </>
        )}

        <div className="flex justify-between border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="mr-1 size-4" /> Back
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || busy}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Save &amp; Continue
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-white/75">
        {label}
        {required && <span className="text-blue-300"> *</span>}
      </Label>
      {children}
    </div>
  );
}
