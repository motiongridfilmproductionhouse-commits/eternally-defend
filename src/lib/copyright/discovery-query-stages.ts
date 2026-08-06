/**
 * Adaptive discovery query stages. Stage 2/3 run only when earlier coverage is low.
 */

import { queryTitleVariants, expandTitleVariants } from "./title-identity";
import {
  MAX_DISCOVERY_QUERIES_PER_SCAN,
  MIN_DISCOVERY_QUERIES,
  STAGE_ADEQUATE_COVERAGE_CANDIDATES,
  TARGET_DISCOVERY_CANDIDATES,
} from "./discovery-config";
import {
  DISCOVERY_MIRROR_DOMAINS,
  DISCOVERY_TARGET_DOMAINS,
  DISCOVERY_TORRENT_INDEX_DOMAINS,
  buildPlatformClusterQuery,
  domainsByCategory,
  siteQueryForDomain,
} from "./discovery-target-domains";
import type { ReferenceAnalysis } from "./discover.server";

export interface DiscoveryQueryPlan {
  query: string;
  recent: boolean;
  priority?: boolean;
  page?: number;
  stage: 1 | 2 | 3;
}

export interface StagedDiscoveryQueries {
  stages: Array<{ stage: 1 | 2 | 3; plans: DiscoveryQueryPlan[] }>;
  totalUniqueQueries: number;
}

const NEG =
  '-site:imdb.com -site:wikipedia.org -site:rottentomatoes.com -site:netflix.com -site:primevideo.com -site:hotstar.com -site:voxcinemas.com -site:bookmyshow.com -site:fandango.com -"box office" -showtimes -"now showing"';

const LOCAL_TERMS: Record<string, string[]> = {
  malayalam: ["മുഴുവൻ സിനിമ", "ഓൺലൈൻ", "ഡൗൺലോഡ്", "ചോർന്നു"],
  tamil: ["முழு படம்", "ஆன்லைன்", "பதிவிறக்கம்", "கசிந்தது"],
  telugu: ["పూర్తి సినిమా", "ఆన్‌లైన్", "డౌన్‌లోడ్", "లీక్"],
  kannada: ["ಪೂರ್ಣ ಚಲನಚಿತ್ರ", "ಆನ್‌ಲೈನ್", "ಡೌನ್‌ಲೋಡ್"],
  hindi: ["फुल मूवी", "ऑनलाइन देखें", "डाउनलोड", "लीक"],
  bengali: ["সম্পূর্ণ সিনেমা", "অনলাইন", "ডাউনলোড"],
  arabic: ["فيلم كامل", "مشاهدة اون لاين", "تحميل", "مسرب"],
  spanish: ["pelicula completa", "ver online gratis", "descargar"],
  french: ["film complet", "voir en streaming", "telecharger"],
  portuguese: ["filme completo", "assistir online", "download"],
  russian: ["смотреть онлайн", "скачать", "полный фильм"],
  indonesian: ["film lengkap", "nonton online", "unduh"],
  english: ["full movie", "watch online free", "download"],
};

const PIRACY_SITE_FILTER =
  "(site:telegram.me OR site:t.me OR site:archive.org OR site:ok.ru OR site:dailymotion.com OR site:bilibili.tv OR site:bilibili.com OR site:rumble.com OR site:vk.com OR site:pastebin.com OR site:reddit.com OR site:x.com OR site:facebook.com)";

const FILE_HOST_FILTER =
  "(site:mega.nz OR site:mediafire.com OR site:gofile.io OR site:pixeldrain.com OR site:terabox.com OR site:terabox.app OR site:drive.google.com OR site:doodstream.com OR site:streamtape.com OR site:mixdrop.co OR site:filemoon.sx OR site:1fichier.com)";

