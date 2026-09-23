import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { planEnrollmentTransfer } from "./enrollment";

describe("planEnrollmentTransfer", () => {
  const findings = [
    { id: "f1", discovery_id: "d1", state: "VERIFIED" },
    { id: "f2", discovery_id: "d2", state: "NEEDS_HUMAN_REVIEW" },
    { id: "f3", discovery_id: "d3", state: "VERIFIED" },
  ];
  const discoveries = [
    { id: "d1", identity_bucket: "MATCHED" },
    { id: "d2", identity_bucket: "MATCHED" },
    { id: "d3", identity_bucket: "POSSIBLE_MATCH" },
  ];

  it("only transfers verified findings on identity-matched items", () => {
    const plan = planEnrollmentTransfer({
      selectedIds: ["f1", "f2", "f3"],
      findings,
      discoveries,
      existing: [],
    });
    expect(plan.toTransfer).toEqual(["f1"]);
    expect(plan.rejected.sort()).toEqual(["f2", "f3"]);
    expect(plan.includeIdentity).toBe(true);
  });

  it("is idempotent: a repeat hand-off never duplicates findings or the identity package", () => {
    const existing = [
      { finding_id: null, target_table: "enrollment_identity" },
      { finding_id: "f1", target_table: "enrollment_finding" },
    ];
    const plan = planEnrollmentTransfer({
      selectedIds: ["f1", "f1"],
      findings,
      discoveries,
      existing,
    });
    expect(plan.toTransfer).toEqual([]);
    expect(plan.alreadyTransferred).toEqual(["f1"]);
    expect(plan.includeIdentity).toBe(false);
  });
});

/* Structural safety: prospect intelligence can never reach enforcement. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("prospect / enforcement separation", () => {
  const root = join(__dirname, "..", "..", "..");

  it("no enforcement, takedown or removal code imports prospect modules", () => {
    const enforcementDirs = [
      join(root, "src/lib/enforcement"),
      join(root, "services/enforcement-worker/src"),
    ];
    const offenders: string[] = [];
    for (const dir of enforcementDirs) {
      let files: string[] = [];
      try {
        files = walk(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (
          /lib\/prospect|prospect_(scans|findings|discoveries|identities)/.test(
            readFileSync(f, "utf8"),
          )
        )
          offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("prospect modules never import enforcement, takedown or complaint code", () => {
    const offenders = walk(join(root, "src/lib/prospect"))
      .filter((f) => !f.endsWith(".test.ts"))
      .filter((f) =>
        /from\s+["']@\/lib\/(enforcement|removal|takedown|youtube-removal|sensitive-protection)|complaint-(engine|draft)|platform-submission|automation\//.test(
          readFileSync(f, "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("no source file hardcodes staff authorization to an email address", () => {
    const safeWalk = (d: string) => {
      try {
        return walk(d);
      } catch {
        return [];
      }
    };
    const files = [
      ...safeWalk(join(root, "src/lib/prospect")),
      ...safeWalk(join(root, "src/components/staff")),
      ...safeWalk(join(root, "src/routes")),
    ].filter((f) => !f.endsWith(".test.ts"));
    const offenders = files.filter(
      (f) => /staff|prospect/i.test(f) && /hellosreehari@gmail\.com/i.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
