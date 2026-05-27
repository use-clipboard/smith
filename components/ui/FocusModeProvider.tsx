'use client';

import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

/**
 * Focus mode hides the SMITH chrome (sidebar, top bar, tab strip, banners) so
 * the active tool gets the full viewport. CSS-only — nothing unmounts, so
 * in-progress edits and active tabs survive the toggle.
 *
 * Originally bookkeeping-only; promoted to a global provider so every tool can
 * opt in via the toggle in the top bar (or the bound shortcut).
 */
interface FocusModeContextValue {
  focusMode: boolean;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  toggleFocusMode: () => void;
}

const FocusModeContext = createContext<FocusModeContextValue | null>(null);

export function useFocusMode(): FocusModeContextValue {
  const ctx = useContext(FocusModeContext);
  if (!ctx) throw new Error('useFocusMode must be used inside FocusModeProvider');
  return ctx;
}

export default function FocusModeProvider({ children }: { children: ReactNode }) {
  const [focusMode, setFocusMode] = useState(false);

  const toggleFocusMode = useCallback(() => setFocusMode(f => !f), []);

  // Body class drives all the chrome-hiding rules in globals.css.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (focusMode) document.body.classList.add('focus-mode');
    else document.body.classList.remove('focus-mode');
    return () => { document.body.classList.remove('focus-mode'); };
  }, [focusMode]);

  // Ctrl+\ (⌘+\) toggles; Esc exits when focus is on.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '\\' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setFocusMode(f => !f);
        return;
      }
      if (e.key === 'Escape' && focusMode) {
        // Best-effort: modal dialogs typically stopPropagation before this,
        // so this only fires when nothing else is consuming the keystroke.
        setFocusMode(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusMode]);

  return (
    <FocusModeContext.Provider value={{ focusMode, setFocusMode, toggleFocusMode }}>
      {children}
    </FocusModeContext.Provider>
  );
}
