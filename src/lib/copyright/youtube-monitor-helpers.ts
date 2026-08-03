/** Pure helpers for YouTube monitoring server functions (no server-only imports). */

export function guessType(key: string): string {
  if (/\.png$/i.test(key)) return "image/png";
  if (/\.webp$/i.test(key)) return "image/webp";
  return "image/jpeg";
}

export function sameDay(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const da = new Date(a), db = new Date(b);
  if (Number.isNaN(+da) || Number.isNaN(+db)) return false;
  return Math.abs(+da - +db) < 36 * 3600 * 1000;
}
