/**
 * Minimal in-memory Supabase-shaped mock for Phase 2 protection tests.
 * Not a full PostgREST reimplementation — just enough chainable
 * select/insert/update/upsert/delete + eq/in/order/limit/maybeSingle/single
 * behavior for the dispatch modules' query patterns, with real filtering so
 * tenant-isolation and idempotency assertions are meaningful rather than
 * hand-waved. Mirrors the spirit of src/lib/enforcement/auto-enforcement.test.ts's
 * createMockSupabase, generalized across many tables instead of one.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export interface MockCall {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

export function createMockSupabase(initial: Record<string, Row[]> = {}) {
  const store: Record<string, Row[]> = {};
  for (const [table, rows] of Object.entries(initial)) {
    store[table] = rows.map((r) => ({ ...r }));
  }
  const calls: MockCall[] = [];
  let nextId = 1;
  const genId = () => `mock-${nextId++}`;

  function from(table: string) {
    if (!store[table]) store[table] = [];
    let filtered = store[table];
    let selectOpts: { count?: string; head?: boolean } | undefined;

    let orderKey: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    // update()/delete() must NOT mutate immediately — in real supabase-js
    // (and here) .eq()/.in()/etc. filters are chained AFTER .update()/
    // .delete() and narrow what the mutation targets. Applying eagerly at
    // .update()-call time (before those filters run) would mutate every row
    // in the table instead of just the matched ones. So the mutation is
    // deferred and only applied once a terminal method resolves the chain,
    // by which point all chained filters have already narrowed `filtered`.
    let pendingUpdate: Row | null = null;
    let pendingDelete = false;

    const applyOrderLimit = (rows: Row[]) => {
      let out = rows;
      if (orderKey) {
        out = [...out].sort((a, b) => {
          const av = a[orderKey as string];
          const bv = b[orderKey as string];
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (orderAsc ? 1 : -1);
        });
      }
      if (limitN !== null) out = out.slice(0, limitN);
      return out;
    };

    const applyPendingMutation = () => {
      if (pendingUpdate) {
        const patch = pendingUpdate;
        pendingUpdate = null;
        const targetIds = new Set(filtered.map((r) => r.id));
        // Mirrors trg_scan_module_enrollments_updated (and equivalent
        // triggers): every real UPDATE bumps updated_at, even when the
        // caller's patch doesn't mention it — needed to faithfully simulate
        // the claim's optimistic-concurrency check in tests.
        store[table] = store[table].map((r) =>
          targetIds.has(r.id)
            ? { ...r, ...patch, updated_at: patch.updated_at ?? new Date().toISOString() }
            : r,
        );
        filtered = store[table].filter((r) => targetIds.has(r.id));
      } else if (pendingDelete) {
        pendingDelete = false;
        const targetIds = new Set(filtered.map((r) => r.id));
        store[table] = store[table].filter((r) => !targetIds.has(r.id));
        filtered = [];
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        selectOpts = opts;
        calls.push({ table, op: "select" });
        return chain;
      },
      eq(col: string, val: unknown) {
        filtered = filtered.filter((r) => r[col] === val);
        return chain;
      },
      neq(col: string, val: unknown) {
        filtered = filtered.filter((r) => r[col] !== val);
        return chain;
      },
      in(col: string, vals: unknown[]) {
        filtered = filtered.filter((r) => vals.includes(r[col]));
        return chain;
      },
      lte(col: string, val: string) {
        filtered = filtered.filter((r) => r[col] !== undefined && r[col] <= val);
        return chain;
      },
      not(_col: string, _op: string, _val: string) {
        return chain;
      },
      or(_expr: string) {
        return chain;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderKey = col;
        orderAsc = opts?.ascending ?? true;
        return chain;
      },
      limit(n: number) {
        limitN = n;
        return chain;
      },
      async maybeSingle() {
        applyPendingMutation();
        const rows = applyOrderLimit(filtered);
        if (selectOpts?.count === "exact" && selectOpts.head) {
          return { data: null, count: rows.length, error: null };
        }
        return { data: rows[0] ?? null, error: null };
      },
      async single() {
        applyPendingMutation();
        const rows = applyOrderLimit(filtered);
        return { data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } };
      },
      insert(payload: Row | Row[]) {
        calls.push({ table, op: "insert", payload });
        const rows = Array.isArray(payload) ? payload : [payload];
        const inserted = rows.map((r) => ({
          id: r.id ?? genId(),
          created_at: new Date().toISOString(),
          ...r,
        }));
        store[table].push(...inserted);
        filtered = inserted;
        return chain;
      },
      update(patch: Row) {
        calls.push({ table, op: "update", payload: patch });
        pendingUpdate = patch;
        return chain;
      },
      upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
        calls.push({ table, op: "upsert", payload });
        const rows = Array.isArray(payload) ? payload : [payload];
        const conflictCols = (opts?.onConflict ?? "id").split(",");
        for (const row of rows) {
          const existingIdx = store[table].findIndex((r) =>
            conflictCols.every((c) => r[c] === row[c]),
          );
          if (existingIdx >= 0) {
            store[table][existingIdx] = { ...store[table][existingIdx], ...row };
          } else {
            store[table].push({ id: row.id ?? genId(), ...row });
          }
        }
        filtered = store[table];
        return chain;
      },
      delete() {
        calls.push({ table, op: "delete" });
        pendingDelete = true;
        return chain;
      },
      // Resolve as a thenable so `await supabase.from(t).select().eq(...)` (or
      // a bare .update()/.delete() chain with no terminal single()) without a
      // terminal maybeSingle()/single() call still works.
      then(resolve: (v: { data: Row[] | null; count?: number; error: null }) => void) {
        applyPendingMutation();
        const rows = applyOrderLimit(filtered);
        if (selectOpts?.count === "exact" && selectOpts.head) {
          resolve({ data: null, count: filtered.length, error: null });
          return;
        }
        resolve({ data: rows, error: null });
      },
    };
    return chain;
  }

  return {
    from,
    calls,
    _store: store,
  };
}
