/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverOnDomainCopyrightContact,
  recordDiscoveredRouteCandidate,
  reprocessDiscoveredRouteCandidates,
} from "./contact-discovery.server";

const DOMAIN = "indie-pirate.test";

const PAGES: Record<string, string> = {
  [`https://${DOMAIN}`]: `<html><body><a href="/dmca">DMCA</a><a href="/contact">Contact</a></body></html>`,
  [`https://${DOMAIN}/dmca`]: `<html><body><h1>DMCA Policy</h1>
    <p>General enquiries: support@${DOMAIN}</p>
    <p>Copyright infringement notices must be sent to <a href="mailto:dmca@${DOMAIN}">dmca@${DOMAIN}</a>.</p>
    </body></html>`,
  [`https://${DOMAIN}/contact`]: `<html><body><h1>Contact us</h1><p>support@${DOMAIN}</p></body></html>`,
};

function mockFetch(pages: Record<string, string>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const key = String(url).replace(/\/$/, "");
    const body = pages[key];
    if (!body) return { ok: false, status: 404, text: async () => "" } as any;
    return { ok: true, status: 200, text: async () => body } as any;
  });
}

/** Minimal in-memory stand-in for the routes table. */
function fakeSupabase(rows: any[] = []) {
  const state = { rows };
  const api = {
    state,
    from(_table: string) {
      const filters: Array<(r: any) => boolean> = [];
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: any) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        in: (col: string, vals: any[]) => {
          filters.push((r) => vals.includes(r[col]));
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({
          data: state.rows.find((r) => filters.every((f) => f(r))) ?? null,
          error: null,
        }),
        insert: async (payload: any) => {
          state.rows.push({ id: `id-${state.rows.length + 1}`, ...payload });
          return { error: null };
        },
        update: (payload: any) => {
          const b: any = {
            eq: async (col: string, val: any) => {
              for (const r of state.rows) if (r[col] === val) Object.assign(r, payload);
              return { error: null };
            },
          };
          return b;
        },
        then: (resolve: any) =>
          resolve({ data: state.rows.filter((r) => filters.every((f) => f(r))), error: null }),
      };
      return builder;
    },
  };
  return api as any;
}

beforeEach(() => mockFetch(PAGES));
afterEach(() => vi.unstubAllGlobals());

describe("authoritative discovery on a real-shaped site", () => {
  it("prefers the DMCA-page mailbox over the generic contact address", async () => {
    const res = await discoverOnDomainCopyrightContact(`https://${DOMAIN}/watch/movie`);
    expect(res.found).toBe(true);
    expect(res.candidate?.email).toBe(`dmca@${DOMAIN}`);
    expect(res.pageKind).toBe("DMCA");
    expect(res.methodCandidate).toBe("PUBLISHED_DMCA_PAGE");
    expect(res.evidenceUrl).toBe(`https://${DOMAIN}/dmca`);
    expect(res.evidenceExcerpt).toContain(`dmca@${DOMAIN}`);
    expect(res.confidence).toBeLessThan(1);
  });

  it("13. a failed website fetch never produces a candidate", async () => {
    mockFetch({});
    const res = await discoverOnDomainCopyrightContact(`https://${DOMAIN}/watch/movie`);
    expect(res.found).toBe(false);
    expect(res.candidate).toBeNull();
  });

  it("stores DISCOVERED_UNVERIFIED with evidence URL + excerpt", async () => {
    const db = fakeSupabase();
    const res = await discoverOnDomainCopyrightContact(`https://${DOMAIN}/watch/movie`);
    const out = await recordDiscoveredRouteCandidate({ supabase: db, result: res });
    expect(out.stored).toBe(true);
    const row = db.state.rows[0];
    expect(row.verification_status).toBe("DISCOVERED_UNVERIFIED");
    expect(row.verified_at).toBeNull();
    expect(row.verification_method).toBe("AUTOMATED_ON_DOMAIN_DISCOVERY");
    expect(row.authoritative_source_url).toBe(`https://${DOMAIN}/dmca`);
    expect(row.evidence_snapshot.evidence_url).toBe(`https://${DOMAIN}/dmca`);
    expect(row.evidence_snapshot.authoritative_page_kind).toBe("DMCA");
    expect(row.evidence_snapshot.verification_method_candidate).toBe("PUBLISHED_DMCA_PAGE");
    expect(row.confidence).toBeLessThanOrEqual(0.5);
  });

  it("9. reprocessing the same domain is idempotent and keeps history", async () => {
    const db = fakeSupabase();
    const res = await discoverOnDomainCopyrightContact(`https://${DOMAIN}/watch/movie`);
    await recordDiscoveredRouteCandidate({ supabase: db, result: res });
    await recordDiscoveredRouteCandidate({ supabase: db, result: res });
    expect(db.state.rows).toHaveLength(1);
    expect(db.state.rows[0].evidence_snapshot.evidence_history.length).toBe(1);
    expect(db.state.rows[0].verification_status).toBe("DISCOVERED_UNVERIFIED");
  });

  it("never overwrites an operator decision", async () => {
    const db = fakeSupabase([
      {
        id: "x",
        domain: DOMAIN,
        verification_status: "VERIFIED",
        recipient_email: `legal@${DOMAIN}`,
      },
    ]);
    const res = await discoverOnDomainCopyrightContact(`https://${DOMAIN}/watch/movie`);
    const out = await recordDiscoveredRouteCandidate({ supabase: db, result: res });
    expect(out.stored).toBe(false);
    expect(db.state.rows[0].recipient_email).toBe(`legal@${DOMAIN}`);
  });

  it("reprocess dry run writes nothing", async () => {
    const db = fakeSupabase([
      { id: "r1", domain: DOMAIN, verification_status: "DISCOVERED_UNVERIFIED", source_url: null },
    ]);
    const summary = await reprocessDiscoveredRouteCandidates({ supabase: db, dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.upgraded).toBe(1);
    expect(db.state.rows[0].evidence_snapshot).toBeUndefined();
  });

  it("reprocess write mode upgrades evidence but keeps the route unverified", async () => {
    const db = fakeSupabase([
      { id: "r1", domain: DOMAIN, verification_status: "DISCOVERED_UNVERIFIED", source_url: null },
    ]);
    const summary = await reprocessDiscoveredRouteCandidates({ supabase: db, dryRun: false });
    expect(summary.upgraded).toBe(1);
    expect(db.state.rows).toHaveLength(1);
    expect(db.state.rows[0].verification_status).toBe("DISCOVERED_UNVERIFIED");
    expect(db.state.rows[0].evidence_snapshot.authoritative_page_kind).toBe("DMCA");
  });
});
