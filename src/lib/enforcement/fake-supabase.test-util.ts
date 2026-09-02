/**
 * Minimal in-memory Supabase stand-in used ONLY by enforcement pipeline tests.
 * Supports the subset of the query builder the enforcement worker/orchestrator
 * uses: select/eq/in/gte/lte/neq/order/limit/single/maybeSingle, insert,
 * update, upsert, count queries and rpc.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test double mimics the untyped Supabase builder */

type Row = Record<string, unknown>;
type Filter = { op: string; col: string; val: unknown };

let seq = 0;
const uid = () => `id-${++seq}`;

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.col];
    switch (f.op) {
      case "eq":
        return v === f.val;
      case "neq":
        return v !== f.val;
      case "in":
        return Array.isArray(f.val) && (f.val as unknown[]).includes(v);
      case "gte":
        return String(v ?? "") >= String(f.val);
      case "lte":
        return String(v ?? "") <= String(f.val);
      case "not":
        return v !== null && v !== undefined;
      default:
        return true;
    }
  });
}

export interface FakeDb {
  tables: Record<string, Row[]>;
  from: (table: string) => any;
  rpc: (name: string, args?: Row) => Promise<{ data: unknown; error: null }>;
  insertErrorTables: Set<string>;
}

export function createFakeSupabase(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const insertErrorTables = new Set<string>();

  const rowsOf = (t: string) => (tables[t] ??= []);

  function builder(table: string) {
    const filters: Filter[] = [];
    let limitN: number | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let countMode = false;

    const run = () => {
      let rows = rowsOf(table).filter((r) => matches(r, filters));
      if (orderCol) {
        rows = [...rows].sort((a, b) => {
          const x = String(a[orderCol as string] ?? "");
          const y = String(b[orderCol as string] ?? "");
          return orderAsc ? x.localeCompare(y) : y.localeCompare(x);
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return rows;
    };

    const api: any = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) countMode = true;
        return api;
      },
      eq: (col: string, val: unknown) => (filters.push({ op: "eq", col, val }), api),
      neq: (col: string, val: unknown) => (filters.push({ op: "neq", col, val }), api),
      in: (col: string, val: unknown[]) => (filters.push({ op: "in", col, val }), api),
      gte: (col: string, val: unknown) => (filters.push({ op: "gte", col, val }), api),
      lte: (col: string, val: unknown) => (filters.push({ op: "lte", col, val }), api),
      not: (col: string) => (filters.push({ op: "not", col, val: null }), api),
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return api;
      },
      limit: (n: number) => ((limitN = n), api),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const r = run()[0];
        return r ? { data: r, error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (resolve: (v: unknown) => void) => {
        const rows = run();
        return Promise.resolve(
          resolve(
            countMode
              ? { data: null, count: rows.length, error: null }
              : { data: rows, error: null },
          ),
        );
      },
      insert: (payload: Row | Row[]) => {
        const list = Array.isArray(payload) ? payload : [payload];
        const inserted: Row[] = [];
        if (!insertErrorTables.has(table)) {
          for (const p of list) {
            const row = { id: uid(), created_at: new Date().toISOString(), ...p };
            rowsOf(table).push(row);
            inserted.push(row);
          }
        }
        const err = insertErrorTables.has(table)
          ? { message: `simulated insert failure on ${table}` }
          : null;
        const res: any = {
          select: () => res,
          single: async () => ({ data: inserted[0] ?? null, error: err }),
          maybeSingle: async () => ({ data: inserted[0] ?? null, error: err }),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve(resolve({ data: inserted, error: err })),
        };
        return res;
      },
      update: (patch: Row) => {
        const upFilters: Filter[] = [];
        const res: any = {
          eq: (col: string, val: unknown) => (upFilters.push({ op: "eq", col, val }), res),
          in: (col: string, val: unknown[]) => (upFilters.push({ op: "in", col, val }), res),
          select: () => res,
          maybeSingle: async () => {
            const updated = applyUpdate();
            return { data: updated[0] ?? null, error: null };
          },
          single: async () => {
            const updated = applyUpdate();
            return { data: updated[0] ?? null, error: null };
          },
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve(resolve({ data: applyUpdate(), error: null })),
        };
        const applyUpdate = () => {
          const hit = rowsOf(table).filter((r) => matches(r, upFilters));
          hit.forEach((r) => Object.assign(r, patch));
          return hit;
        };
        return res;
      },
      upsert: (payload: Row) => {
        const res: any = {
          then: (resolve: (v: unknown) => void) => {
            const existing = rowsOf(table).find((r) => r["domain"] === payload["domain"]);
            if (!existing) rowsOf(table).push({ id: uid(), ...payload });
            return Promise.resolve(resolve({ data: null, error: null }));
          },
        };
        return res;
      },
    };
    return api;
  }

  return {
    tables,
    insertErrorTables,
    from: (table: string) => builder(table),
    rpc: async (name: string) => {
      // Force the worker's tenant-safe fallback claim path.
      if (name === "claim_next_enforcement_job") return { data: null, error: null };
      return { data: null, error: null };
    },
  };
}
