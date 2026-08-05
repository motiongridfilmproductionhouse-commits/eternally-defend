import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getClientProfile, saveClientProfile } from "@/lib/onboarding/profile.functions";
import { selectAccountType, type AccountType } from "@/lib/onboarding/account-type.functions";
import { completeV2Onboarding } from "@/lib/onboarding/progress.functions";
import { createVeriffSession, getKycStatus } from "@/lib/onboarding/kyc.functions";

const OPTIONS: Array<{ value: AccountType; label: string; description: string }> = [
  {
    value: "celebrity",
    label: "Celebrity / Public Figure",
    description: "Protect a public identity and official presence.",
  },
  {
    value: "individual",
    label: "Individual",
    description: "Protect your personal identity and assets with Veriff.",
  },
  {
    value: "enterprise",
    label: "Enterprise / Company",
    description: "Protect a company, brand, or organization.",
  },
  {
    value: "production_house",
    label: "Production House",
    description: "Protect a studio, production company, and its catalog.",
  },
];

export function V2OnboardingWizard() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<AccountType | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ legal_name: "", country: "", company_name: "", email: "" });
  const choose = useServerFn(selectAccountType);
  const save = useServerFn(saveClientProfile);
  const complete = useServerFn(completeV2Onboarding);
  const createVeriff = useServerFn(createVeriffSession);
  const fetchProfile = useServerFn(getClientProfile);
  const fetchKyc = useServerFn(getKycStatus);
  const { data: profile } = useQuery({
    queryKey: ["v2-client-profile"],
    queryFn: () => fetchProfile(),
  });
  const { data: kyc, refetch: refetchKyc } = useQuery({
    queryKey: ["v2-kyc-status"],
    queryFn: () => fetchKyc(),
    enabled: selected === "individual",
    refetchInterval: selected === "individual" ? 5000 : false,
  });
  const accountType = selected ?? (profile?.account_type as AccountType | null) ?? null;

  const chooseType = async (value: AccountType) => {
    setSaving(true);
    try {
      await choose({ data: value });
      setSelected(value);
      toast.success("Account type saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save account type");
    } finally {
      setSaving(false);
    }
  };

  const saveRoute = async () => {
    if (!accountType || !form.legal_name.trim() || !form.country.trim()) return;
    setSaving(true);
    try {
      await save({
        data: {
          ...form,
          client_type:
            accountType === "enterprise" || accountType === "production_house"
              ? "business"
              : accountType,
        } as never,
      });
      await qc.invalidateQueries({ queryKey: ["v2-client-profile"] });
      toast.success("Route details saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save route details");
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    setSaving(true);
    try {
      await complete();
      window.location.assign("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to complete onboarding");
    } finally {
      setSaving(false);
    }
  };

  if (!accountType) {
    return (
      <V2Shell
        title="Choose Your Account Type"
        subtitle="Select the route that matches the account you are protecting."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={saving}
              onClick={() => chooseType(option.value)}
              className="rounded-lg border border-white/10 bg-[#0A1128] p-5 text-left transition hover:border-blue-400 hover:bg-blue-500/10"
            >
              <div className="font-semibold">{option.label}</div>
              <div className="mt-2 text-sm text-white/60">{option.description}</div>
            </button>
          ))}
        </div>
      </V2Shell>
    );
  }

  const option = OPTIONS.find((item) => item.value === accountType)!;
  const individualApproved = kyc?.verification_status === "APPROVED";
  return (
    <V2Shell title={option.label} subtitle="Complete the requirements for this account route.">
      <Card className="border-white/10 bg-[#0A1128] text-white">
        <CardHeader>
          <CardTitle>Route details</CardTitle>
          <CardDescription className="text-white/60">
            These details are stored for this account type only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            className="border-white/10 bg-[#0F172A] text-white"
            placeholder="Legal name"
            value={form.legal_name || profile?.full_name || ""}
            onChange={(event) => setForm({ ...form, legal_name: event.target.value })}
          />
          <Input
            className="border-white/10 bg-[#0F172A] text-white"
            placeholder="Country"
            value={form.country || profile?.country || ""}
            onChange={(event) => setForm({ ...form, country: event.target.value })}
          />
          <Input
            className="border-white/10 bg-[#0F172A] text-white"
            placeholder={
              accountType === "individual" || accountType === "celebrity"
                ? "Company or management name (optional)"
                : "Company name"
            }
            value={form.company_name || profile?.company_name || ""}
            onChange={(event) => setForm({ ...form, company_name: event.target.value })}
          />
          <Button
            type="button"
            disabled={
              saving ||
              !(form.legal_name || profile?.full_name) ||
              !(form.country || profile?.country)
            }
            onClick={saveRoute}
          >
            Save route details
          </Button>
          {accountType === "individual" && !individualApproved && (
            <div className="border-t border-white/10 pt-4 space-y-3">
              <p className="text-sm text-white/70">
                Individual accounts require Veriff identity verification.
              </p>
              {kyc?.session_url ? (
                <a
                  className="text-sm text-blue-300 underline"
                  href={kyc.session_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Continue Veriff verification
                </a>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const result = await createVeriff();
                    if (result.session_url)
                      window.open(result.session_url, "_blank", "noopener,noreferrer");
                    await refetchKyc();
                  }}
                >
                  Start Veriff
                </Button>
              )}
            </div>
          )}
          {(accountType !== "individual" || individualApproved) && (
            <Button type="button" disabled={saving} onClick={finish}>
              Complete onboarding
            </Button>
          )}
        </CardContent>
      </Card>
    </V2Shell>
  );
}

function V2Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#050A18] px-6 py-12 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <div className="text-xs font-semibold tracking-[0.24em] text-blue-400">
            ACCOUNT-TYPE ONBOARDING
          </div>
          <h1 className="mt-2 text-3xl font-bold">{title}</h1>
          <p className="mt-2 text-white/60">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
