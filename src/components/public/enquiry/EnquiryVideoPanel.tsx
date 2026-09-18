import { EternaLogo } from "@/components/public/PublicSite";

/**
 * Enquiry-only identity panel. The layered blue field and fluid wordmark are
 * intentionally scoped here so the public header and footer retain their
 * original logo treatment.
 */
export function EnquiryVideoPanel() {
  return (
    <aside className="eterna-enquiry-art relative min-h-40 overflow-hidden sm:min-h-48 lg:h-full lg:min-h-[540px]">
      <div className="eterna-enquiry-art__layer eterna-enquiry-art__layer--one" aria-hidden="true" />
      <div className="eterna-enquiry-art__layer eterna-enquiry-art__layer--two" aria-hidden="true" />
      <div className="eterna-enquiry-art__grain" aria-hidden="true" />
      <div className="relative z-10 flex h-full min-h-40 flex-col justify-between p-6 sm:min-h-48 lg:min-h-[540px] lg:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-landing-on-media-muted">
          Eterna Sentinel
        </p>
        <div className="eterna-enquiry-mark py-8 lg:py-0">
          <EternaLogo inverse className="h-6 sm:h-8 lg:h-10" alt="Éterna" />
        </div>
        <p className="max-w-[17rem] text-sm leading-6 text-landing-on-media-muted">
          Identity protection begins with verified context.
        </p>
      </div>
    </aside>
  );
}
