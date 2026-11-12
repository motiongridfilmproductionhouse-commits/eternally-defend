import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, serviceSchema } from "@/components/public/ServiceLanding";

const PATH = "/incident-response";
const DESCRIPTION =
  "A deepfake, leak or impersonation is live. Eterna's incident response verifies, preserves evidence and coordinates action. Request a confidential assessment.";

export const Route = createFileRoute("/incident-response")({
  head: () =>
    landingHead({
      path: PATH,
      title: "Deepfake & Impersonation Incident Response | Eterna",
      description: DESCRIPTION,
    }),
  component: Page,
});

const faqs = [
  {
    q: "What is deepfake incident response?",
    a: "Deepfake incident response is the coordinated work done once a manipulated video, image or audio clip of a real person appears: verifying it, preserving evidence, assessing spread, reporting through eligible routes and monitoring for reuploads. Eterna Sentinel runs each step with human review.",
  },
  {
    q: "When should I contact Eterna for incident response?",
    a: "Contact Eterna when you find a deepfake or fake account using your identity, when someone threatens to publish private material, or when a false claim about you or your organization is spreading quickly. If you are in immediate danger, contact local emergency services first.",
  },
  {
    q: "Can you guarantee the content will be taken down?",
    a: "No. Eterna is not an automatic takedown service. Whether content is removed depends on platform policy, the facts of the case and the authorization in place. Eterna coordinates the eligible routes and documents the outcome honestly.",
  },
  {
    q: "Should I pay someone who is threatening to publish my images?",
    a: "Paying rarely makes threats stop and often leads to further demands. Preserve the messages, do not engage further, and get help. Eterna's guide on private video leaks and blackmail explains the first steps.",
  },
  {
    q: "Do I need to prove who I am before you help?",
    a: "Yes. Eterna verifies the identity of the affected person and that anyone acting for them is authorized. This protects you from someone else requesting action in your name.",
  },
  {
    q: "What happens after the incident is handled?",
    a: "Monitoring continues on agreed sources so reuploads and altered copies can be identified and escalated. A reupload does not mean the first response failed; it is a known pattern.",
  },
  {
    q: "Is online reputation crisis response different from deepfake response?",
    a: "The steps are similar: verify, preserve evidence, assess spread, choose the right route and monitor. The route differs. A viral false claim may call for platform reporting, legal review or a communications decision rather than a manipulated-media report.",
  },
];

