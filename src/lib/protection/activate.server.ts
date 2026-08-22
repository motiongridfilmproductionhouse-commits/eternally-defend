/**
 * Single entry point called wherever a customer's authorization becomes (or
 * remains) ACTIVE: builds/refreshes the canonical protection profile and
 * enrolls every eligible scan module. Never throws — enrollment problems
 * must never block or fail onboarding/admin-approval responses.
 */
import { buildOrUpdateProtectionProfile } from "./profile.server";
import { enrollEligibleModules } from "./enrollment.server";

export async function activateProtectionEnrollment(userId: string): Promise<void> {
  try {
    const result = await buildOrUpdateProtectionProfile(userId);
    if (!result) return;
    await enrollEligibleModules(userId, result.profileId);
  } catch (err) {
    console.error("[protection] activateProtectionEnrollment failed", userId, err);
  }
}
