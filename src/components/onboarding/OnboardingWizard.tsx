import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  buildStep1Payload,
  isStep1Valid,
  showsCompanyFields,
  type Step1Form,
} from "@/lib/onboarding/step1-profile-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, Check, ChevronRight, ChevronLeft, Lock } from "lucide-react";
import { getProgress, setStepStatus } from "@/lib/onboarding/progress.functions";
import { getClientProfile, saveClientProfile } from "@/lib/onboarding/profile.functions";
import { getKycStatus } from "@/lib/onboarding/kyc.functions";
import { getFaceEnrollment } from "@/lib/onboarding/face-enrollment.functions";
import { listAssets } from "@/lib/onboarding/assets.functions";
import { getAuthorizationBundle } from "@/lib/onboarding/authorization.functions";
import { FaceEnrollmentStep } from "@/components/onboarding/FaceEnrollmentStep";
import { AssetVerificationStep } from "@/components/onboarding/AssetVerificationStep";
import { AuthorizationScopeStep } from "@/components/onboarding/AuthorizationScopeStep";
import { AuthorizationReviewStep } from "@/components/onboarding/AuthorizationReviewStep";
import { SignatureStep } from "@/components/onboarding/SignatureStep";
import { CertificateStep } from "@/components/onboarding/CertificateStep";
import { OnboardingCompleteStep } from "@/components/onboarding/OnboardingCompleteStep";
import { V2OnboardingWizard } from "@/components/onboarding/V2OnboardingWizard";
import { switchToCompanyOnboarding } from "@/lib/onboarding/company.functions";
import { isV2AccountType } from "@/lib/onboarding/v2-config";
import { useOnboardingDirty } from "@/lib/onboarding/unsaved-changes";


/** Client types that belong to the dedicated company onboarding flow. */
const COMPANY_CLIENT_TYPES = new Set(["business", "corporate", "agency"]);

const STEP_TITLES = [
  "Account & Client Profile",
  "Face Protection Enrollment",
  "Digital Asset Verification",
  "Authorization Scope",
  "Authorization Letter Review",
  "Electronic Signature",
  "Verification Certificate",
  "Onboarding Complete",
];

export function OnboardingWizard({
  initialProgress,
}: {
  initialProgress: { current_step?: number | null; onboarding_version?: string | null } | null;
}) {
  const fetchProfile = useServerFn(getClientProfile);
  const { data: routingProfile, isLoading: routingLoading } = useQuery({
    queryKey: ["client_profile"],
    queryFn: () => fetchProfile(),
  });

  const isV2 =
    initialProgress?.onboarding_version === "v2" ||
    (routingProfile as { onboarding_version?: string | null } | undefined)?.onboarding_version ===
      "v2" ||
    isV2AccountType(
      (routingProfile as { onboarding_account_type?: unknown } | undefined)
        ?.onboarding_account_type,
    );

  if (routingLoading) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-[#050A18] text-white/70 text-sm">
        Loading secure onboarding…
      </div>
    );
  }

  if (isV2) {
    return <V2OnboardingWizard initialProgress={initialProgress} />;
  }
  return <LegacyOnboardingWizard initialProgress={initialProgress} />;
}


