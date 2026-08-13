/**
 * TEMPORARY KILL SWITCH — Face Protection / AWS Face Liveness onboarding.
 *
 * Set to `true` to restore the Face Scan onboarding step, its completion
 * requirement, and face-based verification scoring for every account type.
 *
 * While `false`:
 *  - the Face Protection step is hidden from all onboarding flows,
 *  - onboarding can be completed without face enrollment,
 *  - nobody is newly marked FACE_VERIFIED through onboarding.
 *
 * No AWS/Rekognition code is removed and no enrolled face data is touched:
 * existing enrollments stay intact and become active again on re-enable.
 */
export const FACE_PROTECTION_ONBOARDING_ENABLED = false;
