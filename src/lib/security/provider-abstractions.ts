/**
 * Eterna Architecture — Provider Abstraction Interfaces
 *
 * Decouples Eterna platform business logic from underlying third-party vendor SDKs.
 * Frontend components interact exclusively with Eterna domain contracts.
 */

export interface DiscoveryQueryInput {
  targetName: string;
  aliases?: string[];
  scope?: "NON_OFFICIAL_ONLY" | "NEWS_ALLEGATIONS" | "ALL_SOURCES";
  maxResults?: number;
}

export interface DiscoveredContentItem {
  id: string;
  title: string;
  description: string;
  publisherId?: string;
  publisherTitle: string;
  publishedAt?: string;
  url: string;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface VideoDiscoveryProvider {
  search(input: DiscoveryQueryInput): Promise<DiscoveredContentItem[]>;
}

export interface WebDiscoveryProvider {
  crawl(url: string): Promise<{ text: string; title: string }>;
  search(query: string): Promise<DiscoveredContentItem[]>;
}

export interface EvidenceAnalysisInput {
  targetName: string;
  contentTitle: string;
  contentBody: string;
  publisherTitle: string;
}

export interface EvidenceAnalysisResult {
  isSubjectMatch: boolean;
  confidenceScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  removalPotential: "high" | "medium" | "low" | "not_eligible";
  recommendedAction: string;
  violationTypes: string[];
}

export interface EvidenceAnalysisProvider {
  analyze(input: EvidenceAnalysisInput): Promise<EvidenceAnalysisResult>;
}

export interface StorageProvider {
  uploadPrivateAsset(path: string, content: Buffer | Blob): Promise<{ assetPath: string }>;
  getSignedDownloadUrl(path: string, expiresSeconds?: number): Promise<{ url: string }>;
}

export interface IdentityVerificationProvider {
  createVerificationSession(userId: string): Promise<{ sessionId: string; clientUrl: string }>;
  verifySession(sessionId: string): Promise<{ isVerified: boolean }>;
}
