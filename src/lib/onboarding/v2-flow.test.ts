import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("v2 wizard reuses existing shared onboarding steps", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/onboarding/V2OnboardingWizard.tsx"),
    "utf8",
  );
  assert.match(source, /FaceEnrollmentStep/);
  assert.match(source, /AssetVerificationStep/);
  assert.match(source, /AuthorizationScopeStep/);
  assert.match(source, /AuthorizationReviewStep/);
  assert.match(source, /SignatureStep/);
  assert.match(source, /CertificateStep/);
  assert.match(source, /OnboardingCompleteStep/);
  assert.match(source, /VeriffIdentityStep/);
  assert.match(source, /V2EvidenceStep/);
  assert.match(source, /V2RepresentativeStep/);
});

test("evidence types match the migration check constraint", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260806070255_664835b3-4b31-4407-b44f-9952a7a1c39e.sql",
    ),
    "utf8",
  );
  assert.match(migration, /official_contact/);
  assert.match(migration, /representative/);
  assert.match(migration, /company/);
  assert.match(migration, /rights/);

  const config = readFileSync(resolve(process.cwd(), "src/lib/onboarding/v2-config.ts"), "utf8");
  assert.match(
    config,
    /V2_EVIDENCE_TYPES = \[[\s\S]*"official_contact"[\s\S]*"representative"[\s\S]*"company"[\s\S]*"rights"/,
  );

  const evidence = readFileSync(
    resolve(process.cwd(), "src/lib/onboarding/v2-evidence.functions.ts"),
    "utf8",
  );
  assert.match(evidence, /V2_EVIDENCE_TYPES/);
  assert.match(evidence, /primaryEvidenceTypeForAccount/);
  assert.doesNotMatch(evidence, /evidence_type: "public_identity"/);
  assert.doesNotMatch(evidence, /evidence_type: "company_document"/);
});

test("veriff session creation rejects non-individual v2 accounts", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/onboarding/kyc.functions.ts"),
    "utf8",
  );
  assert.match(source, /only available for Individual accounts/);
  assert.match(source, /requiresVeriff/);
});

test("completion endpoints are version-gated in both directions", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/onboarding/progress.functions.ts"),
    "utf8",
  );
  assert.match(source, /v2 accounts must complete route-specific onboarding/);
  assert.match(source, /only available to v2 accounts/);
  assert.match(source, /Individual accounts require approved Veriff verification/);
  assert.match(source, /verification_badge/);
});
