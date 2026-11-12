import { Copy } from "lucide-react";
import type { ArticleBlock, ArticleFaq, NewsroomArticleData } from "@/components/public/NewsroomArticle";

export const GUIDES_PUBLISHED = "2026-11-12";

type PlatformSpec = {
  slug: string;
  platform: string;
  title: string;
  headTitle: string;
  description: string;
  helpUrl: string;
  helpName: string;
  intro: string[];
  identifiers: string;
  withAccount: string[];
  withoutAccount: string[];
  onBehalf: string[];
  platformNotes: string[];
  after: string;
  faqs: ArticleFaq[];
};

export function platformGuide(s: PlatformSpec): NewsroomArticleData {
  const blocks: ArticleBlock[] = [
    ...s.intro.map((p) => ({ p })),
    {
      callout: "means",
      title: "Menus change",
      text: `${s.platform} updates its menus and report categories regularly, so the exact labels below may differ from what you see. The general path stays similar. If an option has moved, start from the [${s.helpName}](${s.helpUrl}) and search for "impersonation".`,
    },
    { h2: `Before you report an impersonation account on ${s.platform}` },
    {
      p: "A clear record makes a report easier to review, and it can't be rebuilt once the account is renamed or deleted.",
    },
    {
      steps: [
        "Take full-screen screenshots of the profile, including the name, username, profile photo, bio and follower count. Keep your device clock visible if you can.",
        "Screenshot the posts, stories or messages that show the impersonation, especially anything asking people for money, personal details or contact off the platform.",
        `Copy and save the full profile URL. ${s.identifiers}`,
        "Write down the date and time you found the account, and how you found it (for example, a friend sent you a link).",
        "Save any messages people received from the account, with the sender's name visible.",
        "Store everything in one folder, and do not edit or crop the original files. Make a copy if you need to annotate anything.",
      ],
    },
    {
      p: "Avoid messaging the account, commenting on its posts or publicly calling it out before you report. That can prompt the person behind it to change the username or delete evidence without making removal any faster. Our guide on [how to preserve evidence](/newsroom/how-to-preserve-deepfake-evidence) covers documentation in more depth.",
    },
    { h2: `How to report an impersonation account on ${s.platform}: step by step` },
    { p: `If you have a ${s.platform} account, this is usually the fastest route:` },
    { steps: s.withAccount },
    { p: `If you don't have a ${s.platform} account, or you have been blocked by the impersonator:` },
    { steps: s.withoutAccount },
    { p: "If you are reporting on behalf of someone else, such as a client, family member or employer:" },
    { steps: s.onBehalf },
    ...s.platformNotes.map((p) => ({ p })),
    { h2: "What happens after you report" },
    { p: s.after },
    {
      p: "Platforms do not publish a fixed timeline for impersonation reviews, and response times vary with the volume of reports and how clearly the report shows impersonation. While you wait, keep checking the account and add new screenshots to your folder if it posts again or changes its name.",
    },
    { h2: "What to do if your report is rejected" },
    { p: "A rejected report does not always mean the platform decided the account is allowed. Often the report lacked something the reviewer needed. Before trying again:" },
    {
      steps: [
        "Check the decision message for the reason and for any option to request another review. Use it if it exists.",
        "Confirm you chose the impersonation category, not a general spam or harassment category.",
        "Make sure you submitted through the official impersonation form with identity documents if the in-app report was declined.",
        "Gather any new evidence, such as messages sent to your contacts, ads, or posts claiming to be you, and submit a fresh report that references it.",
        "Ask people who were contacted by the account to file their own reports describing what happened to them.",
        "Keep a log of each report, the date, the reference number if any, and the outcome.",
      ],
    },
    {
      p: "If the account is being used for fraud, threats or extortion, consider also reporting it to local police or your national cybercrime reporting service. A police reference number can be useful later.",
    },
    { h2: "When to get help" },
    {
      p: `Self-reporting works for many simple cases. It tends to stall when there are several accounts, when the account keeps returning under new names, when it is running scams in your name, or when you are a public figure and the account is drawing real attention. In those situations Eterna's [fake account removal service](/fake-account-removal) verifies the account, preserves evidence and escalates through the channels available, within your authorization. Removal decisions remain with ${s.platform}, and no outcome can be guaranteed.`,
    },
    {
      p: "For a wider view of impersonation risk, see our [AI impersonation protection](/ai-impersonation) page and the guide to [what to do when someone uses your name or photos](/newsroom/fake-account-using-my-name-photos).",
    },
  ];
  return {
    path: `/newsroom/${s.slug}`,
    title: s.title,
    headTitle: s.headTitle,
    description: s.description,
    published: GUIDES_PUBLISHED,
    category: "Impersonation",
    readTime: "7-minute read",
    icon: Copy,
    concept: `Reporting an impersonation account on ${s.platform}`,
    blocks,
    faqs: s.faqs,
    related: [
      { to: "/fake-account-removal", title: "Fake Account Removal Service", description: "Verified evidence and escalation when self-reporting stalls." },
      { to: "/newsroom/fake-account-using-my-name-photos", title: "Fake Account Using Your Name or Photos?", description: "How to tell what kind of account it is and respond." },
      { to: "/newsroom/impersonation-response-guide", title: "The Impersonation Response Guide", description: "What to do, in order, after discovering impersonation." },
    ],
    cta: { text: "Get help removing a fake account", to: "/fake-account-removal" },
  };
}

