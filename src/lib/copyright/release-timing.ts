export type ReleaseTiming =
  "same_day" | "next_day" | "first_week" | "first_month" | "later" | "unknown";

/** Release timing bucket from the number of days between release and now. */
export function releaseTimingFor(releaseDate: string | null | undefined): {
  timing: ReleaseTiming;
  offsetDays: number | null;
} {
  if (!releaseDate) return { timing: "unknown", offsetDays: null };
  const t = Date.parse(releaseDate);
  if (!Number.isFinite(t)) return { timing: "unknown", offsetDays: null };
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 0) return { timing: "unknown", offsetDays: days };
  if (days === 0) return { timing: "same_day", offsetDays: days };
  if (days === 1) return { timing: "next_day", offsetDays: days };
  if (days <= 7) return { timing: "first_week", offsetDays: days };
  if (days <= 30) return { timing: "first_month", offsetDays: days };
  return { timing: "later", offsetDays: days };
}
