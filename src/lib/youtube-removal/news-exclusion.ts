/**
 * Official-news-organisation detection for the YouTube removal scan.
 *
 * Client-facing results must exclude established professional broadcasters,
 * including their secondary/branding variants ("Asianet News Live",
 * "24 News HD", "ManoramaOnline"). Detection is brand-based, NOT keyword
 * based: a channel is NOT excluded just because its name contains "news",
 * "media", "tv", "updates" or "reporter" — small commentary, gossip and
 * reaction channels must still be analysed.
 */

export type ChannelClass = "official_news" | "independent";

/**
 * Established broadcaster brand roots. Matching is done on a normalized,
 * whitespace-stripped channel title / handle, so "TwentyFour News" and
 * "24News HD" both resolve.
 */
const NEWS_BRANDS: string[] = [
  // Kerala / Malayalam broadcasters
  "24news",
  "twentyfournews",
  "asianetnews",
  "manoramanews",
  "manoramaonline",
  "mathrubhuminews",
  "mathrubhumi",
  "mediaonetv",
  "mediaone",
  "reportertv",
  "reporterlive",
  "news18kerala",
  "news18malayalam",
  "kairalinews",
  "kairalipeople",
  "janamtv",
  "amritanews",
  "amritatv",
  "jaihindtv",
  "kaumudytv",
  "safarinews",
  "marunadanmalayali",
  "indiatodaymalayalam",
  "keralakaumudi",
  "deshabhimani",
  "madhyamam",
  "twentyfourhd",
  // National / international broadcasters
  "ndtv",
  "indiatoday",
  "timesnow",
  "timesofindia",
  "republicworld",
  "republictv",
  "aajtak",
  "abpnews",
  "zeenews",
  "cnnnews18",
  "news18india",
  "indianexpress",
  "thehindu",
  "hindustantimes",
  "firstpost",
  "wion",
  "ddnews",
  "ani",
  "asianewsinternational",
  "ptinews",
  "bbcnews",
  "bbc",
  "cnn",
  "reuters",
  "aljazeera",
  "apnews",
  "associatedpress",
  "skynews",
  "dwnews",
  "france24",
  "abcnews",
  "cbsnews",
  "nbcnews",
  "foxnews",
  "guardian",
  "washingtonpost",
  "nytimes",
];

function normalizeBrand(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface ChannelClassificationInput {
  channelTitle: string;
  channelHandle?: string | null;
  channelDescription?: string | null;
}

export interface ChannelClassification {
  channelClass: ChannelClass;
  matchedBrand?: string;
  reason: string;
}

/**
 * Classify a channel as an established news organisation (excluded from
 * client-facing results) or an independent publisher (analysed).
 */
export function classifyChannel(input: ChannelClassificationInput): ChannelClassification {
  const title = normalizeBrand(input.channelTitle ?? "");
  const handle = normalizeBrand(input.channelHandle ?? "");
  const description = normalizeBrand(input.channelDescription ?? "").slice(0, 400);

  for (const brand of NEWS_BRANDS) {
    if (!brand) continue;
    // Brand root must appear in the channel identity (title/handle), or the
    // description must self-identify as the official channel of the brand.
    if (title.includes(brand) || handle.includes(brand)) {
      return {
        channelClass: "official_news",
        matchedBrand: brand,
        reason: `Channel identity matches established broadcaster brand "${brand}"`,
      };
    }
    if (description.includes(`official${brand}`) || description.includes(`${brand}official`)) {
      return {
        channelClass: "official_news",
        matchedBrand: brand,
        reason: `Channel describes itself as the official channel of "${brand}"`,
      };
    }
  }

  return {
    channelClass: "independent",
    reason: "No established broadcaster brand detected — treated as independent publisher",
  };
}
