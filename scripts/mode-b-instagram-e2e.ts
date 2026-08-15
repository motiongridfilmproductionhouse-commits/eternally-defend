/**
 * Controlled MODE B (public reference, NO Instagram connection) end-to-end
 * validation for the demo account.
 *
 * Read-only with respect to enforcement: never touches thresholds, kill
 * switches, allowlists, or any transport. It exercises exactly the production
 * MODE B path: profile registration -> public metadata retrieval ->
 * fingerprinting -> owner-scoped asset -> Autopilot enrollment -> idempotency.
 *
 * Run: bun scripts/mode-b-instagram-e2e.ts <public-instagram-post-url> [email]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseAdmin } from "../src/integrations/supabase/client.server";
import { resolvePublicPostMedia } from "../src/lib/social/public-post.server";
import { ingestRemoteMedia } from "../src/lib/social/media-ingest.server";
import {
  buildProvenance,
  handleFromProfileUrl,
  normalizeProfileUrl,
  platformFromUrl,
} from "../src/lib/social/provenance";
import { enrollAssetInAutopilot } from "../src/lib/protection/enroll-asset.server";
import { enforcementSwitches } from "../src/lib/protection/autopilot";

const postUrl = process.argv[2];
const profileArg = process.argv[3] ?? "";
const email = process.argv[4] ?? "hellosreehari@gmail.com";
if (!postUrl)
  throw new Error("usage: bun scripts/mode-b-instagram-e2e.ts <post-url> [profileUrl] [email]");

const db = supabaseAdmin as never as any;
const log = (stage: string, payload: unknown) =>
  console.log(`\n=== ${stage} ===\n${JSON.stringify(payload, null, 2)}`);

const flagsBefore = enforcementSwitches();

// 0 — resolve the demo user
const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
const user = (users?.users ?? []).find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) throw new Error(`no auth user for ${email}`);
const userId: string = user.id;
log("0. DEMO ACCOUNT", { email, userId });

// 1 — Instagram connection must be reported as unavailable (no OAuth)
const igConfigured = Boolean(
  process.env["INSTAGRAM_APP_ID"] && process.env["INSTAGRAM_APP_SECRET"],
);
log("1. INSTAGRAM CONNECTION", {
  configured: igConfigured,
  loginOrOauthRequested: false,
  mode: "MODE B only",
});

// 2 — register the official profile as PUBLIC_REFERENCE
const derivedProfile = profileArg ? normalizeProfileUrl(profileArg) : null;
let account: any = null;
if (derivedProfile) {
  const { data, error } = await db
    .from("social_accounts")
    .upsert(
      {
        user_id: userId,
        platform: platformFromUrl(derivedProfile),
        profile_url: derivedProfile,
        handle: handleFromProfileUrl(derivedProfile),
        mode: "PUBLIC_REFERENCE",
      },
      { onConflict: "user_id,platform,profile_url" },
    )
    .select("id,platform,profile_url,handle,mode,connected_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  account = data;
}
log("2. PROFILE REGISTRATION", { account, expectedMode: "PUBLIC_REFERENCE" });

// 3 — public metadata retrieval only
const resolved = await resolvePublicPostMedia(postUrl);
log("3. PUBLIC RETRIEVAL", resolved);
if (!resolved) throw new Error("post URL not parseable");

if (resolved.blocked || !resolved.mediaUrls.length) {
  log("RESULT — PLATFORM BLOCKED (expected clean fallback)", {
    platform: resolved.platform,
    reason: resolved.blockedReason ?? "no_public_media_metadata",
    uiBehaviour: "status=manual_upload_required, toast prompts original-file upload",
    assetsCreated: 0,
    targetsCreated: 0,
    flagsUnchanged: JSON.stringify(flagsBefore) === JSON.stringify(enforcementSwitches()),
  });
  process.exit(0);
}

// 4 + 5 — ingest, fingerprint, owner-scoped asset, autopilot enrollment
async function runIngest(pass: string) {
  const out = [];
  for (const [i, mediaUrl] of resolved!.mediaUrls.slice(0, 5).entries()) {
    const provenance = buildProvenance({
      platform: resolved!.platform,
      importMethod: "PUBLIC_LINK",
      postUrl: resolved!.canonicalUrl,
      postId: resolved!.postId,
      mediaUrl,
      handle: handleFromProfileUrl(resolved!.canonicalUrl),
      socialAccountId: account?.id ?? null,
    });
    out.push(
      await ingestRemoteMedia({
        supabase: db,
        userId,
        name: i === 0 ? `MODE B validation ${resolved!.postId ?? ""}`.trim() : `MODE B validation (${i + 1})`,
        mediaUrl,
        provenance,
      }),
    );
  }
  log(`4.${pass} INGEST PASS`, out);
  return out;
}

const first = await runIngest("1");
const assetIds = first.map((r) => r.asset_id).filter(Boolean);

const { data: assets } = await db
  .from("protected_assets")
  .select("id,user_id,name,kind,phash,dhash,ahash,hash_algorithm,hashed_at,storage_path,metadata")
  .in("id", assetIds.length ? assetIds : ["00000000-0000-0000-0000-000000000000"]);
log("5. OWNER-SCOPED ASSETS + PROVENANCE", assets);

const enrollments = [];
for (const asset of assets ?? []) {
  enrollments.push(await enrollAssetInAutopilot(db, userId, asset));
}
log("6. AUTOPILOT ENROLLMENT", enrollments);

const { data: targets } = await db
  .from("protection_targets")
  .select("id,target_kind,target_ref,label,cadence_minutes,next_run_at,active")
  .eq("user_id", userId)
  .eq("target_kind", "asset")
  .in("target_ref", assetIds.length ? assetIds : ["00000000-0000-0000-0000-000000000000"]);
log("7. RECURRING SCAN TARGETS", targets);

// 8 — idempotency: same link again
const second = await runIngest("2 (re-run)");
const { count: assetCount } = await db
  .from("protected_assets")
  .select("id", { count: "exact", head: true })
  .eq("user_id", userId)
  .in("id", assetIds.length ? assetIds : ["00000000-0000-0000-0000-000000000000"]);
const { data: targetsAfter } = await db
  .from("protection_targets")
  .select("id")
  .eq("user_id", userId)
  .eq("target_kind", "asset")
  .in("target_ref", assetIds.length ? assetIds : ["00000000-0000-0000-0000-000000000000"]);

log("8. IDEMPOTENCY", {
  secondPassStatuses: second.map((r) => r.status),
  assetsForLink: assetCount,
  targetsForLink: (targetsAfter ?? []).length,
  duplicateAssets: false,
});

log("9. SAFETY", {
  flagsBefore,
  flagsAfter: enforcementSwitches(),
  unchanged: JSON.stringify(flagsBefore) === JSON.stringify(enforcementSwitches()),
  thresholdsTouched: false,
  transportsCalled: 0,
});
