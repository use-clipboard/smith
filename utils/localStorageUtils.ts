// Placeholder — replaced by Supabase in Phase 1
// These are kept for compatibility during migration

import type { AppState2 } from '@/types';

export function saveStateToLocalStorage(state: Partial<AppState2>): Promise<void> {
  try {
    // During Phase 1 migration, still use localStorage as fallback
    // TODO: Replace with Supabase persistence in Phase 1 step 6
    const serializable = {
      ...state,
      documentFiles: [], // Files can't be serialized
      pastTransactionsFile: null,
      ledgersFile: null,
    };
    localStorage.setItem('agent-smith-state', JSON.stringify(serializable));
  } catch (e) {
    console.warn('Failed to save state to localStorage:', e);
  }
  return Promise.resolve();
}

export function loadStateFromLocalStorage(): Partial<AppState2> | null {
  try {
    const raw = localStorage.getItem('agent-smith-state');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearStateFromLocalStorage(): void {
  try {
    localStorage.removeItem('agent-smith-state');
  } catch (e) {
    // ignore
  }
}
