import { useEffect, useSyncExternalStore } from "react";

/**
 * Tracks which onboarding steps currently hold unsaved edits, so the
 * "Back to Login" control can warn before leaving. Purely client-side UI state.
 */
const dirtyKeys = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return dirtyKeys.size > 0;
}

export function setOnboardingDirty(key: string, dirty: boolean) {
  const had = dirtyKeys.has(key);
  if (dirty === had) return;
  if (dirty) dirtyKeys.add(key);
  else dirtyKeys.delete(key);
  emit();
}

/** Register the dirty state of a step form; cleans up on unmount. */
export function useOnboardingDirty(key: string, dirty: boolean) {
  useEffect(() => {
    setOnboardingDirty(key, dirty);
  }, [key, dirty]);
  useEffect(
    () => () => {
      setOnboardingDirty(key, false);
    },
    [key],
  );
}

export function useHasUnsavedOnboardingChanges() {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false,
  );
}

export function clearOnboardingDirty() {
  if (dirtyKeys.size === 0) return;
  dirtyKeys.clear();
  emit();
}
