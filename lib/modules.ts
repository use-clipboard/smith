// Server-side module utility
// Use this in API routes and server components to check module access.
// For client-side checks, use the useModules() hook from ModulesProvider.

import { NextResponse } from 'next/server';
import { MODULES } from '@/config/modules.config';

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