function LegacyOnboardingWizard({
  initialProgress,
}: {
  initialProgress: { current_step?: number | null; onboarding_version?: string | null } | null;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Legacy progress rows were numbered against the old 9-step flow that had
  // Veriff at step 2. Map those onto the current 8-step flow.
  const storedStep = Math.max(1, Number(initialProgress?.current_step) || 1);
  const initialStep = Math.min(storedStep <= 2 ? storedStep : storedStep - 1, STEP_TITLES.length);
  const [step, setStep] = useState<number>(initialStep);
  const setStatus = useServerFn(setStepStatus);
  const refreshProgress = useServerFn(getProgress);

  // Create server function callers at the component top level.
  const fetchClientProfile = useServerFn(getClientProfile);
  const fetchKycStatus = useServerFn(getKycStatus);
  const fetchFaceEnrollment = useServerFn(getFaceEnrollment);
  const fetchAssets = useServerFn(listAssets);
  const fetchAuthorizationBundle = useServerFn(getAuthorizationBundle);

  // Queries for specific step data
  const { data: profile, refetch: refetchProfile } = useQuery({
    queryKey: ["client_profile"],
    queryFn: () => fetchClientProfile(),
  });

  const { data: kyc } = useQuery({
    queryKey: ["kyc_status"],
    queryFn: () => fetchKycStatus(),
    refetchInterval: (q) => {
      const s = (q.state.data as { verification_status?: string } | undefined)?.verification_status;
      return s === "APPROVED" || s === "DECLINED" || s === "EXPIRED" ? false : 5000;
    },
  });

  const { data: faceEnrollment, refetch: refetchFaceEnrollment } = useQuery({
    queryKey: ["face_enrollment_status"],
    queryFn: () => fetchFaceEnrollment(),
  });

  const { data: assets } = useQuery({
    queryKey: ["digital_assets"],
    queryFn: () => fetchAssets(),
  });

  const { data: authBundle } = useQuery({
    queryKey: ["auth_bundle"],
    queryFn: () => fetchAuthorizationBundle(),
  });

  const advanceStep = async (nextStep: number, status: any = "COMPLETED") => {
    try {
      const updated = await setStatus({
        data: { step, status, advance: true },
      });

      setStep(Math.max(updated?.current_step ?? nextStep, nextStep));

      await qc.invalidateQueries({
        queryKey: ["onboarding-progress"],
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to advance step");
    }
  };

  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const stepIndex = step - 1;
  // Veriff identity verification is no longer collected during onboarding, so
  // no onboarding step is gated on KYC. Legal/enforcement checks are unchanged.
  const isKycApproved = true;
  const isFaceVerified = faceEnrollment?.status === "FACE_VERIFIED";
  const isFaceDeferred = faceEnrollment?.status === "DEFERRED";
  const isFaceHandled = isFaceVerified || isFaceDeferred;
  const hasVerifiedAsset = assets?.some((a: any) => a.verification_status === "VERIFIED") ?? false;
  const hasScopes = (authBundle?.scopes?.filter((s: any) => s.granted)?.length ?? 0) > 0;
  const visibleSteps = STEP_TITLES.map((title, i) => ({ title, step: i + 1, index: i }));
  const visiblePosition = Math.max(
    1,
    visibleSteps.findIndex((s) => s.step === step) + 1,
  );

  const auth = authBundle?.auth;
  const isDraftReady =
    authBundle?.documents?.some((d: any) => d.kind === "draft" && d.version === auth?.version) ??
    false;
  const isReviewVisible = auth && auth.status !== "DRAFT";
  const isApproved = auth?.status === "ACTIVE";

  return (
    <div className="fixed inset-0 flex flex-col lg:flex-row bg-[#050A18] overflow-hidden text-white">
      <aside
        className="relative lg:w-[40%] md:w-[45%] w-full lg:h-full h-auto overflow-hidden flex flex-col justify-between p-8 md:p-12"
        style={{ background: "linear-gradient(135deg, #071B4A 0%, #1037A6 55%, #1E5EFF 100%)" }}
      >
        <div className="pointer-events-none absolute -top-40 -left-32 size-[520px] rounded-full opacity-60 bg-blue-400/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-52 -right-40 size-[620px] rounded-full opacity-50 bg-blue-600/30 blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="size-10 rounded-xl grid place-items-center bg-white/15 backdrop-blur-xl border border-white/20 shadow-lg">
            <ShieldCheck className="size-5" />
          </div>
          <div className="font-display text-xl font-bold tracking-tight">Eterna AI</div>
        </div>

        <div className="relative z-10 my-8 lg:my-0 flex-1 overflow-y-auto pr-4 custom-scrollbar">
          <div className="text-[11px] font-semibold tracking-[0.28em] text-white/60 mb-2">
            SECURE ONBOARDING
          </div>
          <h1 className="font-display text-3xl font-bold leading-tight mb-8">
            Identity & Protection Setup
          </h1>

          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute left-[15px] top-4 bottom-4 w-px bg-white/15"
            />
            <ol className="relative space-y-1">
              {visibleSteps.map(({ title, index: i }, position) => {
                const isActive = i === stepIndex;
                const isPast = i < stepIndex;
                const isLocked =
                  (i >= 2 && !isFaceHandled) ||
                  (i >= 3 && !hasVerifiedAsset) ||
                  (i >= 4 && !hasScopes) ||
                  (i >= 5 && !isDraftReady) ||
                  (i >= 6 && !isReviewVisible) ||
                  (i >= 7 && !isApproved);

                return (
                  <li key={title} className="relative flex items-center gap-4 py-3">
                    <span
                      className={`relative z-10 size-8 rounded-full grid place-items-center text-[11px] font-bold shrink-0 border transition-all duration-300 ${
                        isActive
                          ? "bg-white text-[#0b1f4d] border-white shadow-[0_0_0_4px_rgba(255,255,255,0.1)]"
                          : isPast
                            ? "bg-emerald-400 text-[#0b1f4d] border-emerald-300"
                            : "bg-white/5 text-white/50 border-white/20 backdrop-blur"
                      }`}
                    >
                      {isPast ? (
                        <Check className="size-4" />
                      ) : isLocked ? (
                        <Lock className="size-3.5 opacity-50" />
                      ) : (
                        position + 1
                      )}
                    </span>
                    <span
                      className={`text-sm font-medium truncate transition-colors ${
                        isActive
                          ? "text-white font-semibold"
                          : isPast
                            ? "text-white/80"
                            : "text-white/40"
                      }`}
                    >
                      {title}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="relative z-10 text-xs text-white/50 pt-4 border-t border-white/10">
          Step {visiblePosition} of {visibleSteps.length} · Enterprise Security
        </div>
      </aside>

      <section className="relative flex-1 lg:h-full h-auto overflow-y-auto bg-[#050A18]">
        <div className="relative min-h-full flex flex-col justify-center px-6 md:px-12 lg:px-20 py-14">
          <div className="w-full max-w-2xl mx-auto">
            <div className="mb-8">
              <div className="text-[11px] font-semibold tracking-[0.24em] text-blue-400 mb-2">
                STEP {visiblePosition} / {visibleSteps.length}
              </div>
              <h2 className="font-display text-3xl font-bold">{STEP_TITLES[stepIndex]}</h2>
            </div>

            <div className="animate-fade-in">
              {step === 1 && (
                <Step1Profile
                  profile={profile}
                  onRefetch={refetchProfile}
                  onNext={() => advanceStep(2)}
                />
              )}
              {step === 2 && (
                <FaceEnrollmentStep
                  enrollmentStatus={faceEnrollment}
                  isKycApproved={isKycApproved}
                  onRefetch={async () => {
                    await refetchFaceEnrollment();
                  }}
                  onBack={goBack}
                  onNext={() => advanceStep(3)}
                  onDefer={() => advanceStep(3, "DEFERRED")}
                />
              )}
              {step === 3 && (
                <AssetVerificationStep onBack={goBack} onNext={() => advanceStep(4)} />
              )}
              {step === 4 && (
                <AuthorizationScopeStep onBack={goBack} onNext={() => advanceStep(5)} />
              )}
              {step === 5 && (
                <AuthorizationReviewStep
                  onBack={goBack}
                  onNext={() => advanceStep(6)}
                  onGoToStep={advanceStep}
                />
              )}
              {step === 6 && <SignatureStep onBack={goBack} onNext={() => advanceStep(7)} />}
              {step === 7 && isApproved && (
                <CertificateStep
                  onBack={goBack}
                  onNext={() => advanceStep(8)}
                  kycStatus={kyc?.verification_status ?? "NOT_STARTED"}
                  faceStatus={faceEnrollment?.status ?? "NOT_STARTED"}
                  assetStatus={hasVerifiedAsset ? "VERIFIED" : "UNVERIFIED"}
                />
              )}
              {step === 8 && isApproved && <OnboardingCompleteStep onGoToStep={advanceStep} />}
              {step >= 7 && step <= 8 && !isApproved && (
                <StepLockedPlaceholder
                  step={step}
                  isFaceVerified={isFaceVerified}
                  hasVerifiedAsset={hasVerifiedAsset}
                  hasScopes={hasScopes}
                  isDraftReady={isDraftReady}
                  isReviewVisible={!!isReviewVisible}
                  isApproved={isApproved}
                  onBack={goBack}
                />
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------- STEP 1: Account & Client Profile ---------- */
function Step1Profile({
  profile,
  onRefetch,
  onNext,
}: {
  profile: any;
  onRefetch: () => void;
  onNext: () => void;
}) {
  const saveAction = useServerFn(saveClientProfile);
  const switchToCompany = useServerFn(switchToCompanyOnboarding);
  const stepQc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    legal_name: profile?.full_name ?? "",
    display_name: profile?.display_name ?? "",
    company_name: profile?.company_name ?? "",
    role_title: profile?.role_title ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    country: profile?.country ?? "",
    address: profile?.address ?? "",
    client_type: profile?.client_type ?? "individual",
  });

  useEffect(() => {
    if (profile) {
      setForm((prev) => ({
        ...prev,
        legal_name: profile.full_name || prev.legal_name,
        display_name: profile.display_name || prev.display_name,
        company_name: profile.company_name || prev.company_name,
        role_title: profile.role_title || prev.role_title,
        email: profile.email || prev.email,
        phone: profile.phone || prev.phone,
        country: profile.country || prev.country,
        address: profile.address || prev.address,
        client_type: profile.client_type || prev.client_type,
      }));
    }
  }, [profile]);

  const savedStep1 = {
    legal_name: profile?.full_name ?? "",
    display_name: profile?.display_name ?? "",
    company_name: profile?.company_name ?? "",
    role_title: profile?.role_title ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    country: profile?.country ?? "",
    address: profile?.address ?? "",
    client_type: profile?.client_type ?? "individual",
  };
  useOnboardingDirty(
    "legacy-step1",
    (Object.keys(savedStep1) as Array<keyof typeof savedStep1>).some(
      (key) => ((form as any)[key] ?? "") !== (savedStep1[key] ?? ""),
    ),
  );

  const isCompanyType = COMPANY_CLIENT_TYPES.has(form.client_type);
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value });
  const showCompanyFields = showsCompanyFields(form.client_type);
  const isValid = isCompanyType || isStep1Valid(form as Step1Form);

  /**
   * Company/corporate/agency accounts belong to the dedicated 7-step company
   * onboarding flow, so selecting one of those types switches the wizard
   * immediately instead of waiting for "Save & Continue".
   */
  const handleClientTypeChange = async (e: any) => {
    const next = String(e.target.value);
    setForm((prev) => ({ ...prev, client_type: next }));
    if (!COMPANY_CLIENT_TYPES.has(next)) return;
    setSaving(true);
    try {
      await switchToCompany({});
      await stepQc.invalidateQueries({ queryKey: ["client_profile"] });
      await stepQc.invalidateQueries({ queryKey: ["onboarding-progress"] });
      await onRefetch();
      toast.success("Company onboarding started");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not start company onboarding");
    } finally {
      setSaving(false);
    }
  };


  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      // Company client types use the dedicated company onboarding flow — no
      // legacy personal profile fields are required to get there.
      if (isCompanyType) {
        const result = await switchToCompany({});
        await stepQc.invalidateQueries({ queryKey: ["client_profile"] });
        await onRefetch();
        if (result?.switched) {
          await stepQc.invalidateQueries({ queryKey: ["onboarding-progress"] });
          toast.success("Company onboarding started");
          return;
        }
      }

      await saveAction({ data: buildStep1Payload(form as Step1Form) as any });
      await onRefetch();
      toast.success("Profile saved successfully");
      onNext();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };


  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
      <CardHeader>
        <CardTitle className="text-xl">Client Information</CardTitle>
        <CardDescription className="text-white/60">
          Enter your official details. This will be used for legal agreements.
        </CardDescription>
        {profile?.client_id && (
          <div className="mt-2 inline-flex items-center gap-2 bg-blue-500/10 text-blue-400 border border-blue-500/20 px-3 py-1.5 rounded-md text-xs font-mono font-medium">
            Client ID: {profile.client_id}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Client Type" required>
            <select
              className="flex h-10 w-full rounded-md border border-white/10 bg-[#0F172A] px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 text-white"
              value={form.client_type}
              onChange={handleClientTypeChange}
              disabled={saving}
            >


              <option value="individual">Individual</option>
              <option value="creator">Creator</option>
              <option value="celebrity">Celebrity</option>
              <option value="business">Business</option>
              <option value="corporate">Corporate</option>
              <option value="agency">Agency</option>
            </select>
          </Field>
          <Field label="Full Legal Name" required>
            <Input
              className="bg-[#0F172A] border-white/10 text-white"
              value={form.legal_name}
              onChange={set("legal_name")}
              placeholder="As it appears on ID"
            />
          </Field>
          <Field label="Artist / Display Name">
            <Input
              className="bg-[#0F172A] border-white/10 text-white"
              value={form.display_name}
              onChange={set("display_name")}
              placeholder="Optional alias"
            />
          </Field>
          {showCompanyFields && (
            <>
              <Field label="Company Name">
                <Input
                  className="bg-[#0F172A] border-white/10 text-white"
                  value={form.company_name}
                  onChange={set("company_name")}
                />
              </Field>
              <Field label="Role / Title">
                <Input
                  className="bg-[#0F172A] border-white/10 text-white"
                  value={form.role_title}
                  onChange={set("role_title")}
                  placeholder="e.g. CEO, Manager"
                />
              </Field>
            </>
          )}
          <Field label="Email" required>
            <Input
              className="bg-[#0F172A] border-white/10 text-white"
              type="email"
              value={form.email}
              onChange={set("email")}
            />
            {profile?.email_verified_at && (
              <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                <Check className="size-3" /> Email verified
              </p>
            )}
          </Field>
          <Field label="Phone">
            <Input
              className="bg-[#0F172A] border-white/10 text-white"
              value={form.phone}
              onChange={set("phone")}
            />
          </Field>
          <Field label="Country" required>
            <Input
              className="bg-[#0F172A] border-white/10 text-white"
              value={form.country}
              onChange={set("country")}
            />
          </Field>
        </div>
        <Field label="Address">
          <Input
            className="bg-[#0F172A] border-white/10 text-white"
            value={form.address}
            onChange={set("address")}
            placeholder="Full address for contracts"
          />
        </Field>

        <div className="flex justify-end pt-4">
          <Button
            type="button"
            disabled={!isValid || saving}
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-500 text-white border-0 shadow-lg shadow-blue-500/20"
          >
            {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            Save & Continue <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- STEPS 7-8: Locked Placeholders ---------- */
function StepLockedPlaceholder({
  step,
  isFaceVerified,
  hasVerifiedAsset,
  hasScopes,
  isDraftReady,
  isReviewVisible,
  isApproved,
  onBack,
}: {
  step: number;
  isFaceVerified: boolean;
  hasVerifiedAsset: boolean;
  hasScopes: boolean;
  isDraftReady: boolean;
  isReviewVisible: boolean;
  isApproved: boolean;
  onBack: () => void;
}) {
  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
      <CardHeader>
        <CardTitle className="text-xl">{STEP_TITLES[step - 1]}</CardTitle>
        <CardDescription className="text-white/60">This step is currently locked.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col items-center justify-center py-10 space-y-4 text-center">
          <div className="size-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
            <Lock className="size-6 text-white/40" />
          </div>
          {!isFaceVerified && step >= 3 ? (
            <p className="text-sm text-red-400">
              Complete or defer Face Protection Enrollment (Step 2) to unlock this section.
            </p>
          ) : !hasVerifiedAsset && step >= 4 ? (
            <p className="text-sm text-red-400">
              You must verify at least one Digital Asset (Step 3) to unlock this section.
            </p>
          ) : !hasScopes && step >= 5 ? (
            <p className="text-sm text-red-400">
              You must authorize at least one monitoring scope (Step 4) to unlock this section.
            </p>
          ) : !isDraftReady && step >= 6 ? (
            <p className="text-sm text-red-400">
              You must generate and review your Authorization Draft (Step 5) to unlock this section.
            </p>
          ) : !isReviewVisible && step >= 7 ? (
            <p className="text-sm text-red-400">
              You must securely sign the Authorization Letter (Step 6) to unlock this section.
            </p>
          ) : !isApproved && step >= 7 ? (
            <p className="text-sm text-red-400">
              Signing the authorization is required to issue your certificate.
            </p>
          ) : (
            <p className="text-sm text-white/50">
              This section is under construction. Development will continue in future phases.
            </p>
          )}
        </div>
        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="size-4 mr-1" /> Back
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
      <Label className="text-xs font-semibold text-white/80">
        {label}
        {required && <span className="text-blue-400"> *</span>}
      </Label>
      {children}
    </div>
  );
}