const STREAM_SITE_FILTER =
  "(site:movierulz.vc OR site:ibomma.bet OR site:tamilrockers.ws OR site:123movies.ai OR site:fmovies.to OR site:soap2day.day OR site:vegamovies.nl OR site:mp4moviez.ink OR site:9xmovies.gold OR site:ogomovies1.com.pk) full movie";

const PIRACY_SITE_CLUSTERS: string[] = [
  "(site:ogomovies1.com.pk OR site:ogomovies.com OR site:einthusan.tv OR site:mallumv.co OR site:malluvilla.in)",
  "(site:bilibili.tv OR site:bilibili.com OR site:dailymotion.com OR site:ok.ru OR site:archive.org) full movie",
  "(site:terabox.app OR site:terabox.com OR site:mega.nz OR site:pixeldrain.com OR site:drive.google.com) (download OR sharing OR movie)",
  "(site:movierulz.vc OR site:movierulz2.com OR site:5movierulz.re OR site:todaypk.mx OR site:movieswood.com)",
  "(site:tamilmv.vip OR site:1tamilmv.com OR site:tamilblasters.hair OR site:moviesda.mobi OR site:isaimini.com)",
  "(site:hdhub4u.tv OR site:filmy4wap.co.in OR site:vegamovies.nl OR site:bolly4u.org OR site:sdmoviespoint.cc)",
  "(site:katmoviehd.tw OR site:cinevood.pics OR site:dvdplay.com.tz OR site:mp4moviez.ink OR site:9xmovies.gold)",
  "(site:t.me OR site:telegram.me) movie download",
  "(site:dailymotion.com OR site:ok.ru OR site:vk.com OR site:archive.org OR site:rumble.com OR site:bilibili.tv) full movie",
];

interface QueryContext {
  base: string;
  names: string[];
  year: string | null;
  isFresh: boolean;
  titleNoYear: string;
  titleNoPunct: string;
  analysis: ReferenceAnalysis;
}

