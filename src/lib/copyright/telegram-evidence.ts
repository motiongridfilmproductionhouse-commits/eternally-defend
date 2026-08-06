/**
 * Public Telegram web-page discovery helpers.
 *
 * Only publicly accessible t.me / telegram.me message URLs are candidates.
 * Private channels, joinchat invites, and login walls fail closed.
 * Channel name or generic "free movies" language alone is insufficient.
 */

import { hostOf } from "./url.server";
import { hasExactTitleIdentity } from "./title-identity";

const TELEGRAM_HOSTS = ["t.me", "telegram.me", "telegram.org"];

export function isTelegramHost(url: string): boolean {
  const host = (hostOf(url) ?? "").toLowerCase();
  return TELEGRAM_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Public exact-message URL patterns:
 *  - https://t.me/channelname/123
 *  - https://t.me/s/channelname/123 (public preview)
 * Private / inaccessible patterns fail closed:
 *  - /joinchat/, /+, c/ (private channel numeric), login, addstickers
 */
export function isPublicTelegramMessageUrl(url: string): boolean {
  if (!isTelegramHost(url)) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return false;
    if (/\/(joinchat|\+|login|addstickers|proxy|socks)\b/i.test(path)) return false;
    // Private channel form: /c/<id>/<msg>
    if (/^\/c\/\d+/i.test(path)) return false;
    // Public message: /s/<channel>/<msg> or /<channel>/<msg>
    if (/^\/s\/[A-Za-z0-9_]{3,}\/\d+$/i.test(path)) return true;
    if (/^\/[A-Za-z0-9_]{3,}\/\d+$/i.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}

const ACCESS_SIGNAL_RE =
  /\b(download|magnet:|\.torrent|mega\.nz|mediafire|gofile|pixeldrain|full\s*movie|watch\s*online|stream\s*now|\.mkv|\.mp4|file\s*host|mirror\s*\d)\b/i;

const GENERIC_FREE_RE = /\b(free\s*movies?|movie\s*channel|films?\s*free|hollywood\s*hub)\b/i;

/**
 * Evaluate a retrieved public Telegram message page.
 * Requires exact title on the public message AND a download/file/magnet/player signal.
 */
export function evaluateTelegramPublicEvidence(opts: {
  url: string;
  pageTitle?: string | null;
  markdown?: string;
  html?: string;
  titles: string[];
}): {
  eligible: boolean;
  reason: string;
  evidenceUrl: string | null;
  identity: boolean;
  access: boolean;
} {
  if (!isTelegramHost(opts.url)) {
    return {
      eligible: false,
      reason: "Not a Telegram host",
      evidenceUrl: null,
      identity: false,
      access: false,
    };
  }
  if (!isPublicTelegramMessageUrl(opts.url)) {
    return {
      eligible: false,
      reason:
        "Telegram URL is not a public exact-message page (private/joinchat/inaccessible fail closed).",
      evidenceUrl: null,
      identity: false,
      access: false,
    };
  }

  const blob = `${opts.pageTitle ?? ""}\n${opts.markdown ?? ""}\n${opts.html ?? ""}`;
  const identity = hasExactTitleIdentity(blob, opts.titles).match;
  const access = ACCESS_SIGNAL_RE.test(blob);
  const genericOnly = GENERIC_FREE_RE.test(blob) && !access;

  if (!identity) {
    return {
      eligible: false,
      reason: "Public Telegram message lacks exact movie title identity.",
      evidenceUrl: opts.url,
      identity: false,
      access,
    };
  }
  if (!access || genericOnly) {
    return {
      eligible: false,
      reason:
        "Public Telegram message lacks download/file/magnet/player/mirror signal (channel name or generic free-movies language insufficient).",
      evidenceUrl: opts.url,
      identity: true,
      access: false,
    };
  }

  return {
    eligible: true,
    reason: "Public Telegram exact-message evidence with title + access signal.",
    evidenceUrl: opts.url,
    identity: true,
    access: true,
  };
}
