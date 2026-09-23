import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  accountTypeForIdentity,
  identitySnapshotOf,
  planFindingImports,
  planProfilePrefill,
  type ImportSourceFinding,
} from "./enrollment";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: null }));

/* ------------------------------------------------------------------ */
/* Minimal in-memory Supabase fake (only what the consumer uses).       */
/* ------------------------------------------------------------------ */
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
const UNIQUE: Record<string, string[]> = {
  client_prospect_findings: ["client_user_id", "prospect_finding_id"],
};
let seq = 0;

function fakeDb(tables: Tables) {
  const from = (table: string) => {
    tables[table] ??= [];
    let filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "update" | "upsert" | "insert" = "select";
    let patch: Row = {};
    let payload: Row[] = [];
    let cols = "*";
    let head = false;
    let wantCount = false;
    let ignoreDup = false;

    const withJoins = (r: Row): Row => {
      if (!cols.includes("discovery:prospect_discoveries")) return { ...r };
      const d = (tables.prospect_discoveries ?? []).find((x) => x.id === r.discovery_id) ?? null;
      return { ...r, discovery: d };
    };
    const run = () => {
      const rows = tables[table];
      if (mode === "select") {
        const hit = rows.filter((r) => filters.every((f) => f(r))).map(withJoins);
        return { data: head ? null : hit, count: wantCount ? hit.length : null, error: null };
      }
      if (mode === "update") {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        for (const r of hit) Object.assign(r, patch);
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      const key = UNIQUE[table];
      const inserted: Row[] = [];
      for (const p of payload) {
        const dup = key && rows.find((r) => key.every((k) => r[k] === p[k]));
        if (dup) {
          if (ignoreDup || mode === "upsert") continue;
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        const row = { id: `row-${++seq}`, created_at: new Date(seq * 1000).toISOString(), ...p };
        rows.push(row);
        inserted.push({ ...row });
      }
      return { data: inserted, error: null };
    };

    const q: Record<string, unknown> = {
      select(c = "*", opts?: { count?: string; head?: boolean }) {
        cols = c;
        if (mode === "select") {
          head = Boolean(opts?.head);
          wantCount = Boolean(opts?.count);
        }
        return q;
      },
      eq(col: string, v: unknown) {
        filters.push((r) => r[col] === v);
        return q;
      },
      is(col: string, v: unknown) {
        filters.push((r) => (r[col] ?? null) === v);
        return q;
      },
      in(col: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[col]));
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      update(p: Row) {
        mode = "update";
        patch = p;
        return q;
      },
      upsert(p: Row | Row[], o?: { ignoreDuplicates?: boolean }) {
        mode = "upsert";
        payload = Array.isArray(p) ? p : [p];
        ignoreDup = Boolean(o?.ignoreDuplicates);
        return q;
      },
      insert(p: Row | Row[]) {
        mode = "insert";
        payload = Array.isArray(p) ? p : [p];
        return q;
      },
      maybeSingle: async () => {
        const r = run();
        return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
      },
      single: async () => {
        const r = run();
        return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        try {
          return Promise.resolve(run()).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).then(resolve, reject);
        }
      },
    };
    filters = [];
    return q;
  };
  return { from };
}