function localTermsFor(langs: string[]): string[] {
  const out: string[] = [];
  for (const l of langs) {
    const terms = LOCAL_TERMS[l.trim().toLowerCase()];
    if (terms) out.push(...terms);
  }
  return [...new Set(out)];
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function buildContext(a: ReferenceAnalysis, workTitle: string): QueryContext | null {
  const primary = (a.title || workTitle).trim();
  if (!primary) return null;
  const names = queryTitleVariants(primary, [workTitle, a.title ?? "", ...a.altTitles]).slice(0, 6);
  const base = names[0] ?? primary;
  const year = a.releaseDate?.slice(0, 4) || null;
  const age = daysSince(a.releaseDate);
  const isFresh = age !== null && age <= 30;
  const titleNoYear = base.replace(/\s*\(?\d{4}\)?\s*$/g, "").trim();
  const titleNoPunct = base
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { base, names, year, isFresh, titleNoYear, titleNoPunct, analysis: a };
}

function createPlanBuilder(ctx: QueryContext, stage: 1 | 2 | 3) {
  const seen = new Set<string>();
  const plans: DiscoveryQueryPlan[] = [];
  const push = (query: string, recent = ctx.isFresh, priority = false) => {
    const trimmed = query.replace(NEG, "").trim().replace(/^"|"$/g, "");
    if (
      !trimmed ||
      trimmed === ctx.base ||
      ctx.names.some((n) => trimmed === n || trimmed === `"${n}"`)
    ) {
      return;
    }
    const t = query.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    plans.push({ query: t, recent, priority, stage });
  };
  const pushPriority = (query: string, recent = ctx.isFresh) => push(query, recent, true);
  return { push, pushPriority, plans };
}

function buildStage1(ctx: QueryContext): DiscoveryQueryPlan[] {
  const { push, pushPriority, plans } = createPlanBuilder(ctx, 1);
  const { base, year, titleNoYear, titleNoPunct, analysis: a } = ctx;

  const explicitPhrases = [
    year ? `"${base}" "${year}" "full movie"` : `"${base}" "full movie"`,
    `"${base}" watch online`,
    `"${base}" watch full movie`,
    `"${base}" free watch`,
    `"${base}" download`,
    `"${base}" direct download`,
    `"${base}" streaming`,
    `"${base}" stream`,
    `"${base}" CAM`,
    `"${base}" HDCAM`,
    `"${base}" online print`,
    `"${base}" movie print`,
    `"${base}" HD`,
    `"${base}" 1080p`,
    `"${base}" 720p`,
    `"${base}" WEB-DL`,
    `"${base}" WEBRip`,
    `"${base}" HDRip`,
    `"${base}" DVDRip`,
    `"${base}" CAMRip`,
    `"${base}" HDTS`,
    `"${base}" mp4`,
    `"${base}" mkv`,
    `"${base}" torrent`,
    `"${base}" magnet`,
  ];
  for (const q of explicitPhrases) pushPriority(q);

  if (year) {
    pushPriority(`"${base}" ${year} watch full movie`);
    pushPriority(`"${base}" ${year} download`);
    pushPriority(`"${base}" ${year} stream`);
  }

  if (titleNoYear && titleNoYear !== base) {
    pushPriority(`"${titleNoYear}" full movie`);
    pushPriority(`"${titleNoYear}" watch online`);
    pushPriority(`"${titleNoYear}" download`);
  }
  if (titleNoPunct && titleNoPunct !== base) {
    pushPriority(`"${titleNoPunct}" 1080p`);
  }

  const stage1Terms = [
    "watch online",
    "watch full movie",
    "full movie",
    "download",
    "direct download",
    "stream",
    "1080p",
    "720p",
    "WEBRip",
    "HDRip",
    "CAMRip",
    "HDTS",
    "torrent",
    "magnet",
    "mkv",
    "mp4",
  ];
  for (const term of stage1Terms) push(`"${base}" ${term} ${NEG}`, ctx.isFresh);

  return plans;
}

function buildStage2(ctx: QueryContext): DiscoveryQueryPlan[] {
  const { push, pushPriority, plans } = createPlanBuilder(ctx, 2);
  const { base, names, year, analysis: a } = ctx;

  for (const n of names.slice(1, 4)) {
    push(`"${n}" watch full movie ${NEG}`, ctx.isFresh);
    push(`"${n}" download ${NEG}`, ctx.isFresh);
    push(`"${n}" watch online ${NEG}`, ctx.isFresh);
    push(`"${n}" torrent magnet ${NEG}`, ctx.isFresh);
    if (year) push(`"${n}" ${year} full movie ${NEG}`, ctx.isFresh);
  }

  for (const v of expandTitleVariants(base).slice(0, 4)) {
    if (!/[\s-]/.test(v)) continue;
    pushPriority(`"${v}" watch online`);
    if (v.includes(" ")) pushPriority(`"${v}" download`);
  }
  for (const alt of a.altTitles.slice(0, 3)) {
    if (alt.trim()) pushPriority(`"${alt.trim()}" full movie`);
  }

  const langs = [a.language, ...a.audienceLanguages].filter(Boolean) as string[];
  for (const term of localTermsFor(langs).slice(0, 8)) {
    push(`"${base}" ${term}`, ctx.isFresh);
  }
  if (a.language) push(`"${base}" ${a.language} dubbed watch online ${NEG}`, ctx.isFresh);

  const fresh = [
    "theatre print online",
    "cinema recording leak",
    "same day leak",
    "hdcam 720p download",
    "first day print online",
    "full movie leaked",
  ];
  if (ctx.isFresh || !a.releaseDate) {
    for (const term of fresh) push(`"${base}" ${term} ${NEG}`, true);
  }

  for (const actor of a.actors.slice(0, 2)) {
    push(`"${base}" ${actor} download full movie ${NEG}`, ctx.isFresh);
  }
  if (a.productionCompany) {
    pushPriority(`"${base}" ${a.productionCompany} leaked movie`);
  }
  if (a.releaseDate) {
    pushPriority(`"${base}" ${a.releaseDate} download`);
  }

  const general = [
    "watch free",
    "free streaming",
    "hdcam download",
    "dubbed",
    "player",
    "server",
    "file host",
    "video host",
    "streaming server",
  ];
  for (const term of general) push(`"${base}" ${term} ${NEG}`, ctx.isFresh);

  const langWord = a.language ? a.language.toLowerCase() : "";
  for (const phrase of [
    "movie download",
    "full movie watch online free",
    "movie download hdrip 720p",
    "movie telegram link",
    "1080p mkv download",
    "watch free online player",
  ]) {
    pushPriority(`"${base}" ${langWord} ${phrase} ${NEG}`.replace(/\s+/g, " "));
  }

  return plans;
}

function buildStage3(ctx: QueryContext): DiscoveryQueryPlan[] {
  const { pushPriority, plans } = createPlanBuilder(ctx, 3);
  const { base, names, year } = ctx;

  for (const seed of DISCOVERY_TARGET_DOMAINS.slice(0, 5)) {
    pushPriority(`"${base}" site:${seed}`);
    for (const n of names.slice(1, 3)) pushPriority(`"${n}" site:${seed}`);
  }

  for (const cluster of PIRACY_SITE_CLUSTERS) {
    pushPriority(`"${base}" ${cluster}`);
  }
  pushPriority(`"${base}" full movie ${PIRACY_SITE_FILTER}`);
  pushPriority(`"${base}" ${FILE_HOST_FILTER}`);
  pushPriority(`"${base}" ${STREAM_SITE_FILTER}`);
  pushPriority(`"${base}" torrent magnet ${NEG}`);

  for (const domain of DISCOVERY_TARGET_DOMAINS) {
    pushPriority(siteQueryForDomain(domain, base));
    if (year) pushPriority(`site:${domain} "${base}" ${year}`);
  }
  pushPriority(`site:ia*.us.archive.org "${base}"`);

  for (const domain of DISCOVERY_MIRROR_DOMAINS.slice(0, 8)) {
    pushPriority(`site:${domain} "${base}" full movie`);
  }
  for (const domain of DISCOVERY_TORRENT_INDEX_DOMAINS.slice(0, 4)) {
    pushPriority(`site:${domain} "${base}" torrent`);
  }

  for (const category of ["telegram", "video_hosting", "cloud_storage", "archive"] as const) {
    const q = buildPlatformClusterQuery(category, base, "full movie");
    if (q) pushPriority(q);
  }

  pushPriority(`"${base}" (site:t.me OR site:telegram.me) full movie`);
  pushPriority(`"${base}" (site:bilibili.tv OR site:bilibili.com) movie`);
  pushPriority(`"${base}" (site:terabox.app OR site:terabox.com) sharing`);
  pushPriority(`"${base}" site:archive.org (pdf OR movie OR boly4u)`);
  pushPriority(`"${base}" site:dailymotion.com full movie`);

  for (const domain of domainsByCategory("file_host").slice(0, 4)) {
    pushPriority(siteQueryForDomain(domain, base));
  }

  return plans;
}

function dedupeAcrossStages(
  stages: Array<{ stage: 1 | 2 | 3; plans: DiscoveryQueryPlan[] }>,
): StagedDiscoveryQueries {
  const seen = new Set<string>();
  const out: Array<{ stage: 1 | 2 | 3; plans: DiscoveryQueryPlan[] }> = [];
  let total = 0;
  for (const block of stages) {
    const plans: DiscoveryQueryPlan[] = [];
    for (const plan of block.plans) {
      if (seen.has(plan.query)) continue;
      seen.add(plan.query);
      plans.push(plan);
      total += 1;
    }
    if (plans.length) out.push({ stage: block.stage, plans });
  }
  return { stages: out, totalUniqueQueries: total };
}

/** Build all three adaptive query stages (deduped within and across stages). */
export function buildStagedDiscoveryQueries(
  analysis: ReferenceAnalysis,
  workTitle: string,
): StagedDiscoveryQueries {
  const ctx = buildContext(analysis, workTitle);
  if (!ctx) return { stages: [], totalUniqueQueries: 0 };

  const staged = dedupeAcrossStages([
    { stage: 1, plans: buildStage1(ctx) },
    { stage: 2, plans: buildStage2(ctx) },
    { stage: 3, plans: buildStage3(ctx) },
  ]);

  // Pad to MIN_DISCOVERY_QUERIES only when all stages are expanded (full scan path).
  const flat = flattenStagedQueries(staged);
  if (flat.length < MIN_DISCOVERY_QUERIES) {
    const extra = createPlanBuilder(ctx, 2);
    const fillers = [
      "watch online",
      "watch full movie",
      "download",
      "stream",
      "1080p",
      "720p",
      "torrent",
      "magnet",
      "mkv",
      "mp4",
    ];
    for (const term of fillers) {
      if (flat.length + extra.plans.length >= MIN_DISCOVERY_QUERIES) break;
      extra.push(`"${ctx.base}" ${term} ${NEG}`, ctx.isFresh);
    }
    const stage2 = staged.stages.find((s) => s.stage === 2);
    if (stage2) stage2.plans.push(...extra.plans);
    else staged.stages.push({ stage: 2, plans: extra.plans });
    staged.totalUniqueQueries = flattenStagedQueries(staged).length;
  }

  return staged;
}

export function flattenStagedQueries(staged: StagedDiscoveryQueries): DiscoveryQueryPlan[] {
  const seen = new Set<string>();
  const out: DiscoveryQueryPlan[] = [];
  const push = (plan: DiscoveryQueryPlan) => {
    if (seen.has(plan.query) || out.length >= MAX_DISCOVERY_QUERIES_PER_SCAN) return;
    seen.add(plan.query);
    out.push(plan);
  };
  const byStage = (n: 1 | 2 | 3) => staged.stages.find((s) => s.stage === n)?.plans ?? [];
  // Stage 1 first, then stage 3 platform seeds, then stage 2 variants — keeps site:
  // queries in the capped union used by regression tests without running all 72 at runtime.
  for (const plan of byStage(1)) push(plan);
  for (const plan of byStage(3)) push(plan);
  for (const plan of byStage(2)) push(plan);
  return out;
}

/** Flattened query list for regression tests (all stages, capped). */
export function buildAllDiscoveryQueries(
  analysis: ReferenceAnalysis,
  workTitle: string,
): DiscoveryQueryPlan[] {
  return flattenStagedQueries(buildStagedDiscoveryQueries(analysis, workTitle));
}

/** @deprecated Use hasBroadDiscoveryCoverage from discovery-saturation for stage gating. */
export function hasAdequateDiscoveryCoverage(uniqueCandidateUrls: number): boolean {
  return uniqueCandidateUrls >= STAGE_ADEQUATE_COVERAGE_CANDIDATES;
}

/** Select stages to run given current unique candidate coverage. */
export function stagesToRunForCoverage(
  staged: StagedDiscoveryQueries,
  uniqueCandidateUrls: number,
): Array<{ stage: 1 | 2 | 3; plans: DiscoveryQueryPlan[] }> {
  if (hasAdequateDiscoveryCoverage(uniqueCandidateUrls)) {
    return staged.stages.length ? [staged.stages[0]!] : [];
  }
  const out: Array<{ stage: 1 | 2 | 3; plans: DiscoveryQueryPlan[] }> = [];
  for (const block of staged.stages) {
    out.push(block);
    if (hasAdequateDiscoveryCoverage(uniqueCandidateUrls)) break;
  }
  return out;
}

export { TARGET_DISCOVERY_CANDIDATES, STAGE_ADEQUATE_COVERAGE_CANDIDATES };
