import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, serviceSchema, webPageSchema } from "@/components/public/ServiceLanding";

const PATH = "/monitoring";
const DESCRIPTION =
  "Impersonation and synthetic media can surface anywhere. Eterna's digital identity monitoring watches for emerging risks. Request a confidential assessment.";

export const Route = createFileRoute("/monitoring")({
  head: () =>
    landingHead({
      path: PATH,
      title: "Digital Identity Monitoring Service | Eterna Sentinel",
      description: DESCRIPTION,
    }),
  component: Page,
});

const faqs = [
  {
    q: "What is digital identity monitoring?",
    a: "Digital identity monitoring is the ongoing search of agreed public sources for misuse of a person's or organization's identity, such as impersonation accounts, synthetic media and harmful content, followed by human review of anything found. Eterna Sentinel treats every signal as unverified until it has been checked.",
  },
  {
    q: "What does impersonation monitoring look for?",
    a: "Accounts, pages and ads that use the client's name, photos, logo or likeness without permission, including profiles that copy an official account's look or claim to speak for the client.",
  },
  {
    q: "Can deepfake monitoring detect every fake?",
    a: "No. No monitoring system can detect every threat or cover the entire internet. Eterna monitors the supported public sources agreed for each engagement, and suspected synthetic media is verified before it is treated as a finding.",
  },
  {
    q: "Will I get an alert for every mention of my name?",
    a: "No. Ordinary mentions, news coverage and fan content are not threats. Signals are filtered and reviewed by people so alerts focus on findings that may need attention.",
  },
  {
    q: "Which sources are monitored?",
    a: "Sources are agreed during scoping and typically include supported social platforms, video sites, search results and the public web. Eterna is clear about what is and is not covered.",
  },
  {
    q: "What happens when a finding needs action?",
    a: "Verified findings with preserved evidence are routed to incident response, where any platform report or escalation is carried out within the authorization agreed for the engagement.",
  },
];

