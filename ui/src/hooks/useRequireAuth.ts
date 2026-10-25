import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "../context/authState";

/**
 * Hook for gating participation actions behind authentication.
 *
 * Usage:
 *   const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } = useRequireAuth();
 *
 *   function handleVote() {
 *     requireAuth(() => {
 *       // This runs after auth is complete
 *       submitVote(...);
 *     });
 *   }
 *
 * Returns showAuthModal=true when the auth modal should be displayed.
 * handleAuthComplete executes the pending action and closes the modal.
 */
export function useRequireAuth() {
  const { canParticipate, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  // An action asked for while the session was still being read (a press
  // right after the page loads). Decided once it is: run, or ask to sign in.
  // Deciding early showed a signed-in resident the sign-in box, and lost the
  // press (seen in the Submit specs, 2026-10-12).
  const waiting = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (loading || !waiting.current) return;
    const action = waiting.current;
    waiting.current = null;
    if (canParticipate) {
      action();
    } else {
      setPendingAction(() => action);
      setShowAuthModal(true);
    }
  }, [loading, canParticipate]);

  const requireAuth = useCallback(
    (action: () => void) => {
      if (loading) {
        waiting.current = action;
      } else if (canParticipate) {
        // User is authenticated and resident — run action immediately
        action();
      } else {
        // Store the action and show auth modal
        setPendingAction(() => action);
        setShowAuthModal(true);
      }
    },
    [canParticipate, loading]
  );

  const closeAuthModal = useCallback(() => {
    setShowAuthModal(false);
    setPendingAction(null);
  }, []);

  const handleAuthComplete = useCallback(() => {
    setShowAuthModal(false);
    // Execute the pending action
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  }, [pendingAction]);

  return { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete };
}
