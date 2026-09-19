import type { ReactNode } from "react";

const kindStyles = {
  evidence: "border-landing-line bg-landing-soft",
  distinction: "border-landing-line bg-landing-soft",
  mistake: "border-[#d9b392] bg-[#fff7f0]",
  matters: "border-[#d0d8d2] bg-[#f3f9f5]",
  steps: "border-landing-line bg-landing-soft",
  means: "border-[#dcd4cc] bg-[#f9f7f5]",
} as const;

export function ArticleCallout({
  kind,
  label,
  children,
}: {
  kind: keyof typeof kindStyles;
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-md border p-5 ${kindStyles[kind]}`}>
      {label ? (
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-landing-muted">
          {label}
        </p>
      ) : null}
      <div className="space-y-3 text-sm leading-7 text-landing-muted">{children}</div>
    </div>
  );
}
