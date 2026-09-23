/**
 * Pre-Enrollment Intelligence — runtime source availability.
 *
 * Resolves, per source family, whether the backend can actually query it right
 * now. Nothing is assumed: a family is only "queryable" when its credentials
 * exist and product policy allows it. Families we cannot query directly stay
 * UNAVAILABLE forever in the rail — URLs from those platforms may still be
 * stored when a web search returns them, with discovery_method "Web Search".
 */

import {
  SOURCE_FAMILIES,
  type SourceFamily,
  type SourceFamilyKey,
} from "./source-registry";
import type { SourceState } from "./coverage";

export interface FamilyAvailability {
  family: SourceFamily;
  key: SourceFamilyKey;
  label: string;
  queryable: boolean;
  /** Initial state written to prospect_scan_sources. */
  initialState: SourceState;
  reason: string | null;
  providersConfigured: string[];
}

function hasSecret(name: string): boolean {
  const value = process.env[name];
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(false|0|off|no)$/i.test(trimmed)) return false;
  return true;
}

export function resolveFamilyAvailability(): FamilyAvailability[] {
  return SOURCE_FAMILIES.map((family) => {
    const base = {
      family,
      key: family.key,
      label: family.label,
      providersConfigured: [] as string[],
    };

    if (!family.policyEnabled) {
      return {
        ...base,
        queryable: false,
        initialState: "policy_disabled" as SourceState,
        reason: family.policyReason ?? "Disabled by product policy",
      };
    }

    if (!family.directAccess) {
      return {
        ...base,
        queryable: false,
        initialState: "unavailable" as SourceState,
        reason: family.unavailableReason ?? "No permitted API access configured",
      };
    }

    const missingRequired = family.requiresSecrets.filter((secret) => !hasSecret(secret));
    const anyList = family.requiresAnySecret ?? [];
    const anySatisfied = anyList.length === 0 || anyList.some((secret) => hasSecret(secret));

    if (missingRequired.length > 0 || !anySatisfied) {
      return {
        ...base,
        queryable: false,
        initialState: "unavailable" as SourceState,
        reason:
          missingRequired.length > 0
            ? "Credential not configured"
            : "No configured provider for this source",
      };
    }

    return {
      ...base,
      queryable: true,
      initialState: "not_scanned" as SourceState,
      reason: null,
      providersConfigured: family.providers,
    };
  });
}

export function availabilityByKey(): Map<SourceFamilyKey, FamilyAvailability> {
  const map = new Map<SourceFamilyKey, FamilyAvailability>();
  for (const entry of resolveFamilyAvailability()) map.set(entry.key, entry);
  return map;
}
