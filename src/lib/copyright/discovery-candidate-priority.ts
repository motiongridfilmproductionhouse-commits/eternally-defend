/**
 * Prioritized crawl ordering for discovery leads with strong distribution signals.
 */

export interface DiscoveryLeadPriorityInput {
  url: string;
  title: string | null;
  text: string;
  strong?: boolean;
}

const SIGNAL_WEIGHTS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /full\s*movie/i, weight: 22 },
  { pattern: /watch\s*online/i, weight: 20 },
  { pattern: /\bdownload\b/i, weight: 18 },
  { pattern: /direct\s*download/i, weight: 20 },
  { pattern: /\b1080p\b/i, weight: 16 },
  { pattern: /\b720p\b/i, weight: 14 },
  { pattern: /webrip/i, weight: 16 },
  { pattern: /hdrip/i, weight: 16 },
  { pattern: /camrip/i, weight: 14 },
  { pattern: /\bhdts\b/i, weight: 14 },
  { pattern: /\.mp4\b/i, weight: 12 },
  { pattern: /\.mkv\b/i, weight: 12 },
  { pattern: /\btorrent\b/i, weight: 18 },
  { pattern: /\bmagnet\b/i, weight: 18 },
  { pattern: /iframe|embedded\s*player|jwplayer|videojs/i, weight: 20 },
  { pattern: /mega\.nz|mediafire|terabox|drive\.google|pixeldrain|gofile/i, weight: 14 },
  { pattern: /archive\.org/i, weight: 12 },
  { pattern: /t\.me|telegram/i, weight: 14 },
];

const SKIP_CRAWL_PATTERNS =
  /\/(login|signin|signup|register|privacy|terms|cookie|advert|ads|tag\/|tags\/|category\/|categories\/|share\/|sharer\.php)/i;

export function scoreDiscoveryLeadPriority(lead: DiscoveryLeadPriorityInput): number {
  const blob = `${lead.url} ${lead.title ?? ""} ${lead.text}`;
  if (SKIP_CRAWL_PATTERNS.test(lead.url)) return -100;
  let score = lead.strong ? 25 : 0;
  for (const { pattern, weight } of SIGNAL_WEIGHTS) {
    if (pattern.test(blob)) score += weight;
  }
  return score;
}

export function compareDiscoveryLeadPriority(
  a: DiscoveryLeadPriorityInput,
  b: DiscoveryLeadPriorityInput,
): number {
  return scoreDiscoveryLeadPriority(b) - scoreDiscoveryLeadPriority(a);
}

export function sortDiscoveryLeadsByPriority<T extends DiscoveryLeadPriorityInput>(
  leads: T[],
): T[] {
  return [...leads].sort(compareDiscoveryLeadPriority);
}
