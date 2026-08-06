import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveV2ClientProfile } from "@/lib/onboarding/v2-profile.functions";
import { V2_ACCOUNT_LABELS, type V2AccountType } from "@/lib/onboarding/v2-config";

export function V2ProfileStep({ profile, accountType, onSaved }: { profile: any; accountType: V2AccountType; onSaved: () => Promise<void> | void }) {
  const save = useServerFn(saveV2ClientProfile);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    legal_name: profile?.legal_name ?? profile?.full_name ?? "",
    display_name: profile?.display_name ?? "",
    company_name: profile?.company_name ?? "",
    role_title: profile?.role_title ?? "",
    phone: profile?.phone ?? "",
    country: profile?.country ?? "",
    address: profile?.address ?? "",
  });
  useEffect(() => {
    if (!profile) return;
    setForm({
      legal_name: profile.legal_name ?? profile.full_name ?? "",
      display_name: profile.display_name ?? "",
      company_name: profile.company_name ?? "",
      role_title: profile.role_title ?? "",
      phone: profile.phone ?? "",
      country: profile.country ?? "",
      address: profile.address ?? "",
    });
  }, [profile]);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const needsCompany = accountType === "enterprise" || accountType === "production_house";
  const valid = form.legal_name.trim() && form.country.trim() && (!needsCompany || form.company_name.trim());

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await save({ data: form });
      await onSaved();
      toast.success("Profile saved.");
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to save profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">{V2_ACCOUNT_LABELS[accountType]} profile</CardTitle>
        <CardDescription className="text-white/60">Enter the legal details that will appear on authorization records and certificates.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={needsCompany ? "Authorized representative" : "Full legal name"} required><Input value={form.legal_name} onChange={set("legal_name")} className="border-white/10 bg-[#0F172A] text-white" /></Field>
          <Field label={accountType === "celebrity" ? "Public / stage name" : "Display name"}><Input value={form.display_name} onChange={set("display_name")} className="border-white/10 bg-[#0F172A] text-white" /></Field>
          {needsCompany && <Field label={accountType === "production_house" ? "Production house name" : "Company name"} required><Input value={form.company_name} onChange={set("company_name")} className="border-white/10 bg-[#0F172A] text-white" /></Field>}
          <Field label="Role / title"><Input value={form.role_title} onChange={set("role_title")} className="border-white/10 bg-[#0F172A] text-white" /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={set("phone")} className="border-white/10 bg-[#0F172A] text-white" /></Field>
          <Field label="Country" required><Input value={form.country} onChange={set("country")} className="border-white/10 bg-[#0F172A] text-white" /></Field>
        </div>
        <Field label="Address"><Input value={form.address} onChange={set("address")} className="border-white/10 bg-[#0F172A] text-white" /></Field>
        <div className="flex justify-end border-t border-white/10 pt-4">
          <Button onClick={submit} disabled={!valid || busy} className="bg-blue-600 text-white hover:bg-blue-500">
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Save & Continue <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-white/75">{label}{required && <span className="text-blue-300"> *</span>}</Label>{children}</div>;
}