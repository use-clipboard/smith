'use client';

import { useEffect, useState } from 'react';

/** True once /api/me confirms the current user is a firm admin. Cheap, cached
 *  per component mount — used to gate admin-only affordances (e.g. the audit
 *  history button) in views that don't already receive an isAdmin prop. */
export function useIsAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setAdmin(d.userRole === 'admin'); })
      .catch(() => { /* non-admin by default */ });
    return () => { cancelled = true; };
  }, []);
  return admin;
}
