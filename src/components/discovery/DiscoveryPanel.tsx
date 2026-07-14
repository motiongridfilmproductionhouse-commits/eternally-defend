import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageCard } from "@/components/dashboard/PageCard";
import { AccountCard } from "./AccountCard";
import { VerificationDialog } from "./VerificationDialog";
import {
  createSubject, discoverAccounts, decideAccount, addManualAccount,
  listSubjects, listAccounts, deleteSubject,
} from "@/lib/discovery.functions";
import type { Database } from "@/integrations/supabase/types";
import { Loader2, Search, Sparkles, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

type Subject = Database["public"]["Tables"]["discovery_subjects"]["Row"];
type Account = Database["public"]["Tables"]["discovered_accounts"]["Row"];

export function DiscoveryPanel() {
  const qc = useQueryClient();
  const listSubjectsFn = useServerFn(listSubjects);
  const listAccountsFn = useServerFn(listAccounts);
  const createSubjectFn = useServerFn(createSubject);
  const discoverFn = useServerFn(discoverAccounts);
  const decideFn = useServerFn(decideAccount);
  const addManualFn = useServerFn(addManualAccount);
  const deleteSubjectFn = useServerFn(deleteSubject);

  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);
  const [verifyAccount, setVerifyAccount] = useState<Account | null>(null);
  const [form, setForm] = useState({
    subject_kind: "brand" as Subject["subject_kind"],
    query: "",
    website_domain: "",
    country: "",
    org: "",
  });
  const [manualUrl, setManualUrl] = useState("");

  const subjectsQuery = useQuery({ queryKey: ["discovery-subjects"], queryFn: () => listSubjectsFn() });

  const accountsQuery = useQuery({
    queryKey: ["discovery-accounts", activeSubjectId],
    enabled: !!activeSubjectId,
    queryFn: () => listAccountsFn({ data: { subjectId: activeSubjectId! } }),
  });

  const createMut = useMutation({
    mutationFn: () => createSubjectFn({ data: {
      subject_kind: form.subject_kind,
      query: form.query.trim(),
      website_domain: form.website_domain.trim() || null,
      country: form.country.trim() || null,
      org: form.org.trim() || null,
    } }),
    onSuccess: async (s) => {
      qc.invalidateQueries({ queryKey: ["discovery-subjects"] });
      setActiveSubjectId(s.id);
      // kick off discovery right away
      discoverMut.mutate(s.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const discoverMut = useMutation({
    mutationFn: (subjectId: string) => discoverFn({ data: { subjectId } }),
    onSuccess: (res) => {
      toast.success(`Discovered ${res.accounts.length} candidate account(s)`);
      qc.invalidateQueries({ queryKey: ["discovery-accounts", res.subject.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decideMut = useMutation({
    mutationFn: (v: { accountId: string; decision: "confirmed" | "not_mine" | "unsure" }) =>
      decideFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["discovery-accounts", activeSubjectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const manualMut = useMutation({
    mutationFn: () => addManualFn({ data: { subjectId: activeSubjectId!, profile_url: manualUrl.trim() } }),
    onSuccess: () => {
      setManualUrl("");
      toast.success("Account added");
      qc.invalidateQueries({ queryKey: ["discovery-accounts", activeSubjectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (subjectId: string) => deleteSubjectFn({ data: { subjectId } }),
    onSuccess: () => {
      if (activeSubjectId) setActiveSubjectId(null);
      qc.invalidateQueries({ queryKey: ["discovery-subjects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const subjects = subjectsQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];
  const activeSubject = subjects.find((s) => s.id === activeSubjectId) ?? null;

  return (
    <>
    <PageCard
      title="ACCOUNT DISCOVERY"
      sub="Find likely-official accounts across platforms, confirm ownership, then upgrade to verified for enforcement."
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left column: subject form + list */}
        <div className="md:col-span-1 space-y-4">
          <div className="rounded-xl border border-border p-4 space-y-2 bg-card">
            <div className="text-xs font-semibold uppercase text-muted-foreground">New subject</div>
            <label className="block text-xs font-semibold">Kind
              <select
                value={form.subject_kind}
                onChange={(e) => setForm({ ...form, subject_kind: e.target.value as Subject["subject_kind"] })}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm bg-card"
              >
                {(["person", "brand", "company", "domain", "handle", "website"] as const).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold">Name / handle / domain
              <input value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} placeholder="e.g. Acme Corp" className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" />
            </label>
            <label className="block text-xs font-semibold">Official website (optional)
              <input value={form.website_domain} onChange={(e) => setForm({ ...form, website_domain: e.target.value })} placeholder="acme.com" className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-semibold">Country
                <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" />
              </label>
              <label className="block text-xs font-semibold">Organisation
                <input value={form.org} onChange={(e) => setForm({ ...form, org: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-border text-sm" />
              </label>
            </div>
            <button
              onClick={() => createMut.mutate()}
              disabled={!form.query.trim() || createMut.isPending || discoverMut.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-60"
              style={{ background: "var(--gradient-brand)" }}
            >
              {(createMut.isPending || discoverMut.isPending) ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Search accounts
            </button>
          </div>

          <div className="rounded-xl border border-border p-3 bg-card">
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 px-1">Subjects</div>
            {subjectsQuery.isLoading ? (
              <div className="py-6 text-center text-xs text-muted-foreground"><Loader2 className="size-4 inline animate-spin" /></div>
            ) : subjects.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">None yet — search to add your first.</div>
            ) : (
              <div className="space-y-1">
                {subjects.map((s) => (
                  <div key={s.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${activeSubjectId === s.id ? "bg-accent" : "hover:bg-accent/50"}`}>
                    <button className="flex-1 text-left truncate" onClick={() => setActiveSubjectId(s.id)}>
                      <div className="font-medium truncate">{s.query}</div>
                      <div className="text-[10px] text-muted-foreground">{s.subject_kind}{s.website_domain ? ` · ${s.website_domain}` : ""}</div>
                    </button>
                    <button
                      className="p-1 text-muted-foreground hover:text-destructive"
                      onClick={() => { if (confirm(`Remove subject "${s.query}"? This deletes all discovered accounts for it.`)) deleteMut.mutate(s.id); }}
                      title="Delete subject"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column: results */}
        <div className="md:col-span-2 space-y-3">
          {!activeSubject ? (
            <div className="h-full min-h-[240px] rounded-xl border border-dashed border-border grid place-items-center text-sm text-muted-foreground">
              <div className="text-center">
                <Search className="size-6 mx-auto mb-1" />
                Select or create a subject to see candidate accounts.
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-sm font-semibold">Candidates for “{activeSubject.query}”</div>
                <button
                  onClick={() => discoverMut.mutate(activeSubject.id)}
                  disabled={discoverMut.isPending}
                  className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent disabled:opacity-60"
                >
                  {discoverMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  Re-run discovery
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="Add account manually — paste profile URL"
                  className="flex-1 px-3 py-2 rounded-lg border border-border text-sm"
                />
                <button
                  disabled={!manualUrl.trim() || manualMut.isPending}
                  onClick={() => manualMut.mutate()}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-60"
                >
                  <Plus className="size-3.5" /> Add
                </button>
              </div>

              {accountsQuery.isLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin inline" /></div>
              ) : accounts.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No candidates yet. {discoverMut.isPending ? "Discovering…" : "Try re-running discovery."}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {accounts.map((a) => (
                    <AccountCard
                      key={a.id}
                      account={a}
                      busy={decideMut.isPending}
                      onDecide={(decision) => decideMut.mutate({ accountId: a.id, decision })}
                      onVerify={() => setVerifyAccount(a)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageCard>

    <VerificationDialog
      account={verifyAccount}
      open={!!verifyAccount}
      onOpenChange={(o) => !o && setVerifyAccount(null)}
      onAccountUpdated={() => qc.invalidateQueries({ queryKey: ["discovery-accounts", activeSubjectId] })}
    />
    </>
  );
}
