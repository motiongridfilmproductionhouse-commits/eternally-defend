import { createHash, randomUUID } from "crypto";
async function main() {
  const U = process.env["SUPABASE_URL"]!, K = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  const code = "ETRN-UI-" + randomUUID().slice(0, 4).toUpperCase();
  const h = createHash("sha256").update(":" + code.toUpperCase()).digest("hex");
  const r = await fetch(U + "/rest/v1/signup_invites", { method: "POST", headers: { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" }, body: JSON.stringify({ code_hash: h, label: "ui-e2e", max_uses: 1, account_type: "celebrity" }) });
  console.log(code, r.status);
}
main();
