import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BrainCircuit, Scale, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/public/PublicSite";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [
    { title: "About Eterna Sentinel — Digital Protection" },
    { name: "description", content: "Meet Eterna Sentinel, a managed digital identity, reputation and content protection operation built around evidence and human judgment." },
    { property: "og:title", content: "About Eterna Sentinel" },
    { property: "og:description", content: "How Eterna combines technology, evidence and human review to protect visible identities and organizations." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ]}), component: AboutPage,
});

function AboutPage() {
  const principles = [
    { icon: ShieldCheck, title: "Built for visible identities", body: "Eterna was created for people and organizations whose names, faces, voices and work carry public exposure." },
    { icon: BrainCircuit, title: "Technology assists", body: "Discovery and analysis tools help teams find patterns across large public surfaces without treating every signal as a threat." },
    { icon: Scale, title: "People decide", body: "Context, authorization, eligibility and evidence remain central. Consequential actions require human review." },
    { icon: Users, title: "One operating team", body: "Monitoring, investigation, evidence and case coordination are brought into one governed workflow." },
  ];
  return <PublicPage eyebrow="Company" title="Protection built for the realities of public identity." intro="Eterna Sentinel is a managed digital protection operation and technology platform for public figures, executives, organizations and their authorized representatives.">
    <section className="py-20 md:py-28"><div className="mx-auto max-w-6xl px-6"><div className="grid gap-px overflow-hidden border border-landing-line bg-landing-line md:grid-cols-2">{principles.map(({ icon: Icon, title, body }) => <article key={title} className="bg-landing p-8 md:p-10"><Icon className="size-5 text-landing-accent"/><h2 className="mt-12 text-2xl font-semibold">{title}</h2><p className="mt-4 max-w-md text-sm leading-6 text-landing-muted">{body}</p></article>)}</div></div></section>
    <section className="bg-landing-soft py-20 md:py-28"><div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2"><div><p className="landing-kicker">Why Eterna exists</p><h2 className="mt-4 text-4xl font-medium">Digital exposure moves faster than disconnected response.</h2></div><div className="space-y-5 text-sm leading-7 text-landing-muted"><p>Impersonation, synthetic media, unauthorized content and reputation threats often arrive across different platforms at the same time. Eterna brings discovery, assessment and evidence into a single operating view.</p><p>The aim is not indiscriminate removal. It is to help authorized clients understand what happened, preserve what matters and choose an appropriate, supportable response.</p></div></div></section>
    <section id="leadership" className="py-20 md:py-28"><div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2"><div><p className="landing-kicker">Leadership</p><h2 className="mt-4 text-3xl font-medium">Accountable by design.</h2><p className="mt-5 max-w-md text-sm leading-6 text-landing-muted">Leadership and corporate information are shared directly during qualified company and partnership enquiries.</p></div><div id="careers" className="border-l border-landing-line pl-0 md:pl-12"><p className="landing-kicker">Careers</p><h2 className="mt-4 text-3xl font-medium">Work on protection with judgment.</h2><p className="mt-5 max-w-md text-sm leading-6 text-landing-muted">Eterna welcomes enquiries from people experienced in trust and safety, investigations, security operations and responsible technology.</p><Button asChild variant="link" className="mt-5 h-auto p-0 text-landing-ink"><Link to="/waitinglist" search={{ source: "company-enquiry" }}>Contact Eterna <ArrowRight/></Link></Button></div></div></section>
  </PublicPage>;
}