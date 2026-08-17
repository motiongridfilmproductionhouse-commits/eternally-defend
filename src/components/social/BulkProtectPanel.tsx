import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileUp, Layers, Link2, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { protectFromLink } from "@/lib/social/import-from-link.functions";
import { prepareSocialMediaUpload, protectFromUpload } from "@/lib/social/upload-media.functions";
import {
  BATCH_FILTERS,
  BATCH_STATUS_LABEL,
  BATCH_STATUS_TONE,
  canonicalLinkKey,
  classifyUploadFile,
  fileKey,
  matchesBatchFilter,
  parseLinkBatch,
  summarizeBatch,
  type BatchFilter,
  type BatchItemStatus,
} from "@/lib/social/batch";
import { blockedRetrievalMessage } from "@/lib/social/status";

type Mode = "links" | "files";

interface BatchItem {
  id: string;
  label: string;
  sublabel: string | null;
  status: BatchItemStatus;
  detail: string | null;
  /** Present for file items so a failed item can be retried with the same bytes. */
  file?: File;
  /** Present for link items so a failed link can be retried. */
  url?: string;
  assets: number;
}

const PANEL = "rounded-xl border border-border bg-card p-4 space-y-3";

/**
 * Bulk social asset protection.
 *
 * Every item still runs through the existing single-item pipeline one at a time
 * (validate → private storage → provenance → SHA-256 → perceptual hashes or
 * video keyframes → protected_assets → exactly-once Autopilot enrollment), so a
 * batch is never one combined asset and one bad item never rolls back the rest.
 */
