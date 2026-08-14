// Defensive fetch + JSON parse for client-side API calls.
//
// The auth middleware redirects any unauthenticated request to /login, and that
// login page is a 200 HTML document. A naive `res.json()` on it throws the
// cryptic "Unexpected token '<', "<!DOCTYPE"… is not valid JSON" — which really
// just means the user's session lapsed (common right after a dev-server restart
// or when a session times out). This helper detects that case (and other
// non-JSON / error responses) and throws an Error whose `.message` is safe and
// meaningful to show to the user.

export const SESSION_EXPIRED_MESSAGE =
  'Your session has expired. Please refresh the page to sign in again.';

export async function fetchJson<T = unknown>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection and try again.');
  }

  const contentType = res.headers.get('content-type') ?? '';

  // Not JSON → either a redirect to the login page (session gone) or some other
  // non-JSON body. Surface a clear message instead of a raw parse error.
  if (!contentType.includes('application/json')) {
    if (res.status === 204) return null as T; // No Content
    const body = await res.text().catch(() => '');
    if ((res.redirected && /\/login(\?|$)/.test(res.url)) || /^\s*<(?:!doctype|html)/i.test(body)) {
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }
    throw new Error(body.slice(0, 200).trim() || `Request failed (${res.status})`);
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); }
    catch { throw new Error('The server returned an unexpected response. Please try again.'); }
  }

  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data as T;
}
