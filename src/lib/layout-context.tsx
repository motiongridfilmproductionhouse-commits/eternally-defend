import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { setSidebarCollapsed } from "./scan-actions.functions";

type LayoutState = {
  collapsed: boolean;
  hidden: boolean;
  setCollapsed: (v: boolean) => void;
  toggleCollapsed: () => void;
  setHidden: (v: boolean) => void;
  toggleHidden: () => void;
};

const LayoutCtx = createContext<LayoutState | null>(null);

export function SidebarLayoutProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("sidebar_collapsed") === "1";
  });
  const [hidden, setHiddenState] = useState<boolean>(false);
  const persist = useServerFn(setSidebarCollapsed);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    try { window.localStorage.setItem("sidebar_collapsed", v ? "1" : "0"); } catch { /* ignore */ }
    persist({ data: { collapsed: v } }).catch(() => { /* preference sync is best-effort */ });
  }, [persist]);

  const setHidden = useCallback((v: boolean) => setHiddenState(v), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setHiddenState((h) => !h);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value: LayoutState = {
    collapsed,
    hidden,
    setCollapsed,
    toggleCollapsed: () => setCollapsed(!collapsed),
    setHidden,
    toggleHidden: () => setHiddenState((h) => !h),
  };
  return <LayoutCtx.Provider value={value}>{children}</LayoutCtx.Provider>;
}

export function useSidebarLayout(): LayoutState {
  const v = useContext(LayoutCtx);
  if (!v) {
    // Safe fallback when consumers render outside the provider (e.g. tests, storybook).
    return {
      collapsed: false,
      hidden: false,
      setCollapsed: () => {},
      toggleCollapsed: () => {},
      setHidden: () => {},
      toggleHidden: () => {},
    };
  }
  return v;
}
