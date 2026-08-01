import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { pickPrimaryReferenceFace } from "@/lib/deepfake/identity-scan-viz";

const BUCKET = "deepfake-reference-faces";
const SIGNED_URL_TTL_SEC = 60 * 30;

type FaceRow = {
  id: string;
  storage_path?: string | null;
  created_at?: string | null;
};

/**
 * Presentation-only: resolves a single signed thumbnail URL for the primary
 * enrolled reference face. Never downloads or preloads all five photos.
 */
export function useReferenceFaceThumbnail(input: {
  faces: FaceRow[] | null | undefined;
  localPreviewUrl?: string | null;
}): {
  thumbnailUrl: string | null;
  isLoading: boolean;
} {
  const primary = pickPrimaryReferenceFace(input.faces ?? []);
  const storagePath = primary?.storage_path?.trim() || null;
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Clear immediately so a profile switch never keeps the previous portrait.
    setSignedUrl(null);

    if (!storagePath) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          setSignedUrl(null);
        } else {
          setSignedUrl(data.signedUrl);
        }
      } catch {
        if (!cancelled) setSignedUrl(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  return {
    thumbnailUrl: signedUrl ?? input.localPreviewUrl ?? null,
    isLoading,
  };
}
