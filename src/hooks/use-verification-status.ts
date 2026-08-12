import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOnboardingState } from "@/lib/onboarding.functions";
import { getKycStatus } from "@/lib/onboarding/kyc.functions";
import { getFaceEnrollment } from "@/lib/onboarding/face-enrollment.functions";
import {
  canPerformSensitiveAction,
  deriveVerificationStatus,
  type VerificationStatus,
} from "@/lib/verification/verification-status";
import { isV2AccountType, type V2AccountType } from "@/lib/onboarding/v2-config";
import { useSession } from "./use-session";

/**
 * Reads verification signals that already exist (KYC, face profile, profile
 * badge/authorization) and derives a single display status.
 */
export function useVerificationStatus() {
  const { session, ready } = useSession();
  const fetchState = useServerFn(getOnboardingState);
  const fetchKyc = useServerFn(getKycStatus);
  const fetchFace = useServerFn(getFaceEnrollment);
  const enabled = ready && !!session;

  const stateQuery = useQuery({
    queryKey: ["onboarding-state", session?.user.id ?? "anon"],
    queryFn: () => fetchState(),
    enabled,
    staleTime: 30_000,
  });
  const kycQuery = useQuery({
    queryKey: ["kyc_status", session?.user.id ?? "anon"],
    queryFn: () => fetchKyc(),
    enabled,
    staleTime: 30_000,
  });
  const faceQuery = useQuery({
    queryKey: ["face_enrollment_status", session?.user.id ?? "anon"],
    queryFn: () => fetchFace(),
    enabled,
    staleTime: 30_000,
  });

  const profile = stateQuery.data?.profile ?? null;
  const status: VerificationStatus = deriveVerificationStatus({
    kycStatus: (kycQuery.data as { verification_status?: string } | null)?.verification_status,
    faceStatus: (faceQuery.data as { status?: string } | null)?.status,
    verificationBadge: profile?.verification_badge ?? null,
    authorizationStatus: profile?.authorization_status ?? null,
  });

  const accountType: V2AccountType | null = isV2AccountType(profile?.onboarding_account_type)
    ? profile.onboarding_account_type
    : null;

  return {
    loading: stateQuery.isLoading || kycQuery.isLoading || faceQuery.isLoading,
    status,
    accountType,
    isVerified: status === "VERIFIED",
    isPending: status === "VERIFICATION_PENDING",
    canPerformSensitiveAction: canPerformSensitiveAction(status),
    refetch: async () => {
      await Promise.all([stateQuery.refetch(), kycQuery.refetch(), faceQuery.refetch()]);
    },
  };
}
