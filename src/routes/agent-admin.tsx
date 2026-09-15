import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  agentAdminData,
  updateAgentAdmin,
  createAgentAccount,
} from "@/lib/agent/assessment.functions";
import type { PricingPolicy } from "@/lib/agent/policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export const Route = createFileRoute("/agent-admin")({ ssr: false, component: AgentAdmin });
const fields = [
  ["base_annual", "Base annual cost (INR)"],
  ["annual_per_domain", "Annual cost per observed domain (INR)"],
  ["review_minutes_per_page_month", "Monthly review minutes per observed page"],
  ["hourly_review_rate", "Review cost per hour (INR)"],
  ["range_margin", "Range margin (0–0.5)"],
  ["minimum_pages", "Minimum matched pages (at least 3)"],
  ["minimum_domains", "Minimum observed domains (at least 2)"],
] as const;
function AgentAdmin() {
  const get = useServerFn(agentAdminData);
  const createAgent = useServerFn(createAgentAccount);
  const [agentEmail, setAgentEmail] = useState("");
  const [agentPassword, setAgentPassword] = useState("");
  const update = useServerFn(updateAgentAdmin);
  const q = useQuery({ queryKey: ["agent-admin"], queryFn: () => get(), retry: false });
  const [policy, setPolicy] = useState<PricingPolicy | null>(null);
  const [user, setUser] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(
    data:
      | { kind: "member"; user_id: string; active: boolean }
      | { kind: "pricing"; policy: Omit<PricingPolicy, "version"> },
  ) {
    setBusy(true);
    setNotice("");
    try {
      await update({ data });
      await q.refetch();
      setPolicy(null);
      setNotice("Configuration saved. New assessments use the updated policy.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  const p = policy ?? (q.data?.policy as PricingPolicy | undefined);
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <a href="/agent-assessment" className="text-sm text-blue-600">
          ← Agent assessment
        </a>
        <h1 className="my-8 text-3xl font-semibold">Agent settings</h1>
        {q.error ? (
          <p role="alert">
            Administrator access is required. <a href="/auth?agent=1">Sign in</a>
          </p>
        ) : !q.data || !p ? (
          <p>Loading settings…</p>
        ) : (
          <>
            <section className="mb-8 rounded-[28px] border border-slate-200 bg-white p-7">
              <h2 className="mb-4 text-xl font-medium">Create agent account</h2>
              <p className="mb-5 text-sm text-slate-500">
                Set an email username and password. Agents sign in directly without an invitation
                code.
              </p>
              <form
                className="mb-8 space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setNotice("");
                  try {
                    const result = await createAgent({
                      data: { email: agentEmail, password: agentPassword },
                    });
                    setAgentPassword("");
                    setNotice(
                      result.enabled
                        ? "Agent account created. Sign in using the email and password."
                        : `Account created, but agent access could not be enabled. Enable this user ID below: ${result.id}`,
                    );
                    await q.refetch();
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : "Could not create agent.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Input
                  type="email"
                  autoComplete="off"
                  aria-label="Agent username (email)"
                  placeholder="Agent username (email)"
                  required
                  maxLength={254}
                  value={agentEmail}
                  onChange={(e) => setAgentEmail(e.target.value)}
                />
                <Input
                  type="password"
                  autoComplete="new-password"
                  aria-label="Agent password"
                  placeholder="Agent password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={agentPassword}
                  onChange={(e) => setAgentPassword(e.target.value)}
                />
                <Button disabled={busy}>Create agent</Button>
              </form>
              <h2 className="mb-4 text-xl font-medium">Existing account access</h2>
              <p className="mb-5 text-sm text-slate-500">
                Enable an existing Eterna account using its user ID. This does not change its login
                or create an account.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({ kind: "member", user_id: user, active: true });
                }}
                className="flex flex-wrap gap-3"
              >
                <Input
                  aria-label="Existing user ID"
                  required
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="User UUID"
                  className="min-w-48 flex-1"
                />
                <Button disabled={busy}>Enable agent</Button>
              </form>
              <div className="mt-6 space-y-4">
                {q.data.members.map((m) => (
                  <div
                    key={m.user_id}
                    className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"
                  >
                    <span className="break-all text-xs">
                      {m.user_id} · {m.active ? "Active" : "Disabled"}
                    </span>
                    <Button
                      disabled={busy}
                      variant="outline"
                      onClick={() =>
                        save({ kind: "member", user_id: m.user_id, active: !m.active })
                      }
                    >
                      {m.active ? "Disable" : "Enable"}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const { version, ...values } = p;
                void save({
                  kind: "pricing",
                  policy: Object.fromEntries(
                    Object.entries(values).filter(([key]) => key !== "id"),
                  ) as Omit<PricingPolicy, "version">,
                });
              }}
              className="rounded-[28px] border border-slate-200 bg-white p-7"
            >
              <h2 className="mb-3 text-xl font-medium">
                Protection pricing · version {q.data.policy.version}
              </h2>
              <p className="mb-6 text-sm leading-6 text-slate-500">
                Enter approved Eterna rates. Estimates cover observed-domain monitoring and review
                workload only. Missing identity or insufficient evidence always requires review,
                even when pricing is enabled.
              </p>
              <div className="grid gap-5 sm:grid-cols-2">
                {fields.map(([key, label]) => (
                  <label key={key} className="text-sm">
                    {label}
                    <Input
                      required
                      type="number"
                      min={key === "minimum_pages" ? 3 : key === "minimum_domains" ? 2 : 0}
                      step={key.startsWith("minimum_") ? 1 : "any"}
                      value={p[key]}
                      onChange={(e) => setPolicy({ ...p, [key]: Number(e.target.value) })}
                      className="mt-2 h-12"
                    />
                  </label>
                ))}
              </div>
              <label className="my-6 flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => setPolicy({ ...p, enabled: e.target.checked })}
                />{" "}
                Enable automatic protection estimates
              </label>
              <Button disabled={busy}>Save pricing policy</Button>
            </form>
          </>
        )}
        {notice && (
          <p role="status" className="mt-5 rounded-2xl bg-blue-50 p-5 text-sm">
            {notice}
          </p>
        )}
      </div>
    </main>
  );
}
