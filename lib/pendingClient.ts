/**
 * Module-level singleton that carries a "pending client" from the client detail
 * page to a tool page when the user clicks a Quick Launch button.
 *
 * Usage:
 *   // On the client page:
 *   setPendingClient('/full-analysis', { id, name, client_ref, business_type, vat_number, status });
 *   openTab({ route: '/full-analysis', ... });
 *
 *   // In the tool page (useEffect on mount):
 *   const pending = consumePendingClient('/full-analysis');
 *   if (pending) setSelectedClient(pending);
 */

export interface PendingClientData {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
  vat_number: string | null;
  status: string;
}

interface PendingEntry {
  route: string;
  client: PendingClientData;
}

let _pending: PendingEntry | null = null;

/**
 * Set the pending client for a tool route, then dispatch a DOM event so
 * already-mounted tool tabs can react immediately (new tabs catch it via
 * consumePendingClient on mount instead).
 */
export function setPendingClient(route: string, client: PendingClientData): void {
  _pending = { route, client };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('smith:pending-client', { detail: { route } })
    );
  }
}

/**
 * Consume (read + clear) the pending client for a given route.
 * Returns the client if it matches, or null. Always clears after reading.
 */
export function consumePendingClient(route: string): PendingClientData | null {
  if (_pending?.route === route) {
    const client = _pending.client;
    _pending = null;
    return client;
  }
  return null;
}
