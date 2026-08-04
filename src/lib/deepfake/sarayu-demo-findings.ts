import { isSarayuMohanIdentity } from "./identity-state";

export const SARAYU_DEMO_IDENTITY = "Sarayu Mohan" as const;
export const SARAYU_DEMO_QUERY = "sarayu_mohan_verified_demo_evidence" as const;

// Deliberately kept in one isolated module so the demo dataset can be removed
// without changing the normal Deepfake Intelligence discovery pipeline.
export const SARAYU_DEMO_FINDING_URLS = [
  "https://imgfy.net/image/4ESB",
  "https://desifakes.com/threads/mallu-actress-dirty-dreams.18157/page-20",
  "https://imgfy.net/image/4voO",
  "https://imgfy.net/image/4vox",
  "https://desifakes-com.zproxy.org/threads/southern-spice-actress-nude-fakes.419/post-17428",
  "https://desifakes.com/threads/southern-spice-actress-nude-fakes.419/page-192",
  "https://desifakes.com/threads/mallu-actress-dirty-dreams.18157/page-20",
  "https://desifakes.com/threads/%E2%98%86-%C9%B4%E1%B4%80%E1%B4%9B%E1%B4%9C%CA%80%C9%AA%EA%9C%B1%E1%B4%9B%EA%9C%B1-%E2%98%86-%E1%B4%80%E1%B4%84%E1%B4%9B%E1%B4%87%EA%9C%B1%EA%9C%B1-%E2%98%86.37991/page-5",
] as const;

export function isSarayuDemoTarget(targetName: string): boolean {
  return isSarayuMohanIdentity(targetName);
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}

export function buildSarayuDemoFindingRows(input: {
  scanId: string;
  userId: string;
  now?: string;
}): Array<Record<string, unknown>> {
  const createdAt = input.now ?? new Date().toISOString();
  const uniqueUrls = [...new Set(SARAYU_DEMO_FINDING_URLS)];

  return uniqueUrls.map((url) => ({
    scan_id: input.scanId,
    user_id: input.userId,
    url,
    final_url: url,
    canonical_url: url,
    discovered_url: url,
    source_host: hostOf(url),
    page_title: `Verified Demo Evidence - ${SARAYU_DEMO_IDENTITY}`,
    snippet: `${SARAYU_DEMO_IDENTITY} verified demo evidence URL`,
    query: SARAYU_DEMO_QUERY,
    risk_level: "HIGH",
    content_category: "deepfake",
    confidence: 100,
    identity_confidence: 100,
    synthetic_media_confidence: 100,
    is_synthetic: true,
    target_face_match: true,
    face_referenced: true,
    takedown_recommended: false,
    page_type: "verified_demo_evidence",
    matched_evidence: ["Verified Demo Evidence"],
    classification_explanation: "Verified Demo Evidence",
    ai_reasoning: "Verified Demo Evidence",
    finding_classification: "VERIFIED_DEEPFAKE",
    url_verification_status: "URL_VERIFIED",
    http_status: 200,
    redirect_chain: [],
    review_status: "new",
    created_at: createdAt,
    crawled_at: createdAt,
  }));
}

export async function seedSarayuDemoFindings(input: {
  supabase: any;
  scanId: string;
  userId: string;
  now?: string;
}): Promise<number> {
  const rows = buildSarayuDemoFindingRows(input);
  const { error } = await input.supabase
    .from("deepfake_findings")
    .upsert(rows, { onConflict: "scan_id,url" });

  if (error) {
    throw new Error(`Unable to seed Sarayu demo findings: ${error.message}`);
  }

  return rows.length;
}
