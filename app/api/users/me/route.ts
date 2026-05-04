import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/users/me — returns current user's ID and role
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  return NextResponse.json({ userId: ctx.userId, firmId: ctx.firmId, userRole: ctx.userRole });
}
