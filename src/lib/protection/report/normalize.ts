/**
 * Pure per-module normalizers. Each maps one module's native finding row to
 * the common ReportDiscovery shape, including whether the row cleared that
 * module's own "verified" bar. The verified predicates mirror the gates the
 * dispatch modules already use before handing anything to enforcement —
 * they are read here, never loosened.
 */
import type { ReportDiscovery } from "./types";

function confidenceLabel(confidence: number | null): string {
  if (confidence === null) return "Not scored";
  if (confidence >= 90) return "Exact match";
  if (confidence >= 70) return "Probable match";
  if (confidence >= 50) return "Possible match";
  return "Low confidence";
}

function compact(values: (string | null | undefined)[]): string[] {
  return values.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

export interface CopyrightMatchRow {
  id: string;
  source_url: string | null;
  page_title: string | null;
  platform: string | null;
  confidence: number | null;
  confidence_band: string | null;
  detection_type: string | null;
  ocr_text: string | null;
  reason: string | null;
  review_status: string | null;
  created_at: string | null;
}

export function normalizeCopyrightMatch(row: CopyrightMatchRow): ReportDiscovery {
  const confidence = typeof row.confidence === "number" ? row.confidence : null;
  return {
    id: row.id,
    module: "copyright_intel",
    title: row.page_title || row.source_url || "Untitled match",
    sourceUrl: row.source_url ?? null,
    discoveredAt: row.created_at ?? null,
    confidence,
    confidenceLabel: row.confidence_band
      ? `${row.confidence_band} (${confidenceLabel(confidence)})`
      : confidenceLabel(confidence),
    evidence: compact([
      row.platform ? `Platform: ${row.platform}` : null,
      row.detection_type ? `Detection: ${row.detection_type}` : null,
      row.reason,
      row.ocr_text ? `OCR: ${row.ocr_text.slice(0, 240)}` : null,
    ]),
    status: row.review_status ?? "unreviewed",
    riskType: "Copyright Infringement",
    platform: row.platform ?? null,
    moduleVerified: row.confidence_band === "confirmed" && row.review_status !== "rejected",
  };
}

export interface DeepfakeFindingRow {
  id: string;
  url: string | null;
  canonical_url: string | null;
  page_title: string | null;
  snippet: string | null;
  source_host: string | null;
  content_category: string | null;
  risk_level: string | null;
  confidence: number | null;
  is_synthetic: boolean | null;
  face_referenced: boolean | null;
  takedown_recommended: boolean | null;
  ai_reasoning: string | null;
  review_status: string | null;
  created_at: string | null;
}

export function normalizeDeepfakeFinding(row: DeepfakeFindingRow): ReportDiscovery {
  const confidence = typeof row.confidence === "number" ? row.confidence : null;
  return {
    id: row.id,
    module: "deepfake_intel",
    title: row.page_title || row.canonical_url || row.url || "Untitled finding",
    sourceUrl: row.canonical_url || row.url || null,
    discoveredAt: row.created_at ?? null,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidence: compact([
      row.source_host ? `Host: ${row.source_host}` : null,
      row.content_category ? `Category: ${row.content_category}` : null,
      row.risk_level ? `Risk: ${row.risk_level}` : null,
      row.is_synthetic ? "Synthetic-media signals detected" : null,
      row.face_referenced ? "Protected face referenced" : null,
      row.ai_reasoning,
      row.snippet,
    ]),
    status: row.review_status ?? "unreviewed",
    riskType: row.content_category ? `Deepfake: ${row.content_category}` : "Deepfake",
    platform: row.source_host ?? null,
    moduleVerified: row.takedown_recommended === true,
  };
}

export interface YoutubeRemovalFindingRow {
  id: string;
  video_url: string | null;
  title: string | null;
  channel_title: string | null;
  subject_status: string | null;
  channel_class: string | null;
  risk_level: string | null;
  recommended_action: string | null;
  assessment_reason: string | null;
  created_at: string | null;
}

export function normalizeYoutubeRemovalFinding(row: YoutubeRemovalFindingRow): ReportDiscovery {
  const risk = (row.risk_level ?? "").toLowerCase();
  const confidence = risk === "critical" ? 95 : risk === "high" ? 80 : risk === "medium" ? 60 : null;
  return {
    id: row.id,
    module: "youtube_removal",
    title: row.title || row.video_url || "Untitled video",
    sourceUrl: row.video_url ?? null,
    discoveredAt: row.created_at ?? null,
    confidence,
    confidenceLabel: risk ? `Risk ${risk}` : "Not scored",
    evidence: compact([
      row.channel_title ? `Channel: ${row.channel_title}` : null,
      row.channel_class ? `Channel class: ${row.channel_class}` : null,
      row.subject_status ? `Subject: ${row.subject_status}` : null,
      row.recommended_action ? `Recommended: ${row.recommended_action}` : null,
      row.assessment_reason ?? null,
    ]),
    status: row.recommended_action ?? "none",
    riskType: row.recommended_action ?? null,
    platform: "YouTube",
    moduleVerified:
      row.subject_status !== "not_subject" &&
      row.channel_class !== "official_news" &&
      (risk === "high" || risk === "critical") &&
      !!row.recommended_action,
  };
}

export interface ScanHitRow {
  id: string;
  canonical_url: string | null;
  permalink: string | null;
  title: string | null;
  description: string | null;
  source: string | null;
  author: string | null;
  severity: string | null;
  risk_type: string | null;
  threat_score: number | null;
  risk_score: number | null;
  detected_at: string | null;
  created_at: string | null;
}

export function normalizeScanHit(row: ScanHitRow): ReportDiscovery {
  const raw = row.threat_score ?? row.risk_score ?? null;
  const confidence = typeof raw === "number" ? Math.round(raw) : null;
  const severity = (row.severity ?? "").toLowerCase();
  return {
    id: row.id,
    module: "reputation_web_scan",
    title: row.title || row.canonical_url || row.permalink || "Untitled mention",
    sourceUrl: row.canonical_url || row.permalink || null,
    discoveredAt: row.detected_at || row.created_at || null,
    confidence,
    confidenceLabel: severity ? `Severity ${severity}` : "Not scored",
    evidence: compact([
      row.source ? `Source: ${row.source}` : null,
      row.author ? `Author: ${row.author}` : null,
      row.risk_type ? `Risk type: ${row.risk_type}` : null,
      row.description,
    ]),
    status: severity || "unclassified",
    riskType: row.risk_type ?? null,
    platform: row.source ?? null,
    moduleVerified: severity === "critical" || severity === "high",
  };
}
