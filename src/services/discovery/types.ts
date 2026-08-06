/**
 * Discovery Engine - Core Types
 * Pillar 1: Discovery
 */

export interface DiscoveryAsset {
  id: string;
  title: string;

  releaseDate?: string;
  language?: string;
  country?: string;

  aliases?: string[];
}

export interface SearchResult {
  url: string;
  title: string;

  snippet?: string;

  source: string;
}

export interface DiscoveryCandidate {
  url: string;

  canonicalUrl: string;

  source: string;

  query: string;

  score: number;
}
