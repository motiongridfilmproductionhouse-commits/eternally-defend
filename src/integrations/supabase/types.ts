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
      account_audit_log: {
        Row: {
          account_id: string
          action: string
          actor_id: string | null
          created_at: string
          from_status:
            | Database["public"]["Enums"]["discovered_account_status"]
            | null
          id: string
          meta: Json
          to_status:
            | Database["public"]["Enums"]["discovered_account_status"]
            | null
        }
        Insert: {
          account_id: string
          action: string
          actor_id?: string | null
          created_at?: string
          from_status?:
            | Database["public"]["Enums"]["discovered_account_status"]
            | null
          id?: string
          meta?: Json
          to_status?:
            | Database["public"]["Enums"]["discovered_account_status"]
            | null
        }
        Update: {
          account_id?: string
          action?: string
          actor_id?: string | null
          created_at?: string
          from_status?:
            | Database["public"]["Enums"]["discovered_account_status"]
            | null
          id?: string
          meta?: Json
          to_status?:
            | Database["public"]["Enums"]["discovered_account_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "account_audit_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "discovered_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_verifications: {
        Row: {
          account_id: string
          code: string | null
          created_at: string
          evidence: Json
          expires_at: string | null
          id: string
          method: Database["public"]["Enums"]["verification_method"]
          reviewer_id: string | null
          state: Database["public"]["Enums"]["verification_state"]
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          account_id: string
          code?: string | null
          created_at?: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          method: Database["public"]["Enums"]["verification_method"]
          reviewer_id?: string | null
          state?: Database["public"]["Enums"]["verification_state"]
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          account_id?: string
          code?: string | null
          created_at?: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          method?: Database["public"]["Enums"]["verification_method"]
          reviewer_id?: string | null
          state?: Database["public"]["Enums"]["verification_state"]
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_verifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "discovered_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
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
      asset_verification_events: {
        Row: {
          asset_id: string | null
          created_at: string
          event: string
          id: string
          payload: Json | null
          user_id: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          event: string
          id?: string
          payload?: Json | null
          user_id: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          event?: string
          id?: string
          payload?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_verification_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "digital_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      authorization_admin_reviews: {
        Row: {
          authorization_id: string
          decided_at: string
          decision: string
          id: string
          notes: string | null
          reviewer_id: string | null
          user_id: string
        }
        Insert: {
          authorization_id: string
          decided_at?: string
          decision: string
          id?: string
          notes?: string | null
          reviewer_id?: string | null
          user_id: string
        }
        Update: {
          authorization_id?: string
          decided_at?: string
          decision?: string
          id?: string
          notes?: string | null
          reviewer_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "authorization_admin_reviews_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "client_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      authorization_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          payload: Json | null
          target: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          payload?: Json | null
          target?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          payload?: Json | null
          target?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      authorization_documents: {
        Row: {
          authorization_id: string
          created_at: string
          id: string
          kind: string
          s3_key: string
          sha256: string | null
          user_id: string
          version: number | null
        }
        Insert: {
          authorization_id: string
          created_at?: string
          id?: string
          kind: string
          s3_key: string
          sha256?: string | null
          user_id: string
          version?: number | null
        }
        Update: {
          authorization_id?: string
          created_at?: string
          id?: string
          kind?: string
          s3_key?: string
          sha256?: string | null
          user_id?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "authorization_documents_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "client_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      authorization_records: {
        Row: {
          active: boolean
          authorization_level: Database["public"]["Enums"]["authorization_level_enum"]
          consent_version: string
          consents: Json
          created_at: string
          id: string
          ip_address: string | null
          legal_name: string
          onboarding_version: string
          signature_hash: string
          signature_text: string
          signed_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          authorization_level: Database["public"]["Enums"]["authorization_level_enum"]
          consent_version: string
          consents: Json
          created_at?: string
          id?: string
          ip_address?: string | null
          legal_name: string
          onboarding_version: string
          signature_hash: string
          signature_text: string
          signed_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          authorization_level?: Database["public"]["Enums"]["authorization_level_enum"]
          consent_version?: string
          consents?: Json
          created_at?: string
          id?: string
          ip_address?: string | null
          legal_name?: string
          onboarding_version?: string
          signature_hash?: string
          signature_text?: string
          signed_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      authorization_scopes: {
        Row: {
          authorization_id: string
          created_at: string
          granted: boolean
          id: string
          scope_key: string
          user_id: string
        }
        Insert: {
          authorization_id: string
          created_at?: string
          granted?: boolean
          id?: string
          scope_key: string
          user_id: string
        }
        Update: {
          authorization_id?: string
          created_at?: string
          granted?: boolean
          id?: string
          scope_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "authorization_scopes_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "client_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      authorization_signatures: {
        Row: {
          authorization_id: string
          created_at: string
          document_sha256: string | null
          drawn_signature_svg: string | null
          id: string
          ip_address: string | null
          otp_verified_at: string | null
          role_title: string | null
          signed_at: string | null
          status: Database["public"]["Enums"]["signature_status"]
          typed_name: string | null
          user_agent: string | null
          user_id: string
          version: number
        }
        Insert: {
          authorization_id: string
          created_at?: string
          document_sha256?: string | null
          drawn_signature_svg?: string | null
          id?: string
          ip_address?: string | null
          otp_verified_at?: string | null
          role_title?: string | null
          signed_at?: string | null
          status?: Database["public"]["Enums"]["signature_status"]
          typed_name?: string | null
          user_agent?: string | null
          user_id: string
          version: number
        }
        Update: {
          authorization_id?: string
          created_at?: string
          document_sha256?: string | null
          drawn_signature_svg?: string | null
          id?: string
          ip_address?: string | null
          otp_verified_at?: string | null
          role_title?: string | null
          signed_at?: string | null
          status?: Database["public"]["Enums"]["signature_status"]
          typed_name?: string | null
          user_agent?: string | null
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "authorization_signatures_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "client_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      authorization_versions: {
        Row: {
          authorization_id: string
          created_at: string
          id: string
          snapshot: Json
          user_id: string
          version: number
        }
        Insert: {
          authorization_id: string
          created_at?: string
          id?: string
          snapshot: Json
          user_id: string
          version: number
        }
        Update: {
          authorization_id?: string
          created_at?: string
          id?: string
          snapshot?: Json
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "authorization_versions_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "client_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      biometric_consents: {
        Row: {
          consent_version: string
          consents: Json
          id: string
          ip_address: string | null
          revoked_at: string | null
          signed_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          consent_version: string
          consents: Json
          id?: string
          ip_address?: string | null
          revoked_at?: string | null
          signed_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          consent_version?: string
          consents?: Json
          id?: string
          ip_address?: string | null
          revoked_at?: string | null
          signed_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
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
      case_findings: {
        Row: {
          case_id: string
          created_at: string
          id: string
          note: string | null
          scan_hit_id: string | null
          user_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          note?: string | null
          scan_hit_id?: string | null
          user_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          note?: string | null
          scan_hit_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_findings_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_findings_scan_hit_id_fkey"
            columns: ["scan_hit_id"]
            isOneToOne: false
            referencedRelation: "scan_hits"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          assignee: string | null
          closed_at: string | null
          created_at: string
          id: string
          metadata: Json
          notes: string | null
          opened_at: string
          priority: string
          status: string
          subject: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assignee?: string | null
          closed_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          notes?: string | null
          opened_at?: string
          priority?: string
          status?: string
          subject: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assignee?: string | null
          closed_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          notes?: string | null
          opened_at?: string
          priority?: string
          status?: string
          subject?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      client_authorizations: {
        Row: {
          auth_number: string
          created_at: string
          effective_date: string | null
          enforcement_enabled: boolean
          expiry_date: string | null
          id: string
          snapshot: Json | null
          status: Database["public"]["Enums"]["authorization_status"]
          territory: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          auth_number: string
          created_at?: string
          effective_date?: string | null
          enforcement_enabled?: boolean
          expiry_date?: string | null
          id?: string
          snapshot?: Json | null
          status?: Database["public"]["Enums"]["authorization_status"]
          territory?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          auth_number?: string
          created_at?: string
          effective_date?: string | null
          enforcement_enabled?: boolean
          expiry_date?: string | null
          id?: string
          snapshot?: Json | null
          status?: Database["public"]["Enums"]["authorization_status"]
          territory?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      client_profiles: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type_enum"] | null
          address: string | null
          authorization_level:
            | Database["public"]["Enums"]["authorization_level_enum"]
            | null
          authorization_status: Database["public"]["Enums"]["authorization_status_enum"]
          business_reg_number: string | null
          client_id: string | null
          client_type: Database["public"]["Enums"]["client_type_enum"] | null
          company_email: string | null
          company_name: string | null
          contact_person: string | null
          country: string | null
          created_at: string
          display_name: string | null
          email: string | null
          email_verified_at: string | null
          full_name: string | null
          gov_id_ref: string | null
          legal_name: string | null
          official_socials: Json
          onboarding_completed: boolean
          onboarding_step: number
          onboarding_version: string
          phone: string | null
          phone_verified_at: string | null
          role_title: string | null
          sidebar_collapsed: boolean
          social_profiles: Json
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type_enum"] | null
          address?: string | null
          authorization_level?:
            | Database["public"]["Enums"]["authorization_level_enum"]
            | null
          authorization_status?: Database["public"]["Enums"]["authorization_status_enum"]
          business_reg_number?: string | null
          client_id?: string | null
          client_type?: Database["public"]["Enums"]["client_type_enum"] | null
          company_email?: string | null
          company_name?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          email_verified_at?: string | null
          full_name?: string | null
          gov_id_ref?: string | null
          legal_name?: string | null
          official_socials?: Json
          onboarding_completed?: boolean
          onboarding_step?: number
          onboarding_version?: string
          phone?: string | null
          phone_verified_at?: string | null
          role_title?: string | null
          sidebar_collapsed?: boolean
          social_profiles?: Json
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type_enum"] | null
          address?: string | null
          authorization_level?:
            | Database["public"]["Enums"]["authorization_level_enum"]
            | null
          authorization_status?: Database["public"]["Enums"]["authorization_status_enum"]
          business_reg_number?: string | null
          client_id?: string | null
          client_type?: Database["public"]["Enums"]["client_type_enum"] | null
          company_email?: string | null
          company_name?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          email_verified_at?: string | null
          full_name?: string | null
          gov_id_ref?: string | null
          legal_name?: string | null
          official_socials?: Json
          onboarding_completed?: boolean
          onboarding_step?: number
          onboarding_version?: string
          phone?: string | null
          phone_verified_at?: string | null
          role_title?: string | null
          sidebar_collapsed?: boolean
          social_profiles?: Json
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      digital_assets: {
        Row: {
          channel_id: string | null
          channel_url: string | null
          created_at: string
          handle: string | null
          id: string
          kind: string
          metadata: Json
          name: string | null
          updated_at: string
          user_id: string
          verification_method: string | null
          verification_status: Database["public"]["Enums"]["asset_verification_status"]
          verified_at: string | null
        }
        Insert: {
          channel_id?: string | null
          channel_url?: string | null
          created_at?: string
          handle?: string | null
          id?: string
          kind: string
          metadata?: Json
          name?: string | null
          updated_at?: string
          user_id: string
          verification_method?: string | null
          verification_status?: Database["public"]["Enums"]["asset_verification_status"]
          verified_at?: string | null
        }
        Update: {
          channel_id?: string | null
          channel_url?: string | null
          created_at?: string
          handle?: string | null
          id?: string
          kind?: string
          metadata?: Json
          name?: string | null
          updated_at?: string
          user_id?: string
          verification_method?: string | null
          verification_status?: Database["public"]["Enums"]["asset_verification_status"]
          verified_at?: string | null
        }
        Relationships: []
      }
      discovered_accounts: {
        Row: {
          bio: string | null
          confidence: number
          created_at: string
          cross_links: Json
          decided_at: string | null
          discovery_source: Database["public"]["Enums"]["discovery_source"]
          display_name: string | null
          follower_count: number | null
          handle: string | null
          id: string
          match_reasons: string[]
          match_signals: Json
          platform: Database["public"]["Enums"]["discovered_platform"]
          platform_verified: boolean
          profile_image_url: string | null
          profile_url: string
          status: Database["public"]["Enums"]["discovered_account_status"]
          subject_id: string
          updated_at: string
          user_decision:
            | Database["public"]["Enums"]["discovered_user_decision"]
            | null
          user_id: string
          website_links: Json
        }
        Insert: {
          bio?: string | null
          confidence?: number
          created_at?: string
          cross_links?: Json
          decided_at?: string | null
          discovery_source?: Database["public"]["Enums"]["discovery_source"]
          display_name?: string | null
          follower_count?: number | null
          handle?: string | null
          id?: string
          match_reasons?: string[]
          match_signals?: Json
          platform: Database["public"]["Enums"]["discovered_platform"]
          platform_verified?: boolean
          profile_image_url?: string | null
          profile_url: string
          status?: Database["public"]["Enums"]["discovered_account_status"]
          subject_id: string
          updated_at?: string
          user_decision?:
            | Database["public"]["Enums"]["discovered_user_decision"]
            | null
          user_id: string
          website_links?: Json
        }
        Update: {
          bio?: string | null
          confidence?: number
          created_at?: string
          cross_links?: Json
          decided_at?: string | null
          discovery_source?: Database["public"]["Enums"]["discovery_source"]
          display_name?: string | null
          follower_count?: number | null
          handle?: string | null
          id?: string
          match_reasons?: string[]
          match_signals?: Json
          platform?: Database["public"]["Enums"]["discovered_platform"]
          platform_verified?: boolean
          profile_image_url?: string | null
          profile_url?: string
          status?: Database["public"]["Enums"]["discovered_account_status"]
          subject_id?: string
          updated_at?: string
          user_decision?:
            | Database["public"]["Enums"]["discovered_user_decision"]
            | null
          user_id?: string
          website_links?: Json
        }
        Relationships: [
          {
            foreignKeyName: "discovered_accounts_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "discovery_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_subjects: {
        Row: {
          country: string | null
          created_at: string
          id: string
          normalized_name: string | null
          notes: string | null
          org: string | null
          query: string
          subject_kind: Database["public"]["Enums"]["discovery_subject_kind"]
          updated_at: string
          user_id: string
          website_domain: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          id?: string
          normalized_name?: string | null
          notes?: string | null
          org?: string | null
          query: string
          subject_kind: Database["public"]["Enums"]["discovery_subject_kind"]
          updated_at?: string
          user_id: string
          website_domain?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          id?: string
          normalized_name?: string | null
          notes?: string | null
          org?: string | null
          query?: string
          subject_kind?: Database["public"]["Enums"]["discovery_subject_kind"]
          updated_at?: string
          user_id?: string
          website_domain?: string | null
        }
        Relationships: []
      }
      dmca_submissions: {
        Row: {
          copyright_basis: string
          created_at: string
          enforcement_request_id: string | null
          external_reference: string | null
          id: string
          package_path: string | null
          platform: string
          protected_asset_id: string | null
          response: Json | null
          submission_status: string
          submitted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          copyright_basis: string
          created_at?: string
          enforcement_request_id?: string | null
          external_reference?: string | null
          id?: string
          package_path?: string | null
          platform: string
          protected_asset_id?: string | null
          response?: Json | null
          submission_status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          copyright_basis?: string
          created_at?: string
          enforcement_request_id?: string | null
          external_reference?: string | null
          id?: string
          package_path?: string | null
          platform?: string
          protected_asset_id?: string | null
          response?: Json | null
          submission_status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dmca_submissions_enforcement_request_id_fkey"
            columns: ["enforcement_request_id"]
            isOneToOne: false
            referencedRelation: "enforcement_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dmca_submissions_protected_asset_id_fkey"
            columns: ["protected_asset_id"]
            isOneToOne: false
            referencedRelation: "protected_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      enforcement_actions: {
        Row: {
          action_type: string
          actor_id: string
          created_at: string
          enforcement_request_id: string | null
          evidence_ids: string[]
          generated_files: Json
          id: string
          payload: Json
          platform: string | null
          submission_status: string | null
          target_url: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          actor_id: string
          created_at?: string
          enforcement_request_id?: string | null
          evidence_ids?: string[]
          generated_files?: Json
          id?: string
          payload?: Json
          platform?: string | null
          submission_status?: string | null
          target_url?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          actor_id?: string
          created_at?: string
          enforcement_request_id?: string | null
          evidence_ids?: string[]
          generated_files?: Json
          id?: string
          payload?: Json
          platform?: string | null
          submission_status?: string | null
          target_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enforcement_actions_enforcement_request_id_fkey"
            columns: ["enforcement_request_id"]
            isOneToOne: false
            referencedRelation: "enforcement_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      enforcement_evidence: {
        Row: {
          created_at: string
          enforcement_request_id: string
          evidence_type: string
          id: string
          payload: Json
          reference: string | null
          storage_path: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          enforcement_request_id: string
          evidence_type: string
          id?: string
          payload?: Json
          reference?: string | null
          storage_path?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          enforcement_request_id?: string
          evidence_type?: string
          id?: string
          payload?: Json
          reference?: string | null
          storage_path?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enforcement_evidence_enforcement_request_id_fkey"
            columns: ["enforcement_request_id"]
            isOneToOne: false
            referencedRelation: "enforcement_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      enforcement_package_items: {
        Row: {
          bytes: number | null
          enforcement_request_id: string
          generated_at: string
          id: string
          kind: string
          sha256: string | null
          storage_bucket: string
          storage_path: string
          user_id: string
        }
        Insert: {
          bytes?: number | null
          enforcement_request_id: string
          generated_at?: string
          id?: string
          kind: string
          sha256?: string | null
          storage_bucket?: string
          storage_path: string
          user_id: string
        }
        Update: {
          bytes?: number | null
          enforcement_request_id?: string
          generated_at?: string
          id?: string
          kind?: string
          sha256?: string | null
          storage_bucket?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enforcement_package_items_enforcement_request_id_fkey"
            columns: ["enforcement_request_id"]
            isOneToOne: false
            referencedRelation: "enforcement_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      enforcement_requests: {
        Row: {
          authorization_pdf_path: string | null
          created_at: string
          evidence_pdf_path: string | null
          evidence_refs: Json
          id: string
          metadata: Json
          method: string
          package_generated_at: string | null
          package_hash: string | null
          platform: string
          platform_complaint_json: Json | null
          platform_complaint_pdf_path: string | null
          responded_at: string | null
          response_notes: string | null
          scan_hit_id: string | null
          status: string
          submission_status: string
          submitted_at: string | null
          target_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          authorization_pdf_path?: string | null
          created_at?: string
          evidence_pdf_path?: string | null
          evidence_refs?: Json
          id?: string
          metadata?: Json
          method: string
          package_generated_at?: string | null
          package_hash?: string | null
          platform: string
          platform_complaint_json?: Json | null
          platform_complaint_pdf_path?: string | null
          responded_at?: string | null
          response_notes?: string | null
          scan_hit_id?: string | null
          status?: string
          submission_status?: string
          submitted_at?: string | null
          target_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          authorization_pdf_path?: string | null
          created_at?: string
          evidence_pdf_path?: string | null
          evidence_refs?: Json
          id?: string
          metadata?: Json
          method?: string
          package_generated_at?: string | null
          package_hash?: string | null
          platform?: string
          platform_complaint_json?: Json | null
          platform_complaint_pdf_path?: string | null
          responded_at?: string | null
          response_notes?: string | null
          scan_hit_id?: string | null
          status?: string
          submission_status?: string
          submitted_at?: string | null
          target_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enforcement_requests_scan_hit_id_fkey"
            columns: ["scan_hit_id"]
            isOneToOne: false
            referencedRelation: "scan_hits"
            referencedColumns: ["id"]
          },
        ]
      }
      enforcement_status_history: {
        Row: {
          created_at: string
          enforcement_request_id: string
          from_status: string | null
          id: string
          note: string | null
          to_status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enforcement_request_id: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status: string
          user_id: string
        }
        Update: {
          created_at?: string
          enforcement_request_id?: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enforcement_status_history_enforcement_request_id_fkey"
            columns: ["enforcement_request_id"]
            isOneToOne: false
            referencedRelation: "enforcement_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      enforcement_targets: {
        Row: {
          channel_name: string | null
          channel_url: string | null
          created_at: string
          enforcement_request_id: string
          id: string
          metadata: Json
          platform: string
          scan_hit_id: string | null
          target_url: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel_name?: string | null
          channel_url?: string | null
          created_at?: string
          enforcement_request_id: string
          id?: string
          metadata?: Json
          platform: string
          scan_hit_id?: string | null
          target_url: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel_name?: string | null
          channel_url?: string | null
          created_at?: string
          enforcement_request_id?: string
          id?: string
          metadata?: Json
          platform?: string
          scan_hit_id?: string | null
          target_url?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enforcement_targets_enforcement_request_id_fkey"
            columns: ["enforcement_request_id"]
            isOneToOne: false
            referencedRelation: "enforcement_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enforcement_targets_scan_hit_id_fkey"
            columns: ["scan_hit_id"]
            isOneToOne: false
            referencedRelation: "scan_hits"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprise_documents: {
        Row: {
          doc_type: Database["public"]["Enums"]["enterprise_doc_type_enum"]
          filename: string
          id: string
          mime: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_at: string
          user_id: string
        }
        Insert: {
          doc_type: Database["public"]["Enums"]["enterprise_doc_type_enum"]
          filename: string
          id?: string
          mime?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_at?: string
          user_id: string
        }
        Update: {
          doc_type?: Database["public"]["Enums"]["enterprise_doc_type_enum"]
          filename?: string
          id?: string
          mime?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_at?: string
          user_id?: string
        }
        Relationships: []
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
      evidence_vault_items: {
        Row: {
          bytes: number | null
          case_id: string | null
          content_type: string | null
          created_at: string
          enforcement_request_id: string | null
          face_match_event_id: string | null
          id: string
          kind: string
          label: string | null
          metadata: Json | null
          s3_bucket: string
          s3_key: string
          scan_hit_id: string | null
          sha256: string | null
          user_id: string
        }
        Insert: {
          bytes?: number | null
          case_id?: string | null
          content_type?: string | null
          created_at?: string
          enforcement_request_id?: string | null
          face_match_event_id?: string | null
          id?: string
          kind: string
          label?: string | null
          metadata?: Json | null
          s3_bucket: string
          s3_key: string
          scan_hit_id?: string | null
          sha256?: string | null
          user_id: string
        }
        Update: {
          bytes?: number | null
          case_id?: string | null
          content_type?: string | null
          created_at?: string
          enforcement_request_id?: string | null
          face_match_event_id?: string | null
          id?: string
          kind?: string
          label?: string | null
          metadata?: Json | null
          s3_bucket?: string
          s3_key?: string
          scan_hit_id?: string | null
          sha256?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_vault_items_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_vault_items_enforcement_request_id_fkey"
            columns: ["enforcement_request_id"]
            isOneToOne: false
            referencedRelation: "enforcement_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_vault_items_face_match_event_id_fkey"
            columns: ["face_match_event_id"]
            isOneToOne: false
            referencedRelation: "face_match_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_vault_items_scan_hit_id_fkey"
            columns: ["scan_hit_id"]
            isOneToOne: false
            referencedRelation: "scan_hits"
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
      face_match_events: {
        Row: {
          bounding_box: Json | null
          collection_id: string
          context_notes: string | null
          created_at: string
          enforcement_request_id: string | null
          face_confidence: number | null
          id: string
          image_s3_bucket: string | null
          image_s3_key: string | null
          matched_asset_id: string | null
          matched_face_id: string | null
          matched_protected_face_id: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          scan_hit_id: string | null
          similarity: number | null
          source_type: string | null
          source_url: string | null
          threat_category: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bounding_box?: Json | null
          collection_id: string
          context_notes?: string | null
          created_at?: string
          enforcement_request_id?: string | null
          face_confidence?: number | null
          id?: string
          image_s3_bucket?: string | null
          image_s3_key?: string | null
          matched_asset_id?: string | null
          matched_face_id?: string | null
          matched_protected_face_id?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_hit_id?: string | null
          similarity?: number | null
          source_type?: string | null
          source_url?: string | null
          threat_category?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bounding_box?: Json | null
          collection_id?: string
          context_notes?: string | null
          created_at?: string
          enforcement_request_id?: string | null
          face_confidence?: number | null
          id?: string
          image_s3_bucket?: string | null
          image_s3_key?: string | null
          matched_asset_id?: string | null
          matched_face_id?: string | null
          matched_protected_face_id?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_hit_id?: string | null
          similarity?: number | null
          source_type?: string | null
          source_url?: string | null
          threat_category?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "face_match_events_enforcement_request_id_fkey"
            columns: ["enforcement_request_id"]
            isOneToOne: false
            referencedRelation: "enforcement_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_match_events_matched_asset_id_fkey"
            columns: ["matched_asset_id"]
            isOneToOne: false
            referencedRelation: "protected_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_match_events_matched_protected_face_id_fkey"
            columns: ["matched_protected_face_id"]
            isOneToOne: false
            referencedRelation: "protected_faces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_match_events_scan_hit_id_fkey"
            columns: ["scan_hit_id"]
            isOneToOne: false
            referencedRelation: "scan_hits"
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
      generated_reports: {
        Row: {
          created_at: string
          filters: Json
          findings_count: number
          id: string
          kind: string
          name: string
          pdf_url: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          findings_count?: number
          id?: string
          kind?: string
          name: string
          pdf_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          findings_count?: number
          id?: string
          kind?: string
          name?: string
          pdf_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      kyc_verifications: {
        Row: {
          client_id: string | null
          country: string | null
          created_at: string
          document_type: string | null
          id: string
          provider_reference: string | null
          raw_webhook: Json | null
          review_reason: string | null
          session_url: string | null
          updated_at: string
          user_id: string
          veriff_session_id: string | null
          verification_date: string | null
          verification_status: Database["public"]["Enums"]["kyc_status"]
        }
        Insert: {
          client_id?: string | null
          country?: string | null
          created_at?: string
          document_type?: string | null
          id?: string
          provider_reference?: string | null
          raw_webhook?: Json | null
          review_reason?: string | null
          session_url?: string | null
          updated_at?: string
          user_id: string
          veriff_session_id?: string | null
          verification_date?: string | null
          verification_status?: Database["public"]["Enums"]["kyc_status"]
        }
        Update: {
          client_id?: string | null
          country?: string | null
          created_at?: string
          document_type?: string | null
          id?: string
          provider_reference?: string | null
          raw_webhook?: Json | null
          review_reason?: string | null
          session_url?: string | null
          updated_at?: string
          user_id?: string
          veriff_session_id?: string | null
          verification_date?: string | null
          verification_status?: Database["public"]["Enums"]["kyc_status"]
        }
        Relationships: []
      }
      legal_cases: {
        Row: {
          attorney: string | null
          case_id: string | null
          case_number: string | null
          created_at: string
          enforcement_request_id: string | null
          filed_at: string | null
          id: string
          notes: string | null
          package_path: string | null
          stage: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attorney?: string | null
          case_id?: string | null
          case_number?: string | null
          created_at?: string
          enforcement_request_id?: string | null
          filed_at?: string | null
          id?: string
          notes?: string | null
          package_path?: string | null
          stage?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attorney?: string | null
          case_id?: string | null
          case_number?: string | null
          created_at?: string
          enforcement_request_id?: string | null
          filed_at?: string | null
          id?: string
          notes?: string | null
          package_path?: string | null
          stage?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_cases_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_cases_enforcement_request_id_fkey"
            columns: ["enforcement_request_id"]
            isOneToOne: false
            referencedRelation: "enforcement_requests"
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
      onboarding_assets: {
        Row: {
          asset_kind: Database["public"]["Enums"]["asset_kind_enum"]
          created_at: string
          id: string
          label: string
          metadata: Json
          storage_path: string | null
          updated_at: string
          url: string | null
          user_id: string
          value: string | null
        }
        Insert: {
          asset_kind: Database["public"]["Enums"]["asset_kind_enum"]
          created_at?: string
          id?: string
          label: string
          metadata?: Json
          storage_path?: string | null
          updated_at?: string
          url?: string | null
          user_id: string
          value?: string | null
        }
        Update: {
          asset_kind?: Database["public"]["Enums"]["asset_kind_enum"]
          created_at?: string
          id?: string
          label?: string
          metadata?: Json
          storage_path?: string | null
          updated_at?: string
          url?: string | null
          user_id?: string
          value?: string | null
        }
        Relationships: []
      }
      onboarding_audit_log: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_address: string | null
          payload: Json
          step: number | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_address?: string | null
          payload?: Json
          step?: number | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          payload?: Json
          step?: number | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      onboarding_progress: {
        Row: {
          created_at: string
          current_step: number
          overall_status: Database["public"]["Enums"]["onboarding_overall_status"]
          step_states: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_step?: number
          overall_status?: Database["public"]["Enums"]["onboarding_overall_status"]
          step_states?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_step?: number
          overall_status?: Database["public"]["Enums"]["onboarding_overall_status"]
          step_states?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_reports: {
        Row: {
          created_at: string
          enforcement_request_id: string | null
          external_reference: string | null
          form_payload: Json
          id: string
          platform: string
          report_type: string
          response: Json | null
          submission_status: string
          submitted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enforcement_request_id?: string | null
          external_reference?: string | null
          form_payload?: Json
          id?: string
          platform: string
          report_type: string
          response?: Json | null
          submission_status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enforcement_request_id?: string | null
          external_reference?: string | null
          form_payload?: Json
          id?: string
          platform?: string
          report_type?: string
          response?: Json | null
          submission_status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_reports_enforcement_request_id_fkey"
            columns: ["enforcement_request_id"]
            isOneToOne: false
            referencedRelation: "enforcement_requests"
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
          discovered_account_id: string | null
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
          discovered_account_id?: string | null
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
          discovered_account_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "protected_assets_discovered_account_id_fkey"
            columns: ["discovered_account_id"]
            isOneToOne: false
            referencedRelation: "discovered_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      protected_face_profiles: {
        Row: {
          collection_id: string
          created_at: string
          enrollment_date: string | null
          id: string
          liveness_score: number | null
          liveness_session_id: string | null
          rekognition_user_id: string | null
          status: Database["public"]["Enums"]["face_profile_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          enrollment_date?: string | null
          id?: string
          liveness_score?: number | null
          liveness_session_id?: string | null
          rekognition_user_id?: string | null
          status?: Database["public"]["Enums"]["face_profile_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          enrollment_date?: string | null
          id?: string
          liveness_score?: number | null
          liveness_session_id?: string | null
          rekognition_user_id?: string | null
          status?: Database["public"]["Enums"]["face_profile_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      protected_face_references: {
        Row: {
          created_at: string
          face_id: string | null
          id: string
          profile_id: string
          quality_scores: Json | null
          s3_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          face_id?: string | null
          id?: string
          profile_id: string
          quality_scores?: Json | null
          s3_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          face_id?: string | null
          id?: string
          profile_id?: string
          quality_scores?: Json | null
          s3_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "protected_face_references_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "protected_face_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      protected_faces: {
        Row: {
          asset_id: string | null
          bounding_box: Json | null
          collection_id: string
          confidence: number | null
          created_at: string
          discovered_account_id: string | null
          external_image_id: string | null
          face_id: string
          id: string
          image_id: string | null
          label: string | null
          platform: string | null
          s3_bucket: string
          s3_key: string
          source_url: string | null
          user_id: string
        }
        Insert: {
          asset_id?: string | null
          bounding_box?: Json | null
          collection_id: string
          confidence?: number | null
          created_at?: string
          discovered_account_id?: string | null
          external_image_id?: string | null
          face_id: string
          id?: string
          image_id?: string | null
          label?: string | null
          platform?: string | null
          s3_bucket: string
          s3_key: string
          source_url?: string | null
          user_id: string
        }
        Update: {
          asset_id?: string | null
          bounding_box?: Json | null
          collection_id?: string
          confidence?: number | null
          created_at?: string
          discovered_account_id?: string | null
          external_image_id?: string | null
          face_id?: string
          id?: string
          image_id?: string | null
          label?: string | null
          platform?: string | null
          s3_bucket?: string
          s3_key?: string
          source_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "protected_faces_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "protected_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protected_faces_discovered_account_id_fkey"
            columns: ["discovered_account_id"]
            isOneToOne: false
            referencedRelation: "discovered_accounts"
            referencedColumns: ["id"]
          },
        ]
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
      rekognition_collections: {
        Row: {
          collection_id: string
          created_at: string
          face_count: number
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          face_count?: number
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          face_count?: number
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scan_hits: {
        Row: {
          author: string | null
          author_handle: string | null
          canonical_url: string | null
          country: string | null
          created_at: string
          description: string | null
          detected_at: string
          engagement: number | null
          evidence_refs: Json
          external_id: string | null
          first_seen_at: string
          growth_pct: number | null
          hidden_at: string | null
          hidden_by_user_id: string | null
          hidden_reason: string | null
          id: string
          is_new_since_last_scan: boolean
          language: string | null
          last_seen_at: string
          metrics: Json
          narrative_claim: string | null
          organisation_id: string | null
          permalink: string | null
          previous_scan_id: string | null
          previous_scan_seen: boolean
          protection_profile_id: string | null
          published_at: string | null
          purge_after: string | null
          reach: number | null
          retention_class: string
          risk_score: number | null
          risk_type: string | null
          scan_id: string
          severity: string | null
          source: string
          source_metadata: Json
          source_type: string | null
          tags: string[]
          threat_score: number | null
          thumbnail_url: string | null
          times_detected: number
          title: string | null
          updated_at: string
          user_id: string
          velocity: string | null
        }
        Insert: {
          author?: string | null
          author_handle?: string | null
          canonical_url?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          detected_at?: string
          engagement?: number | null
          evidence_refs?: Json
          external_id?: string | null
          first_seen_at?: string
          growth_pct?: number | null
          hidden_at?: string | null
          hidden_by_user_id?: string | null
          hidden_reason?: string | null
          id?: string
          is_new_since_last_scan?: boolean
          language?: string | null
          last_seen_at?: string
          metrics?: Json
          narrative_claim?: string | null
          organisation_id?: string | null
          permalink?: string | null
          previous_scan_id?: string | null
          previous_scan_seen?: boolean
          protection_profile_id?: string | null
          published_at?: string | null
          purge_after?: string | null
          reach?: number | null
          retention_class?: string
          risk_score?: number | null
          risk_type?: string | null
          scan_id: string
          severity?: string | null
          source: string
          source_metadata?: Json
          source_type?: string | null
          tags?: string[]
          threat_score?: number | null
          thumbnail_url?: string | null
          times_detected?: number
          title?: string | null
          updated_at?: string
          user_id: string
          velocity?: string | null
        }
        Update: {
          author?: string | null
          author_handle?: string | null
          canonical_url?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          detected_at?: string
          engagement?: number | null
          evidence_refs?: Json
          external_id?: string | null
          first_seen_at?: string
          growth_pct?: number | null
          hidden_at?: string | null
          hidden_by_user_id?: string | null
          hidden_reason?: string | null
          id?: string
          is_new_since_last_scan?: boolean
          language?: string | null
          last_seen_at?: string
          metrics?: Json
          narrative_claim?: string | null
          organisation_id?: string | null
          permalink?: string | null
          previous_scan_id?: string | null
          previous_scan_seen?: boolean
          protection_profile_id?: string | null
          published_at?: string | null
          purge_after?: string | null
          reach?: number | null
          retention_class?: string
          risk_score?: number | null
          risk_type?: string | null
          scan_id?: string
          severity?: string | null
          source?: string
          source_metadata?: Json
          source_type?: string | null
          tags?: string[]
          threat_score?: number | null
          thumbnail_url?: string | null
          times_detected?: number
          title?: string | null
          updated_at?: string
          user_id?: string
          velocity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scan_hits_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
        ]
      }
      scans: {
        Row: {
          completed_at: string | null
          created_at: string
          duplicate_hits_removed: number
          error: string | null
          id: string
          name: string | null
          new_hits: number
          organisation_id: string | null
          params: Json
          period: string | null
          period_end: string | null
          period_start: string | null
          protection_profile_id: string | null
          query: string | null
          sources: string[]
          started_at: string | null
          status: string
          total_hits: number
          unique_hits: number
          updated_at: string
          updated_hits: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          duplicate_hits_removed?: number
          error?: string | null
          id?: string
          name?: string | null
          new_hits?: number
          organisation_id?: string | null
          params?: Json
          period?: string | null
          period_end?: string | null
          period_start?: string | null
          protection_profile_id?: string | null
          query?: string | null
          sources?: string[]
          started_at?: string | null
          status?: string
          total_hits?: number
          unique_hits?: number
          updated_at?: string
          updated_hits?: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          duplicate_hits_removed?: number
          error?: string | null
          id?: string
          name?: string | null
          new_hits?: number
          organisation_id?: string | null
          params?: Json
          period?: string | null
          period_end?: string | null
          period_start?: string | null
          protection_profile_id?: string | null
          query?: string | null
          sources?: string[]
          started_at?: string | null
          status?: string
          total_hits?: number
          unique_hits?: number
          updated_at?: string
          updated_hits?: number
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
      verification_certificates: {
        Row: {
          authorization_id: string
          certificate_number: string
          expires_at: string | null
          id: string
          issued_at: string
          public_slug: string
          s3_key: string | null
          score: number
          sha256: string | null
          snapshot: Json | null
          status: string
          user_id: string
        }
        Insert: {
          authorization_id: string
          certificate_number: string
          expires_at?: string | null
          id?: string
          issued_at?: string
          public_slug: string
          s3_key?: string | null
          score: number
          sha256?: string | null
          snapshot?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          authorization_id?: string
          certificate_number?: string
          expires_at?: string | null
          id?: string
          issued_at?: string
          public_slug?: string
          s3_key?: string | null
          score?: number
          sha256?: string | null
          snapshot?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_certificates_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "client_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      video_analysis_jobs: {
        Row: {
          analysis_state: string
          audio_analysis_authorised: boolean
          audio_state: string
          caption_language: string | null
          caption_source: string | null
          captions_state: string
          completed_at: string | null
          coverage_pct: number | null
          created_at: string
          error: string | null
          finding_count: number
          id: string
          organisation_id: string | null
          platform: string
          scan_hit_id: string | null
          scan_id: string | null
          started_at: string | null
          transcript_segment_count: number
          updated_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          analysis_state?: string
          audio_analysis_authorised?: boolean
          audio_state?: string
          caption_language?: string | null
          caption_source?: string | null
          captions_state?: string
          completed_at?: string | null
          coverage_pct?: number | null
          created_at?: string
          error?: string | null
          finding_count?: number
          id?: string
          organisation_id?: string | null
          platform?: string
          scan_hit_id?: string | null
          scan_id?: string | null
          started_at?: string | null
          transcript_segment_count?: number
          updated_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          analysis_state?: string
          audio_analysis_authorised?: boolean
          audio_state?: string
          caption_language?: string | null
          caption_source?: string | null
          captions_state?: string
          completed_at?: string | null
          coverage_pct?: number | null
          created_at?: string
          error?: string | null
          finding_count?: number
          id?: string
          organisation_id?: string | null
          platform?: string
          scan_hit_id?: string | null
          scan_id?: string | null
          started_at?: string | null
          transcript_segment_count?: number
          updated_at?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_analysis_jobs_scan_hit_id_fkey"
            columns: ["scan_hit_id"]
            isOneToOne: false
            referencedRelation: "scan_hits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_analysis_jobs_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
        ]
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
      video_creator_profiles: {
        Row: {
          channel_created_at: string | null
          channel_handle: string | null
          channel_id: string
          channel_name: string | null
          channel_url: string | null
          country: string | null
          created_at: string
          credibility_score: number | null
          critical_findings_count: number
          description: string | null
          estimated_total_reach: number | null
          findings_count: number
          first_detected_at: string | null
          id: string
          influence_score: number | null
          latest_detected_at: string | null
          monitoring_enabled: boolean
          organisation_id: string | null
          platform: string
          profile_image_url: string | null
          protection_profile_id: string | null
          raw: Json
          repeated_allegation_count: number
          subscriber_count: number | null
          threat_amplification_score: number | null
          total_view_count: number | null
          updated_at: string
          user_id: string
          video_count: number | null
        }
        Insert: {
          channel_created_at?: string | null
          channel_handle?: string | null
          channel_id: string
          channel_name?: string | null
          channel_url?: string | null
          country?: string | null
          created_at?: string
          credibility_score?: number | null
          critical_findings_count?: number
          description?: string | null
          estimated_total_reach?: number | null
          findings_count?: number
          first_detected_at?: string | null
          id?: string
          influence_score?: number | null
          latest_detected_at?: string | null
          monitoring_enabled?: boolean
          organisation_id?: string | null
          platform?: string
          profile_image_url?: string | null
          protection_profile_id?: string | null
          raw?: Json
          repeated_allegation_count?: number
          subscriber_count?: number | null
          threat_amplification_score?: number | null
          total_view_count?: number | null
          updated_at?: string
          user_id: string
          video_count?: number | null
        }
        Update: {
          channel_created_at?: string | null
          channel_handle?: string | null
          channel_id?: string
          channel_name?: string | null
          channel_url?: string | null
          country?: string | null
          created_at?: string
          credibility_score?: number | null
          critical_findings_count?: number
          description?: string | null
          estimated_total_reach?: number | null
          findings_count?: number
          first_detected_at?: string | null
          id?: string
          influence_score?: number | null
          latest_detected_at?: string | null
          monitoring_enabled?: boolean
          organisation_id?: string | null
          platform?: string
          profile_image_url?: string | null
          protection_profile_id?: string | null
          raw?: Json
          repeated_allegation_count?: number
          subscriber_count?: number | null
          threat_amplification_score?: number | null
          total_view_count?: number | null
          updated_at?: string
          user_id?: string
          video_count?: number | null
        }
        Relationships: []
      }
      video_creator_risk_history: {
        Row: {
          created_at: string
          creator_profile_id: string
          critical_findings_count: number
          dominant_risk_category: string | null
          estimated_total_reach: number | null
          findings_count: number
          id: string
          influence_score: number | null
          metrics: Json
          reason: string | null
          snapshot_at: string
          threat_amplification_score: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          creator_profile_id: string
          critical_findings_count?: number
          dominant_risk_category?: string | null
          estimated_total_reach?: number | null
          findings_count?: number
          id?: string
          influence_score?: number | null
          metrics?: Json
          reason?: string | null
          snapshot_at?: string
          threat_amplification_score?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          creator_profile_id?: string
          critical_findings_count?: number
          dominant_risk_category?: string | null
          estimated_total_reach?: number | null
          findings_count?: number
          id?: string
          influence_score?: number | null
          metrics?: Json
          reason?: string | null
          snapshot_at?: string
          threat_amplification_score?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_creator_risk_history_creator_profile_id_fkey"
            columns: ["creator_profile_id"]
            isOneToOne: false
            referencedRelation: "video_creator_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_timestamp_findings: {
        Row: {
          captured_at: string
          channel_id: string | null
          channel_name: string | null
          channel_url: string | null
          claim_summary: string | null
          confidence: number | null
          context_after: string | null
          context_before: string | null
          context_type: string
          created_at: string
          creator_profile_id: string | null
          end_seconds: number
          end_time_display: string | null
          evidence_source: string | null
          id: string
          matched_entity: string | null
          organisation_id: string | null
          original_language: string | null
          original_text: string
          platform: string
          protection_profile_id: string | null
          raw: Json
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          risk_category: string | null
          scan_hit_id: string | null
          scan_id: string | null
          segment_id: string | null
          severity: string | null
          speaker_label: string | null
          speaker_stance: string | null
          start_seconds: number
          start_time_display: string | null
          translated_text: string | null
          translation_language: string | null
          updated_at: string
          user_id: string
          video_id: string
          video_url: string | null
          watch_exact_moment_url: string | null
        }
        Insert: {
          captured_at?: string
          channel_id?: string | null
          channel_name?: string | null
          channel_url?: string | null
          claim_summary?: string | null
          confidence?: number | null
          context_after?: string | null
          context_before?: string | null
          context_type?: string
          created_at?: string
          creator_profile_id?: string | null
          end_seconds: number
          end_time_display?: string | null
          evidence_source?: string | null
          id?: string
          matched_entity?: string | null
          organisation_id?: string | null
          original_language?: string | null
          original_text: string
          platform?: string
          protection_profile_id?: string | null
          raw?: Json
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          risk_category?: string | null
          scan_hit_id?: string | null
          scan_id?: string | null
          segment_id?: string | null
          severity?: string | null
          speaker_label?: string | null
          speaker_stance?: string | null
          start_seconds: number
          start_time_display?: string | null
          translated_text?: string | null
          translation_language?: string | null
          updated_at?: string
          user_id: string
          video_id: string
          video_url?: string | null
          watch_exact_moment_url?: string | null
        }
        Update: {
          captured_at?: string
          channel_id?: string | null
          channel_name?: string | null
          channel_url?: string | null
          claim_summary?: string | null
          confidence?: number | null
          context_after?: string | null
          context_before?: string | null
          context_type?: string
          created_at?: string
          creator_profile_id?: string | null
          end_seconds?: number
          end_time_display?: string | null
          evidence_source?: string | null
          id?: string
          matched_entity?: string | null
          organisation_id?: string | null
          original_language?: string | null
          original_text?: string
          platform?: string
          protection_profile_id?: string | null
          raw?: Json
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          risk_category?: string | null
          scan_hit_id?: string | null
          scan_id?: string | null
          segment_id?: string | null
          severity?: string | null
          speaker_label?: string | null
          speaker_stance?: string | null
          start_seconds?: number
          start_time_display?: string | null
          translated_text?: string | null
          translation_language?: string | null
          updated_at?: string
          user_id?: string
          video_id?: string
          video_url?: string | null
          watch_exact_moment_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_timestamp_findings_creator_profile_id_fkey"
            columns: ["creator_profile_id"]
            isOneToOne: false
            referencedRelation: "video_creator_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_timestamp_findings_scan_hit_id_fkey"
            columns: ["scan_hit_id"]
            isOneToOne: false
            referencedRelation: "scan_hits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_timestamp_findings_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_timestamp_findings_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "video_transcript_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      video_transcript_segments: {
        Row: {
          confidence: number | null
          coverage_pct: number | null
          created_at: string
          end_seconds: number
          id: string
          is_auto_generated: boolean | null
          language: string | null
          organisation_id: string | null
          platform: string
          scan_hit_id: string | null
          source: string
          speaker_label: string | null
          start_seconds: number
          text: string
          translated_text: string | null
          translation_language: string | null
          user_id: string
          video_id: string
        }
        Insert: {
          confidence?: number | null
          coverage_pct?: number | null
          created_at?: string
          end_seconds: number
          id?: string
          is_auto_generated?: boolean | null
          language?: string | null
          organisation_id?: string | null
          platform?: string
          scan_hit_id?: string | null
          source: string
          speaker_label?: string | null
          start_seconds: number
          text: string
          translated_text?: string | null
          translation_language?: string | null
          user_id: string
          video_id: string
        }
        Update: {
          confidence?: number | null
          coverage_pct?: number | null
          created_at?: string
          end_seconds?: number
          id?: string
          is_auto_generated?: boolean | null
          language?: string | null
          organisation_id?: string | null
          platform?: string
          scan_hit_id?: string | null
          source?: string
          speaker_label?: string | null
          start_seconds?: number
          text?: string
          translated_text?: string | null
          translation_language?: string | null
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_transcript_segments_scan_hit_id_fkey"
            columns: ["scan_hit_id"]
            isOneToOne: false
            referencedRelation: "scan_hits"
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
      youtube_verification_challenges: {
        Row: {
          asset_id: string
          code: string
          created_at: string
          evidence: Json | null
          expires_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          asset_id: string
          code: string
          created_at?: string
          evidence?: Json | null
          expires_at: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          asset_id?: string
          code?: string
          created_at?: string
          evidence?: Json | null
          expires_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "youtube_verification_challenges_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "digital_assets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_public_verification: {
        Args: { _slug: string }
        Returns: {
          auth_number: string
          authorization_status: Database["public"]["Enums"]["authorization_status"]
          certificate_number: string
          client_id: string
          company_name: string
          display_name: string
          enforcement_enabled: boolean
          expires_at: string
          issued_at: string
          public_slug: string
          score: number
          status: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      account_type_enum: "personal" | "business"
      app_role: "admin" | "analyst" | "user" | "super_admin"
      asset_kind_enum:
        | "name"
        | "brand"
        | "company"
        | "product"
        | "social_account"
        | "youtube_channel"
        | "website"
        | "logo"
        | "image"
        | "video"
        | "copyright"
      asset_verification_status:
        | "UNVERIFIED"
        | "CODE_GENERATED"
        | "VERIFICATION_PENDING"
        | "VERIFIED"
        | "REJECTED"
        | "EXPIRED"
        | "REVOKED"
      authorization_level_enum:
        | "monitoring"
        | "monitoring_evidence"
        | "monitoring_enforcement"
        | "full_protection"
      authorization_status:
        | "DRAFT"
        | "AWAITING_KYC"
        | "AWAITING_FACE_VERIFICATION"
        | "AWAITING_ASSET_VERIFICATION"
        | "AWAITING_SIGNATURE"
        | "SIGNED"
        | "UNDER_ADMIN_REVIEW"
        | "ACTIVE"
        | "REJECTED"
        | "SUSPENDED"
        | "REVOKED"
        | "EXPIRED"
      authorization_status_enum:
        | "pending"
        | "authorized"
        | "enterprise_authorized"
      client_type_enum:
        | "individual"
        | "celebrity"
        | "creator"
        | "business"
        | "corporate"
        | "agency"
      discovered_account_status:
        | "discovered"
        | "likely_official"
        | "user_confirmed"
        | "ownership_pending"
        | "verified"
        | "rejected"
      discovered_platform:
        | "youtube"
        | "instagram"
        | "facebook"
        | "tiktok"
        | "x"
        | "linkedin"
        | "reddit"
        | "website"
      discovered_user_decision: "confirmed" | "not_mine" | "unsure"
      discovery_source:
        | "firecrawl_search"
        | "website_links"
        | "cross_link"
        | "manual"
      discovery_subject_kind:
        | "person"
        | "brand"
        | "company"
        | "domain"
        | "handle"
        | "website"
      enterprise_doc_type_enum:
        | "authorization_letter"
        | "agency_agreement"
        | "power_of_attorney"
        | "brand_protection"
      face_profile_status:
        | "NOT_STARTED"
        | "CONSENT_REQUIRED"
        | "CAMERA_PERMISSION_REQUIRED"
        | "CAPTURE_IN_PROGRESS"
        | "LIVENESS_PROCESSING"
        | "LIVENESS_FAILED"
        | "QUALITY_FAILED"
        | "FACE_VERIFIED"
        | "MANUAL_REVIEW"
        | "DELETION_REQUESTED"
        | "DELETED"
      kyc_status:
        | "NOT_STARTED"
        | "SESSION_CREATED"
        | "IN_PROGRESS"
        | "SUBMITTED"
        | "APPROVED"
        | "DECLINED"
        | "RESUBMISSION_REQUIRED"
        | "EXPIRED"
        | "MANUAL_REVIEW"
      onboarding_overall_status:
        | "NOT_STARTED"
        | "IN_PROGRESS"
        | "ACTION_REQUIRED"
        | "UNDER_REVIEW"
        | "VERIFIED"
        | "REJECTED"
        | "COMPLETED"
      signature_status:
        | "DRAFT"
        | "READY_FOR_REVIEW"
        | "AWAITING_SIGNATURE"
        | "AWAITING_OTP"
        | "SIGNED"
        | "VOIDED"
        | "SUPERSEDED"
      verification_method:
        | "oauth"
        | "domain_dns"
        | "domain_meta"
        | "business_email"
        | "bio_code"
        | "document"
        | "admin_review"
      verification_state: "pending" | "passed" | "failed" | "expired"
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
      account_type_enum: ["personal", "business"],
      app_role: ["admin", "analyst", "user", "super_admin"],
      asset_kind_enum: [
        "name",
        "brand",
        "company",
        "product",
        "social_account",
        "youtube_channel",
        "website",
        "logo",
        "image",
        "video",
        "copyright",
      ],
      asset_verification_status: [
        "UNVERIFIED",
        "CODE_GENERATED",
        "VERIFICATION_PENDING",
        "VERIFIED",
        "REJECTED",
        "EXPIRED",
        "REVOKED",
      ],
      authorization_level_enum: [
        "monitoring",
        "monitoring_evidence",
        "monitoring_enforcement",
        "full_protection",
      ],
      authorization_status: [
        "DRAFT",
        "AWAITING_KYC",
        "AWAITING_FACE_VERIFICATION",
        "AWAITING_ASSET_VERIFICATION",
        "AWAITING_SIGNATURE",
        "SIGNED",
        "UNDER_ADMIN_REVIEW",
        "ACTIVE",
        "REJECTED",
        "SUSPENDED",
        "REVOKED",
        "EXPIRED",
      ],
      authorization_status_enum: [
        "pending",
        "authorized",
        "enterprise_authorized",
      ],
      client_type_enum: [
        "individual",
        "celebrity",
        "creator",
        "business",
        "corporate",
        "agency",
      ],
      discovered_account_status: [
        "discovered",
        "likely_official",
        "user_confirmed",
        "ownership_pending",
        "verified",
        "rejected",
      ],
      discovered_platform: [
        "youtube",
        "instagram",
        "facebook",
        "tiktok",
        "x",
        "linkedin",
        "reddit",
        "website",
      ],
      discovered_user_decision: ["confirmed", "not_mine", "unsure"],
      discovery_source: [
        "firecrawl_search",
        "website_links",
        "cross_link",
        "manual",
      ],
      discovery_subject_kind: [
        "person",
        "brand",
        "company",
        "domain",
        "handle",
        "website",
      ],
      enterprise_doc_type_enum: [
        "authorization_letter",
        "agency_agreement",
        "power_of_attorney",
        "brand_protection",
      ],
      face_profile_status: [
        "NOT_STARTED",
        "CONSENT_REQUIRED",
        "CAMERA_PERMISSION_REQUIRED",
        "CAPTURE_IN_PROGRESS",
        "LIVENESS_PROCESSING",
        "LIVENESS_FAILED",
        "QUALITY_FAILED",
        "FACE_VERIFIED",
        "MANUAL_REVIEW",
        "DELETION_REQUESTED",
        "DELETED",
      ],
      kyc_status: [
        "NOT_STARTED",
        "SESSION_CREATED",
        "IN_PROGRESS",
        "SUBMITTED",
        "APPROVED",
        "DECLINED",
        "RESUBMISSION_REQUIRED",
        "EXPIRED",
        "MANUAL_REVIEW",
      ],
      onboarding_overall_status: [
        "NOT_STARTED",
        "IN_PROGRESS",
        "ACTION_REQUIRED",
        "UNDER_REVIEW",
        "VERIFIED",
        "REJECTED",
        "COMPLETED",
      ],
      signature_status: [
        "DRAFT",
        "READY_FOR_REVIEW",
        "AWAITING_SIGNATURE",
        "AWAITING_OTP",
        "SIGNED",
        "VOIDED",
        "SUPERSEDED",
      ],
      verification_method: [
        "oauth",
        "domain_dns",
        "domain_meta",
        "business_email",
        "bio_code",
        "document",
        "admin_review",
      ],
      verification_state: ["pending", "passed", "failed", "expired"],
    },
  },
} as const
