import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Lock, ShieldCheck } from "lucide-react";
import { getProgress, setStepStatus, type StepStatus } from "@/lib/onboarding/progress.functions";
import { getClientProfile } from "@/lib/onboarding/profile.functions";
import { getKycStatus } from "@/lib/onboarding/kyc.functions";
import { getFaceEnrollment } from "@/lib/onboarding/face-enrollment.functions";
import { listAssets } from "@/lib/onboarding/assets.functions";
import { getAuthorizationBundle } from "@/lib/onboarding/authorization.functions";
import {
  isLightVerificationAccount,
  isV2AccountType,
  requiresVeriff,
  v2FlowForAccount,
  type V2AccountType,
} from "@/lib/onboarding/v2-config";
import { AccountTypeStep } from "@/components/onboarding/AccountTypeStep";
import { V2ProfileStep } from "@/components/onboarding/V2ProfileStep";
import { LightProfileStep } from "@/components/onboarding/LightProfileStep";
import { LightCompleteStep } from "@/components/onboarding/LightCompleteStep";
import { V2EvidenceStep } from "@/components/onboarding/V2EvidenceStep";
import { V2RepresentativeStep } from "@/components/onboarding/V2RepresentativeStep";
import { VeriffIdentityStep } from "@/components/onboarding/VeriffIdentityStep";
import { FaceEnrollmentStep } from "@/components/onboarding/FaceEnrollmentStep";
import { AssetVerificationStep } from "@/components/onboarding/AssetVerificationStep";
import { AuthorizationScopeStep } from "@/components/onboarding/AuthorizationScopeStep";
import { AuthorizationReviewStep } from "@/components/onboarding/AuthorizationReviewStep";
import { SignatureStep } from "@/components/onboarding/SignatureStep";
import { CertificateStep } from "@/components/onboarding/CertificateStep";
import { OnboardingCompleteStep } from "@/components/onboarding/OnboardingCompleteStep";
import { CompanyProfileStep } from "@/components/onboarding/company/CompanyProfileStep";
import { CompanyRepresentativeStep } from "@/components/onboarding/company/CompanyRepresentativeStep";
import { CompanyRegistrationStep } from "@/components/onboarding/company/CompanyRegistrationStep";
import { CompanyAuthorizationSignatureStep } from "@/components/onboarding/company/CompanyAuthorizationSignatureStep";
import { CompanySocialStep } from "@/components/onboarding/company/CompanySocialStep";
import { CompanyReviewStep } from "@/components/onboarding/company/CompanyReviewStep";
import { CompanyCompleteStep } from "@/components/onboarding/company/CompanyCompleteStep";