function Page() {
  return (
    <ServiceLanding
      eyebrow="Incident Response"
      section="Platform"
      sourcePage="incident-response"
      title="Deepfake Incident Response for Digital Identity Threats"
      intro="Deepfake incident response from Eterna Sentinel helps authorized clients act quickly and correctly when a deepfake, impersonation account, threat or harmful leak appears. Eterna verifies what happened, preserves evidence, assesses spread and coordinates an appropriate, authorized response, then keeps watching for reuploads."
      schema={serviceSchema({
        path: PATH,
        name: "Eterna Sentinel Incident Response",
        serviceType: "Deepfake and impersonation incident response",
        description: DESCRIPTION,
      })}
      sections={[
        {
          kicker: "When to call",
          heading: "Situations that need impersonation incident response.",
          body: ["Incident response is for situations that are already happening, not general concerns. Typical triggers:"],
          bullets: [
            "A deepfake: video, image or audio showing you or your executive doing or saying something that never happened.",
            "A fake account: a profile using your name or photos to contact people, take money or spread content.",
            "Blackmail or threats: someone threatening to publish private or fabricated images or videos.",
            "A viral false claim: an allegation or misleading story about you or your organization spreading quickly.",
          ],
          links: [
            { label: "Someone made a deepfake of me: what to do", to: "/newsroom/someone-made-a-deepfake-of-me" },
            { label: "Private video leaks and blackmail: what to do first", to: "/newsroom/private-video-leak-online-blackmail-first-steps" },
          ],
        },
        {
          kicker: "The first steps",
          heading: "How Eterna runs the first steps.",
          body: ["The order matters. Acting before evidence is preserved can make a case harder to report or prove later."],
          bullets: [
            "Verify: confirm authorization, the identity involved and whether the content is what it appears to be.",
            "Preserve evidence: capture the source, timestamp, account details and context before anything changes.",
            "Assess spread: identify where copies, reposts and related accounts appear across agreed sources.",
            "Prioritise platforms: start where reach and harm are highest and where an eligible reporting route exists.",
            "Respond: submit authorized reports, brief advisors and support communications decisions.",
            "Monitor reuploads: keep watching for new or altered copies after the first response.",
          ],
        },
        {
          kicker: "Before help arrives",
          heading: "What you should and shouldn't do.",
          body: ["A few early decisions make a large difference. While you wait for help:"],
          bullets: [
            "Do take screenshots and copy links, including the account name and the date and time you saw it.",
            "Do tell the people most likely to be contacted by a fake, such as your team or family, privately.",
            "Do secure your own accounts with strong passwords and two-factor authentication.",
            "Don't comment on, share or message the fake account; it can spread the content and alert whoever made it.",
            "Don't pay anyone threatening to publish material.",
            "Don't post a public statement until you know what you are responding to.",
          ],
        },
        {
          kicker: "Evidence preservation",
          heading: "Why evidence comes before reporting.",
          body: [
            "Posts get deleted, edited or made private once they are reported or noticed. A preserved record of the original, with source and timestamp, is what platforms, lawyers and investigators rely on.",
            "Eterna keeps that record in access-controlled storage and shares it only with the people you authorize.",
          ],
          links: [{ label: "How to preserve evidence when you discover a deepfake", to: "/newsroom/how-to-preserve-deepfake-evidence" }],
        },
        {
          kicker: "Online reputation crisis response",
          heading: "When the problem is a story, not a file.",
          body: [
            "Some incidents are not manipulated media at all, but a false allegation or misleading narrative. The same discipline applies: verify what is being said and where, preserve it, assess spread and choose the right route, which may be a platform report, legal review or a considered public response.",
          ],
        },
        {
          kicker: "Example scenario",
          heading: "Illustrative example: a fake clip goes viral.",
          body: [
            "Example scenario, not a real client: a manipulated clip of a speaker appears on several video sites overnight. Eterna verifies it against the original recording, preserves each copy with its source and time, reports the copies with the highest reach first, and gives the speaker's team a short summary they can use to decide whether to comment publicly.",
          ],
        },
        {
          kicker: "After the incident",
          heading: "Monitoring for reuploads.",
          body: [
            "Harmful content often returns, sometimes altered just enough to avoid automatic matching. After the initial response, Eterna keeps monitoring agreed sources so reuploads can be identified and escalated quickly. A reupload is not a sign that the first response failed.",
          ],
          links: [{ label: "Deepfake reuploads: why content returns", to: "/newsroom/deepfake-reuploads-after-removal" }],
        },
      ]}
      cardsHeading="The incident response sequence"
      cards={[
        { title: "Verify", body: "Confirm authorization and the identity involved." },
        { title: "Investigate", body: "Assess the content, source and spread." },
        { title: "Preserve evidence", body: "Retain records suitable for platform and legal review." },
        { title: "Respond", body: "Coordinate eligible, authorized platform or enforcement action." },
        { title: "Monitor again", body: "Watch for recurrence across agreed surfaces." },
      ]}
      faqs={faqs}
      faqHeading="Deepfake incident response questions"
      guides={[
        { label: "How to preserve evidence when you discover a deepfake", to: "/newsroom/how-to-preserve-deepfake-evidence" },
        { label: "Deepfake reuploads: why content returns", to: "/newsroom/deepfake-reuploads-after-removal" },
        { label: "Someone made a deepfake of me: what to do", to: "/newsroom/someone-made-a-deepfake-of-me" },
        { label: "Private video leaks and blackmail: what to do first", to: "/newsroom/private-video-leak-online-blackmail-first-steps" },
      ]}
      related={[
        { label: "Deepfake Protection", to: "/deepfake-protection" },
        { label: "Online Reputation Protection", to: "/online-reputation-protection" },
        { label: "Verification Methodology", to: "/methodology" },
        { label: "How Eterna Sentinel Works", to: "/how-it-works" },
        { label: "Request Protection", to: "/request-protection" },
      ]}
    />
  );
}
