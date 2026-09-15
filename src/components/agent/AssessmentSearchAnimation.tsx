import { Search, ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";

type AssessmentSearchAnimationProps = {
  artistName: string;
  imageUrl?: string | null;
  stage: string;
};

const checks = ["Public sources", "Identity signals", "Risk context"];

export function AssessmentSearchAnimation({
  artistName,
  imageUrl,
  stage,
}: AssessmentSearchAnimationProps) {
  const initials = artistName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

  return (
    <section className="assessment-search" aria-live="polite" aria-label={`Analyzing ${artistName}`}>
      <div className="assessment-search__header">
        <div className="assessment-search__identity">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="assessment-search__portrait"
            />
          ) : (
            <div className="assessment-search__portrait assessment-search__initials" aria-hidden="true">
              {initials}
            </div>
          )}
          <div>
            <p className="assessment-search__eyebrow">Digital protection assessment</p>
            <h2>Searching for {artistName}</h2>
          </div>
        </div>
        <div className="assessment-search__live">
          <span aria-hidden="true" /> Live scan
        </div>
      </div>

      <div className="assessment-search__visual" aria-hidden="true">
        <div className="assessment-search__source">
          <Search className="size-5" />
        </div>
        <svg viewBox="0 0 900 320" preserveAspectRatio="none" role="presentation">
          <defs>
            <linearGradient id="search-signal" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--assessment-signal-cyan)" />
              <stop offset="0.55" stopColor="var(--assessment-signal-blue)" />
              <stop offset="1" stopColor="var(--assessment-signal-violet)" />
            </linearGradient>
            <filter id="search-glow" x="-40%" y="-80%" width="180%" height="260%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <path className="assessment-search__baseline" d="M0 160 H900" />
          <g className="assessment-search__wave" filter="url(#search-glow)">
            <path d="M0 160 C155 160 175 160 238 160 C295 160 304 70 370 76 C445 82 440 235 522 232 C602 229 597 112 675 113 C738 114 744 160 900 160" />
            <path d="M0 160 C177 160 204 160 250 160 C310 160 324 105 382 110 C448 116 465 207 525 204 C590 201 610 133 678 134 C752 136 750 160 900 160" />
            <path d="M0 160 C177 160 221 160 270 160 C322 160 337 132 390 135 C443 138 474 181 527 180 C587 178 627 151 682 151 C759 151 774 160 900 160" />
          </g>

          <g className="assessment-search__branches" filter="url(#search-glow)">
            <path d="M545 199 C628 203 659 58 768 48" />
            <path d="M592 164 C682 165 702 107 825 105" />
            <path d="M592 164 C684 166 706 215 814 221" />
            <path d="M535 215 C614 241 658 277 765 278" />
          </g>

          <g className="assessment-search__nodes">
            <circle cx="768" cy="48" r="5" />
            <circle cx="825" cy="105" r="5" />
            <circle cx="814" cy="221" r="5" />
            <circle cx="765" cy="278" r="5" />
            <circle cx="690" cy="88" r="3.5" />
            <circle cx="706" cy="215" r="3.5" />
          </g>
          <circle className="assessment-search__scanner" cx="0" cy="160" r="7" />
        </svg>
        <div className="assessment-search__flare" />
      </div>

      <div className="assessment-search__checks">
        {checks.map((check, index) => (
          <div key={check} className="assessment-search__check" style={{ "--check-index": index } as CSSProperties}>
            <ShieldCheck className="size-4" />
            <span>{check}</span>
          </div>
        ))}
      </div>
      <p className="assessment-search__stage" role="status">
        <span aria-hidden="true" /> {stage}
      </p>
    </section>
  );
}