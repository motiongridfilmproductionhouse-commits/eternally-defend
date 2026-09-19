import type { ReactNode } from "react";

export function ArticleSources({
  sources,
  note,
}: {
  sources: Array<{ citation: ReactNode; url?: string }>;
  note?: string;
}) {
  return (
    <div className="border-t border-landing-line pt-8">
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-landing-muted">
        Sources
      </h3>
      <ul className="mt-4 space-y-3 text-sm leading-6 text-landing-muted">
        {sources.map(({ citation, url }, index) => (
          <li key={`${citation}-${index}`}>
            {url ? (
              <a href={url} className="landing-link" target="_blank" rel="noreferrer">
                {citation}
              </a>
            ) : (
              <>{citation}</>
            )}
          </li>
        ))}
      </ul>
      {note ? <p className="mt-4 text-xs leading-6 text-landing-muted">{note}</p> : null}
    </div>
  );
}
