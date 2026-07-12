import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';

// GET /api/billing/me → the current user's billing capabilities (for the UI to
// hide admin-only actions). Server routes still enforce the real check.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');
  return NextResponse.json({ isAdmin: ctx.userRole === 'admin' });
}
