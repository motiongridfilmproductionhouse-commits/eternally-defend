import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCompanyOnboarding, saveCompanyProfile } from "@/lib/onboarding/company.functions";

const INPUT = "border-white/10 bg-[#0F172A] text-white";
const GHOST_BUTTON =
  "border border-sky-500/30 bg-slate-950/60 text-sky-100 hover:bg-slate-900/80 hover:text-white";

export function CompanyProfileStep({ onNext }: { onNext: () => void }) {
  const fetchCompany = useServerFn(getCompanyOnboarding);
  const save = useServerFn(saveCompanyProfile);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["company-onboarding"],
    queryFn: () => fetchCompany(),
  });

  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    legal_company_name: "",
    brand_name: "",
    website: "",
    country: "",
    business_address: "",
    registration_number: "",
    business_email: "",
    phone: "",
  });

  useEffect(() => {
    if (!data?.profile) return;
    setForm({
      legal_company_name: data.profile.legal_company_name,
      brand_name: data.profile.brand_name,
      website: data.profile.website,
      country: data.profile.country,
      business_address: data.profile.business_address,
      registration_number: data.profile.registration_number,
      business_email: data.profile.business_email,
      phone: data.profile.phone,
    });
  }, [data?.profile]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const valid =
    form.legal_company_name.trim().length > 1 &&
    form.website.trim().length > 2 &&
    form.country.trim().length > 0 &&
    /.+@.+\..+/.test(form.business_email.trim());

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const result = await save({ data: form });
      await refetch();
      void result;
      toast.success("Company details saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save company profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Company Details</CardTitle>
        <CardDescription className="text-white/60">
          Your registered company identity. These details anchor brand monitoring and impersonation
          detection.
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
              <Field label="Legal company name" required>
                <Input
                  value={form.legal_company_name}
                  onChange={set("legal_company_name")}
                  className={INPUT}
                />
              </Field>
              <Field label="Brand / trading name">
                <Input value={form.brand_name} onChange={set("brand_name")} className={INPUT} />
              </Field>
              <Field label="Official website" required>
                <Input
                  value={form.website}
                  onChange={set("website")}
                  placeholder="https://company.com"
                  className={INPUT}
                />
              </Field>
              <Field label="Country" required>
                <Input value={form.country} onChange={set("country")} className={INPUT} />
              </Field>
              <Field label="Company registration number">
                <Input
                  value={form.registration_number}
                  onChange={set("registration_number")}
                  className={INPUT}
                />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={set("phone")} className={INPUT} />
              </Field>
              <Field label="Official company email" required>
                <Input
                  type="email"
                  value={form.business_email}
                  onChange={set("business_email")}
                  className={INPUT}
                />
              </Field>
              <Field label="Business address">
                <Input
                  value={form.business_address}
                  onChange={set("business_address")}
                  className={INPUT}
                />
              </Field>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-sky-400/20 bg-sky-500/10 p-3 text-[11px] leading-relaxed text-sky-100">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Your work email is stored for contact and notifications only. It is not marked
                verified until email verification is available.
              </span>
            </div>
          </>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={submit}
            disabled={!valid || busy}
            className={GHOST_BUTTON}
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Save
          </Button>
          <Button
            type="button"
            onClick={async () => {
              if (!valid || busy) return;
              setBusy(true);
              try {
                await save({ data: form });
                await refetch();
                onNext();
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Unable to save company profile",
                );
              } finally {
                setBusy(false);
              }
            }}
            disabled={!valid || busy}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Continue{" "}
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
