/**
 * End-to-end invite-gate verification against the live backend.
 * Read/write is confined to signup_invites* rows and throwaway auth users it creates
 * and deletes. Does not touch onboarding, protection or enforcement data.
 *
 *   node --import tsx scripts/invite-gate-e2e.ts
 */
import { createHash, randomUUID } from "crypto";

const URL_ = process.env["SUPABASE_URL"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const ANON = process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"]!;

const svc = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });

const hash = (code: string) =>
  createHash("sha256").update(`${process.env["INVITE_CODE_PEPPER"] ?? ""}:${code.toUpperCase()}`).digest("hex");

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` :: ${detail}` : ""}`);
}

async function makeInvite(fields: Record<string, unknown>) {
  const code = `ETRN-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  const r = await svc("/rest/v1/signup_invites", {
    method: "POST",
    body: JSON.stringify({ code_hash: hash(code), label: "e2e-test", ...fields }),
  });
  const [row] = await r.json();
  return { code, row };
}

async function claim(code: string, email: string) {
  const r = await svc("/rest/v1/rpc/claim_signup_invite", {
    method: "POST",
    body: JSON.stringify({ _code_hash: hash(code), _email: email.toLowerCase() }),
  });
  const body = await r.json();
  return Array.isArray(body) ? body : [];
}

async function getInvite(id: string) {
  const r = await svc(`/rest/v1/signup_invites?id=eq.${id}&select=*`);
  const [row] = await r.json();
  return row;
}

async function cleanup(ids: string[]) {
  for (const id of ids) await svc(`/rest/v1/signup_invites?id=eq.${id}`, { method: "DELETE" });
}

async function main() {
  const created: string[] = [];

  // 1. valid code → claim succeeds and consumes exactly one use
  {
    const { code, row } = await makeInvite({ max_uses: 1 });
    created.push(row.id);
    const claimed = await claim(code, "valid@e2e.test");
    const after = await getInvite(row.id);
    check("valid code claims and increments use_count", claimed.length === 1 && after.use_count === 1);

    // 2. max-use code blocked after limit
    const again = await claim(code, "valid@e2e.test");
    check("max-use code blocked after limit", again.length === 0);

    // 3. release restores the use when account creation fails
    await svc("/rest/v1/rpc/release_signup_invite", {
      method: "POST",
      body: JSON.stringify({ _invite_id: row.id }),
    });
    const released = await getInvite(row.id);
    check("failed signup releases the invite use", released.use_count === 0);
  }

  // 4. invalid code
  check("unknown code rejected", (await claim("ETRN-NOPE-NOPE-NOPE", "x@e2e.test")).length === 0);

  // 5. expired code
  {
    const { code, row } = await makeInvite({
      max_uses: 5,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    created.push(row.id);
    check("expired code rejected", (await claim(code, "x@e2e.test")).length === 0);
  }

  // 6. revoked code
  {
    const { code, row } = await makeInvite({ max_uses: 5, status: "revoked" });
    created.push(row.id);
    check("revoked code rejected", (await claim(code, "x@e2e.test")).length === 0);
  }

  // 7. email-bound code
  {
    const { code, row } = await makeInvite({ max_uses: 5, assigned_email: "bound@e2e.test" });
    created.push(row.id);
    check("email-bound code rejects another email", (await claim(code, "other@e2e.test")).length === 0);
    check("email-bound code accepts its own email", (await claim(code, "BOUND@e2e.test")).length === 1);
  }

  // 8. race condition: 8 simultaneous claims on max_uses = 3
  {
    const { code, row } = await makeInvite({ max_uses: 3 });
    created.push(row.id);
    const settled = await Promise.all(
      Array.from({ length: 8 }, (_, i) => claim(code, `race${i}@e2e.test`)),
    );
    const wins = settled.filter((s) => s.length === 1).length;
    const after = await getInvite(row.id);
    check(
      "simultaneous attempts cannot exceed max_uses",
      wins === 3 && after.use_count === 3,
      `wins=${wins} use_count=${after.use_count}`,
    );
  }

  // 9. direct signup API bypass is rejected (public signup disabled)
  {
    const r = await fetch(`${URL_}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: `bypass-${randomUUID()}@e2e.test`, password: "Sup3rSecret!23" }),
    });
    const body = await r.text();
    check("direct signup API bypass rejected", r.status >= 400, `${r.status} ${body.slice(0, 120)}`);
  }

  // 10. anon cannot read or write invitations
  {
    const read = await fetch(`${URL_}/rest/v1/signup_invites?select=code_hash`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    check("anon cannot list invitation codes", read.status >= 400, String(read.status));
    const rpc = await fetch(`${URL_}/rest/v1/rpc/claim_signup_invite`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ _code_hash: hash("ETRN-X"), _email: "a@b.c" }),
    });
    check("anon cannot call claim_signup_invite", rpc.status >= 400, String(rpc.status));
  }

  // 11. existing account sign-in unaffected by the gate
  {
    const email = `existing-${randomUUID()}@e2e.test`;
    const password = "Sup3rSecret!23";
    const mk = await svc("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const user = await mk.json();
    const login = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    check("existing user login unaffected (no invite required)", login.status === 200, String(login.status));
    if (user?.id) await svc(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
  }

  await cleanup(created);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
