import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  clearOnboardingDirty,
  useHasUnsavedOnboardingChanges,
} from "@/lib/onboarding/unsaved-changes";

/**
 * Subtle top-right escape hatch from onboarding. Signs the session out so the
 * login page does not bounce the same authenticated user straight back in.
 * Saved onboarding progress is untouched — resume happens on next sign-in.
 */
export function ExitOnboardingButton() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasUnsaved = useHasUnsavedOnboardingChanges();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const leave = async () => {
    setLeaving(true);
    try {
      clearOnboardingDirty();
      await qc.cancelQueries();
      qc.clear();
      await supabase.auth.signOut();
    } finally {
      setLeaving(false);
      setConfirmOpen(false);
      navigate({ to: "/auth", replace: true });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => (hasUnsaved ? setConfirmOpen(true) : leave())}
        disabled={leaving}
        className="fixed right-4 top-4 z-50 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-medium text-white/80 backdrop-blur-md transition hover:bg-white/20 hover:text-white disabled:opacity-60 md:right-6 md:top-6"
      >
        {leaving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ArrowLeft className="size-3.5" />
        )}
        Back to Login
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You have unsaved changes. Leave onboarding?</AlertDialogTitle>
            <AlertDialogDescription>
              Information you already saved is kept, and you can resume from this point after signing
              in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void leave();
              }}
              disabled={leaving}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
