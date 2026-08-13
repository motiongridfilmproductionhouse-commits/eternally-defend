import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, Loader2, Mail, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getCompanyOnboarding,
  requestCompanyEmailOtp,
  saveCompanyProfile,
  verifyCompanyEmailOtp,
} from "@/lib/onboarding/company.functions";

const INPUT = "border-white/10 bg-[#0F172A] text-white";
const GHOST_BUTTON =
  "border border-sky-500/30 bg-slate-950/60 text-sky-100 hover:bg-slate-900/80 hover:text-white";

export function CompanyProfileStep({ onNext }: { onNext: () => void }) {
  const fetchCompany = useServerFn(getCompanyOnboarding);
  const save = useServerFn(saveCompanyProfile);
  const requestOtp = useServerFn(requestCompanyEmailOtp);
  const verifyOtp = useServerFn(verifyCompanyEmailOtp);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["company-onboarding"],
    queryFn: () => fetchCompany(),
  });

  const [busy, setBusy] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);
  const [code, setCode] = useState("");
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

  const emailVerified = Boolean(data?.profile.business_email_verified);
  const otpDelivery = data?.otp?.delivery_status ?? null;
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
      toast.success(
        result?.email_verification_reset
          ? "Company profile saved. Verify the new business email."
          : "Company profile saved.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save company profile");
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    setOtpBusy(true);
    try {
      const result = await requestOtp({});
      await refetch();
      if (result?.delivery_status === "SENT") {
        toast.success(`Verification code sent to ${result.email}.`);
      } else {
        toast.warning(
          "Email delivery is not available yet, so the business email stays unverified. Monitoring still works; enforcement stays locked.",
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send verification code");
    } finally {
      setOtpBusy(false);
    }
  };

  const confirmCode = async () => {
    setOtpBusy(true);
    try {
      await verifyOtp({ data: { code } });
      setCode("");
      await refetch();
      toast.success("Business email verified.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify code");
    } finally {
      setOtpBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Company Profile</CardTitle>
        <CardDescription className="text-white/60">
          These legal details appear on the company authorization and protection certificate.
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
                <Input value={form.legal_company_name} onChange={set("legal_company_name")} className={INPUT} />
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
                <Input value={form.registration_number} onChange={set("registration_number")} className={INPUT} />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={set("phone")} className={INPUT} />
              </Field>
              <Field label="Business email" required>
                <Input
                  type="email"
                  value={form.business_email}
                  onChange={set("business_email")}
                  className={INPUT}
                />
              </Field>
              <Field label="Business address">
                <Input value={form.business_address} onChange={set("business_address")} className={INPUT} />
              </Field>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex items-start gap-3">
                {emailVerified ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" />
                ) : (
                  <Mail className="mt-0.5 size-5 shrink-0 text-sky-300" />
                )}
                <div className="flex-1">
                  <div className="text-sm font-semibold">
                    {emailVerified ? "Business email verified" : "Verify your business email"}
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-white/55">
                    {emailVerified
                      ? `${data?.profile.business_email} is confirmed for this company.`
                      : "We send a 6-digit code to the business email to confirm it belongs to your company."}
                  </div>

                  {!emailVerified && (
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={sendCode}
                          disabled={otpBusy || !data?.profile.business_email}
                          className={GHOST_BUTTON}
                        >
                          {otpBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
                          {data?.otp ? "Resend code" : "Send verification code"}
                        </Button>
                        {!data?.profile.business_email && (
                          <span className="text-xs text-white/45">Save the profile first.</span>
                        )}
                      </div>
                      {data?.otp && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            value={code}
                            onChange={(event) =>
                              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                            }
                            inputMode="numeric"
                            placeholder="123456"
                            className={`${INPUT} w-32 tracking-[0.3em]`}
                          />
                          <Button
                            type="button"
                            onClick={confirmCode}
                            disabled={otpBusy || code.length !== 6}
                            className="bg-blue-600 text-white hover:bg-blue-500"
                          >
                            Verify email
                          </Button>
                        </div>
                      )}
                      {otpDelivery && otpDelivery !== "SENT" && (
                        <div className="flex items-start gap-2 rounded-md border border-amber-400/25 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-100">
                          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                          <span>
                            Verification email delivery is not available yet. You can continue setup
                            and monitoring; takedown and enforcement actions stay locked until
                            company authority is established.
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
          <Button type="button" variant="outline" onClick={submit} disabled={!valid || busy} className={GHOST_BUTTON}>
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Save
          </Button>
          <Button
            type="button"
            onClick={onNext}
            disabled={!valid || !data?.profile.legal_company_name}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            Continue <ChevronRight className="ml-1 size-4" />
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
