/**
 * Final MODE B regression. Read-only with respect to enforcement: it forces the
 * kill switches to the safe values, never calls a transport, and never changes
 * thresholds, allowlists or authorization state.
 *
 * Run: bun scripts/mode-b-regression.ts [email]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.ENFORCEMENT_LIVE_ENABLED = "false";
process.env.ENFORCEMENT_TEST_MODE = "true";

import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";
import { resolvePublicPostMedia } from "../src/lib/social/public-post.server";
import { ingestMediaBytes, ingestRemoteMedia } from "../src/lib/social/media-ingest.server";
import {
  buildProvenance,
  handleFromProfileUrl,
  normalizeProfileUrl,
  platformFromUrl,
} from "../src/lib/social/provenance";
import { enrollAssetInAutopilot } from "../src/lib/protection/enroll-asset.server";
import { enforcementSwitches } from "../src/lib/protection/autopilot";
import { deriveAssetStatus, blockedRetrievalMessage } from "../src/lib/social/status";

const email = process.argv[2] ?? "hellosreehari@gmail.com";
const db = supabaseAdmin as never as any;
const checks: Array<{ name: string; pass: boolean; detail: unknown }> = [];
const check = (name: string, pass: boolean, detail: unknown = null) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${JSON.stringify(detail)}` : ""}`);
};

const flagsBefore = enforcementSwitches();
check("ENFORCEMENT_LIVE_ENABLED=false", flagsBefore.liveEnabled === false);
check("ENFORCEMENT_TEST_MODE=true", flagsBefore.testMode === true);

const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
const user = (users?.users ?? []).find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) throw new Error(`no auth user for ${email}`);
const userId: string = user.id;

// FLOW 1 — onboarding social profile stays PUBLIC_REFERENCE / SELF_DECLARED
const profileUrl = normalizeProfileUrl("https://instagram.com/instagram")!;
const { data: account } = await db
  .from("social_accounts")
  .upsert(
    {
      user_id: userId,
      platform: platformFromUrl(profileUrl),
      profile_url: profileUrl,
      handle: handleFromProfileUrl(profileUrl),
      mode: "PUBLIC_REFERENCE",
    },
    { onConflict: "user_id,platform,profile_url" },
  )
  .select("id,mode,connected_at")
  .maybeSingle();
check("onboarding profile stored as PUBLIC_REFERENCE, never connected", account?.mode === "PUBLIC_REFERENCE" && !account?.connected_at, account);

const { data: existingRefs } = await db
  .from("social_accounts")
  .select("mode")
  .neq("mode", "PUBLIC_REFERENCE");
check("no fabricated AUTHORIZED_CONNECTED accounts exist", (existingRefs ?? []).length === 0);

const igCredentials = Boolean(process.env["INSTAGRAM_APP_ID"] && process.env["INSTAGRAM_APP_SECRET"]);
check("MODE A dormant / no Instagram credentials requested", igCredentials === false);

// FLOW 2 — public link import: retrieval -> provenance -> fingerprint -> asset -> autopilot
const linkTarget = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const resolved = await resolvePublicPostMedia(linkTarget);
check("public retrieval returns public media metadata only", Boolean(resolved && resolved.mediaUrls.length), {
  blocked: resolved?.blocked,
  media: resolved?.mediaUrls.length,
});

let linkAssetId: string | null = null;
if (resolved && resolved.mediaUrls.length) {
  const provenance = buildProvenance({
    platform: resolved.platform,
    importMethod: "PUBLIC_LINK",
    postUrl: resolved.canonicalUrl,
    postId: resolved.postId,
    mediaUrl: resolved.mediaUrls[0]!,
    socialAccountId: account?.id ?? null,
  });
  const first = await ingestRemoteMedia({
    supabase: db,
    userId,
    name: "MODE B regression link",
    mediaUrl: resolved.mediaUrls[0]!,
    provenance,
  });
  linkAssetId = first.asset_id;
  check("link import creates or reuses one owner-scoped asset", Boolean(first.asset_id) && first.fingerprinted, first);
  check("provenance records SELF_DECLARED public link", provenance.ownership_basis === "SELF_DECLARED" && provenance.import_method === "PUBLIC_LINK");

  const second = await ingestRemoteMedia({
    supabase: db,
    userId,
    name: "MODE B regression link",
    mediaUrl: resolved.mediaUrls[0]!,
    provenance,
  });
  check("duplicate link creates no duplicate asset", second.status === "duplicate" && second.asset_id === first.asset_id, second);
}

// FLOW 3 — blocked Instagram retrieval -> upload required -> manual upload path
const igResolved = await resolvePublicPostMedia("https://www.instagram.com/p/C9zJc4kR9lQ/");
const igBlocked = Boolean(igResolved && (igResolved.blocked || !igResolved.mediaUrls.length));
check("Instagram block surfaces cleanly (no bypass attempted)", igBlocked, {
  reason: igResolved?.blockedReason,
  copy: blockedRetrievalMessage("instagram"),
});

// A 1x1 PNG stands in for the customer-supplied original file.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=",
  "base64",
);
const uploadProvenance = buildProvenance({
  platform: "instagram",
  importMethod: "MANUAL_UPLOAD",
  postUrl: "https://www.instagram.com/p/C9zJc4kR9lQ",
  postId: "C9zJc4kR9lQ",
  socialAccountId: account?.id ?? null,
});
const uploaded = await ingestMediaBytes({
  supabase: db,
  userId,
  name: "MODE B regression manual upload",
  bytes: new Uint8Array(png),
  contentType: "image/png",
  provenance: uploadProvenance,
});
check("manual upload fallback fingerprints and stores owner-scoped asset", uploaded.fingerprinted && Boolean(uploaded.asset_id), uploaded);

const uploadedAgain = await ingestMediaBytes({
  supabase: db,
  userId,
  name: "MODE B regression manual upload",
  bytes: new Uint8Array(png),
  contentType: "image/png",
  provenance: uploadProvenance,
});
check("duplicate upload creates no duplicate asset", uploadedAgain.status === "duplicate", uploadedAgain);

// Autopilot — exactly one target, initial scan due immediately, cadence preserved
const { data: profile } = await db
  .from("protection_profiles")
  .select("status,paused,auto_scan_enabled")
  .eq("user_id", userId)
  .maybeSingle();

const testAssetId = uploaded.asset_id ?? linkAssetId;
const { data: asset } = await db
  .from("protected_assets")
  .select("id,name,user_id,phash,dhash,ahash")
  .eq("id", testAssetId)
  .maybeSingle();
check("asset is owner-scoped", asset?.user_id === userId);

const e1 = await enrollAssetInAutopilot(db, userId, asset);
const e2 = await enrollAssetInAutopilot(db, userId, asset);
const { data: targets } = await db
  .from("protection_targets")
  .select("id,cadence_minutes,next_run_at,active")
  .eq("user_id", userId)
  .eq("target_kind", "asset")
  .eq("label", asset.name);
check("duplicate enrollment creates no duplicate target", (targets ?? []).length <= 1, { e1, e2, targets });

if (profile?.status === "ACTIVE" && !profile?.paused) {
  const t = (targets ?? [])[0];
  check("enrollment activates one target with an immediate initial scan", Boolean(t) && new Date(t.next_run_at).getTime() <= Date.now() + 1000, t);
} else {
  check(
    "authorization not ACTIVE -> asset stored + fingerprinted, exact reason surfaced (no silent activation)",
    e1.enrolled === false && Boolean(e1.reason),
    {
      enrollReason: e1.reason,
      status: deriveAssetStatus({
        fingerprinted: true,
        hasTarget: (targets ?? []).length > 0,
        profileStatus: profile?.status ?? null,
        profilePaused: profile?.paused ?? null,
        autoScanEnabled: profile?.auto_scan_enabled ?? null,
      }),
    },
  );
}

// Cross-tenant isolation via RLS with the publishable (anon) key
const anon = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
  auth: { persistSession: false },
});
const { data: leakedAssets } = await anon.from("protected_assets").select("id").limit(1);
const { data: leakedAccounts } = await anon.from("social_accounts").select("id").limit(1);
check("cross-tenant read of protected assets fails", (leakedAssets ?? []).length === 0);
check("cross-tenant read of social accounts fails", (leakedAccounts ?? []).length === 0);

// Enforcement must never be triggered by ingestion
const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
const { count: recentCases } = await db
  .from("enforcement_cases")
  .select("id", { count: "exact", head: true })
  .eq("user_id", userId)
  .gte("created_at", since);
check("no enforcement case created by asset ingestion", (recentCases ?? 0) === 0, { recentCases });

const flagsAfter = enforcementSwitches();
check("enforcement switches unchanged", JSON.stringify(flagsBefore) === JSON.stringify(flagsAfter), flagsAfter);

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name));
  process.exit(1);
}
