// Access control for the Bookkeeping tool.
//
// Bookkeeping is part of the Compliance tier, so access is gated by the firm's
// active_modules (like every other paid tool). Pass the firm's active module
// list — resolved via getUserContext().activeModules.
//
// Safety: an empty/absent list means "not provisioned yet" and mirrors
// getUserContext's empty→all-active default, so a firm is never locked out by a
// missing module list. Only a firm with a populated list that omits
// 'bookkeeping' (i.e. a plan without it) is denied.

export function canAccessBookkeeping(activeModules: string[] | null | undefined): boolean {
  if (!activeModules || activeModules.length === 0) return true;
  return activeModules.includes('bookkeeping');
}
