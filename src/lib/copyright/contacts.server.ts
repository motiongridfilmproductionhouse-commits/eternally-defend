/**
 * Abuse / DMCA contact resolution for a host. No network writes are ever made;
 * this only prepares contact routes for a future manual takedown.
 */

export interface AbuseContact {
  host: string | null;
  platform: string;
  abuseEmail: string | null;
  reportUrl: string | null;
  note: string;
}

const KNOWN: Record<string, Omit<AbuseContact, "host">> = {
  "youtube.com": {
    platform: "YouTube",
    abuseEmail: null,
    reportUrl: "https://www.youtube.com/copyright_complaint_form",
    note: "YouTube copyright complaint webform.",
  },
  "youtu.be": {
    platform: "YouTube",
    abuseEmail: null,
    reportUrl: "https://www.youtube.com/copyright_complaint_form",
    note: "YouTube copyright complaint webform.",
  },
  "facebook.com": {
    platform: "Facebook",
    abuseEmail: null,
    reportUrl: "https://www.facebook.com/help/contact/1758255661104383",
    note: "Meta IP infringement report form.",
  },
  "instagram.com": {
    platform: "Instagram",
    abuseEmail: null,
    reportUrl: "https://help.instagram.com/contact/552695131608132",
    note: "Instagram copyright report form.",
  },
  "x.com": {
    platform: "X",
    abuseEmail: null,
    reportUrl: "https://help.x.com/en/forms/ipi",
    note: "X copyright report form.",
  },
  "twitter.com": {
    platform: "X",
    abuseEmail: null,
    reportUrl: "https://help.x.com/en/forms/ipi",
    note: "X copyright report form.",
  },
  "tiktok.com": {
    platform: "TikTok",
    abuseEmail: "legal@tiktok.com",
    reportUrl: "https://www.tiktok.com/legal/report/Copyright",
    note: "TikTok copyright report form.",
  },
  "reddit.com": {
    platform: "Reddit",
    abuseEmail: "copyright@reddit.com",
    reportUrl: "https://www.reddit.com/report",
    note: "Reddit DMCA contact.",
  },
  "dailymotion.com": {
    platform: "Dailymotion",
    abuseEmail: "copyright@dailymotion.com",
    reportUrl: "https://faq.dailymotion.com/hc/en-us/articles/360020920399",
    note: "Dailymotion copyright team.",
  },
  "bilibili.tv": {
    platform: "Bilibili",
    abuseEmail: "copyright@bilibili.com",
    reportUrl: "https://www.bilibili.tv/en/feedback",
    note: "Bilibili copyright / content report.",
  },
  "bilibili.com": {
    platform: "Bilibili",
    abuseEmail: "copyright@bilibili.com",
    reportUrl: "https://www.bilibili.com/blackboard/help.html",
    note: "Bilibili copyright / content report.",
  },
  "terabox.com": {
    platform: "Terabox",
    abuseEmail: "dmca@terabox.com",
    reportUrl: "https://www.terabox.com/",
    note: "Terabox abuse / DMCA contact.",
  },
  "terabox.app": {
    platform: "Terabox",
    abuseEmail: "dmca@terabox.com",
    reportUrl: "https://www.terabox.com/",
    note: "Terabox abuse / DMCA contact.",
  },
  "mega.nz": {
    platform: "MEGA",
    abuseEmail: "copyright@mega.nz",
    reportUrl: "https://mega.nz/copyright",
    note: "MEGA copyright takedown.",
  },
  "vimeo.com": {
    platform: "Vimeo",
    abuseEmail: "dmca@vimeo.com",
    reportUrl: "https://vimeo.com/dmca",
    note: "Vimeo DMCA form.",
  },
  "pinterest.com": {
    platform: "Pinterest",
    abuseEmail: "copyright@pinterest.com",
    reportUrl: "https://www.pinterest.com/about/copyright/dmca-pin/",
    note: "Pinterest DMCA form.",
  },
  "telegram.org": {
    platform: "Telegram",
    abuseEmail: "dmca@telegram.org",
    reportUrl:
      "https://telegram.org/faq#q-there-39s-illegal-content-on-telegram-how-do-i-take-it-down",
    note: "Telegram abuse mailbox.",
  },
  "t.me": {
    platform: "Telegram",
    abuseEmail: "dmca@telegram.org",
    reportUrl: null,
    note: "Telegram abuse mailbox.",
  },
  "archive.org": {
    platform: "Internet Archive",
    abuseEmail: "info@archive.org",
    reportUrl: "https://archive.org/about/terms.php",
    note: "Internet Archive takedown contact.",
  },
  "blogspot.com": {
    platform: "Blogger",
    abuseEmail: null,
    reportUrl: "https://support.google.com/legal/troubleshooter/1114905",
    note: "Google legal removal troubleshooter.",
  },
  "medium.com": {
    platform: "Medium",
    abuseEmail: "copyright@medium.com",
    reportUrl: "https://help.medium.com/hc/en-us/articles/213511878",
    note: "Medium copyright contact.",
  },
};

function registrable(host: string): string {
  const parts = host.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : host;
}

export function resolveAbuseContact(url: string): AbuseContact {
  let host: string | null = null;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return {
      host: null,
      platform: "Unknown",
      abuseEmail: null,
      reportUrl: null,
      note: "Could not parse host.",
    };
  }

  const key = Object.keys(KNOWN).find((k) => host === k || host.endsWith(`.${k}`));
  if (key) return { host, ...KNOWN[key] };

  const root = registrable(host);
  return {
    host,
    platform: root,
    abuseEmail: `abuse@${root}`,
    reportUrl: `https://${root}/dmca`,
    note: "Generic route — verify the site's DMCA/abuse page and WHOIS registrar contact before sending anything.",
  };
}
