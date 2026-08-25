/**
 * Customer + admin-facing server functions for the Protected-Asset Face
 * Bootstrap workflow (Path C). Candidate generation (getIdentityBootstrapState,
 * triggerIdentityCandidateReview) is safe for the customer themselves to
 * trigger — it never decides anyone's identity, only extracts and groups
 * faces for review. Everything that could establish or revoke a trusted
 * identity anchor (listIdentityCandidateClustersForReview,
 * confirmIdentityCandidateCluster, rejectIdentityCandidateCluster,
 * revokeAdminConfirmedAnchor) requires the caller to hold the 'admin' or
 * 'super_admin' role, re-verified server-side on every call from the
 * authenticated session — never trusted from a client-supplied flag. Core
 * logic lives in identity-bootstrap-core.server.ts (plain, mockable
 * functions); this file only owns auth + the admin-role gate, mirroring
 * face-enrollment.functions.ts / face-enrollment-core.server.ts. Never logs
 * face image bytes; never returns S3 credentials, Rekognition face ids, or
 * raw storage paths to the client beyond short-lived signed URLs.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getTrustedFaceAnchorsForUser, hasTrustedAnchor } from "./trusted-face-anchors.server";
import { runProtectedAssetBootstrapForUser } from "./dispatch/protected-asset-bootstrap.server";
import {
  confirmIdentityCandidateClusterCore,
  rejectIdentityCandidateClusterCore,
  revokeAdminConfirmedAnchorCore,
} from "./identity-bootstrap-core.server";

async function requireAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<void> {
  const { data: myRoles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = ((myRoles ?? []) as Array<{ role: string }>).some(
    (r) => r.role === "admin" || r.role === "super_admin",
  );
  if (!isAdmin) throw new Error("Forbidden: admin or super_admin role required");
}

export interface IdentityBootstrapState {
  hasTrustedAnchor: boolean;
  anchorTier: string | null;
  eligibleProtectedAssetCount: number;
  pendingClusterCount: number;
}

export const getIdentityBootstrapState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IdentityBootstrapState> => {
    const { userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;

    const anchorResult = await getTrustedFaceAnchorsForUser(supabase, userId);
    const anchorTier = hasTrustedAnchor(anchorResult) ? anchorResult.anchors[0].tier : null;

    const [{ count: assetCount }, { count: clusterCount }] = await Promise.all([
      supabase
        .from("protected_assets")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("kind", "photo"),
      supabase
        .from("face_identity_candidate_clusters")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "PENDING"),
    ]);

    return {
      hasTrustedAnchor: hasTrustedAnchor(anchorResult),
      anchorTier,
      eligibleProtectedAssetCount: assetCount ?? 0,
      pendingClusterCount: clusterCount ?? 0,
    };
  });

/**
 * Customer-triggerable: analyzes their own existing protected screenshots
 * and groups recurring faces for review. Generates candidates only — never
 * establishes a trusted identity. Safe for the customer to run on
 * themselves; the actual trust decision (confirm) is admin-gated below.
 */
export const triggerIdentityCandidateReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runProtectedAssetBootstrapForUser(supabaseAdmin, userId);
  });

export interface IdentityCandidateClusterSummary {
  id: string;
  status: string;
  tileCount: number;
  representativeTileSignedUrl: string | null;
  exampleTileSignedUrls: string[];
  createdAt: string;
}

export interface PendingIdentityReviewCustomer {
  userId: string;
  displayName: string;
  pendingClusterCount: number;
}

/** Admin-only. Lists every customer with at least one PENDING identity candidate cluster, for the admin review queue. */
export const listCustomersWithPendingIdentityReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingIdentityReviewCustomer[]> => {
    await requireAdmin(context.supabase, context.userId);
    const clientMod = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabaseAdmin = clientMod.supabaseAdmin as any;

    const { data: pendingClusters, error } = await supabaseAdmin
      .from("face_identity_candidate_clusters")
      .select("user_id")
      .eq("status", "PENDING");
    if (error) throw new Error(error.message);

    const counts = new Map<string, number>();
    for (const row of (pendingClusters ?? []) as Array<{ user_id: string }>) {
      counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
    }
    const userIds = Array.from(counts.keys());
    if (userIds.length === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("protection_profiles")
      .select("user_id, display_name, verified_name")
      .in("user_id", userIds);
    const nameByUser = new Map<string, string>(
      (
        (profiles ?? []) as Array<{
          user_id: string;
          display_name: string | null;
          verified_name: string | null;
        }>
      ).map((p) => {
        const name = (p.display_name || p.verified_name || "").trim();
        return [p.user_id, name] as [string, string];
      }),
    );

    return userIds
      .map((userId) => ({
        userId,
        displayName: nameByUser.get(userId) || "Unnamed protected subject",
        pendingClusterCount: counts.get(userId) ?? 0,
      }))
      .sort((a, b) => b.pendingClusterCount - a.pendingClusterCount);
  });

