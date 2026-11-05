/** Temporary owner-requested notice; never changes enforcement records. */
export function shouldShowRafmohNotice(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === "sijoj4464@gmail.com";
}