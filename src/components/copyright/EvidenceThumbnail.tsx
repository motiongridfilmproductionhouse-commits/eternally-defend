import React, { useState } from "react";
import { Film } from "lucide-react";

export interface EvidenceThumbnailProps {
  src?: string | null;
  alt?: string;
  className?: string;
}

export function EvidenceThumbnail({ src, alt, className = "" }: EvidenceThumbnailProps) {
  const [error, setError] = useState(false);

  if (!src || error) {
    return (
      <div
        data-testid="evidence-thumbnail-placeholder"
        className={`flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-border/60 bg-slate-100/80 p-2 text-center text-slate-500 shadow-inner ${className}`}
      >
        <Film className="h-5 w-5 text-slate-400" />
        <span className="text-[10px] font-medium leading-tight text-slate-500">Preview unavailable</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || "Evidence preview"}
      loading="lazy"
      onError={() => setError(true)}
      className={`h-24 w-24 shrink-0 rounded-lg border border-border/60 object-cover ${className}`}
    />
  );
}

export default EvidenceThumbnail;
