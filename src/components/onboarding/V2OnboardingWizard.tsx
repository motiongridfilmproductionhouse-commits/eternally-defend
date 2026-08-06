import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  Loader2,
  Lock,
  ShieldCheck,
  User,
  UserRoundCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  selectAccountType,
  type AccountType,
} from "@/lib/onboarding/account-type.functions";
import {
  completeV2Onboarding,
  getProgress,
  setStepStatus,
} from "@/lib/onboarding/progress.functions";
import {
  getClientProfile,
  saveClientProfile,
} from "@/lib/onboarding/profile.functions";
import {
  createVeriffSession,
  getKycStatus,
  syncVeriffStatus,
} from "@/lib/onboarding/kyc.functions";
import { getFaceEnrollment } from "@/lib/onboarding/face-enrollment.functions";
import { listAssets } from "@/lib/onboarding/assets.functions";
import { getAuthorizationBundle } from "@/lib/onboarding/authorization.functions";
import { getMyCertificate } from "@/lib/onboarding/certificate.functions";

import { FaceEnrollmentStep } from "@/components/onboarding/FaceEnrollmentStep";
import { AssetVerificationStep } from "@/components/onboarding/AssetVerificationStep";
import { AuthorizationScopeStep } from "@/components/onboarding/AuthorizationScopeStep";
import { AuthorizationReviewStep } from "@/components/onboarding/AuthorizationReviewStep";
import { SignatureStep } from "@/components/onboarding/SignatureStep";
import { CertificateStep } from "@/components/onboarding/CertificateStep";

type StepId =
  | "account_type"
  | "profile"
  | "kyc"
  | "face"
  | "assets"
  | "authorization_scope"
  | "authorization_review"
  | "signature"
  | "certificate"
  | "complete";

type RouteStep = {
  id: StepId;
  title: string;
  description: string;
};

const ACCOUNT_OPTIONS: Array<{
  value: AccountType;
  label: string;
  description: string;
  icon: typeof User;
}> = [
  {
    value: "celebrity",
    label: "Celebrity / Public Figure",
    description:
      "For actors, artists, influencers, creators, executives, and public personalities.",
    icon: UserRoundCheck,
  },
  {
    value: "individual",
    label: "Individual",
    description:
      "For individuals protecting their personal identity, reputation, images, and digital assets.",
    icon: User,
  },
  {
    value: "enterprise",
    label: "Enterprise / Company",
    description:
      "For brands, corporations, agencies, legal firms, and registered organizations.",
    icon: Building2,
  },
  {
    value: "production_house",
    label: "Production House",
    description:
      "For film studios, producers, distributors, and media rights holders.",
    icon: Film,
  },
];

const COMMON_FINAL_STEPS: RouteStep[] = [
  {
    id: "face",
    title: "Face Protection Enrollment",
    description: "Create a secure face reference for impersonation protection.",
  },
  {
    id: "assets",
    title: "Digital Asset Verification",
    description: "Register and verify the digital assets Eterna will protect.",
  },
  {
    id: "authorization_scope",
    title: "Authorization Scope",
    description: "Select the permissions granted to Eterna.",
  },
  {
    id: "authorization_review",
    title: "Authorization Letter Review",
    description: "Review the formal authorization document before signing.",
  },
  {
    id: "signature",
    title: "Electronic Signature",
    description: "Sign and seal the authorization.",
  },
  {
    id: "certificate",
    title: "Verification Certificate",
    description: "Review and download the issued certificate.",
  },
  {
    id: "complete",
    title: "Onboarding Complete",
    description: "Finish setup and enter the Eterna dashboard.",
  },
];

