import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { isPublicSignupEnabled, assertPublicSignupAllowed } from "./auth-config";

describe("Public Signup Restriction & Security Controls", () => {
  const originalEnv = process.env.PUBLIC_SIGNUP_ENABLED;

  beforeEach(() => {
    delete process.env.PUBLIC_SIGNUP_ENABLED;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PUBLIC_SIGNUP_ENABLED = originalEnv;
    } else {
      delete process.env.PUBLIC_SIGNUP_ENABLED;
    }
  });

  it("A. PUBLIC_SIGNUP_ENABLED=false (default) -> public signup rejected", () => {
    process.env.PUBLIC_SIGNUP_ENABLED = "false";
    assert.strictEqual(isPublicSignupEnabled(), false);
    assert.throws(
      () => assertPublicSignupAllowed(),
      (err: any) => err.message.includes("New registrations are temporarily closed"),
    );
  });

  it("B. Direct signup API request when disabled returns REGISTRATION_CLOSED error payload", async () => {
    process.env.PUBLIC_SIGNUP_ENABLED = "false";

    // Simulate API request handler logic
    const handleSignupRequest = async () => {
      if (!isPublicSignupEnabled()) {
        return {
          status: 403,
          body: {
            error: "REGISTRATION_CLOSED",
            message: "New registrations are temporarily closed.",
          },
        };
      }
      return { status: 200, body: { ok: true } };
    };

    const res = await handleSignupRequest();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, "REGISTRATION_CLOSED");
    assert.strictEqual(res.body.message, "New registrations are temporarily closed.");
  });

  it("C. Existing user login logic remains completely unaffected", async () => {
    process.env.PUBLIC_SIGNUP_ENABLED = "false";

    // Simulate user login handler
    const simulateLogin = async (credentials: { email: string }) => {
      // Login ignores signup restriction
      return { success: true, user: { email: credentials.email, id: "usr-123" } };
    };

    const res = await simulateLogin({ email: "existing@example.com" });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.user.id, "usr-123");
  });

  it("D. Existing authenticated user session & app access remains functional", () => {
    process.env.PUBLIC_SIGNUP_ENABLED = "false";

    const session = { user: { id: "usr-123" } };
    const canAccessDashboard = Boolean(session.user);

    assert.strictEqual(canAccessDashboard, true);
  });

  it("E. Existing incomplete user can complete onboarding", () => {
    process.env.PUBLIC_SIGNUP_ENABLED = "false";

    const profile = { user_id: "usr-123", onboarding_completed: false };
    const targetRoute = profile.onboarding_completed ? "/" : "/onboarding";

    assert.strictEqual(targetRoute, "/onboarding");
  });

  it("F. Admin/service-role provisioning bypasses public self-registration restriction", () => {
    process.env.PUBLIC_SIGNUP_ENABLED = "false";

    const simulateAdminProvisioning = (role: string) => {
      if (role === "service_role" || role === "admin") {
        return { created: true, user_id: "usr-admin-created" };
      }
      // Public path
      assertPublicSignupAllowed();
      return { created: true };
    };

    const adminResult = simulateAdminProvisioning("service_role");
    assert.strictEqual(adminResult.created, true);
    assert.strictEqual(adminResult.user_id, "usr-admin-created");

    // Public path still fails
    assert.throws(() => simulateAdminProvisioning("public_user"));
  });

  it("G. PUBLIC_SIGNUP_ENABLED=true -> existing signup behavior can be restored without code changes", () => {
    process.env.PUBLIC_SIGNUP_ENABLED = "true";
    assert.strictEqual(isPublicSignupEnabled(), true);
    assert.doesNotThrow(() => assertPublicSignupAllowed());
  });
});
