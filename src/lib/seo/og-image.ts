/**
 * Default branded social preview image (1200x630) for corporate pages.
 *
 * Not supplied yet: add the file at public/og/eterna-sentinel-default.jpg and
 * set ENABLED to true. Until then no og:image is emitted (a placeholder
 * previews worse than none). Articles may use their own images.
 */
export const DEFAULT_OG_IMAGE = {
  ENABLED: false,
  url: "https://protectbyeterna.com/og/eterna-sentinel-default.jpg",
  width: 1200,
  height: 630,
} as const;
