-- Migration: 20260808160000_scan_hits_numeric_overflow_fix.sql
-- Description: Fix numeric field overflow in public.scan_hits, widen metric types, safely sanitize invalid existing scores, and add 0-100 CHECK constraints on risk_score and threat_score.

-- 1. Widen column types for defensive resilience
ALTER TABLE public.scan_hits
  ALTER COLUMN risk_score TYPE NUMERIC(12,3),
  ALTER COLUMN threat_score TYPE NUMERIC(12,3),
  ALTER COLUMN growth_pct TYPE NUMERIC(12,3),
  ALTER COLUMN reach TYPE BIGINT,
  ALTER COLUMN engagement TYPE BIGINT;

-- 2. Safely normalize any invalid existing DB rows to 0..100
UPDATE public.scan_hits
SET risk_score = LEAST(100.000, GREATEST(0.000, risk_score))
WHERE risk_score IS NOT NULL AND (risk_score < 0 OR risk_score > 100);

UPDATE public.scan_hits
SET threat_score = LEAST(100.000, GREATEST(0.000, threat_score))
WHERE threat_score IS NOT NULL AND (threat_score < 0 OR threat_score > 100);

-- 3. Add CHECK constraints enforcing semantic 0..100 domain on risk_score & threat_score
ALTER TABLE public.scan_hits
  DROP CONSTRAINT IF EXISTS chk_scan_hits_risk_score,
  DROP CONSTRAINT IF EXISTS chk_scan_hits_threat_score;

ALTER TABLE public.scan_hits
  ADD CONSTRAINT chk_scan_hits_risk_score CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100)),
  ADD CONSTRAINT chk_scan_hits_threat_score CHECK (threat_score IS NULL OR (threat_score >= 0 AND threat_score <= 100));
