/**
 * Lightweight pub/sub for Document Vault mutations.
 * Dispatch `VAULT_CHANGED` on `window` after any tag / delete / sync so
 * subscribers (e.g. the sidebar untagged badge) can re-fetch their count
 * without prop-drilling or background polling.
 */
export const VAULT_CHANGED = 'smith:vault-changed';

export function dispatchVaultChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(VAULT_CHANGED));
  }
}
