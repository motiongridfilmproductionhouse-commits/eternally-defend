import assert from "node:assert/strict";
import test from "node:test";
import { buildAliases, buildQueryPlan, initialsOf } from "@/lib/business-reputation/identity-profile";

test("aliases and queries", () => {
  const input = { officialName: "Bright Star Dental Pvt Ltd", city: "Kochi", region: "Kerala", country: "India", executives: ["Dr A"], scope: "branch" as const };
  const a = buildAliases(input);
  assert.ok(a.some((x) => x.aliasType === "official"));
  assert.equal(initialsOf("Bright Star Dental Pvt Ltd"), "BSD");
  const q = buildQueryPlan(input);
  assert.ok(q.length > 20);
  assert.ok(q.every((x) => x.query.includes("Kochi") || x.query.includes("Dr A") || x.query.includes("Bright") || x.query.includes("BSD")));
  const brand = buildQueryPlan({ ...input, scope: "brand" });
  assert.ok(!brand[0]!.query.includes("Kochi"));
});