const TargetUserInput = z.object({ targetUserId: z.string().uuid() });

/** Admin-only. Lists a specific customer's identity clusters with signed crop URLs for review. */
export const listIdentityCandidateClustersForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TargetUserInput.parse(d))
  .handler(async ({ data, context }): Promise<IdentityCandidateClusterSummary[]> => {
    await requireAdmin(context.supabase, context.userId);
    const clientMod = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabaseAdmin = clientMod.supabaseAdmin as any;
    const { getSignedGetUrl } = await import("@/lib/aws/s3.server");

    const { data: clusters, error } = await supabaseAdmin
      .from("face_identity_candidate_clusters")
      .select("id, status, tile_count, representative_tile_id, created_at")
      .eq("user_id", data.targetUserId)
      .order("tile_count", { ascending: false });
    if (error) throw new Error(error.message);

    const results: IdentityCandidateClusterSummary[] = [];
    for (const cluster of clusters ?? []) {
      let representativeTileSignedUrl: string | null = null;
      const exampleTileSignedUrls: string[] = [];

      const { data: memberTiles } = await supabaseAdmin
        .from("protected_asset_grid_tiles")
        .select("id, tile_storage_path")
        .eq("cluster_id", cluster.id)
        .eq("user_id", data.targetUserId)
        .limit(4);

      for (const tile of memberTiles ?? []) {
        if (!tile.tile_storage_path) continue;
        try {
          const url = await getSignedGetUrl(tile.tile_storage_path, 300);
          if (tile.id === cluster.representative_tile_id) representativeTileSignedUrl = url;
          exampleTileSignedUrls.push(url);
        } catch {
          // A single signed-URL failure shouldn't drop the whole cluster from the review list.
        }
      }

      results.push({
        id: cluster.id,
        status: cluster.status,
        tileCount: cluster.tile_count,
        representativeTileSignedUrl:
          representativeTileSignedUrl ?? exampleTileSignedUrls[0] ?? null,
        exampleTileSignedUrls,
        createdAt: cluster.created_at,
      });
    }
    return results;
  });

const ClusterActionInput = z.object({
  targetUserId: z.string().uuid(),
  clusterId: z.string().uuid(),
});

/** Admin-only. The trust boundary — see identity-bootstrap-core.server.ts's confirmIdentityCandidateClusterCore. */
export const confirmIdentityCandidateCluster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ClusterActionInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getS3, getBucket } = await import("@/lib/aws/clients.server");
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { computePerceptualHash } = await import("./face-reference-extraction/dedupe.server");
    const { promoteToReferenceFace } =
      await import("./dispatch/face-reference-extraction-io.server");
    const { runFaceReferenceExtractionForUser } =
      await import("./dispatch/face-reference-extraction.server");

    return confirmIdentityCandidateClusterCore(
      supabaseAdmin,
      { adminUserId: context.userId, targetUserId: data.targetUserId, clusterId: data.clusterId },
      {
        downloadTileBytes: async (storagePath) => {
          const object = await getS3().send(
            new GetObjectCommand({ Bucket: getBucket(), Key: storagePath }),
          );
          if (!object.Body) throw new Error("Tile image could not be loaded.");
          return new Uint8Array(await object.Body.transformToByteArray());
        },
        computePhash: computePerceptualHash,
        promoteToReferenceFace,
        runFaceReferenceExtraction: (admin, userId) =>
          runFaceReferenceExtractionForUser(admin, userId),
      },
    );
  });

/** Admin-only. Marks a candidate cluster as NOT the protected person — it must never be used as a trusted anchor. */
export const rejectIdentityCandidateCluster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ClusterActionInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return rejectIdentityCandidateClusterCore(supabaseAdmin, {
      adminUserId: context.userId,
      targetUserId: data.targetUserId,
      clusterId: data.clusterId,
    });
  });

const RevokeInput = z.object({
  targetUserId: z.string().uuid(),
  referenceFaceId: z.string().uuid(),
});

/** Admin-only. Revokes a wrongly-confirmed anchor — never deletes; see revokeAdminConfirmedAnchorCore. */
export const revokeAdminConfirmedAnchor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RevokeInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return revokeAdminConfirmedAnchorCore(supabaseAdmin, {
      adminUserId: context.userId,
      referenceFaceId: data.referenceFaceId,
    });
  });
