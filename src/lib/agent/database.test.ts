import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createHash, randomBytes } from "node:crypto";
const db = new PGlite();
const agent = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const client = "00000000-0000-4000-8000-000000000003";
const admin = "00000000-0000-4000-8000-000000000004";
const secondClient = "00000000-0000-4000-8000-000000000005";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT null::uuid';
    CREATE TABLE public.client_profiles(user_id uuid PRIMARY KEY REFERENCES auth.users, onboarding_completed boolean DEFAULT false);
    CREATE TABLE public.onboarding_progress(user_id uuid PRIMARY KEY REFERENCES auth.users);
    CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql AS $$ SELECT u='${admin}'::uuid AND r='admin' $$;
    INSERT INTO auth.users VALUES ('${agent}'),('${other}'),('${client}'),('${admin}'),('${secondClient}');`);
  await db.exec(
    await readFile(
      new URL("../../../supabase/migrations/20260914120000_agent_assessments.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.query("INSERT INTO agent_memberships(user_id) VALUES ($1),($2)", [agent, other]);
});
after(async () => {
  await db.close();
});
async function create(actor: string, key: string) {
  const { rows } = await db.query<{ id: string }>(
    "SELECT agent_create_assessment($1,$2,$3,$4) AS id",
    [actor, "Test Artist", "https://artist.com/profile", key],
  );
  return rows[0].id;
}
async function ready(key: string) {
  const id = await create(agent, key);
  await db.query(
    `UPDATE agent_assessments SET status='READY',pricing='{"minimum":100,"maximum":200}' WHERE id=$1`,
    [id],
  );
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO agent_assessment_handoffs(assessment_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')`,
    [id, hash(token)],
  );
  return { id, token };
}
test("database rejects client creation and permits authorized agents", async () => {
  await assert.rejects(create(client, "unauthorized"), /Forbidden/);
  assert.ok(await create(agent, "authorized"));
});
test("same recent assessment is reused and rate limit is actor-scoped", async () => {
  assert.equal(await create(other, "duplicate"), await create(other, "duplicate"));
  for (let n = 0; n < 9; n++) await create(other, "limit-" + n);
  await assert.rejects(create(other, "limit-overflow"), /limit reached/);
});
test("authenticated and anonymous clients cannot read or mutate protected tables or invoke privileged RPCs", async () => {
  for (const role of ["authenticated", "anon"]) {
    await db.exec(`SET ROLE ${role}`);
    try {
      for (const table of [
        "agent_memberships",
        "agent_assessments",
        "agent_pricing_policy",
        "agent_assessment_handoffs",
        "agent_assessment_audit",
      ]) {
        await assert.rejects(db.query(`SELECT * FROM ${table}`), /permission denied/);
        await assert.rejects(db.query(`DELETE FROM ${table}`), /permission denied/);
      }
      await assert.rejects(create(agent, "direct"), /permission denied/);
      await assert.rejects(
        db.query("SELECT agent_claim_assessment($1,$2)", ["x", client]),
        /permission denied/,
      );
    } finally {
      await db.exec("RESET ROLE");
    }
  }
});
test("opaque token resolves once; same-client replay works, cross-client replay fails", async () => {
  const { id, token } = await ready("claim");
  const first = await db.query<{ id: string }>("SELECT agent_claim_assessment($1,$2) AS id", [
    hash(token),
    client,
  ]);
  assert.equal(first.rows[0].id, id);
  await db.query("SELECT agent_claim_assessment($1,$2)", [hash(token), client]);
  await assert.rejects(
    db.query("SELECT agent_claim_assessment($1,$2)", [hash(token), secondClient]),
    /Invalid or expired/,
  );
  const { rows } = await db.query<{ client_user_id: string; conversion_status: string }>(
    "SELECT client_user_id,conversion_status FROM agent_assessments WHERE id=$1",
    [id],
  );
  assert.equal(rows[0].client_user_id, client);
  assert.equal(rows[0].conversion_status, "SIGNED_UP");
  await db.query("INSERT INTO onboarding_progress VALUES($1)", [client]);
  assert.equal(
    (
      await db.query<{ conversion_status: string }>(
        "SELECT conversion_status FROM agent_assessments WHERE id=$1",
        [id],
      )
    ).rows[0].conversion_status,
    "ONBOARDING_STARTED",
  );
  await db.query("INSERT INTO client_profiles VALUES($1,true)", [client]);
  assert.equal(
    (
      await db.query<{ conversion_status: string }>(
        "SELECT conversion_status FROM agent_assessments WHERE id=$1",
        [id],
      )
    ).rows[0].conversion_status,
    "ACTIVATED",
  );
});
test("expired and unknown tokens fail; agent session cannot claim a client assessment", async () => {
  const { id, token } = await ready("expired");
  await assert.rejects(
    db.query("SELECT agent_claim_assessment($1,$2)", [hash(token), agent]),
    /client account/,
  );
  await db.query(
    `UPDATE agent_assessment_handoffs SET expires_at=now()-interval '1 second' WHERE assessment_id=$1`,
    [id],
  );
  await assert.rejects(
    db.query("SELECT agent_claim_assessment($1,$2)", [hash(token), client]),
    /Invalid or expired/,
  );
  await assert.rejects(
    db.query("SELECT agent_claim_assessment($1,$2)", [hash("unknown"), client]),
    /Invalid or expired/,
  );
});
test("admin configuration is role-gated and disabling membership takes effect immediately", async () => {
  const change = { kind: "member", user_id: other, active: false };
  await assert.rejects(
    db.query("SELECT agent_update_configuration($1,$2)", [agent, change]),
    /Forbidden/,
  );
  await db.query("SELECT agent_update_configuration($1,$2)", [admin, change]);
  await assert.rejects(create(other, "disabled"), /Forbidden/);
  assert.ok(
    (await db.query("SELECT * FROM agent_assessment_audit WHERE actor_id=$1", [admin])).rows.length,
  );
});
test("failed scans cannot persist prices; normal client profile lifecycle still works without an assessment", async () => {
  const id = await create(agent, "fail-no-price");
  await assert.rejects(
    db.query(`UPDATE agent_assessments SET status='FAILED',pricing='{}' WHERE id=$1`, [id]),
    /check constraint/,
  );
  await db.query("INSERT INTO client_profiles VALUES($1,false)", [secondClient]);
  await db.query("INSERT INTO onboarding_progress VALUES($1)", [secondClient]);
  await db.query("UPDATE client_profiles SET onboarding_completed=true WHERE user_id=$1", [
    secondClient,
  ]);
  assert.equal(
    (
      await db.query<{ onboarding_completed: boolean }>(
        "SELECT onboarding_completed FROM client_profiles WHERE user_id=$1",
        [secondClient],
      )
    ).rows[0].onboarding_completed,
    true,
  );
});
