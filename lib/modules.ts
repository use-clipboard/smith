// Server-side module utility
// Use this in API routes and server components to check module access.
// For client-side checks, use the useModules() hook from ModulesProvider.

import { NextResponse } from 'next/server';
import { MODULES, OPTIONAL_MODULE_IDS, modulesForPlan } from '@/config/modules.config';

const KNOWN_TIERS = new Set(['internal', 'compliance', 'practice']);

/**
 * Resolve a firm's effective active modules.
 *
 * A firm ALWAYS gets the modules its plan tier includes, unioned with whatever
 * is stored in `firms.active_modules`. The stored array is only a snapshot,
 * written when the plan was last set — so when a new tool is added to a tier
 * (e.g. Accounts Studio → Compliance), existing firms would otherwise never
 * receive it until their plan was re-saved. Folding the tier's module list in
 * here makes that automatic and back-fill-free.
 *
 * Note: because tier modules are always granted, an admin cannot "turn off" a
 * module their tier includes via the Modules override — the override only ADDS
 * extras on top of the tier. That's intentional: you get what your tier grants.
 */
export function resolveActiveModules(
  stored: string[] | null | undefined,
  tier: string | null | undefined,
): string[] {
  const base = (stored && stored.length > 0) ? stored : OPTIONAL_MODULE_IDS;
  if (tier && KNOWN_TIERS.has(tier)) {
    return Array.from(new Set([...base, ...modulesForPlan(tier)]));
  }
  return base;
}

/**
 * Pure function — check if a module is active for a firm.
 * Safe to call anywhere (server or client) — no side effects.
 *
 * Always returns true for alwaysOn modules regardless of activeModules list.
 */
export function isModuleActiveForFirm(moduleId: string, activeModules: string[]): boolean {
  const mod = MODULES.find(m => m.id === moduleId);
  if (!mod) return false;
  if (mod.alwaysOn) return true;
  return activeModules.includes(moduleId);
}

/**
 * Build a module checker bound to a firm's active module list.
 * Useful in API routes so you only pass activeModules once.
 *
 * @example
 * const { isModuleActive } = buildModuleChecker(ctx.activeModules);
 * if (!isModuleActive('full-analysis')) return moduleNotActive('full-analysis');
 */
export function buildModuleChecker(activeModules: string[]) {
  return {
    isModuleActive: (moduleId: string) => isModuleActiveForFirm(moduleId, activeModules),
  };
}

/** Standard 403 response for inactive modules — use in API routes */
export function moduleNotActive(moduleId?: string): NextResponse {
  return NextResponse.json(
    {
      error: 'Module not active',
      message: moduleId
        ? `The '${moduleId}' module is not enabled for your firm. Ask your admin to enable it in Settings → Modules.`
        : 'This feature is not enabled for your firm.',
      code: 'MODULE_INACTIVE',
    },
    { status: 403 }
  );
}