const ROUTES: Record<AccountType, RouteStep[]> = {
  celebrity: [
    {
      id: "account_type",
      title: "Account Type",
      description: "Celebrity / Public Figure selected.",
    },
    {
      id: "profile",
      title: "Celebrity Profile",
      description:
        "Provide your official identity, public name, manager, and contact information.",
    },
    ...COMMON_FINAL_STEPS,
  ],

  individual: [
    {
      id: "account_type",
      title: "Account Type",
      description: "Individual selected.",
    },
    {
      id: "profile",
      title: "Personal Profile",
      description: "Provide your legal identity and contact information.",
    },
    {
      id: "kyc",
      title: "Veriff Identity Verification",
      description:
        "Verify your government-issued identity securely through Veriff.",
    },
    ...COMMON_FINAL_STEPS,
  ],

  enterprise: [
    {
      id: "account_type",
      title: "Account Type",
      description: "Enterprise / Company selected.",
    },
    {
      id: "profile",
      title: "Company Profile",
      description:
        "Provide your organization and authorized representative details.",
    },
    ...COMMON_FINAL_STEPS,
  ],

  production_house: [
    {
      id: "account_type",
      title: "Account Type",
      description: "Production House selected.",
    },
    {
      id: "profile",
      title: "Production House Profile",
      description:
        "Provide the studio, rights-holder, and authorized representative details.",
    },
    ...COMMON_FINAL_STEPS,
  ],
};

type ProfileForm = {
  legal_name: string;
  display_name: string;
  company_name: string;
  role_title: string;
  phone: string;
  country: string;
  address: string;
};

const EMPTY_PROFILE: ProfileForm = {
  legal_name: "",
  display_name: "",
  company_name: "",
  role_title: "",
  phone: "",
  country: "",
  address: "",
};

