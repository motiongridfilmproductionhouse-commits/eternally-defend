import type { AliasSource } from "./identity-types";
import { normalizeKey } from "./identity-knowledge.server";

export type StoredAlias = {
  alias: string;
  source: AliasSource;
  active: boolean;
};

/** Pure alias merge for unit tests (mirrors identity-profile.server rules). */
export function mergeAliasListsForTest(
  existing: StoredAlias[],
  incoming: Array<{ alias: string; source: AliasSource }>,
): StoredAlias[] {
  const map = new Map<string, StoredAlias>();
  for (const row of existing) {
    map.set(normalizeKey(row.alias) || row.alias, row);
  }
  for (const row of incoming) {
    const key = normalizeKey(row.alias) || row.alias;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { alias: row.alias, source: row.source, active: true });
      continue;
    }
    if (prev.source === "reviewer_approved" || prev.source === "user_provided") continue;
    if (prev.source === "rejected") continue;
    map.set(key, { ...prev, alias: row.alias, source: row.source, active: true });
  }
  return [...map.values()];
}
