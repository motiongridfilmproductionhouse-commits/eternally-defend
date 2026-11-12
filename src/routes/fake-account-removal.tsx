import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, serviceSchema, webPageSchema } from "@/components/public/ServiceLanding";

const PATH = "/fake-account-removal";
const DESCRIPTION =
  "Someone running a fake account impersonating you? Eterna's fake account removal service verifies, preserves evidence and escalates. Request an assessment.";

export const Route = createFileRoute("/fake-account-removal")({
  head: () =>
    landingHead({ path: PATH, title: "Fake Account Removal Service | Eterna Sentinel", description: DESCRIPTION }),
  component: Page,
});

const faqs = [
  {
    q: "What is a fake account removal service?",
    a: "A fake account removal service helps you get an account impersonating you reviewed and removed by the platform. Eterna Sentinel verifies the account, preserves evidence and escalates through the reporting channels available, within your authorization.",
  },
  {
    q: "Can you remove a fake account impersonating me straight away?",
    a: "No. Only the platform can remove an account, and each platform runs its own review. Eterna prepares and escalates a clear, evidenced report, but cannot promise an outcome or a timeline.",
  },
  {
    q: "What do I need to provide?",
    a: "Proof of your identity, or proof that you are authorized to act for the person or organisation being impersonated, plus links to the accounts and anything you have already saved.",
  },
  {
    q: "Do you handle impersonation account takedown for brands and executives?",
    a: "Yes. Impersonation account takedown can cover individuals, executives and organisations, provided the request comes from the person or an authorized representative.",
  },
  {
    q: "What if the account comes back under a new name?",
    a: "Repeat accounts are common. Where monitoring is part of the engagement, new accounts are identified, verified and escalated with reference to earlier reports.",
  },
  {
    q: "Should I report the account myself first?",
    a: "You can, and for simple cases it often works. Our platform guides explain how. If your report stalls, there are multiple accounts, or the account is running scams, Eterna can help.",
  },
];

