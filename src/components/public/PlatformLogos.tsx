const platforms = ["YouTube", "Instagram", "Facebook", "X", "Reddit", "TikTok", "Web"];

export function PlatformLogos() {
  return (
    <div className="mt-5 flex flex-wrap gap-2" aria-label="Supported platforms">
      {platforms.map((platform, index) => (
        <span
          key={platform}
          className="border border-landing-line px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-landing-muted transition-colors duration-300 hover:border-landing-ink hover:text-landing-ink"
          style={{ transitionDelay: `${index * 35}ms` }}
        >
          {platform}
        </span>
      ))}
    </div>
  );
}
