async function main() {
  const U = process.env["SUPABASE_URL"]!, K = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  const H = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" };
  const inv = await (await fetch(U + "/rest/v1/signup_invites?label=eq.ui-e2e&select=id,use_count,last_used_at", { headers: H })).json();
  const red = await (await fetch(U + "/rest/v1/signup_invite_redemptions?select=invite_id,email,user_id&order=created_at.desc&limit=3", { headers: H })).json();
  console.log("invite:", inv, "\nredemptions:", red);
  for (const r of red) {
    if (String(r.email).includes("invite-ui-")) await fetch(`${U}/auth/v1/admin/users/${r.user_id}`, { method: "DELETE", headers: H });
  }
  for (const i of inv) await fetch(`${U}/rest/v1/signup_invites?id=eq.${i.id}`, { method: "DELETE", headers: H });
  console.log("cleaned up");
}
main();
