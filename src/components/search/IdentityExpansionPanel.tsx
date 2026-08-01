import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  previewSearchExpansion,
  updateSearchIdentityAlias,
} from "@/lib/search.functions";

type PreviewResult = {
  searchingAs: string;
  alsoSearching: string[];
  ambiguous: boolean;
  ambiguityCandidates: Array<{ name: string; reason: string; confidence: number }>;
  searchQueries: Array<{ query: string; category: string; priority: number }>;
  profileId: string | null;
};

export function IdentityExpansionPanel(props: {
  query: string;
  aliases?: string[];
  handles?: string[];
  module?:
    | "general"
    | "reputation"
    | "deepfake"
    | "impersonation"
    | "copyright"
    | "social"
    | "monitoring";
  entityType?: string;
  className?: string;
  /** When true, persist profile rows during preview. Default false (persist on scan). */
  persistPreview?: boolean;
  onExpansion?: (result: PreviewResult) => void;
}) {
  const [aliasDraft, setAliasDraft] = useState("");
  const [localAlso, setLocalAlso] = useState<string[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const q = props.query.trim();
  const aliasesKey = JSON.stringify(props.aliases ?? []);
  const handlesKey = JSON.stringify(props.handles ?? []);

  const preview = useMutation({
    mutationFn: async (seq: number) => {
      const res = (await previewSearchExpansion({
        data: {
          query: q,
          module: props.module ?? "general",
          entityType: props.entityType,
          knownAliases: props.aliases ?? [],
          knownHandles: props.handles ?? [],
          persist: props.persistPreview === true,
        },
      })) as PreviewResult;
      return { seq, res };
    },
    onSuccess: ({ seq, res }) => {
      // Ignore stale responses from earlier keystrokes.
      if (seq !== requestSeq.current) return;
      setLocalAlso(res.alsoSearching);
      // Non-persist previews return profileId=null — keep any already-known id.
      if (res.profileId) setProfileId(res.profileId);
      setPreviewData(res);
      props.onExpansion?.(res);
    },
  });

  const aliasMut = useMutation({
    mutationFn: async (input: {
      action:
        | "add_alias"
        | "remove_alias"
        | "approve_alias"
        | "reject_alias"
        | "mark_handle"
        | "confirm_identity"
        | "report_wrong_identity";
      value: string;
    }) => {
      const startedForQuery = q;
      const seqAtStart = requestSeq.current;
      let activeProfileId = profileId;
      // Persist only when the user takes an explicit identity action.
      if (!activeProfileId) {
        const persisted = (await previewSearchExpansion({
          data: {
            query: startedForQuery,
            module: props.module ?? "general",
            entityType: props.entityType,
            knownAliases: props.aliases ?? [],
            knownHandles: props.handles ?? [],
            persist: true,
          },
        })) as PreviewResult;
        activeProfileId = persisted.profileId;
        if (startedForQuery === props.query.trim() && seqAtStart === requestSeq.current) {
          setProfileId(persisted.profileId);
          setPreviewData(persisted);
          setLocalAlso(persisted.alsoSearching);
        }
      }
      // Drop stale mutations if the user changed the query mid-flight.
      if (startedForQuery !== props.query.trim() || seqAtStart !== requestSeq.current) {
        return { ok: false as const, stale: true as const };
      }
      if (!activeProfileId) throw new Error("Could not persist identity profile.");
      const updated = (await updateSearchIdentityAlias({
        data: {
          profileId: activeProfileId,
          action: input.action,
          value: input.value,
          canonicalName:
            input.action === "confirm_identity" ? input.value : undefined,
        },
      })) as { ok: boolean; profileId?: string };
      if (updated.profileId) {
        activeProfileId = updated.profileId;
        setProfileId(updated.profileId);
      }
      return { ok: true as const, stale: false as const, profileId: activeProfileId };
    },
    onSuccess: (result) => {
      if (result?.stale) return;
      if (result?.profileId) setProfileId(result.profileId);
      const seq = ++requestSeq.current;
      preview.mutate(seq);
    },
  });

  // Reset stale panel state whenever the target identity input changes.
  useEffect(() => {
    setLocalAlso([]);
    setPreviewData(null);
    setProfileId(null);
    setAliasDraft("");
    setSelectedCandidate(null);
  }, [q, aliasesKey, handlesKey, props.module]);

  useEffect(() => {
    if (q.length < 2) return;
    const seq = ++requestSeq.current;
    const t = setTimeout(() => preview.mutate(seq), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, aliasesKey, handlesKey, props.module]);

  const searchingAs =
    previewData?.searchingAs ||
    (previewData?.ambiguous ? q : previewData?.searchingAs) ||
    q;
  const also = useMemo(() => {
    const base = previewData?.alsoSearching ?? localAlso;
    return base.filter(
      (x: string) => x.trim() && x.trim().toLowerCase() !== searchingAs.toLowerCase(),
    );
  }, [localAlso, previewData?.alsoSearching, searchingAs]);

  if (!q) return null;

  return (
    <div className={`rounded-lg border border-border/60 bg-card/40 p-3 space-y-2 ${props.className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Identity expansion</div>
        {preview.isPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="text-sm">
        <span className="text-muted-foreground">Searching as:</span>{" "}
        <span className="font-medium">
          {previewData?.ambiguous
            ? `${q} (unconfirmed — multiple candidates)`
            : searchingAs || "—"}
        </span>
      </div>

      {also.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">Also searching:</div>
          <div className="flex flex-wrap gap-1.5">
            {also.slice(0, 10).map((term) => {
              const isShowBadge = / \(show\)$/i.test(term);
              return (
              <Badge key={term} variant="outline" className="gap-1 font-normal">
                {term}
                {profileId && !isShowBadge && (
                  <button
                    type="button"
                    className="ml-0.5 opacity-60 hover:opacity-100"
                    title="Remove incorrect alias"
                    onClick={() =>
                      aliasMut.mutate({
                        action: "remove_alias",
                        value: term,
                      })
                    }
                  >
                    <X className="size-3" />
                  </button>
                )}
              </Badge>
              );
            })}
          </div>
        </div>
      )}

      {previewData?.ambiguous && (
        <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <div>
              Multiple possible identities were found. Results will remain unverified until the identity is confirmed.
              Select one candidate below before confirming.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(previewData.ambiguityCandidates ?? []).slice(0, 3).map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={`rounded-md border px-2 py-1 text-[11px] ${
                    selectedCandidate === c.name
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border/60 bg-background/40"
                  }`}
                  onClick={() => setSelectedCandidate(c.name)}
                >
                  {c.name} — {Math.round(c.confidence * 100)}%
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <div className="flex min-w-[180px] flex-1 gap-1">
          <Input
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value)}
            placeholder="Add alias"
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={!aliasDraft.trim() || aliasMut.isPending}
            onClick={() => {
              aliasMut.mutate({ action: "add_alias", value: aliasDraft.trim() });
              setAliasDraft("");
            }}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 text-xs"
          disabled={
            aliasMut.isPending ||
            q.length < 2 ||
            (Boolean(previewData?.ambiguous) && !selectedCandidate)
          }
          onClick={() =>
            aliasMut.mutate({
              action: "confirm_identity",
              value:
                selectedCandidate ||
                previewData?.searchingAs ||
                searchingAs ||
                q,
            })
          }
        >
          <Check className="size-3.5 mr-1" />
          Confirm identity
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 text-xs"
          disabled={aliasMut.isPending || q.length < 2}
          onClick={() =>
            aliasMut.mutate({
              action: "report_wrong_identity",
              value: previewData?.searchingAs || searchingAs || q,
            })
          }
        >
          Report wrong identity
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Aliases are investigation aids only. Content stays a lead until analysis and human review.
        Preview does not persist profiles unless explicitly enabled; scans persist expansion diagnostics.
      </p>
    </div>
  );
}