function Page() {
  return (
    <ServiceLanding
      eyebrow="Monitoring"
      section="Platform"
      sourcePage="monitoring"
      title="Continuous Digital Identity Monitoring"
      intro="Digital identity monitoring from Eterna Sentinel watches the supported public sources agreed for each client for impersonation, synthetic media and harmful content, then routes every identified signal to human review. Nothing is treated as a finding until it has been verified."
      schema={`[${webPageSchema({ path: PATH, name: "Digital Identity Monitoring", description: DESCRIPTION })},${serviceSchema({ path: PATH, name: "Eterna Sentinel Monitoring", serviceType: "Digital identity, impersonation and deepfake monitoring", description: DESCRIPTION })}]`}
      sections={[
        {
          kicker: "Scope",
          heading: "Monitored sources, agreed in advance.",
          body: [
            "Monitoring covers the supported public sources agreed for each engagement. It does not cover the entire internet, and no monitoring system can detect every threat. Being clear about scope is part of the service.",
            "Within that scope, Eterna looks at:",
          ],
          bullets: [
            "Social platforms: public posts, profiles, pages and ads on supported networks.",
            "Video sites: uploads and clips that use the client's face, voice or name.",
            "Search results: what appears for the client's name and key terms.",
            "Impersonation accounts: profiles copying the client's name, photos, logo or official accounts.",
            "Synthetic media of the client: suspected deepfake video, images and cloned audio.",
          ],
        },
        {
          kicker: "Impersonation monitoring",
          heading: "Finding the accounts that pretend to be you.",
          body: [
            "Fake accounts often copy an official profile's photo, bio and style, then contact followers, staff or customers. Impersonation monitoring looks for these patterns across agreed sources and records each candidate account with its handle, link, creation details where visible and the content it has posted.",
          ],
          links: [{ label: "Fake account using your name or photos?", to: "/newsroom/fake-account-using-my-name-photos" }],
        },
        {
          kicker: "Deepfake monitoring",
          heading: "Watching for synthetic media of the client.",
          body: [
            "Deepfake monitoring looks for video, images and audio that may have been generated or manipulated to depict the client. A suspicious result is a signal, not a conclusion. It is checked against reference material and context before anyone calls it a deepfake.",
          ],
          links: [{ label: "The Deepfake Verification Guide", to: "/newsroom/deepfake-verification-guide" }],
        },
        {
          kicker: "Verification",
          heading: "How signals become verified findings.",
          body: [
            "Most signals turn out to be ordinary: news coverage, fan accounts, legitimate clips. Each one is assessed for identity match, context and potential harm. Only signals that meet Eterna's published verification standard become findings, and findings carry an evidence record with source, timestamp and capture.",
          ],
          links: [{ label: "Read the verification methodology", to: "/methodology" }],
        },
        {
          kicker: "Alerting and review",
          heading: "Alerts reviewed by people, not just software.",
          body: [
            "Technology helps find signals at scale. People decide what they mean. Reviewers filter out noise so clients are not flooded with every mention, and escalate verified findings that may need action.",
            "How and when the client hears about findings is agreed during scoping: regular summaries for routine findings and direct escalation when something needs attention quickly.",
          ],
        },
        {
          kicker: "Before a crisis",
          heading: "Why monitoring before a crisis matters.",
          body: [
            "When monitoring starts only after something has gone wrong, the first copies have already spread and the earliest evidence may be gone. Ongoing monitoring means fakes are more likely to be found early, records already exist, and the response can start from facts.",
          ],
          links: [{ label: "Why companies need reputation monitoring", to: "/newsroom/why-companies-need-reputation-monitoring" }],
        },
        {
          kicker: "Your reports",
          heading: "What monitoring reports show.",
          body: [
            "Routine reports summarise what was reviewed during the period, which findings were verified, the evidence behind each one, and what action was taken or is recommended. Signals that were set aside are counted, not listed in full, so the report stays readable.",
            "Clients can change the scope as their exposure changes, for example adding a new official account, a new product name or a spokesperson who has started appearing in public.",
          ],
        },
        {
          kicker: "Example scenario",
          heading: "Illustrative example: an early fake profile.",
          body: [
            "Example scenario, not a real client: monitoring surfaces a new profile using an athlete's photos and a near-identical handle. A reviewer confirms it is not an official or fan account, preserves the profile and its first posts, and escalates it. Because it was found early, few followers had been contacted before it was reported.",
          ],
        },
        {
          kicker: "After an incident",
          heading: "Monitoring continues once a response is underway.",
          body: [
            "Harmful content can recur or be re-uploaded elsewhere. Monitoring continues after an initial response so recurrence can be identified and escalated.",
          ],
          links: [{ label: "Deepfake reuploads: why content returns", to: "/newsroom/deepfake-reuploads-after-removal" }],
        },
      ]}
      cardsHeading="What monitoring helps identify"
      cards={[
        { title: "Impersonation discovery", body: "Accounts and pages that may be using a client's name, likeness or identity." },
        { title: "Synthetic media signals", body: "Potential deepfakes and manipulated imagery, video or audio." },
        { title: "Reputation risk", body: "Emerging defamatory or misleading content in monitored sources." },
        { title: "Harmful content signals", body: "Early signals of abuse, leaks or coordinated harassment." },
        { title: "Evidence preservation", body: "Source, timestamp and context retained when a signal is identified." },
        { title: "Escalation readiness", body: "Verified findings routed to incident response when action is needed." },
      ]}
      faqs={faqs}
      faqHeading="Digital identity monitoring questions"
      guides={[
        { label: "Why companies need reputation monitoring", to: "/newsroom/why-companies-need-reputation-monitoring" },
        { label: "The Deepfake Verification Guide", to: "/newsroom/deepfake-verification-guide" },
        { label: "Fake account using your name or photos?", to: "/newsroom/fake-account-using-my-name-photos" },
        { label: "Deepfake reuploads: why content returns", to: "/newsroom/deepfake-reuploads-after-removal" },
      ]}
      related={[
        { label: "How Eterna Sentinel Works", to: "/how-it-works" },
        { label: "Incident Response", to: "/incident-response" },
        { label: "Deepfake Protection", to: "/deepfake-protection" },
        { label: "Public Figure Protection", to: "/public-figure-protection" },
        { label: "Request Protection", to: "/request-protection" },
      ]}
    />
  );
}
