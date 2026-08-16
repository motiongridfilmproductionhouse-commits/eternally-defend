/**
 * Controlled-test fixture detection.
 *
 * Enforcement fixtures (eterna-enforcement-test.invalid and any RFC-2606
 * reserved host) are preserved in the database for audit and worker testing,
 * but they must never surface in a customer-facing dashboard. This filter is
 * applied inside server functions — it is a presentation-hygiene filter layered
 * on top of the real security boundary (RLS + auth.uid() ownership), never a
 * replacement for it.
 */
const FIXTURE_HOST_PATTERNS = [
  "eterna-enforcement-test.invalid",
  ".invalid",
  ".test",
  ".example",
  "example.com",
  "localhost",
];

export function isTestFixtureTarget(
  value: { domain?: string | null; target_url?: string | null } | null | undefined,
): boolean {
  if (!value) return false;
  const haystack = `${value.domain ?? ""} ${value.target_url ?? ""}`.toLowerCase();
  if (!haystack.trim()) return false;
  return FIXTURE_HOST_PATTERNS.some((p) => haystack.includes(p));
}

/** Removes controlled-test fixture rows from a customer-facing collection. */
export function excludeTestFixtures<T extends { domain?: string | null; target_url?: string | null }>(
  rows: T[],
): T[] {
  return rows.filter((row) => !isTestFixtureTarget(row));
}