const commonFaq = (platform: string): ArticleFaq[] => [
  {
    q: `Should I message the fake ${platform} account?`,
    a: "Generally no. Document it and report it first. Contacting the account can lead the person behind it to rename or delete content without making removal faster.",
  },
  {
    q: "What if the account is a fan or parody account?",
    a: `${platform} treats clearly labelled fan, commentary and parody accounts differently from accounts designed to deceive. If an account is not labelled and people believe it is you, it is reasonable to report it as impersonation.`,
  },
];

export const PLATFORM_GUIDES: Record<string, NewsroomArticleData> = {
  instagram: platformGuide({
    slug: "report-impersonation-account-instagram",
    platform: "Instagram",
    title: "How to Report an Impersonation Account on Instagram",
    headTitle: "Report an Instagram Impersonation Account | Eterna",
    description:
      "Someone is pretending to be you on Instagram? Learn how to document the account, report it step by step and what to do if it's rejected. Start here.",
    helpUrl: "https://help.instagram.com/",
    helpName: "Instagram Help Center",
    intro: [
      "An Instagram account using your name and photos can appear overnight. It might follow your friends, message your followers, or advertise something you have never heard of. Learning how to report an impersonation account on Instagram properly, with the right evidence and the right category, gives the report the best chance of being reviewed as impersonation rather than dismissed as a general complaint.",
      "Below: what to record, how to report in the app or without an account, and what to do next.",
    ],
    identifiers: "Note the exact username (the @handle), because display names can be changed in seconds while the profile link and handle history are what reviewers look at.",
    withAccount: [
      "Open the impersonating profile in the Instagram app.",
      "Tap the three-dot menu at the top of the profile.",
      "Tap Report, then choose the option for reporting the account rather than a single post.",
      "Select the option along the lines of \"It's pretending to be someone else\" or \"Pretending to be someone\".",
      "Choose \"Me\" if the account is impersonating you, and follow the remaining prompts.",
      "Submit the report and keep a screenshot of the confirmation screen.",
    ],
    withoutAccount: [
      "Go to the Instagram Help Center and search for \"impersonation\".",
      "Open the impersonation report form linked from the help article.",
      "Enter the impersonating account's username and the profile URL.",
      "Upload a clear photo of a government-issued ID if the form asks for it, so Instagram can confirm you are the person being impersonated.",
      "Describe briefly how the account is pretending to be you and submit.",
    ],
    onBehalf: [
      "In the app, follow the same report path but choose the option for someone you know, or a celebrity or public figure, instead of \"Me\".",
      "If you are an authorized representative, use the Help Center impersonation form and select the option for reporting on behalf of someone else.",
      "Be prepared to show your authority to act, such as a letter of authorization, and in many cases the person being impersonated may need to confirm their identity themselves.",
    ],
    platformNotes: [
    ],
    after:
      "Instagram reviews the report against its impersonation policy. You may see the outcome in your support requests or account notifications. If the account is found to be impersonating you, it is typically removed. If not, the decision message may offer a way to request another review.",
    faqs: [
      { q: "Do I need an Instagram account to report impersonation?", a: "No. Instagram provides an impersonation form through its Help Center for people who don't have an account, which may ask for a photo of your ID." },
      { q: "How long does Instagram take to review an impersonation report?", a: "Instagram does not publish a fixed timeline. Review time varies, which is why a clear, well-documented report matters." },
      ...commonFaq("Instagram"),
      { q: "Can someone else report the account for me?", a: "Yes. Friends and followers can report through the app by choosing the option for someone they know, and authorized representatives can use the Help Center form." },
    ],
  }),
  tiktok: platformGuide({
    slug: "report-impersonation-account-tiktok",
    platform: "TikTok",
    title: "How to Report an Impersonation Account on TikTok",
    headTitle: "Report a TikTok Impersonation Account | Eterna",
    description:
      "A fake TikTok account is using your name or videos? Learn how to save evidence, report the impersonation step by step and what to do if TikTok rejects it.",
    helpUrl: "https://support.tiktok.com/",
    helpName: "TikTok Help Center",
    intro: [
      "Impersonation on TikTok often looks different from other platforms. Someone may re-upload your videos under a near-identical handle, run live streams pretending to be you, or use your face to promote giveaways. Knowing how to report an impersonation account on TikTok, and what evidence to keep first, makes it easier for a reviewer to see the problem quickly.",
      "This guide walks through documentation, the general in-app reporting path, options for people without a TikTok account, and what to do after a report.",
    ],
    identifiers: "Note the exact @username and, if you can, the date of the earliest video, since TikTok handles can be changed and videos can be deleted quickly.",
    withAccount: [
      "Open the impersonating profile in the TikTok app.",
      "Tap the share arrow or three-dot menu at the top right of the profile.",
      "Tap Report, then choose Report account.",
      "Select the option for pretending to be someone or impersonation.",
      "Choose whether the account is impersonating you or someone else, and follow the prompts.",
      "Submit the report and screenshot the confirmation.",
    ],
    withoutAccount: [
      "Go to the TikTok Help Center and search for \"impersonation\" or \"report a problem\".",
      "Open the web report form for impersonation that the help article links to.",
      "Enter the account's username and profile URL, and describe how it is pretending to be you.",
      "Provide identity verification if the form requests it.",
      "Submit the form and save any confirmation email.",
    ],
    onBehalf: [
      "Use the in-app report path and choose the option indicating the account is impersonating someone else.",
      "For an authorized representative, use the web impersonation form and identify yourself as acting for the person or brand.",
      "Have documentation of your authority ready, as the platform may ask for it.",
    ],
    platformNotes: [
      "If the impersonator is re-posting your original videos, a copyright report through TikTok's intellectual property channel may be a separate, parallel route. Live streams are harder to document, so record your screen if you see the account live.",
    ],
    after:
      "TikTok reviews the report and may notify you in your inbox or by email. Accounts found to violate the impersonation policy are typically removed or restricted. Where an appeal or review option is offered in the decision, you can use it.",
    faqs: [
      { q: "Can I report a TikTok impersonation account without the app?", a: "Yes. TikTok's Help Center links to a web form for reporting impersonation, which people without an account can use." },
      { q: "What if the account is only re-posting my videos?", a: "That may be better handled as a copyright report through TikTok's intellectual property form, alongside or instead of an impersonation report." },
      ...commonFaq("TikTok"),
      { q: "How long does TikTok take to respond?", a: "TikTok does not publish a fixed timeline for impersonation reviews, so keep documenting the account while you wait." },
    ],
  }),
  facebook: platformGuide({
    slug: "report-impersonation-account-facebook",
    platform: "Facebook",
    title: "How to Report a Fake Facebook Profile Impersonating You",
    headTitle: "Report a Fake Facebook Profile Impersonating You | Eterna",
    description:
      "Found a fake Facebook profile impersonating you? Learn how to document it, report it to Facebook step by step and what to do if it's rejected.",
    helpUrl: "https://www.facebook.com/help/",
    helpName: "Facebook Help Center",
    intro: [
      "Fake Facebook profiles impersonating real people are often used to send friend requests to the real person's contacts and then ask for money or personal details. Some copy a business page or a public figure's profile instead. Reporting a fake Facebook profile impersonating you is straightforward once you know the route, and a clear record makes the reviewer's job easier.",
      "This guide covers documentation first, then the reporting paths for people with and without a Facebook account, and what to do if a report doesn't succeed.",
    ],
    identifiers: "On Facebook, the profile URL may include a numeric ID or a custom username. Save the full URL exactly as it appears, because the display name can be changed at any time.",
    withAccount: [
      "Go to the fake profile.",
      "Click or tap the three-dot menu below or beside the cover photo.",
      "Select Find support or report profile (or the current equivalent).",
      "Choose the option for Pretending to be someone or Fake profile.",
      "Select Me if the profile is impersonating you, and follow the prompts.",
      "Submit the report and screenshot the confirmation.",
    ],
    withoutAccount: [
      "Go to the Facebook Help Center and search for \"impersonation\" or \"fake account\".",
      "Open the impersonation report form linked from the help article for people without an account.",
      "Paste the fake profile's URL and fill in your details.",
      "Upload a photo of a government-issued ID if requested.",
      "Submit the form and keep any confirmation.",
    ],
    onBehalf: [
      "In the report flow, choose the option for someone I know, or a celebrity or public figure.",
      "If the person being impersonated cannot report themselves, ask them to confirm the report directly when possible, as Facebook often needs the impersonated person involved.",
      "Authorized representatives can use the Help Center impersonation form and should keep proof of authority ready.",
    ],
    platformNotes: [
      "If the impersonation copies a Facebook Page rather than a personal profile, use the Page's own three-dot menu and report it in the same way. Fake ads using your face can be reported from the ad itself through its menu.",
    ],
    after:
      "Facebook reviews the report against its policies on impersonation and inauthentic accounts. You can usually follow the status in your Support Inbox. If the profile is found to be impersonating you, it is typically removed.",
    faqs: [
      { q: "Can I report a fake Facebook profile if I'm blocked by it?", a: "Yes. Ask a friend to share the profile link with you and use the Help Center impersonation form, or have the friend report it on your behalf." },
      { q: "Where can I see the status of my report?", a: "If you reported while logged in, Facebook usually shows updates in your Support Inbox." },
      ...commonFaq("Facebook"),
      { q: "Is reporting a fake Page different from a fake profile?", a: "The path is similar, starting from the Page's own menu, but business pages may also be handled through intellectual property channels if trademarks are involved." },
    ],
  }),
  linkedin: platformGuide({
    slug: "report-impersonation-account-linkedin",
    platform: "LinkedIn",
    title: "How to Report a Fake LinkedIn Profile Using Your Name",
    headTitle: "Report a Fake LinkedIn Profile Using Your Name | Eterna",
    description:
      "A fake LinkedIn profile is using your name or job title? Learn how to save evidence, report it to LinkedIn step by step and what to do if it stays up.",
    helpUrl: "https://www.linkedin.com/help/linkedin",
    helpName: "LinkedIn Help",
    intro: [
      "Fake LinkedIn profiles are often built around a real professional's name, photo and employer. They may be used to approach colleagues, recruit for fake jobs or lend credibility to a scam. When you report a fake LinkedIn profile using your name, the professional context matters: the reviewer needs to see that the profile claims your identity or role.",
      "This guide covers what to save, the general reporting path, how to report without an account or on behalf of a colleague, and what happens next.",
    ],
    identifiers: "Save the profile URL, which usually contains a custom slug after /in/, and note the job title and employer the profile claims.",
    withAccount: [
      "Go to the fake profile.",
      "Click the More button on the profile introduction section.",
      "Select Report / Block.",
      "Choose Report, then select the option indicating the profile is fake or is pretending to be someone.",
      "Indicate that the profile is impersonating you and follow the prompts.",
      "Submit the report and screenshot the confirmation.",
    ],
    withoutAccount: [
      "Go to LinkedIn Help and search for \"fake profile\" or \"impersonation\".",
      "Open the form for reporting an inaccurate or fake profile linked from the help article.",
      "Enter the profile URL and your details.",
      "Provide identity verification if requested.",
      "Submit and keep the confirmation email.",
    ],
    onBehalf: [
      "Colleagues can report through the profile's More menu, choosing the option that it is pretending to be someone else.",
      "If the profile misuses your company's name, a company page admin can also report it, and the employer listed may help confirm the profile is not a real employee.",
      "Representatives should keep written authorization from the person being impersonated.",
    ],
    platformNotes: [
      "If the fake profile has sent messages to your contacts, ask them to report the messages as well. Messages promoting fake job offers can usually be reported directly from the conversation.",
    ],
    after:
      "LinkedIn reviews the report and may contact you by email. Profiles found to be fake or impersonating someone are typically restricted or removed.",
    faqs: [
      { q: "Can my employer help report a fake LinkedIn profile?", a: "Yes. If the profile claims to work at your company, an admin of the company page can report it, which can support your own report." },
      { q: "Do I need a LinkedIn account to report?", a: "No. LinkedIn Help links to a form for reporting fake or inaccurate profiles." },
      ...commonFaq("LinkedIn"),
      { q: "What if the fake profile is offering jobs in my name?", a: "Report the profile and the messages, warn your network on your genuine profile, and consider reporting the scam to local authorities." },
    ],
  }),
  x: platformGuide({
    slug: "report-impersonation-account-x",
    platform: "X",
    title: "How to Report an Impersonation Account on X (Twitter)",
    headTitle: "Report an Impersonation Account on X (Twitter) | Eterna",
    description:
      "An X (Twitter) account is pretending to be you? Learn how to save evidence, report it on X step by step and what to do if your report fails.",
    helpUrl: "https://help.x.com/",
    helpName: "X Help Center",
    intro: [
      "Impersonation accounts on X (formerly Twitter) often copy a public figure's display name and photo, then reply to popular posts to reach the real person's audience. Some promote crypto schemes or fake giveaways. Reporting an impersonation account on X works best when you can show which handle is real and how the fake one is misleading people.",
      "This guide covers what to record, the reporting path on X, options without an account or on behalf of someone else, and what to do if the account stays up.",
    ],
    identifiers: "Record the exact @handle, since display names on X can be identical to yours while the handle differs by a single character.",
    withAccount: [
      "Go to the impersonating profile.",
      "Click or tap the three-dot menu on the profile.",
      "Select Report.",
      "Choose the option for impersonation or pretending to be someone.",
      "Indicate whether it is impersonating you or someone else and follow the prompts.",
      "Submit and screenshot the confirmation.",
    ],
    withoutAccount: [
      "Go to the X Help Center and search for \"impersonation\".",
      "Open the impersonation report form linked from the policy page.",
      "Enter the impersonating account's handle and your details.",
      "Provide identity verification if requested.",
      "Submit and keep the confirmation email.",
    ],
    onBehalf: [
      "Use the in-app report and choose the option that it is impersonating someone else.",
      "Authorized representatives, such as agents or legal counsel, can use the impersonation form and indicate they are reporting on someone's behalf.",
      "Keep proof of authorization available.",
    ],
    platformNotes: [
      "X has separate rules for parody, commentary and fan accounts, which are generally expected to state that clearly in the name and bio. An unlabelled account using your name and photo is the clearest impersonation case.",
    ],
    after:
      "X reviews the report and may contact you by email. Accounts that violate the impersonation policy may be suspended or required to change their profile.",
    faqs: [
      { q: "Can I report an impersonation account on X without an account?", a: "Yes. The X Help Center links to an impersonation report form you can use without logging in." },
      { q: "What if the account says it is a parody?", a: "X allows clearly labelled parody accounts. If the label is missing or misleading, you can still report it as impersonation." },
      ...commonFaq("X"),
      { q: "Will X tell me the outcome?", a: "X may email you about the report, but it does not always share details of the action taken." },
    ],
  }),
  youtube: platformGuide({
    slug: "report-impersonation-youtube",
    platform: "YouTube",
    title: "How to Report a YouTube Channel Impersonating You",
    headTitle: "Report a YouTube Channel Impersonating You | Eterna",
    description:
      "A YouTube channel is pretending to be you or your brand? Learn how to document it, report channel impersonation step by step and what to do if it stays up.",
    helpUrl: "https://support.google.com/youtube/",
    helpName: "YouTube Help Center",
    intro: [
      "A YouTube channel impersonating you may copy your channel name, banner and profile picture, re-upload your videos, or run live streams claiming to be you. Some promote scams in the comments of your genuine videos. Reporting a YouTube channel impersonating you means showing the reviewer that the channel is trying to pass as you, not just discussing or reacting to you.",
      "This guide covers what to save first, the general reporting path, options without an account or on behalf of someone, and what to do next.",
    ],
    identifiers: "Save the channel URL, including the @handle or channel ID, because channel names can be changed at any time.",
    withAccount: [
      "Go to the impersonating channel's page.",
      "Open the About section or the channel description panel.",
      "Select the flag or Report user option (the label may vary).",
      "Choose the option for impersonation.",
      "Indicate whether the channel is impersonating you or another creator, and provide your genuine channel link if asked.",
      "Submit and screenshot the confirmation.",
    ],
    withoutAccount: [
      "Go to the YouTube Help Center and search for \"impersonation\".",
      "Open the impersonation complaint form linked from the policy article.",
      "Enter the impersonating channel's URL and your details.",
      "Provide identity verification if requested.",
      "Submit and save the confirmation.",
    ],
    onBehalf: [
      "Use the channel report path and choose the option indicating it is impersonating someone else.",
      "Representatives can use the impersonation complaint form and should be ready to show authorization.",
      "If the channel is re-uploading the creator's videos, the rights holder can file a separate copyright complaint.",
    ],
    platformNotes: [
      "Copyright complaints and impersonation reports are different processes on YouTube. Re-uploads of your own videos are usually a copyright matter, while a channel posing as you is an impersonation matter. Many cases involve both.",
    ],
    after:
      "YouTube reviews the report against its impersonation policy. Channels found to be impersonating someone may be removed or required to change. You may receive an email update.",
    faqs: [
      { q: "Is a re-upload of my video impersonation?", a: "Not by itself. A re-upload is usually a copyright issue, while impersonation is when the channel pretends to be you. Many fake channels do both." },
      { q: "Can I report a YouTube channel without a Google account?", a: "Yes. YouTube's Help Center links to an impersonation complaint form." },
      ...commonFaq("YouTube"),
      { q: "What about scam comments using my name?", a: "Report the comments individually and, on your own channel, consider moderation tools that hold or block comments using your name." },
    ],
  }),
};
