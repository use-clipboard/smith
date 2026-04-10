'use client';

import { createContext, useContext, ReactNode } from 'react';
import { MODULES } from '@/config/modules.config';

interface ModulesContextValue {
  activeModules: string[];
  isModuleActive: (moduleId: string) => boolean;
}

const ModulesContext = createContext<ModulesContextValue>({
  activeModules: [],
  isModuleActive: () => false,
});

interface ModulesProviderProps {
  activeModules: string[];
  children: ReactNode;
}

/**
 * Provides the firm's active module list to all client components.
 * Place this high in the tree (e.g. inside AppShell).
 *
 * Use the useModules() hook to access it in any client component.
 */
export function ModulesProvider({ activeModules, children }: ModulesProviderProps) {
  function isModuleActive(moduleId: string): boolean {
    const mod = MODULES.find(m => m.id === moduleId);
    if (!mod) return false;
    if (mod.alwaysOn) return true;
    return activeModules.includes(moduleId);
  }

  return (
    <ModulesContext.Provider value={{ activeModules, isModuleActive }}>
      {children}
    </ModulesContext.Provider>
  );
}

/**
 * Hook to access the active modules for the current firm.
 *
 * @example
 * const { isModuleActive } = useModules();
 * if (!isModuleActive('document-vault')) { ... }
 */
export function useModules() {
  return useContext(ModulesContext);
}
