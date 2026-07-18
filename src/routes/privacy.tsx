import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | Eterna Sentinel" },
      {
        name: "description",
        content:
          "Privacy Policy for Eterna Sentinel — digital protection, reputation intelligence, and YouTube API Services disclosure.",
      },
      { property: "og:title", content: "Privacy Policy | Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "How Eterna Sentinel collects, uses, retains, and protects information across our digital protection and reputation intelligence platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function PrivacyPage() {
  const updated = "July 14, 2026";
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <Link to="/" className="text-sm font-semibold tracking-tight text-foreground">
            Eterna AI
          </Link>
          <span className="text-xs text-muted-foreground">Last updated: {updated}</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-14">
        <div className="mb-12">
          <p className="text-xs font-medium uppercase tracking-widest text-primary">Legal</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
          <p className="mt-4 text-base text-muted-foreground">
            This Privacy Policy describes how Eterna AI ("Eterna", "we", "our", or "us") collects,
            uses, discloses, and safeguards information when you use our digital protection and
            reputation intelligence platform, websites, applications, and related services
            (collectively, the "Services").
          </p>
        </div>

        <div className="space-y-12">
          <Section id="introduction" title="1. Introduction">
            <p>
              Eterna AI provides digital protection, reputation monitoring, threat intelligence,
              copyright monitoring, impersonation detection, deepfake detection, evidence
              collection, and enforcement support services to individuals, brands, and
              organizations. Our platform helps authorized users identify, document, and respond
              to online risks that may harm their reputation, intellectual property, identity, or
              digital safety.
            </p>
            <p>
              By accessing or using the Services, you agree to the practices described in this
              Privacy Policy. If you do not agree, please do not use the Services.
            </p>
          </Section>

          <Section id="information-we-collect" title="2. Information We Collect">
            <p>We collect the following categories of information:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong className="text-foreground">Account information</strong> — name, username,
                password credentials, and authentication identifiers.
              </li>
              <li>
                <strong className="text-foreground">Contact details</strong> — email address,
                telephone number, and mailing address where provided.
              </li>
              <li>
                <strong className="text-foreground">Organization information</strong> — company
                name, role, team members, and billing details.
              </li>
              <li>
                <strong className="text-foreground">Protected assets submitted by users</strong> —
                names, handles, brand identifiers, URLs, images, videos, documents, and other
                assets that users designate for monitoring.
              </li>
              <li>
                <strong className="text-foreground">Publicly available online content</strong> —
                metadata and content retrieved from public websites, search engines, social
                platforms, news sources, forums, archives, and publicly available YouTube
                content.
              </li>
              <li>
                <strong className="text-foreground">Usage and analytics data</strong> — feature
                usage, interaction events, scan history, and diagnostic logs.
              </li>
              <li>
                <strong className="text-foreground">Device and browser information</strong> — IP
                address, browser type, operating system, device identifiers, language, and
                referral URLs.
              </li>
            </ul>
          </Section>

          <Section id="how-we-use" title="3. How We Use Information">
            <p>We use the information we collect to:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>Provide, operate, and maintain monitoring and protection Services.</li>
              <li>Detect reputation risks, threats, and harmful narratives.</li>
              <li>Identify impersonation, deepfake, and copyright infringement issues.</li>
              <li>Generate reports, evidence bundles, and enforcement packages.</li>
              <li>Improve platform security, reliability, and performance.</li>
              <li>Communicate with users about their accounts, alerts, and support requests.</li>
              <li>Comply with legal obligations and enforce our terms.</li>
            </ul>
          </Section>

          <Section id="public-content" title="4. Public Content Monitoring">
            <p>
              Eterna AI may analyze publicly available content from websites, search engines,
              social media platforms, news sites, forums, public archives, and publicly available
              YouTube content for authorized monitoring purposes. We do not access private
              accounts, private messages, or content protected by authentication controls without
              explicit authorization from the account holder.
            </p>
            <p>
              All monitoring activity is performed on behalf of authorized users for lawful
              purposes such as protecting their reputation, intellectual property, or identity.
            </p>
          </Section>

          <Section id="youtube-disclosure" title="5. YouTube API Services Disclosure">
            <p>
              Eterna AI uses YouTube API Services to retrieve publicly available YouTube metadata
              and content information for monitoring and reporting purposes.
            </p>
            <p>
              By using features that interact with YouTube services, users acknowledge and agree
              to be bound by the{" "}
              <a
                href="https://www.youtube.com/t/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4 hover:opacity-80"
              >
                YouTube Terms of Service
              </a>
              .
            </p>
            <p>
              Google's privacy practices are described in the{" "}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4 hover:opacity-80"
              >
                Google Privacy Policy
              </a>
              .
            </p>
            <p>
              Users may revoke Eterna AI's access to their Google or YouTube data at any time via
              the{" "}
              <a
                href="https://security.google.com/settings/security/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4 hover:opacity-80"
              >
                Google security settings page
              </a>
              .
            </p>
          </Section>

          <Section id="retention" title="6. Data Retention">
            <p>
              Evidence, reports, scan history, and monitoring data are retained securely for the
              duration necessary to provide the Services, comply with legal obligations, resolve
              disputes, and enforce agreements. Retention periods vary by data type and are
              designed to preserve forensic integrity for evidentiary and enforcement purposes.
              Users may request deletion of their data subject to legal and operational
              obligations.
            </p>
          </Section>

          <Section id="sharing" title="7. Sharing of Information">
            <p>
              Eterna AI does not sell personal information. We share information only in the
              following circumstances:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>When required by law, subpoena, court order, or lawful government request.</li>
              <li>
                With authorized service providers who process data on our behalf under
                confidentiality obligations.
              </li>
              <li>When explicitly requested or authorized by the user.</li>
              <li>
                In connection with a merger, acquisition, or asset transfer, subject to
                equivalent privacy protections.
              </li>
            </ul>
          </Section>

          <Section id="security" title="8. Security">
            <p>
              We implement industry-standard safeguards to protect information, including
              encryption in transit and at rest, role-based access controls, audit logging,
              secure cloud storage, isolated production environments, and periodic security
              reviews. Despite these measures, no method of electronic storage or transmission is
              completely secure, and we cannot guarantee absolute security.
            </p>
          </Section>

          <Section id="user-rights" title="9. User Rights">
            <p>Subject to applicable law, users may exercise the following rights:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>Access to the personal information we hold about them.</li>
              <li>Correction of inaccurate or incomplete data.</li>
              <li>Deletion of personal information.</li>
              <li>Data export in a portable format.</li>
              <li>Withdrawal of consent where processing is based on consent.</li>
            </ul>
            <p>
              To exercise these rights, contact us at{" "}
              <a
                href="mailto:privacy@eternai.ai"
                className="text-primary underline underline-offset-4 hover:opacity-80"
              >
                privacy@eternai.ai
              </a>
              .
            </p>
          </Section>

          <Section id="international" title="10. International Data Transfers">
            <p>
              Eterna AI operates globally, and information may be processed and stored in
              jurisdictions other than the user's country of residence. Where required, we rely
              on appropriate safeguards such as standard contractual clauses to protect
              cross-border transfers.
            </p>
          </Section>

          <Section id="cookies" title="11. Cookies and Analytics">
            <p>
              We use cookies, similar technologies, and analytics tools to authenticate sessions,
              remember preferences, measure engagement, and improve the Services. Users may
              control cookies through their browser settings; disabling cookies may limit
              functionality.
            </p>
          </Section>

          <Section id="third-parties" title="12. Third-Party Services">
            <p>The Services rely on trusted third-party providers, including:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>Google (authentication, cloud services, APIs).</li>
              <li>YouTube (public metadata and content retrieval via YouTube API Services).</li>
              <li>Cloud infrastructure providers (hosting, storage, compute).</li>
              <li>Analytics providers (usage metrics and performance monitoring).</li>
              <li>Communication providers (email, notifications, support).</li>
            </ul>
            <p>
              Each third party operates under its own privacy policy, which governs its
              collection and use of information.
            </p>
          </Section>

          <Section id="children" title="13. Children's Privacy">
            <p>
              The Services are not intended for children under the age of 13, and we do not
              knowingly collect personal information from children under 13. If we become aware
              that such data has been collected, we will delete it promptly.
            </p>
          </Section>

          <Section id="changes" title="14. Changes to this Policy">
            <p>
              We may update this Privacy Policy from time to time to reflect changes in our
              practices, technologies, legal requirements, or Services. Material changes will be
              communicated through the platform or by email, and the "Last updated" date at the
              top of this page will be revised accordingly.
            </p>
          </Section>

          <Section id="contact" title="15. Contact Information">
            <p>For questions or requests regarding this Privacy Policy, contact:</p>
            <div className="rounded-lg border border-border/60 bg-card p-5">
              <p className="font-semibold text-foreground">Eterna AI</p>
              <p className="mt-1">
                Email:{" "}
                <a
                  href="mailto:privacy@eternai.ai"
                  className="text-primary underline underline-offset-4 hover:opacity-80"
                >
                  privacy@eternai.ai
                </a>
              </p>
              <p>
                Website:{" "}
                <a
                  href="https://eternai.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-4 hover:opacity-80"
                >
                  https://eternai.ai
                </a>
              </p>
            </div>
          </Section>
        </div>

        <footer className="mt-16 border-t border-border/60 pt-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Eterna AI. All rights reserved.
        </footer>
      </main>
    </div>
  );
}
