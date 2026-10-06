import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Link2, X } from "lucide-react";

export const PASTEL_STYLE = {
  backgroundImage: [
    "radial-gradient(60% 50% at 18% 22%, rgba(191,219,254,0.85) 0%, rgba(191,219,254,0) 70%)",
    "radial-gradient(55% 45% at 82% 18%, rgba(221,214,254,0.9) 0%, rgba(221,214,254,0) 70%)",
    "radial-gradient(65% 55% at 78% 82%, rgba(254,215,195,0.8) 0%, rgba(254,215,195,0) 70%)",
    "radial-gradient(55% 45% at 15% 85%, rgba(187,247,208,0.75) 0%, rgba(187,247,208,0) 70%)",
    "linear-gradient(180deg, #fbfcff 0%, #f5f7fd 100%)",
  ].join(", "),
} as const;

/**
 * Pastel "portal" popup shown when a visitor clicks Remove Content /
 * Remove a Link. Paste a link here and the existing /remove-content
 * analysis flow starts immediately — the workflow itself is unchanged.
 */
export function RemovalPortalModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    try {
      const parsed = new URL(u);
      if (!parsed.hostname.includes(".")) throw new Error();
    } catch {
      setErr("Enter a valid link, for example https://example.com/post");
      return;
    }
    onOpenChange(false);
    void navigate({ to: "/remove-content", search: { url: u } });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={PASTEL_STYLE}
          className="fixed inset-0 z-50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[2rem] border border-white/70 bg-white/70 p-6 shadow-[0_40px_90px_-25px_rgba(70,90,180,0.35)] backdrop-blur-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 sm:p-10"
          style={PASTEL_STYLE}
        >
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Close"
              className="absolute right-4 top-4 grid size-9 place-items-center rounded-full border border-white/70 bg-white/70 text-zinc-500 shadow-sm transition-colors hover:text-zinc-950"
            >
              <X className="size-4" />
            </button>
          </Dialog.Close>

          <div className="mx-auto flex w-fit items-center rounded-full border border-white/80 bg-white/60 p-1 text-xs font-medium shadow-sm">
            <span className="rounded-full bg-white px-4 py-1.5 text-zinc-950 shadow-sm">
              Remove a link
            </span>
            <Link
              to="/track-case"
              onClick={() => onOpenChange(false)}
              className="rounded-full px-4 py-1.5 text-zinc-500 transition-colors hover:text-zinc-950"
            >
              Track a case
            </Link>
          </div>

          <Dialog.Title asChild>
            <h2 className="mt-7 text-balance text-3xl font-semibold leading-tight tracking-tight text-zinc-950 sm:text-4xl">
              Remove Harmful Content From the Internet
            </h2>
          </Dialog.Title>
          <Dialog.Description asChild>
            <p className="mt-3 text-pretty text-sm leading-6 text-zinc-500 sm:text-base">
              Paste the exact link below. Eterna AI will analyze the page, identify the platform,
              and determine the appropriate removal pathway.
            </p>
          </Dialog.Description>

          <form onSubmit={submit} className="mt-7">
            <div className="flex flex-col gap-2 rounded-3xl border border-white/80 bg-white/80 p-2 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.15)] transition focus-within:border-zinc-300 focus-within:ring-4 focus-within:ring-zinc-950/5 sm:flex-row sm:items-center sm:rounded-full">
              <Link2 className="ml-4 hidden size-5 shrink-0 text-blue-600 sm:block" aria-hidden="true" />
              <label htmlFor="removal-portal-url" className="sr-only">
                Paste the link you want removed
              </label>
              <input
                id="removal-portal-url"
                type="text"
                inputMode="url"
                autoComplete="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setErr("");
                }}
                placeholder="Paste the link you want removed"
                className="h-12 min-w-0 flex-1 bg-transparent px-4 text-base text-zinc-900 outline-none placeholder:text-zinc-400"
              />
              <button
                type="submit"
                className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-zinc-950 px-6 text-sm font-semibold text-white transition-all hover:bg-zinc-800 active:scale-95"
              >
                Analyze Link <ArrowRight className="size-4" />
              </button>
            </div>
            {err && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {err}
              </p>
            )}
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-zinc-500">
            {["Pay per link", "No subscription required", "Track every request"].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="size-1 rounded-full bg-zinc-300" />
                {t}
              </span>
            ))}
          </div>

          <p className="mt-5 text-center text-sm">
            <Link
              to="/track-case"
              onClick={() => onOpenChange(false)}
              className="text-zinc-500 underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-zinc-950"
            >
              Already submitted? Track your case
            </Link>
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
