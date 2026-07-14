export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      api_usage: {
        Row: {
          cost_usd: number
          created_at: string
          id: string
          job_id: string | null
          metadata: Json
          provider: string
          unit_type: string
          units: number
          user_id: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          id?: string
          job_id?: string | null
          metadata?: Json
          provider: string
          unit_type: string
          units?: number
          user_id: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          id?: string
          job_id?: string | null
          metadata?: Json
          provider?: string
          unit_type?: string
          units?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      caption_imports: {
        Row: {
          created_at: string
          filename: string | null
          format: string
          id: string
          job_id: string | null
          language: string | null
          raw_text: string
          segment_count: number
          segments: Json
          transcript_source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filename?: string | null
          format: string
          id?: string
          job_id?: string | null
          language?: string | null
          raw_text: string
          segment_count?: number
          segments?: Json
          transcript_source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filename?: string | null
          format?: string
          id?: string
          job_id?: string | null
          language?: string | null
          raw_text?: string
          segment_count?: number
          segments?: Json
          transcript_source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "caption_imports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_frames: {
        Row: {
          created_at: string
          frame_hash: string | null
          frame_url: string | null
          height: number | null
          id: string
          job_id: string
          storage_path: string | null
          timestamp_seconds: number | null
          user_id: string
          width: number | null
        }
        Insert: {
          created_at?: string
          frame_hash?: string | null
          frame_url?: string | null
          height?: number | null
          id?: string
          job_id: string
          storage_path?: string | null
          timestamp_seconds?: number | null
          user_id: string
          width?: number | null
        }
        Update: {
          created_at?: string
          frame_hash?: string | null
          frame_url?: string | null
          height?: number | null
          id?: string
          job_id?: string
          storage_path?: string | null
          timestamp_seconds?: number | null
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_frames_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      extracted_claims: {
        Row: {
          claimant: string | null
          created_at: string
          extracted_claim: string
          fact_check_status: string
          id: string
          job_id: string
          language: string | null
          original_statement: string
          transcript_segment_id: string | null
          user_id: string
        }
        Insert: {
          claimant?: string | null
          created_at?: string
          extracted_claim: string
          fact_check_status?: string
          id?: string
          job_id: string
          language?: string | null
          original_statement: string
          transcript_segment_id?: string | null
          user_id: string
        }
        Update: {
          claimant?: string | null
          created_at?: string
          extracted_claim?: string
          fact_check_status?: string
          id?: string
          job_id?: string
          language?: string | null
          original_statement?: string
          transcript_segment_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extracted_claims_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_claims_transcript_segment_id_fkey"
            columns: ["transcript_segment_id"]
            isOneToOne: false
            referencedRelation: "transcript_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      fact_check_matches: {
        Row: {
          created_at: string
          extracted_claim_id: string
          id: string
          job_id: string
          language: string | null
          match_confidence: number | null
          publisher_name: string | null
          publisher_site: string | null
          raw: Json | null
          review_date: string | null
          review_title: string | null
          review_url: string | null
          reviewed_claim: string | null
          textual_rating: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          extracted_claim_id: string
          id?: string
          job_id: string
          language?: string | null
          match_confidence?: number | null
          publisher_name?: string | null
          publisher_site?: string | null
          raw?: Json | null
          review_date?: string | null
          review_title?: string | null
          review_url?: string | null
          reviewed_claim?: string | null
          textual_rating?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          extracted_claim_id?: string
          id?: string
          job_id?: string
          language?: string | null
          match_confidence?: number | null
          publisher_name?: string | null
          publisher_site?: string | null
          raw?: Json | null
          review_date?: string | null
          review_title?: string | null
          review_url?: string | null
          reviewed_claim?: string | null
          textual_rating?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fact_check_matches_extracted_claim_id_fkey"
            columns: ["extracted_claim_id"]
            isOneToOne: false
            referencedRelation: "extracted_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fact_check_matches_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      finding_review_history: {
        Row: {
          action: string
          created_at: string
          finding_id: string
          from_severity: string | null
          from_status: string | null
          id: string
          notes: string | null
          reviewer_id: string
          to_severity: string | null
          to_status: string
        }
        Insert: {
          action?: string
          created_at?: string
          finding_id: string
          from_severity?: string | null
          from_status?: string | null
          id?: string
          notes?: string | null
          reviewer_id: string
          to_severity?: string | null
          to_status: string
        }
        Update: {
          action?: string
          created_at?: string
          finding_id?: string
          from_severity?: string | null
          from_status?: string | null
          id?: string
          notes?: string | null
          reviewer_id?: string
          to_severity?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "finding_review_history_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "timestamp_findings"
            referencedColumns: ["id"]
          },
        ]
      }
      multimedia_analysis_jobs: {
        Row: {
          actual_cost_cents: number
          api_calls_count: number
          canceled_reason: string | null
          confidence_by_axis: Json | null
          cost_estimate_usd: number
          created_at: string
          estimated_cost_cents: number
          finished_at: string | null
          id: string
          progress_message: string | null
          progress_percent: number
          reputation_score: number | null
          retention_expires_at: string | null
          risk_scores: Json
          score_explanations: Json | null
          source_kind: string
          source_metadata: Json
          source_ref: string
          stage_status: Json
          started_at: string | null
          status: string
          target_aliases: string[]
          target_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_cost_cents?: number
          api_calls_count?: number
          canceled_reason?: string | null
          confidence_by_axis?: Json | null
          cost_estimate_usd?: number
          created_at?: string
          estimated_cost_cents?: number
          finished_at?: string | null
          id?: string
          progress_message?: string | null
          progress_percent?: number
          reputation_score?: number | null
          retention_expires_at?: string | null
          risk_scores?: Json
          score_explanations?: Json | null
          source_kind: string
          source_metadata?: Json
          source_ref: string
          stage_status?: Json
          started_at?: string | null
          status?: string
          target_aliases?: string[]
          target_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_cost_cents?: number
          api_calls_count?: number
          canceled_reason?: string | null
          confidence_by_axis?: Json | null
          cost_estimate_usd?: number
          created_at?: string
          estimated_cost_cents?: number
          finished_at?: string | null
          id?: string
          progress_message?: string | null
          progress_percent?: number
          reputation_score?: number | null
          retention_expires_at?: string | null
          risk_scores?: Json
          score_explanations?: Json | null
          source_kind?: string
          source_metadata?: Json
          source_ref?: string
          stage_status?: Json
          started_at?: string | null
          status?: string
          target_aliases?: string[]
          target_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      multimedia_errors: {
        Row: {
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          job_id: string
          provider: string | null
          raw: Json | null
          stage: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id: string
          provider?: string | null
          raw?: Json | null
          stage: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id?: string
          provider?: string | null
          raw?: Json | null
          stage?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "multimedia_errors_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      multimedia_uploads: {
        Row: {
          created_at: string
          filename: string
          id: string
          job_id: string | null
          mime_type: string
          organization: string | null
          permission_confirmed: boolean
          retention_policy: string
          retention_until: string | null
          sha256: string
          size_bytes: number
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          job_id?: string | null
          mime_type: string
          organization?: string | null
          permission_confirmed?: boolean
          retention_policy?: string
          retention_until?: string | null
          sha256: string
          size_bytes: number
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          job_id?: string | null
          mime_type?: string
          organization?: string | null
          permission_confirmed?: boolean
          retention_policy?: string
          retention_until?: string | null
          sha256?: string
          size_bytes?: number
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "multimedia_uploads_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      narrative_clusters: {
        Row: {
          cluster_key: string
          combined_reach: number
          created_at: string
          dominant_source: string | null
          first_detected_at: string
          id: string
          latest_detected_at: string
          narrative_summary: string | null
          source_count: number
          sources: Json
          target_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cluster_key: string
          combined_reach?: number
          created_at?: string
          dominant_source?: string | null
          first_detected_at?: string
          id?: string
          latest_detected_at?: string
          narrative_summary?: string | null
          source_count?: number
          sources?: Json
          target_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cluster_key?: string
          combined_reach?: number
          created_at?: string
          dominant_source?: string | null
          first_detected_at?: string
          id?: string
          latest_detected_at?: string
          narrative_summary?: string | null
          source_count?: number
          sources?: Json
          target_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ocr_results: {
        Row: {
          bounding_boxes: Json | null
          confidence: number | null
          created_at: string
          evidence_frame_id: string | null
          id: string
          job_id: string
          language_code: string | null
          text: string
          user_id: string
        }
        Insert: {
          bounding_boxes?: Json | null
          confidence?: number | null
          created_at?: string
          evidence_frame_id?: string | null
          id?: string
          job_id: string
          language_code?: string | null
          text: string
          user_id: string
        }
        Update: {
          bounding_boxes?: Json | null
          confidence?: number | null
          created_at?: string
          evidence_frame_id?: string | null
          id?: string
          job_id?: string
          language_code?: string | null
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocr_results_evidence_frame_id_fkey"
            columns: ["evidence_frame_id"]
            isOneToOne: false
            referencedRelation: "evidence_frames"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_results_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      protected_asset_matches: {
        Row: {
          copyright_risk: number | null
          created_at: string
          evidence_frame_id: string | null
          fake_ad_indicator: boolean
          id: string
          impersonation_risk: number | null
          job_id: string
          match_type: string
          ocr_name_match: boolean
          protected_asset_id: string
          requires_review: boolean
          similarity: number
          user_id: string
        }
        Insert: {
          copyright_risk?: number | null
          created_at?: string
          evidence_frame_id?: string | null
          fake_ad_indicator?: boolean
          id?: string
          impersonation_risk?: number | null
          job_id: string
          match_type: string
          ocr_name_match?: boolean
          protected_asset_id: string
          requires_review?: boolean
          similarity: number
          user_id: string
        }
        Update: {
          copyright_risk?: number | null
          created_at?: string
          evidence_frame_id?: string | null
          fake_ad_indicator?: boolean
          id?: string
          impersonation_risk?: number | null
          job_id?: string
          match_type?: string
          ocr_name_match?: boolean
          protected_asset_id?: string
          requires_review?: boolean
          similarity?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "protected_asset_matches_evidence_frame_id_fkey"
            columns: ["evidence_frame_id"]
            isOneToOne: false
            referencedRelation: "evidence_frames"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protected_asset_matches_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protected_asset_matches_protected_asset_id_fkey"
            columns: ["protected_asset_id"]
            isOneToOne: false
            referencedRelation: "protected_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      protected_assets: {
        Row: {
          active: boolean
          created_at: string
          id: string
          kind: string
          metadata: Json
          name: string
          phash: string | null
          source_url: string | null
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          kind: string
          metadata?: Json
          name: string
          phash?: string | null
          source_url?: string | null
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          name?: string
          phash?: string | null
          source_url?: string | null
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      provider_health_checks: {
        Row: {
          checked_by: string | null
          created_at: string
          diagnostic: Json | null
          error_message: string | null
          id: string
          latency_ms: number | null
          mode: string
          provider: string
          status: string
        }
        Insert: {
          checked_by?: string | null
          created_at?: string
          diagnostic?: Json | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          mode: string
          provider: string
          status: string
        }
        Update: {
          checked_by?: string | null
          created_at?: string
          diagnostic?: Json | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          mode?: string
          provider?: string
          status?: string
        }
        Relationships: []
      }
      quota_usage: {
        Row: {
          analyses_count: number
          api_calls_count: number
          cost_cents: number
          created_at: string
          id: string
          storage_bytes: number
          updated_at: string
          usage_date: string
          user_id: string
        }
        Insert: {
          analyses_count?: number
          api_calls_count?: number
          cost_cents?: number
          created_at?: string
          id?: string
          storage_bytes?: number
          updated_at?: string
          usage_date?: string
          user_id: string
        }
        Update: {
          analyses_count?: number
          api_calls_count?: number
          cost_cents?: number
          created_at?: string
          id?: string
          storage_bytes?: number
          updated_at?: string
          usage_date?: string
          user_id?: string
        }
        Relationships: []
      }
      speaker_segments: {
        Row: {
          confidence: number | null
          created_at: string
          end_seconds: number
          id: string
          job_id: string
          speaker_tag: string
          start_seconds: number
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          end_seconds: number
          id?: string
          job_id: string
          speaker_tag: string
          start_seconds: number
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          end_seconds?: number
          id?: string
          job_id?: string
          speaker_tag?: string
          start_seconds?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "speaker_segments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      timestamp_findings: {
        Row: {
          cluster_id: string | null
          confidence: number | null
          contributing_signals: Json | null
          created_at: string
          description: string | null
          detection_reason: string | null
          end_seconds: number | null
          evidence_frame_id: string | null
          evidence_source: string | null
          extracted_claim_id: string | null
          fact_check_status: string | null
          finding_type: string
          human_review_status: string
          id: string
          job_id: string
          model_version: string | null
          original_language: string | null
          review_status: string
          reviewed_at: string | null
          reviewer_id: string | null
          reviewer_notes: string | null
          severity: string
          speaker: string | null
          start_seconds: number
          timestamp_source: string
          title: string
          transcript_excerpt: string | null
          transcript_segment_id: string | null
          translation: string | null
          updated_at: string
          user_id: string
          video_annotation_id: string | null
          visual_detection_id: string | null
          youtube_deep_link: string | null
        }
        Insert: {
          cluster_id?: string | null
          confidence?: number | null
          contributing_signals?: Json | null
          created_at?: string
          description?: string | null
          detection_reason?: string | null
          end_seconds?: number | null
          evidence_frame_id?: string | null
          evidence_source?: string | null
          extracted_claim_id?: string | null
          fact_check_status?: string | null
          finding_type: string
          human_review_status?: string
          id?: string
          job_id: string
          model_version?: string | null
          original_language?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewer_id?: string | null
          reviewer_notes?: string | null
          severity: string
          speaker?: string | null
          start_seconds: number
          timestamp_source?: string
          title: string
          transcript_excerpt?: string | null
          transcript_segment_id?: string | null
          translation?: string | null
          updated_at?: string
          user_id: string
          video_annotation_id?: string | null
          visual_detection_id?: string | null
          youtube_deep_link?: string | null
        }
        Update: {
          cluster_id?: string | null
          confidence?: number | null
          contributing_signals?: Json | null
          created_at?: string
          description?: string | null
          detection_reason?: string | null
          end_seconds?: number | null
          evidence_frame_id?: string | null
          evidence_source?: string | null
          extracted_claim_id?: string | null
          fact_check_status?: string | null
          finding_type?: string
          human_review_status?: string
          id?: string
          job_id?: string
          model_version?: string | null
          original_language?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewer_id?: string | null
          reviewer_notes?: string | null
          severity?: string
          speaker?: string | null
          start_seconds?: number
          timestamp_source?: string
          title?: string
          transcript_excerpt?: string | null
          transcript_segment_id?: string | null
          translation?: string | null
          updated_at?: string
          user_id?: string
          video_annotation_id?: string | null
          visual_detection_id?: string | null
          youtube_deep_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timestamp_findings_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "narrative_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timestamp_findings_evidence_frame_id_fkey"
            columns: ["evidence_frame_id"]
            isOneToOne: false
            referencedRelation: "evidence_frames"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timestamp_findings_extracted_claim_id_fkey"
            columns: ["extracted_claim_id"]
            isOneToOne: false
            referencedRelation: "extracted_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timestamp_findings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timestamp_findings_transcript_segment_id_fkey"
            columns: ["transcript_segment_id"]
            isOneToOne: false
            referencedRelation: "transcript_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timestamp_findings_video_annotation_id_fkey"
            columns: ["video_annotation_id"]
            isOneToOne: false
            referencedRelation: "video_annotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timestamp_findings_visual_detection_id_fkey"
            columns: ["visual_detection_id"]
            isOneToOne: false
            referencedRelation: "visual_detections"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_segments: {
        Row: {
          confidence: number | null
          copyright_relevance: number | null
          created_at: string
          detected_claims: Json
          end_seconds: number
          fact_check_status: string | null
          id: string
          job_id: string
          language_code: string | null
          mentioned_entities: Json
          original_text: string
          reputation_impact: number | null
          segment_index: number
          sentiment: string | null
          speaker_tag: string | null
          start_seconds: number
          threat_category: string | null
          transcription_job_id: string | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          copyright_relevance?: number | null
          created_at?: string
          detected_claims?: Json
          end_seconds: number
          fact_check_status?: string | null
          id?: string
          job_id: string
          language_code?: string | null
          mentioned_entities?: Json
          original_text: string
          reputation_impact?: number | null
          segment_index: number
          sentiment?: string | null
          speaker_tag?: string | null
          start_seconds: number
          threat_category?: string | null
          transcription_job_id?: string | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          copyright_relevance?: number | null
          created_at?: string
          detected_claims?: Json
          end_seconds?: number
          fact_check_status?: string | null
          id?: string
          job_id?: string
          language_code?: string | null
          mentioned_entities?: Json
          original_text?: string
          reputation_impact?: number | null
          segment_index?: number
          sentiment?: string | null
          speaker_tag?: string | null
          start_seconds?: number
          threat_category?: string | null
          transcription_job_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcript_segments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_segments_transcription_job_id_fkey"
            columns: ["transcription_job_id"]
            isOneToOne: false
            referencedRelation: "transcription_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      transcription_jobs: {
        Row: {
          audio_uri: string | null
          created_at: string
          duration_seconds: number | null
          error: string | null
          id: string
          job_id: string
          language_code: string | null
          operation_name: string | null
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          audio_uri?: string | null
          created_at?: string
          duration_seconds?: number | null
          error?: string | null
          id?: string
          job_id: string
          language_code?: string | null
          operation_name?: string | null
          provider: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          audio_uri?: string | null
          created_at?: string
          duration_seconds?: number | null
          error?: string | null
          id?: string
          job_id?: string
          language_code?: string | null
          operation_name?: string | null
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcription_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      translations: {
        Row: {
          confidence: number | null
          created_at: string
          detected_language: string | null
          id: string
          job_id: string | null
          original_text: string
          provider: string
          requires_review: boolean
          source_ref: string | null
          source_type: string
          target_language: string
          translated_text: string
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          detected_language?: string | null
          id?: string
          job_id?: string | null
          original_text: string
          provider: string
          requires_review?: boolean
          source_ref?: string | null
          source_type: string
          target_language: string
          translated_text: string
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          detected_language?: string | null
          id?: string
          job_id?: string | null
          original_text?: string
          provider?: string
          requires_review?: boolean
          source_ref?: string | null
          source_type?: string
          target_language?: string
          translated_text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "translations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_annotations: {
        Row: {
          annotation_type: string
          bounding_box: Json | null
          confidence: number | null
          created_at: string
          end_seconds: number | null
          evidence_frame_id: string | null
          id: string
          job_id: string
          label: string | null
          protected_asset_id: string | null
          raw: Json | null
          requires_review: boolean
          severity: string | null
          shot_number: number | null
          start_seconds: number | null
          user_id: string
        }
        Insert: {
          annotation_type: string
          bounding_box?: Json | null
          confidence?: number | null
          created_at?: string
          end_seconds?: number | null
          evidence_frame_id?: string | null
          id?: string
          job_id: string
          label?: string | null
          protected_asset_id?: string | null
          raw?: Json | null
          requires_review?: boolean
          severity?: string | null
          shot_number?: number | null
          start_seconds?: number | null
          user_id: string
        }
        Update: {
          annotation_type?: string
          bounding_box?: Json | null
          confidence?: number | null
          created_at?: string
          end_seconds?: number | null
          evidence_frame_id?: string | null
          id?: string
          job_id?: string
          label?: string | null
          protected_asset_id?: string | null
          raw?: Json | null
          requires_review?: boolean
          severity?: string | null
          shot_number?: number | null
          start_seconds?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_annotations_evidence_frame_id_fkey"
            columns: ["evidence_frame_id"]
            isOneToOne: false
            referencedRelation: "evidence_frames"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_annotations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_annotations_protected_asset_id_fkey"
            columns: ["protected_asset_id"]
            isOneToOne: false
            referencedRelation: "protected_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      visual_detections: {
        Row: {
          bounding_box: Json | null
          confidence: number | null
          created_at: string
          detection_type: string
          evidence_frame_id: string | null
          face_present: boolean | null
          id: string
          job_id: string
          label: string | null
          raw: Json | null
          safe_search: Json | null
          user_id: string
        }
        Insert: {
          bounding_box?: Json | null
          confidence?: number | null
          created_at?: string
          detection_type: string
          evidence_frame_id?: string | null
          face_present?: boolean | null
          id?: string
          job_id: string
          label?: string | null
          raw?: Json | null
          safe_search?: Json | null
          user_id: string
        }
        Update: {
          bounding_box?: Json | null
          confidence?: number | null
          created_at?: string
          detection_type?: string
          evidence_frame_id?: string | null
          face_present?: boolean | null
          id?: string
          job_id?: string
          label?: string | null
          raw?: Json | null
          safe_search?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visual_detections_evidence_frame_id_fkey"
            columns: ["evidence_frame_id"]
            isOneToOne: false
            referencedRelation: "evidence_frames"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visual_detections_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multimedia_analysis_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "analyst" | "user" | "super_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "analyst", "user", "super_admin"],
    },
  },
} as const
