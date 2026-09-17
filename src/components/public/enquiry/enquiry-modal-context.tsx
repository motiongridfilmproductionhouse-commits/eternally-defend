import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import type { EnquiryPrefill } from "@/lib/enquiry/enquiry.schema";
import { EternaInquiryModal } from "./EternaInquiryModal";

interface EnquiryModalContextValue {
  /** Open the shared enquiry modal, optionally preselecting department/service/profile. */
  openEnquiryModal: (prefill?: EnquiryPrefill) => void;
}

const EnquiryModalContext = createContext<EnquiryModalContextValue | null>(null);

export function useEnquiryModal(): EnquiryModalContextValue {
  const ctx = useContext(EnquiryModalContext);
  if (!ctx) {
    throw new Error("useEnquiryModal must be used within an EnquiryModalProvider");
  }
  return ctx;
}

/**
 * Mounts the one shared EternaInquiryModal for a page and exposes
 * `openEnquiryModal(prefill)` to every descendant via context, so every
 * "Request Protection" / "Contact" / enquiry CTA on the page can open the
 * same modal instance instead of navigating away. Mounted once in
 * PublicSite.tsx's `PublicPage` (covers every inner marketing page) and
 * once in the homepage's own layout (the one page that doesn't use
 * `PublicPage`).
 */
export function EnquiryModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState<EnquiryPrefill>({});
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const restoreScrollRef = useRef<number | null>(null);

  const openEnquiryModal = useCallback((next: EnquiryPrefill = {}) => {
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
    }
    if (typeof window !== "undefined") {
      restoreScrollRef.current = window.scrollY;
    }
    setPrefill(next);
    setIsOpen(true);
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setIsOpen(next);
    if (!next) {
      // Close returns focus to the CTA that opened the modal, and the page
      // never navigated, so scroll position is already preserved — this
      // just guards against the focus-restore causing any scroll jump.
      const scrollY = restoreScrollRef.current;
      const target = restoreFocusRef.current;
      window.requestAnimationFrame(() => {
        target?.focus({ preventScroll: true });
        if (scrollY !== null) window.scrollTo({ top: scrollY });
      });
    }
  }, []);

  const value = useMemo(() => ({ openEnquiryModal }), [openEnquiryModal]);

  return (
    <EnquiryModalContext.Provider value={value}>
      {children}
      <EternaInquiryModal open={isOpen} onOpenChange={handleOpenChange} prefill={prefill} />
    </EnquiryModalContext.Provider>
  );
}

/**
 * Convenience CTA that opens the shared modal on click. Safe to reference
 * from anywhere inside a page that renders `PublicPage` (or the homepage's
 * own `EnquiryModalProvider`) even when the CTA is defined in a component
 * that itself renders `PublicPage` as an ancestor — because `EnquiryButton`
 * is its own component, its `useEnquiryModal()` call only runs once React
 * actually renders it as a descendant of the provider, not when the parent
 * page component's JSX is constructed.
 */
export function EnquiryButton({
  prefill,
  children,
  ...buttonProps
}: { prefill: EnquiryPrefill; children: ReactNode } & Omit<
  ComponentProps<typeof Button>,
  "asChild" | "onClick"
>) {
  const { openEnquiryModal } = useEnquiryModal();
  return (
    <Button type="button" {...buttonProps} onClick={() => openEnquiryModal(prefill)}>
      {children}
    </Button>
  );
}