function Page() {
  return (
    <ServiceLanding
      eyebrow="Fake Account Removal"
      section="Solutions"
      sourcePage="fake-account-removal"
      title="Fake Account Removal Service"
      intro="Eterna Sentinel's fake account removal service helps people and organisations when an account is impersonating them. We verify the account, preserve the evidence and escalate through the platform's reporting channels, within your authorization. Removal decisions rest with each platform."
      schema={`[${webPageSchema({ path: PATH, name: "Fake Account Removal Service", description: DESCRIPTION })},${serviceSchema({ path: PATH, name: "Eterna Sentinel Fake Account Removal", serviceType: "Fake account removal and impersonation account takedown", description: DESCRIPTION })}]`}
      sections={[
        {
          kicker: "The problem",
          heading: "When you need to remove a fake account impersonating you.",
          body: [
            "A fake account can use your name, photos, job title or brand to message your contacts, run scams, post content you never wrote or simply confuse people about who you are. For public figures and businesses it can also draw followers away from genuine accounts. A fake account removal service exists for the moments when reporting it yourself isn't enough.",
            "Common signs an account is impersonating you include:",
          ],
          bullets: [
            "It uses your name or a near-identical username, often with an extra character, underscore or number.",
            "It uses your profile photo, posts or videos copied from your genuine accounts.",
            "It claims your job title, employer, business or official status.",
            "It contacts your followers, friends or customers, often asking for money, gift cards, crypto or personal details.",
            "It promotes giveaways, investment offers or products in your name.",
            "People tell you they have received messages from you that you didn't send.",
          ],
        },
        {
          kicker: "Why it stalls",
          heading: "Why self-reporting often stalls.",
          body: [
            "Most platforms let you report impersonation yourself, and in straightforward cases that works. Reports tend to stall for predictable reasons: the wrong report category was used, the report lacked identity documents, evidence was not captured before the account changed its name, or the account looked similar enough to a fan or parody page that a reviewer wasn't sure.",
            "Other cases are harder by nature. Several accounts may appear at once, removed accounts may return under new names, or the impersonation may span more than one platform. When the account is running scams, every day it stays up matters to the people being contacted.",
          ],
          links: [
            { label: "Report impersonation on Instagram", to: "/newsroom/report-impersonation-account-instagram" },
            { label: "Report impersonation on Facebook", to: "/newsroom/report-impersonation-account-facebook" },
          ],
        },
        {
          kicker: "How Eterna helps",
          heading: "How Eterna verifies, preserves evidence and escalates.",
          body: [
            "Every case begins with verification. A reviewer confirms that the account is impersonating you rather than being a labelled fan, commentary or parody account, and that you, or the person you represent, are who the request says. Nothing is reported until that check is complete.",
            "Next, evidence is preserved: profile details, usernames and IDs, URLs, posts, messages and timestamps are recorded so the record survives if the account is renamed or deleted. That record supports a clear, specific report.",
            "Eterna then escalates through the reporting channels each platform provides, using the impersonation category and the identity or authorization documents the platform requires. Where an impersonation account takedown involves copied content or trademarks, the related reports are prepared as separate, correctly routed submissions. Each step is logged, and you can see what was submitted and what the platform replied.",
          ],
          bullets: [
            "Human verification before any report.",
            "Evidence preserved with sources and timestamps.",
            "Escalation through official platform channels only.",
            "Follow-up on repeat or replacement accounts where monitoring is agreed.",
          ],
        },
        {
          kicker: "What we need",
          heading: "What you need to provide.",
          body: [
            "Because removing a fake account means acting on someone's identity, Eterna needs to confirm who is asking. Before work begins, please be ready to provide:",
          ],
          bullets: [
            "Proof of identity for the person being impersonated, such as a government-issued ID.",
            "If you are a representative (manager, agent, lawyer, employer), written authorization from the person or organisation.",
            "Links to your genuine accounts, so the reviewer can compare them.",
            "Links to the fake accounts and any screenshots or messages you have already saved.",
            "Any reference numbers from reports you have already filed.",
          ],
        },
        {
          kicker: "Across platforms",
          heading: "Impersonation rarely stays on one platform.",
          body: [
            "Someone who copies your identity on one platform often tries others. Eterna checks for related accounts using the same name, photos or wording across the supported platforms agreed for your case, so each one can be verified and reported through the right channel rather than discovered weeks later.",
            "Where an account is being used for fraud, threats or extortion, we will also suggest when it may be appropriate to involve the police or your national cybercrime reporting service, and keep the evidence in a form you can share with them.",
          ],
        },
        {
          kicker: "Timelines",
          heading: "Timelines depend on the platform.",
          body: [
            "Platforms decide whether an account is removed, and they set their own review times. Eterna does not promise that an account will be removed or that it will happen by a particular date. What we can do is make sure the report is complete, correctly routed and followed up, and tell you plainly when an account falls outside a platform's impersonation rules.",
          ],
        },
        {
          kicker: "Illustrative example",
          heading: "Example scenario, not a real client.",
          body: [
            "A consultant learns that a profile using her name and photo is messaging her clients about a fake investment. She had reported it once, but the report was declined. Eterna verifies her identity, preserves the profile and the messages clients forwarded, and resubmits under the impersonation category with her ID. The platform's decision follows its own review.",
          ],
        },
      ]}
      faqs={faqs}
      faqHeading="Fake account removal questions"
      guides={[
        { label: "Fake account using your name or photos?", to: "/newsroom/fake-account-using-my-name-photos" },
        { label: "The Impersonation Response Guide", to: "/newsroom/impersonation-response-guide" },
        { label: "Report impersonation on TikTok", to: "/newsroom/report-impersonation-account-tiktok" },
        { label: "Report a fake LinkedIn profile", to: "/newsroom/report-impersonation-account-linkedin" },
      ]}
      related={[
        { label: "Impersonation Protection", to: "/ai-impersonation" },
        { label: "Incident Response", to: "/incident-response" },
        { label: "Monitoring", to: "/monitoring" },
        { label: "Request Protection", to: "/request-protection" },
      ]}
    />
  );
}