export function V2OnboardingWizard() {
  const queryClient = useQueryClient();

  const fetchProgress = useServerFn(getProgress);
  const updateStep = useServerFn(setStepStatus);
  const fetchProfile = useServerFn(getClientProfile);
  const saveProfile = useServerFn(saveClientProfile);
  const chooseAccountType = useServerFn(selectAccountType);
  const fetchKyc = useServerFn(getKycStatus);
  const createVeriff = useServerFn(createVeriffSession);
  const syncVeriff = useServerFn(syncVeriffStatus);
  const fetchFace = useServerFn(getFaceEnrollment);
  const fetchAssets = useServerFn(listAssets);
  const fetchAuthorization = useServerFn(getAuthorizationBundle);
  const fetchCertificate = useServerFn(getMyCertificate);
  const completeOnboarding = useServerFn(completeV2Onboarding);

  const [pendingType, setPendingType] = useState<AccountType | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [profileForm, setProfileForm] =
    useState<ProfileForm>(EMPTY_PROFILE);

  const {
    data: progress,
    refetch: refetchProgress,
    isLoading: progressLoading,
  } = useQuery({
    queryKey: ["onboarding-progress"],
    queryFn: () => fetchProgress(),
  });

  const {
    data: profile,
    refetch: refetchProfile,
    isLoading: profileLoading,
  } = useQuery({
    queryKey: ["v2-client-profile"],
    queryFn: () => fetchProfile(),
  });

  const persistedAccountType =
    (profile?.account_type as AccountType | null | undefined) ?? null;

  const accountType = persistedAccountType;
  const steps = accountType ? ROUTES[accountType] : [];

  const {
    data: kyc,
    refetch: refetchKyc,
  } = useQuery({
    queryKey: ["v2-kyc-status"],
    queryFn: () => fetchKyc(),
    enabled: accountType === "individual",
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.verification_status;
      return status === "APPROVED" ||
        status === "DECLINED" ||
        status === "EXPIRED"
        ? false
        : 5000;
    },
  });

  const {
    data: faceEnrollment,
    refetch: refetchFace,
  } = useQuery({
    queryKey: ["face-enrollment-status"],
    queryFn: () => fetchFace(),
    enabled: Boolean(accountType),
  });

  const { data: assets = [] } = useQuery({
    queryKey: ["digital_assets"],
    queryFn: () => fetchAssets(),
    enabled: Boolean(accountType),
  });

  const { data: authBundle } = useQuery({
    queryKey: ["auth_bundle"],
    queryFn: () => fetchAuthorization(),
    enabled: Boolean(accountType),
  });

  const { data: certificate } = useQuery({
    queryKey: ["my_certificate"],
    queryFn: () => fetchCertificate(),
    enabled: Boolean(accountType),
  });

  useEffect(() => {
    if (!profile) return;

    setProfileForm({
      legal_name:
        profile.legal_name ??
        profile.full_name ??
        "",
      display_name: profile.display_name ?? "",
      company_name: profile.company_name ?? "",
      role_title: profile.role_title ?? "",
      phone: profile.phone ?? "",
      country: profile.country ?? "",
      address: profile.address ?? "",
    });
  }, [profile]);

  useEffect(() => {
    if (!accountType || !progress) return;

    const serverStep = Math.max(
      1,
      Number(progress.current_step) || 1,
    );

    setStepIndex(
      Math.min(
        Math.max(serverStep - 1, 0),
        ROUTES[accountType].length - 1,
      ),
    );
  }, [accountType, progress]);

  const currentStep = steps[stepIndex];

  const isKycApproved =
    accountType !== "individual" ||
    kyc?.verification_status === "APPROVED";

  const isFaceHandled =
    faceEnrollment?.status === "FACE_VERIFIED" ||
    faceEnrollment?.status === "DEFERRED";

  const hasVerifiedAsset = assets.some(
    (asset: any) => asset.verification_status === "VERIFIED",
  );

  const hasScopes =
    (authBundle?.scopes?.filter((scope: any) => scope.granted)?.length ??
      0) > 0;

  const auth = authBundle?.auth;

  const hasDraft =
    authBundle?.documents?.some(
      (document: any) =>
        document.kind === "draft" &&
        document.version === auth?.version,
    ) ?? false;

  const hasSignature =
    authBundle?.signatures?.some(
      (signature: any) =>
        signature.status === "SIGNED" &&
        signature.version === auth?.version,
    ) ?? false;

  const hasActiveCertificate =
    certificate?.status === "ACTIVE";

  const completedStepIds = useMemo(() => {
    const completed = new Set<StepId>();

    if (accountType) completed.add("account_type");

    if (
      profile?.full_name &&
      profile?.country
    ) {
      completed.add("profile");
    }

    if (isKycApproved) completed.add("kyc");
    if (isFaceHandled) completed.add("face");
    if (hasVerifiedAsset) completed.add("assets");
    if (hasScopes) completed.add("authorization_scope");
    if (hasDraft) completed.add("authorization_review");
    if (hasSignature) completed.add("signature");
    if (hasActiveCertificate) completed.add("certificate");

    if (progress?.overall_status === "COMPLETED") {
      completed.add("complete");
    }

    return completed;
  }, [
    accountType,
    profile,
    isKycApproved,
    isFaceHandled,
    hasVerifiedAsset,
    hasScopes,
    hasDraft,
    hasSignature,
    hasActiveCertificate,
    progress,
  ]);

  const persistAdvance = async (
    status: "COMPLETED" | "DEFERRED" = "COMPLETED",
  ) => {
    if (!currentStep) return;

    try {
      const updated = await updateStep({
        data: {
          step: stepIndex + 1,
          status: status as any,
          advance: true,
        },
      });

      const nextIndex = Math.min(
        Math.max(
          Number(updated?.current_step ?? stepIndex + 2) - 1,
          stepIndex + 1,
        ),
        steps.length - 1,
      );

      setStepIndex(nextIndex);

      await Promise.all([
        refetchProgress(),
        queryClient.invalidateQueries({
          queryKey: ["onboarding-progress"],
        }),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update onboarding progress",
      );
    }
  };

  const goBack = () => {
    setStepIndex((current) => Math.max(0, current - 1));
  };

  const goToRouteStep = (legacyStepNumber: number) => {
    const legacyMap: Record<number, StepId> = {
      1: "profile",
      4: "assets",
      5: "authorization_scope",
    };

    const targetId = legacyMap[legacyStepNumber];
    if (!targetId) return;

    const targetIndex = steps.findIndex(
      (step) => step.id === targetId,
    );

    if (targetIndex >= 0) setStepIndex(targetIndex);
  };

  const confirmAccountType = async () => {
    if (!pendingType || saving) return;

    setSaving(true);

    try {
      await chooseAccountType({ data: pendingType });

      await Promise.all([
        refetchProfile(),
        refetchProgress(),
      ]);

      setPendingType(null);
      setStepIndex(1);

      toast.success("Account type saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save account type",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleProfileSave = async () => {
    if (saving || !accountType) return;

    if (!profileForm.legal_name.trim()) {
      toast.error(
        accountType === "enterprise" ||
          accountType === "production_house"
          ? "Authorized representative name is required."
          : "Legal or official name is required.",
      );
      return;
    }

    if (!profileForm.country.trim()) {
      toast.error("Country is required.");
      return;
    }

    if (
      (accountType === "enterprise" ||
        accountType === "production_house") &&
      !profileForm.company_name.trim()
    ) {
      toast.error("Company or production house name is required.");
      return;
    }

    setSaving(true);

    try {
      await saveProfile({
        data: {
          legal_name: profileForm.legal_name.trim(),
          display_name:
            profileForm.display_name.trim() || null,
          company_name:
            profileForm.company_name.trim() || null,
          role_title:
            profileForm.role_title.trim() || null,
          phone: profileForm.phone.trim() || null,
          country: profileForm.country.trim(),
          address: profileForm.address.trim() || null,
          client_type:
            accountType === "enterprise" ||
            accountType === "production_house"
              ? "business"
              : accountType,
        },
      });

      await refetchProfile();
      toast.success("Profile saved");
      await persistAdvance();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save profile",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleFinalCompletion = async () => {
    if (saving) return;

    setSaving(true);

    try {
      await completeOnboarding();

      await Promise.all([
        refetchProgress(),
        queryClient.invalidateQueries({
          queryKey: ["client_profile"],
        }),
      ]);

      toast.success("Onboarding completed successfully");
      window.location.assign("/");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to complete onboarding",
      );
    } finally {
      setSaving(false);
    }
  };

  if (progressLoading || profileLoading) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-[#050A18] text-white">
        <Loader2 className="size-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!accountType) {
    return (
      <div className="fixed inset-0 overflow-y-auto bg-[#050A18] px-6 py-12 text-white">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <div className="text-xs font-semibold tracking-[0.24em] text-blue-400">
              ETERNA SECURE ONBOARDING
            </div>

            <h1 className="mt-3 text-3xl font-bold">
              Choose Your Account Type
            </h1>

            <p className="mt-2 max-w-2xl text-white/60">
              Select how you are registering. Eterna will personalize
              verification and authorization requirements for your account.
            </p>
          </div>

          <div
            className="grid gap-4 md:grid-cols-2"
            role="radiogroup"
            aria-label="Account type"
          >
            {ACCOUNT_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = pendingType === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={saving}
                  onClick={() => setPendingType(option.value)}
                  className={`relative rounded-2xl border p-6 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                    selected
                      ? "border-blue-400 bg-blue-500/15 shadow-[0_0_30px_rgba(59,130,246,0.18)]"
                      : "border-white/10 bg-[#0A1128] hover:border-blue-400/60 hover:bg-blue-500/5"
                  }`}
                >
                  {selected && (
                    <span className="absolute right-4 top-4 grid size-6 place-items-center rounded-full bg-blue-500">
                      <Check className="size-4" />
                    </span>
                  )}

                  <div className="mb-4 grid size-11 place-items-center rounded-xl bg-white/10">
                    <Icon className="size-5 text-blue-300" />
                  </div>

                  <div className="font-semibold">
                    {option.label}
                  </div>

                  <div className="mt-2 text-sm leading-relaxed text-white/60">
                    {option.description}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex justify-end">
            <Button
              type="button"
              disabled={!pendingType || saving}
              onClick={confirmAccountType}
              className="bg-blue-600 text-white hover:bg-blue-500"
            >
              {saving && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}

              {pendingType
                ? `Continue as ${
                    ACCOUNT_OPTIONS.find(
                      (option) => option.value === pendingType,
                    )?.label
                  }`
                : "Select an account type"}

              <ChevronRight className="ml-2 size-4" />
            </Button>
          </div>

          <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-4 text-xs leading-relaxed text-white/50">
            Eterna collects only the information required for the
            selected account type. Government-issued identification is
            required by default only for Individual accounts.
          </div>
        </div>
      </div>
    );
  }

  if (!currentStep) return null;

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#050A18] text-white lg:flex-row">
      <aside
        className="relative flex h-auto w-full flex-col justify-between overflow-hidden p-7 lg:h-full lg:w-[38%] lg:p-10"
        style={{
          background:
            "linear-gradient(135deg, #071B4A 0%, #1037A6 55%, #1E5EFF 100%)",
        }}
      >
        <div className="pointer-events-none absolute -left-32 -top-40 size-[520px] rounded-full bg-blue-400/30 opacity-60 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-52 -right-40 size-[620px] rounded-full bg-blue-600/30 opacity-50 blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl border border-white/20 bg-white/15">
            <ShieldCheck className="size-5" />
          </div>

          <div className="text-xl font-bold">
            Eterna AI
          </div>
        </div>

        <div className="relative z-10 my-7 flex-1 overflow-y-auto pr-3">
          <div className="mb-2 text-[11px] font-semibold tracking-[0.28em] text-white/60">
            ACCOUNT-TYPE ONBOARDING
          </div>

          <h1 className="mb-7 text-3xl font-bold">
            {
              ACCOUNT_OPTIONS.find(
                (option) => option.value === accountType,
              )?.label
            }
          </h1>

          <ol className="space-y-1">
            {steps.map((routeStep, index) => {
              const active = index === stepIndex;
              const complete = completedStepIds.has(routeStep.id);
              const locked = index > stepIndex && !complete;

              return (
                <li
                  key={routeStep.id}
                  className="flex items-center gap-4 py-2.5"
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-full border text-xs font-bold ${
                      active
                        ? "border-white bg-white text-[#0b1f4d]"
                        : complete
                          ? "border-emerald-300 bg-emerald-400 text-[#0b1f4d]"
                          : "border-white/20 bg-white/5 text-white/50"
                    }`}
                  >
                    {complete && !active ? (
                      <Check className="size-4" />
                    ) : locked ? (
                      <Lock className="size-3.5" />
                    ) : (
                      index + 1
                    )}
                  </span>

                  <div className="min-w-0">
                    <div
                      className={`truncate text-sm ${
                        active
                          ? "font-semibold text-white"
                          : complete
                            ? "text-white/80"
                            : "text-white/45"
                      }`}
                    >
                      {routeStep.title}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="relative z-10 border-t border-white/10 pt-4 text-xs text-white/50">
          Step {stepIndex + 1} of {steps.length}
        </div>
      </aside>

      <main className="h-auto flex-1 overflow-y-auto bg-[#050A18] lg:h-full">
        <div className="flex min-h-full flex-col justify-center px-6 py-12 md:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-3xl">
            <div className="mb-8">
              <div className="mb-2 text-[11px] font-semibold tracking-[0.24em] text-blue-400">
                STEP {stepIndex + 1} / {steps.length}
              </div>

              <h2 className="text-3xl font-bold">
                {currentStep.title}
              </h2>

              <p className="mt-2 text-white/55">
                {currentStep.description}
              </p>
            </div>

            {currentStep.id === "account_type" && (
              <Card className="border-white/10 bg-[#0A1128] text-white">
                <CardHeader>
                  <CardTitle>Account Type Confirmed</CardTitle>

                  <CardDescription className="text-white/60">
                    Your onboarding requirements have been personalized.
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex justify-end">
                  <Button
                    onClick={() => persistAdvance()}
                    className="bg-blue-600 hover:bg-blue-500"
                  >
                    Continue
                    <ChevronRight className="ml-2 size-4" />
                  </Button>
                </CardContent>
              </Card>
            )}

            {currentStep.id === "profile" && (
              <ProfileStep
                accountType={accountType}
                form={profileForm}
                setForm={setProfileForm}
                saving={saving}
                onBack={goBack}
                onSave={handleProfileSave}
              />
            )}

            {currentStep.id === "kyc" && (
              <KycStep
                kyc={kyc}
                saving={saving}
                onBack={goBack}
                onCreate={async () => {
                  setSaving(true);

                  try {
                    const session = await createVeriff();

                    if (session.session_url) {
                      window.open(
                        session.session_url,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }

                    await refetchKyc();
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Unable to start Veriff",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
                onSync={async () => {
                  setSaving(true);

                  try {
                    await syncVeriff();
                    await refetchKyc();
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Unable to refresh Veriff status",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
                onNext={() => persistAdvance()}
              />
            )}

            {currentStep.id === "face" && (
              <FaceEnrollmentStep
                enrollmentStatus={faceEnrollment}
                isKycApproved={isKycApproved}
                onRefetch={async () => {
                  await refetchFace();
                }}
                onBack={goBack}
                onNext={() => persistAdvance()}
                onDefer={() => persistAdvance("DEFERRED")}
              />
            )}

            {currentStep.id === "assets" && (
              <AssetVerificationStep
                onBack={goBack}
                onNext={() => persistAdvance()}
              />
            )}

            {currentStep.id === "authorization_scope" && (
              <AuthorizationScopeStep
                onBack={goBack}
                onNext={() => persistAdvance()}
              />
            )}

            {currentStep.id === "authorization_review" && (
              <AuthorizationReviewStep
                onBack={goBack}
                onNext={() => persistAdvance()}
                onGoToStep={goToRouteStep}
              />
            )}

            {currentStep.id === "signature" && (
              <SignatureStep
                onBack={goBack}
                onNext={() => persistAdvance()}
              />
            )}

            {currentStep.id === "certificate" && (
              <CertificateStep
                onBack={goBack}
                onNext={() => persistAdvance()}
                kycStatus={
                  accountType === "individual"
                    ? kyc?.verification_status ?? "NOT_STARTED"
                    : "NOT_REQUIRED"
                }
                faceStatus={
                  faceEnrollment?.status ?? "NOT_STARTED"
                }
                assetStatus={
                  hasVerifiedAsset ? "VERIFIED" : "NOT_VERIFIED"
                }
              />
            )}

            {currentStep.id === "complete" && (
              <Card className="border-emerald-500/30 bg-[#0A1128] text-white">
                <CardContent className="space-y-6 p-8 text-center">
                  <div className="mx-auto grid size-16 place-items-center rounded-full border border-emerald-500/30 bg-emerald-500/15">
                    <ShieldCheck className="size-8 text-emerald-400" />
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold text-emerald-400">
                      Protection Setup Ready
                    </h2>

                    <p className="mt-2 text-white/60">
                      Complete onboarding to activate your Eterna account.
                    </p>
                  </div>

                  <div className="flex flex-col justify-between gap-3 border-t border-white/10 pt-5 sm:flex-row">
                    <Button
                      variant="ghost"
                      onClick={goBack}
                      disabled={saving}
                      className="text-white hover:bg-white/10"
                    >
                      <ChevronLeft className="mr-2 size-4" />
                      Back
                    </Button>

                    <Button
                      onClick={handleFinalCompletion}
                      disabled={saving}
                      className="bg-emerald-600 text-white hover:bg-emerald-500"
                    >
                      {saving && (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      )}
                      Complete Onboarding
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function ProfileStep({
  accountType,
  form,
  setForm,
  saving,
  onBack,
  onSave,
}: {
  accountType: AccountType;
  form: ProfileForm;
  setForm: React.Dispatch<React.SetStateAction<ProfileForm>>;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const isOrganization =
    accountType === "enterprise" ||
    accountType === "production_house";

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white">
      <CardHeader>
        <CardTitle>
          {isOrganization
            ? "Organization and Representative"
            : "Official Profile"}
        </CardTitle>

        <CardDescription className="text-white/60">
          Enter accurate information that can be included in your
          authorization documents.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {isOrganization && (
          <Field
            label={
              accountType === "production_house"
                ? "Production House Name"
                : "Legal Company Name"
            }
            value={form.company_name}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                company_name: value,
              }))
            }
            required
          />
        )}

        <Field
          label={
            isOrganization
              ? "Authorized Representative Name"
              : accountType === "celebrity"
                ? "Official / Legal Name"
                : "Legal Name"
          }
          value={form.legal_name}
          onChange={(value) =>
            setForm((current) => ({
              ...current,
              legal_name: value,
            }))
          }
          required
        />

        <Field
          label={
            accountType === "celebrity"
              ? "Stage / Public Name"
              : isOrganization
                ? "Trading Name"
                : "Display Name"
          }
          value={form.display_name}
          onChange={(value) =>
            setForm((current) => ({
              ...current,
              display_name: value,
            }))
          }
        />

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={
              isOrganization
                ? "Representative Role"
                : "Profession / Role"
            }
            value={form.role_title}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                role_title: value,
              }))
            }
          />

          <Field
            label="Phone"
            value={form.phone}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                phone: value,
              }))
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Country"
            value={form.country}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                country: value,
              }))
            }
            required
          />

          <Field
            label="Address"
            value={form.address}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                address: value,
              }))
            }
          />
        </div>

        <div className="flex justify-between border-t border-white/10 pt-5">
          <Button
            variant="ghost"
            onClick={onBack}
            disabled={saving}
            className="text-white hover:bg-white/10"
          >
            <ChevronLeft className="mr-2 size-4" />
            Back
          </Button>

          <Button
            onClick={onSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-500"
          >
            {saving && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Save and Continue
            <ChevronRight className="ml-2 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-white/75">
        {label}
        {required && (
          <span className="ml-1 text-red-400">*</span>
        )}
      </Label>

      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-white/10 bg-[#0F172A] text-white"
      />
    </div>
  );
}

function KycStep({
  kyc,
  saving,
  onBack,
  onCreate,
  onSync,
  onNext,
}: {
  kyc: any;
  saving: boolean;
  onBack: () => void;
  onCreate: () => Promise<void>;
  onSync: () => Promise<void>;
  onNext: () => void;
}) {
  const approved = kyc?.verification_status === "APPROVED";

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white">
      <CardHeader>
        <CardTitle>Government Identity Verification</CardTitle>

        <CardDescription className="text-white/60">
          Individual accounts require approved Veriff verification.
          Celebrities and organizations do not enter this step.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs uppercase tracking-wider text-white/40">
            Current status
          </div>

          <div
            className={`mt-2 font-semibold ${
              approved ? "text-emerald-400" : "text-amber-300"
            }`}
          >
            {kyc?.verification_status ?? "NOT STARTED"}
          </div>
        </div>

        {kyc?.session_url && !approved && (
          <a
            href={kyc.session_url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-300 hover:bg-blue-500/15"
          >
            Continue existing Veriff session
          </a>
        )}

        <div className="flex flex-col justify-between gap-3 border-t border-white/10 pt-5 sm:flex-row">
          <Button
            variant="ghost"
            onClick={onBack}
            disabled={saving}
            className="text-white hover:bg-white/10"
          >
            <ChevronLeft className="mr-2 size-4" />
            Back
          </Button>

          <div className="flex gap-2">
            {!approved && (
              <>
                <Button
                  variant="outline"
                  onClick={onSync}
                  disabled={saving}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  Refresh Status
                </Button>

                <Button
                  onClick={onCreate}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-500"
                >
                  Start Veriff
                </Button>
              </>
            )}

            {approved && (
              <Button
                onClick={onNext}
                className="bg-emerald-600 hover:bg-emerald-500"
              >
                Continue
                <ChevronRight className="ml-2 size-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
