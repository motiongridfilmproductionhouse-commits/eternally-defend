/**
 * CONTROLLED REAL-DATA VALIDATION — DRY RUN ONLY.
 *
 * Runs the authoritative-evidence discovery pipeline against real production
 * DISCOVERED_UNVERIFIED domains. It never writes to production: storage is
 * exercised only against an in-memory fake supabase client.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import {
  discoverOnDomainCopyrightContact,
  recordDiscoveredRouteCandidate,
} from "../../src/lib/enforcement/contact-discovery.server";

const DOMAINS = (process.argv[2] ?? "").split(",").filter(Boolean);

function fakeSupabase(rows: any[] = []) {
  const state = { rows };
  return {
    state,
    from() {
      const filters: Array<(r: any) => boolean> = [];
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: any) => (filters.push((r) => r[c] === v), builder),
        in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), builder),
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({
          data: state.rows.find((r) => filters.every((f) => f(r))) ?? null,
          error: null,
        }),
        insert: async (p: any) => (state.rows.push({ id: `id-${state.rows.length + 1}`, ...p }), { error: null }),
        update: (p: any) => ({
          eq: async (c: string, v: any) => {
            for (const r of state.rows) if (r[c] === v) Object.assign(r, p);
            return { error: null };
          },
        }),
        then: (res: any) => res({ data: state.rows.filter((r) => filters.every((f) => f(r))), error: null }),
      };
      return builder;
    },
  } as any;
}

const out: any[] = [];

for (const domain of DOMAINS) {
  const res = await discoverOnDomainCopyrightContact(`https://${domain}/`);

  // Storage rehearsal against an in-memory table (never production).
  const db = fakeSupabase();
  const first = await recordDiscoveredRouteCandidate({ supabase: db, result: res });
  const second = await recordDiscoveredRouteCandidate({ supabase: db, result: res });
  const verifiedDb = fakeSupabase([
    { id: "op", domain, verification_status: "VERIFIED", recipient_email: `legal@${domain}` },
  ]);
  const skipped = await recordDiscoveredRouteCandidate({ supabase: verifiedDb, result: res });

  out.push({
    domain,
    found: res.found,
    recipient: res.candidate?.email ?? null,
    evidenceUrl: res.evidenceUrl,
    pageKind: res.pageKind,
    methodCandidate: res.methodCandidate,
    confidence: res.confidence,
    signals: res.signals,
    excerpt: (res.evidenceExcerpt ?? "").slice(0, 260),
    pagesInspected: res.pagesInspected,
    rejected: res.rejected.map((r) => ({ email: r.email, reasons: r.reasons })),
    skippedReason: res.skippedReason,
    storage: {
      firstWrite: first,
      secondWrite: second,
      rowsAfterTwoRuns: db.state.rows.length,
      status: db.state.rows[0]?.verification_status ?? null,
      verifiedAt: db.state.rows[0]?.verified_at ?? null,
      historyLen: db.state.rows[0]?.evidence_snapshot?.evidence_history?.length ?? 0,
      operatorRowSkipped: skipped,
      operatorRowRecipientUnchanged: verifiedDb.state.rows[0]?.recipient_email,
    },
  });
  console.log(JSON.stringify(out.at(-1), null, 1));
}

console.log("\n=== SUMMARY ===");
for (const r of out) {
  console.log(
    [
      r.domain,
      r.pageKind ?? "-",
      r.recipient ?? "-",
      r.confidence,
      (r.signals[0] ?? "-").slice(0, 60),
      r.rejected.map((x: any) => x.email).join("|") || "-",
      r.found ? "candidate" : "no-candidate",
    ].join(" | "),
  );
}