export function BulkProtectPanel() {
  const qc = useQueryClient();
  const importLink = useServerFn(protectFromLink);
  const prepareUpload = useServerFn(prepareSocialMediaUpload);
  const finishUpload = useServerFn(protectFromUpload);

  const [mode, setMode] = useState<Mode>("links");
  const [linkText, setLinkText] = useState("");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<BatchFilter>("all");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const totals = useMemo(() => summarizeBatch(items.map((i) => i.status)), [items]);
  const visible = items.filter((i) => matchesBatchFilter(i.status, filter));
  const pending = items.filter((i) => i.status === "ready").length;

  const refreshRegistry = () => {
    qc.invalidateQueries({ queryKey: ["social_protected_assets"] });
    qc.invalidateQueries({ queryKey: ["protected_assets"] });
  };

  const patch = (id: string, next: Partial<BatchItem>) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)));

  const queueLinks = () => {
    const known = items.filter((i) => i.url).map((i) => canonicalLinkKey(i.url!));
    const parsed = parseLinkBatch(linkText, known);
    if (!parsed.length) {
      toast.error("Paste at least one post or reel link, one per line.");
      return;
    }
    setItems((prev) => [
      ...prev,
      ...parsed.map((entry, index) => ({
        id: `link-${Date.now()}-${index}`,
        label: entry.url,
        sublabel: null,
        status: entry.status as BatchItemStatus,
        detail: entry.detail,
        url: entry.url,
        assets: 0,
      })),
    ]);
    setLinkText("");
  };

  const queueFiles = (files: File[]) => {
    if (!files.length) return;
    const known = new Set(items.filter((i) => i.file).map((i) => fileKey(i.file!)));
    const next: BatchItem[] = [];
    files.forEach((file, index) => {
      const key = fileKey(file);
      const check = classifyUploadFile(file);
      const duplicate = known.has(key);
      known.add(key);
      next.push({
        id: `file-${Date.now()}-${index}-${file.name}`,
        label: file.name,
        sublabel: `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type || "unknown"}`,
        status: duplicate ? "duplicate" : check.status,
        detail: duplicate ? "Same file already in this batch." : check.detail,
        file,
        assets: 0,
      });
    });
    setItems((prev) => [...prev, ...next]);
  };

  async function runLinkItem(item: BatchItem) {
    const result = await importLink({ data: { url: item.url! } });
    if (result.status === "manual_upload_required") {
      patch(item.id, {
        status: "upload_required",
        detail: blockedRetrievalMessage(result.platform),
      });
      return;
    }
    const created = result.results.filter((r) => r.status === "created").length;
    const duplicates = result.results.filter((r) => r.status === "duplicate").length;
    if (!created && duplicates) {
      patch(item.id, { status: "duplicate", detail: "Already protected.", assets: 0 });
      return;
    }
    patch(item.id, {
      status: created ? "protected" : "failed",
      detail: created
        ? `${created} asset${created === 1 ? "" : "s"} protected${duplicates ? ` · ${duplicates} already protected` : ""}`
        : "No media could be retrieved from that link.",
      assets: created,
    });
  }

  async function runFileItem(item: BatchItem) {
    const file = item.file!;
    const prepared = await prepareUpload({
      data: { fileName: file.name, contentType: file.type as never, size: file.size },
    });
    const put = await fetch(prepared.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!put.ok) {
      const detail = await put.text().catch(() => "");
      throw new Error(`Upload failed (${put.status}). ${detail.slice(0, 140)}`.trim());
    }
    const result = await finishUpload({
      data: { key: prepared.key, name: file.name, contentType: file.type as never },
    });
    if (result.result.status === "duplicate") {
      patch(item.id, { status: "duplicate", detail: "Already protected." });
      return;
    }
    patch(item.id, {
      status: "protected",
      detail: result.result.enrolled
        ? "Protected and enrolled in continuous scanning."
        : "Protected and fingerprinted. Scanning activates with your authorization.",
      assets: 1,
    });
  }

  /** Sequential so each item keeps the exact same pipeline and partial success. */
  const runBatch = async (only?: BatchItem[]) => {
    const queue = only ?? items.filter((i) => i.status === "ready");
    if (!queue.length) return;
    setRunning(true);
    let ok = 0;
    let bad = 0;
    for (const item of queue) {
      patch(item.id, { status: "processing", detail: null });
      try {
        if (item.url) await runLinkItem(item);
        else await runFileItem(item);
        ok += 1;
      } catch (error) {
        bad += 1;
        patch(item.id, {
          status: "failed",
          detail: error instanceof Error ? error.message : "Unexpected failure.",
        });
      }
      refreshRegistry();
    }
    setRunning(false);
    refreshRegistry();
    toast[bad && !ok ? "error" : "success"](
      `Batch finished — ${ok} processed, ${bad} failed. Successful items are kept.`,
    );
  };

  const retryFailed = () => {
    const failed = items.filter((i) => i.status === "failed" || i.status === "upload_required");
    if (!failed.length) return;
    void runBatch(failed);
  };

  return (
    <div className={PANEL}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
          <Layers className="size-4 text-primary" /> Protect multiple items
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {(["links", "files"] as Mode[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-md px-3 py-1 text-[11px] font-medium uppercase tracking-wide transition ${
                mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {value === "links" ? "Multiple links" : "Multiple uploads"}
            </button>
          ))}
        </div>
      </div>

      {mode === "links" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Paste one public post or reel link per line. Each link is validated and protected on its
            own — an unsupported link never stops the others.
          </p>
          <Textarea
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            rows={4}
            placeholder={"https://instagram.com/p/...\nhttps://instagram.com/reel/...\nhttps://youtube.com/watch?v=..."}
            className="text-xs"
          />
          <Button variant="outline" onClick={queueLinks} disabled={!linkText.trim()}>
            <Link2 className="mr-2 size-4" /> Add links to batch
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Select or drop several files at once. JPG, PNG, WEBP, GIF, MP4, MOV up to 15 MB each.
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              queueFiles(Array.from(e.dataTransfer.files ?? []));
            }}
            className={`grid place-items-center gap-2 rounded-lg border border-dashed p-6 text-center transition ${
              dragging ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <FileUp className="size-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Drag files here, or</p>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
              className="hidden"
              onChange={(e) => {
                queueFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <Upload className="mr-2 size-4" /> Select files
            </Button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="text-[10px] uppercase">
              {totals.selected} selected
            </Badge>
            <span>{totals.protected} protected</span>
            <span>{totals.duplicates} duplicates</span>
            <span>{totals.uploadRequired} upload required</span>
            <span>{totals.failed + totals.unsupported} failed</span>
            {running && <Loader2 className="size-3.5 animate-spin text-primary" />}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void runBatch()} disabled={running || !pending}>
              {running && <Loader2 className="mr-2 size-4 animate-spin" />}
              Protect {pending} item{pending === 1 ? "" : "s"}
            </Button>
            <Button
              variant="outline"
              onClick={retryFailed}
              disabled={running || !(totals.failed + totals.uploadRequired)}
            >
              <RefreshCw className="mr-2 size-4" /> Retry failed
            </Button>
            <Button variant="ghost" onClick={() => setItems([])} disabled={running}>
              <X className="mr-2 size-4" /> Clear
            </Button>
          </div>

          <div className="flex flex-wrap gap-1">
            {BATCH_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wide transition ${
                  filter === value
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="text-xs text-muted-foreground">No items in this view.</p>
            ) : (
              visible.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{item.label}</div>
                    {item.sublabel && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {item.sublabel}
                      </div>
                    )}
                    {item.detail && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</div>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] uppercase ${BATCH_STATUS_TONE[item.status]}`}
                  >
                    {item.status === "processing" && (
                      <Loader2 className="mr-1 size-3 animate-spin" />
                    )}
                    {BATCH_STATUS_LABEL[item.status]}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