function seed(): Tables {
  return {
    prospect_enrollment_packages: [
      {
        id: "pkg1",
        scan_id: "scan1",
        prospect_id: "p1",
        client_user_id: "client1",
        status: "LINKED",
        profile_prefilled_at: null,
        applied_at: null,
        created_at: "2026-09-24T00:00:00Z",
        identity_snapshot: identitySnapshotOf({
          id: "p1",
          display_name: "Asha Menon",
          identity_type: "celebrity",
          country_region: "India",
          known_profile_url: "https://instagram.com/asha.official",
          known_website: "https://asha.example",
          aliases: ["Asha M"],
          known_handles: ["@asha.official"],
          known_works: ["Film One"],
          linked_entities: ["Studio Nine"],
        }),
      },
    ],
    client_profiles: [
      {
        user_id: "client1",
        display_name: "Asha (typed by client)",
        company_name: null,
        country: null,
        website: null,
        onboarding_account_type: "celebrity",
        social_profiles: { aliases: ["A. Menon"], photo_url: "x.png" },
      },
    ],
    prospect_enrollment_transfers: [
      {
        scan_id: "scan1",
        finding_id: null,
        target_table: "enrollment_identity",
        target_user_id: null,
      },
      {
        scan_id: "scan1",
        finding_id: "f1",
        target_table: "enrollment_finding",
        target_user_id: null,
      },
      {
        scan_id: "scan1",
        finding_id: "f2",
        target_table: "enrollment_finding",
        target_user_id: null,
      },
    ],
    prospect_findings: [
      {
        id: "f1",
        scan_id: "scan1",
        discovery_id: "d1",
        state: "VERIFIED",
        stage_key: "impersonation",
        category: "Possible impersonation",
        severity: "7",
        detection_reason: "Handle mimics official account",
        confidence: 82,
        verified_by: "staff1",
        verified_at: "2026-09-23T10:00:00Z",
      },
      {
        id: "f2",
        scan_id: "scan1",
        discovery_id: "d2",
        state: "ESCALATED",
        stage_key: "harmful_content",
        category: "Potential reputation risk",
        severity: "6",
        detection_reason: "Unverified allegation",
        confidence: 70,
        verified_by: "staff1",
        verified_at: "2026-09-23T10:05:00Z",
      },
    ],
    prospect_discoveries: [
      {
        id: "d1",
        original_url: "https://instagram.com/asha.offcial",
        canonical_url: "instagram.com/asha.offcial",
        platform: "Instagram",
        title: "asha.offcial",
        discovery_method: "WEB_SEARCH",
        identity_bucket: "MATCHED",
        identity_confidence: 88,
      },
      {
        id: "d2",
        original_url: "https://news.example/story",
        canonical_url: "news.example/story",
        platform: "Web",
        title: "Story",
        discovery_method: "WEB_SEARCH",
        identity_bucket: "MATCHED",
        identity_confidence: 91,
      },
    ],
    prospect_finding_evidence: [
      {
        id: "e1",
        finding_id: "f1",
        source_url: "https://instagram.com/asha.offcial",
        capture_path: null,
        capture_kind: "search_metadata",
        content_hash: "abc",
        observed_at: "2026-09-23T09:00:00Z",
      },
    ],
    client_prospect_findings: [],
  };
}

describe("enrollment consumption — pure planning", () => {
  it("maps identity type to an onboarding account type", () => {
    expect(accountTypeForIdentity("brand")).toBe("enterprise");
    expect(accountTypeForIdentity("executive")).toBe("individual");
    expect(accountTypeForIdentity("public_figure")).toBe("celebrity");
  });

  it("pre-fill never overwrites client-entered values and preserves prospect_scan_id", () => {
    const t = seed();
    const pkg = t.prospect_enrollment_packages[0];
    const update = planProfilePrefill(
      t.client_profiles[0],
      pkg.identity_snapshot as ReturnType<typeof identitySnapshotOf>,
      { packageId: "pkg1", prospectScanId: "scan1" },
    );
    expect(update.display_name).toBeUndefined(); // client already typed one
    expect(update.country).toBe("India");
    expect(update.website).toBe("https://asha.example");
    const social = update.social_profiles as Record<string, unknown>;
    expect(social.aliases).toEqual(["A. Menon", "Asha M"]);
    expect(social.handles).toEqual(["@asha.official"]);
    expect(social.photo_url).toBe("x.png");
    expect(social.links).toEqual([
      expect.objectContaining({ url: "https://instagram.com/asha.official" }),
    ]);
    expect(social.pre_enrollment).toEqual(
      expect.objectContaining({
        prospect_scan_id: "scan1",
        known_works: ["Film One"],
        linked_entities: ["Studio Nine"],
      }),
    );
  });

  it("imports only transferred, verified, identity-matched findings, with evidence refs", () => {
    const t = seed();
    const findings = t.prospect_findings.map((f) => ({
      ...f,
      discovery: t.prospect_discoveries.find((d) => d.id === f.discovery_id),
    })) as unknown as ImportSourceFinding[];
    findings.push({ ...findings[0], id: "f3", state: "NEEDS_HUMAN_REVIEW" });
    const rows = planFindingImports({
      clientUserId: "client1",
      packageId: "pkg1",
      transferredFindingIds: ["f1", "f2", "f3"],
      findings,
      evidence: t.prospect_finding_evidence as never,
      alreadyImported: ["f2"],
    });
    expect(rows.map((r) => r.prospect_finding_id)).toEqual(["f1"]);
    expect(rows[0].prospect_scan_id).toBe("scan1");
    expect(rows[0].evidence_refs).toEqual([
      expect.objectContaining({ evidence_id: "e1", content_hash: "abc" }),
    ]);
  });
});

