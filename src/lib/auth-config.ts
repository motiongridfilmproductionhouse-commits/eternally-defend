/**
 * Centralized Public Signup Feature Flag
 *
 * Environment variable: PUBLIC_SIGNUP_ENABLED (defaults to `false` when unset or set to "false").
 * Toggle to "true" in environment variables to re-enable public self-registration without code changes.
 */

export function isPublicSignupEnabled(): boolean {
  // Safe server-side and client-side check
  const envVal =
    typeof process !== "undefined" && process.env?.PUBLIC_SIGNUP_ENABLED !== undefined
      ? String(process.env.PUBLIC_SIGNUP_ENABLED).trim().toLowerCase()
      : typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_PUBLIC_SIGNUP_ENABLED !== undefined
        ? String((import.meta as any).env.VITE_PUBLIC_SIGNUP_ENABLED).trim().toLowerCase()
        : "false";

  return envVal === "true" || envVal === "1";
}

export function assertPublicSignupAllowed(): void {
  if (!isPublicSignupEnabled()) {
    const err = new Error("New registrations are temporarily closed.");
    (err as any).code = "REGISTRATION_CLOSED";
    throw err;
  }
}