export function V2OnboardingWizard({
  initialProgress,
}: {
  initialProgress: { current_step?: number | null; onboarding_version?: string | null } | null;
}) {
  const qc = useQueryClient();
  const setStatus = useServerFn(setStepStatus);
  const refreshProgress = useServerFn(getProgress);
  const fetchClientProfile = useServerFn(getClientProfile);
  const fetchKycStatus = useServerFn(getKycStatus);
  const fetchFaceEnrollment = useServerFn(getFaceEnrollment);
  const fetchAssets = useServerFn(listAssets);
  const fetchAuthorizationBundle = useServerFn(getAuthorizationBundle);

  const { data: profile, refetch: refetchProfile } = useQuery({
    queryKey: ["client_profile"],
    queryFn: () => fetchClientProfile(),
  });

  const accountType: V2AccountType | null = isV2AccountType(profile?.onboarding_account_type)
    ? profile.onboarding_account_type
    : null;
  const isLightRoute = isLightVerificationAccount(accountType);
  const flow = v2FlowForAccount(accountType);
  const maxStep = flow[flow.length - 1]?.step ?? 1;

  const [step, setStep] = useState(() => Math.max(1, Number(initialProgress?.current_step) || 1));

  // Restore the persisted step once the account route (and thus max step) is known.
  useEffect(() => {
    const restored = Math.min(Math.max(1, Number(initialProgress?.current_step) || 1), maxStep);
    setStep((current) => Math.min(Math.max(current, restored), maxStep));
  }, [accountType, maxStep, initialProgress?.current_step]);

  const { data: kyc, refetch: refetchKyc } = useQuery({
    queryKey: ["kyc_status"],
    queryFn: () => fetchKycStatus(),
    enabled: !accountType || requiresVeriff(accountType),
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

  const advanceStep = async (fromStep: number, status: StepStatus = "COMPLETED") => {
    try {
      const updated = await setStatus({
        data: { step: fromStep, status, advance: true },
      });
      setStep(Math.max(updated?.current_step ?? fromStep + 1, fromStep + 1));
      await qc.invalidateQueries({ queryKey: ["onboarding-progress"] });
      await refreshProgress();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to advance step");
    }
  };

  const goBack = () => setStep((s) => Math.max(1, s - 1));
  const goToStep = (target: number) => setStep(Math.min(Math.max(1, target), maxStep));

  const current = flow.find((item) => item.step === step) ?? flow[0];
  const stepIndex = Math.max(
    0,
    flow.findIndex((item) => item.step === step),
  );
  const isKycApproved = kyc?.verification_status === "APPROVED";
  const isFaceVerified = faceEnrollment?.status === "FACE_VERIFIED";
  const isFaceDeferred = faceEnrollment?.status === "DEFERRED";
  const isFaceHandled = isFaceVerified || isFaceDeferred;
  const hasVerifiedAsset = assets?.some((a) => a.verification_status === "VERIFIED") ?? false;
  const hasScopes = (authBundle?.scopes?.filter((s) => s.granted)?.length ?? 0) > 0;
  const auth = authBundle?.auth;
  const isDraftReady =
    authBundle?.documents?.some((d) => d.kind === "draft" && d.version === auth?.version) ?? false;
  const isReviewVisible = Boolean(auth && auth.status !== "DRAFT");
  const isApproved = auth?.status === "ACTIVE";

  // For celebrity face enrollment, Veriff is not required — unlock the face step UI.
  const faceKycGate = accountType && requiresVeriff(accountType) ? isKycApproved : true;

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
            ACCOUNT-TYPE ONBOARDING
          </div>
          <h1 className="font-display text-3xl font-bold leading-tight mb-8">
            Route-specific protection setup
          </h1>
          <ol className="relative space-y-1">
            {flow.map((item, i) => {
              const isActive = i === stepIndex;
              const isPast = i < stepIndex;
              return (
                <li key={item.title} className="relative flex items-center gap-4 py-3">
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
                    ) : isActive ? (
                      item.step
                    ) : (
                      <Lock className="size-3.5 opacity-50" />
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
                    {item.title}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="relative z-10 text-xs text-white/50 pt-4 border-t border-white/10">
          Step {step} of {flow.length} ·{" "}
          {accountType ? accountType.replace(/_/g, " ") : "select route"}
        </div>
      </aside>

      <section className="relative flex-1 lg:h-full h-auto overflow-y-auto bg-[#050A18]">
        <div className="relative min-h-full flex flex-col justify-center px-6 md:px-12 lg:px-20 py-14">
          <div className="w-full max-w-2xl mx-auto">
            <div className="mb-8">
              <div className="text-[11px] font-semibold tracking-[0.24em] text-blue-400 mb-2">
                STEP {step} / {flow.length}
              </div>
              <h2 className="font-display text-3xl font-bold">{current.title}</h2>
            </div>

            <div className="animate-fade-in">
              {current.key === "account_type" && (
                <AccountTypeStep
                  onSelected={async () => {
                    await refetchProfile();
                    await advanceStep(1);
                  }}
                />
              )}

              {current.key === "profile" && accountType && isLightRoute && (
                <LightProfileStep
                  profile={profile}
                  accountType={accountType}
                  onSaved={async () => {
                    await refetchProfile();
                    await advanceStep(2);
                  }}
                />
              )}

              {current.key === "profile" && accountType && !isLightRoute && (
                <V2ProfileStep
                  profile={profile}
                  accountType={accountType}
                  onSaved={async () => {
                    await refetchProfile();
                    await advanceStep(2);
                  }}
                />
              )}

              {current.key === "veriff" && (
                <VeriffIdentityStep
                  kyc={kyc ?? null}
                  onRefetch={async () => {
                    await refetchKyc();
                  }}
                  onBack={goBack}
                  onNext={() => advanceStep(3)}
                />
              )}

              {current.key === "representative" &&
                (accountType === "enterprise" || accountType === "production_house") && (
                  <V2RepresentativeStep
                    accountType={accountType}
                    onBack={goBack}
                    onNext={() => advanceStep(3)}
                  />
                )}

              {current.key === "evidence" && accountType && accountType !== "individual" && (
                <V2EvidenceStep
                  accountType={accountType}
                  onBack={goBack}
                  onNext={() => advanceStep(current.step)}
                />
              )}

              {current.key === "face" && (
                <FaceEnrollmentStep
                  enrollmentStatus={faceEnrollment}
                  isKycApproved={faceKycGate}
                  onRefetch={async () => {
                    await refetchFaceEnrollment();
                  }}
                  onBack={goBack}
                  onNext={() => advanceStep(current.step)}
                  onDefer={() => advanceStep(current.step, "DEFERRED")}
                />
              )}

              {current.key === "assets" && (
                <AssetVerificationStep onBack={goBack} onNext={() => advanceStep(current.step)} />
              )}

              {/* Company (Client Type = COMPANY) route */}
              {current.key === "company_profile" && (
                <CompanyProfileStep onNext={() => advanceStep(current.step)} />
              )}

              {current.key === "company_representative" && (
                <CompanyRepresentativeStep
                  onBack={goBack}
                  onNext={() => advanceStep(current.step)}
                />
              )}

              {current.key === "company_social" && (
                <CompanySocialStep onBack={goBack} onNext={() => advanceStep(current.step)} />
              )}

              {current.key === "company_authority" && (
                <CompanyRegistrationStep onBack={goBack} onNext={() => advanceStep(current.step)} />
              )}

              {current.key === "company_signature" && (
                <CompanyAuthorizationSignatureStep
                  onBack={goBack}
                  onNext={() => advanceStep(current.step)}
                />
              )}

              {current.key === "company_review" && (
                <CompanyReviewStep
                  onBack={goBack}
                  onNext={() => advanceStep(current.step)}
                  onGoToStep={goToStep}
                />
              )}

              {current.key === "company_complete" && (
                <CompanyCompleteStep
                  onCompleted={async () => {
                    await refetchProfile();
                    await qc.invalidateQueries({ queryKey: ["onboarding-progress"] });
                  }}
                />
              )}



              {current.key === "scope" && (
                <AuthorizationScopeStep onBack={goBack} onNext={() => advanceStep(current.step)} />
              )}

              {current.key === "review" && (
                <AuthorizationReviewStep
                  onBack={goBack}
                  onNext={() => advanceStep(current.step)}
                  onGoToStep={goToStep}
                />
              )}

              {current.key === "signature" && (
                <SignatureStep onBack={goBack} onNext={() => advanceStep(current.step)} />
              )}

              {current.key === "certificate" && isApproved && (
                <CertificateStep
                  onBack={goBack}
                  onNext={() => advanceStep(current.step)}
                  kycStatus={
                    accountType && requiresVeriff(accountType)
                      ? (kyc?.verification_status ?? "NOT_STARTED")
                      : "NOT_REQUIRED"
                  }
                  faceStatus={faceEnrollment?.status ?? "NOT_STARTED"}
                  assetStatus={hasVerifiedAsset ? "VERIFIED" : "UNVERIFIED"}
                  accountType={accountType}
                  showGovernmentId={Boolean(
                    accountType && requiresVeriff(accountType) && isKycApproved,
                  )}
                />
              )}

              {current.key === "complete" && isLightRoute && (
                <LightCompleteStep
                  onCompleted={async () => {
                    await refetchProfile();
                    await qc.invalidateQueries({ queryKey: ["onboarding-progress"] });
                  }}
                />
              )}

              {current.key === "complete" && !isLightRoute && isApproved && (
                <OnboardingCompleteStep
                  onGoToStep={goToStep}
                  accountType={accountType}
                  showGovernmentId={Boolean(
                    accountType && requiresVeriff(accountType) && isKycApproved,
                  )}
                />
              )}

              {(current.key === "certificate" || current.key === "complete") &&
                !isLightRoute &&
                !isApproved && (
                  <div className="rounded-xl border border-white/10 bg-[#0A1128] p-8 text-center text-white/70">
                    Authorization must be signed before this step unlocks.
                    <div className="mt-4 text-xs text-white/40">
                      Draft ready: {String(isDraftReady)} · Review visible:{" "}
                      {String(isReviewVisible)} · Face handled: {String(isFaceHandled)} · Scopes:{" "}
                      {String(hasScopes)}
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