describe("enrollment consumption — apply (idempotent)", () => {
  it("delivers identity + findings once; a second trigger never duplicates", async () => {
    const { applyPreEnrollmentPackagesForUser } = await import("./enrollment-consume.server");
    const tables = seed();
    const db = fakeDb(tables);

    const first = await applyPreEnrollmentPackagesForUser("client1", db);
    expect(first).toEqual({ packages: 1, profilePrefilled: 1, findingsImported: 2 });
    const second = await applyPreEnrollmentPackagesForUser("client1", db);
    expect(second).toEqual({ packages: 1, profilePrefilled: 0, findingsImported: 0 });

    expect(tables.client_prospect_findings).toHaveLength(2);
    expect(new Set(tables.client_prospect_findings.map((r) => r.prospect_finding_id))).toEqual(
      new Set(["f1", "f2"]),
    );
    for (const r of tables.client_prospect_findings) {
      expect(r.prospect_scan_id).toBe("scan1");
      expect(r.client_user_id).toBe("client1");
    }
    const profile = tables.client_profiles[0];
    expect(profile.display_name).toBe("Asha (typed by client)");
    expect((profile.social_profiles as Row).pre_enrollment).toEqual(
      expect.objectContaining({ prospect_scan_id: "scan1", package_id: "pkg1" }),
    );
    const pkg = tables.prospect_enrollment_packages[0];
    expect(pkg.status).toBe("APPLIED");
    expect(pkg.findings_imported).toBe(2);
    expect(tables.prospect_enrollment_transfers.every((t) => t.target_user_id === "client1")).toBe(
      true,
    );
  });

  it("waits for the onboarding profile row before pre-filling, then completes", async () => {
    const { applyPreEnrollmentPackagesForUser } = await import("./enrollment-consume.server");
    const tables = seed();
    const profile = tables.client_profiles.pop()!;
    const db = fakeDb(tables);
    const early = await applyPreEnrollmentPackagesForUser("client1", db);
    expect(early.profilePrefilled).toBe(0);
    expect(tables.prospect_enrollment_packages[0].status).toBe("LINKED");
    tables.client_profiles.push(profile);
    const later = await applyPreEnrollmentPackagesForUser("client1", db);
    expect(later.profilePrefilled).toBe(1);
    expect(later.findingsImported).toBe(0); // already imported on the first call
    expect(tables.prospect_enrollment_packages[0].status).toBe("APPLIED");
  });

  it("does nothing for a client with no linked package", async () => {
    const { applyPreEnrollmentPackagesForUser } = await import("./enrollment-consume.server");
    const tables = seed();
    const out = await applyPreEnrollmentPackagesForUser("someone-else", fakeDb(tables));
    expect(out).toEqual({ packages: 0, profilePrefilled: 0, findingsImported: 0 });
    expect(tables.client_prospect_findings).toHaveLength(0);
  });
});

describe("imported findings never reach enforcement", () => {
  const root = join(__dirname, "..", "..", "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });

  it("client_prospect_findings is referenced only by the prospect hand-off code", () => {
    const allowed = [/src\/lib\/prospect\//];
    const offenders = walk(join(root, "src"))
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith("types.ts"))
      .filter((f) => readFileSync(f, "utf8").includes("client_prospect_findings"))
      .filter((f) => !allowed.some((re) => re.test(f)));
    expect(offenders).toEqual([]);
  });

  it("imported rows can never be marked enforcement-eligible (DB constraint)", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/20260924090000_prospect_enrollment_consumption.sql"),
      "utf8",
    );
    expect(sql).toMatch(
      /enforcement_eligible boolean NOT NULL DEFAULT false CHECK \(enforcement_eligible = false\)/,
    );
    expect(sql).toMatch(/UNIQUE \(client_user_id, prospect_finding_id\)/);
    expect(sql).toMatch(/scan_id uuid NOT NULL UNIQUE/);
  });
});
