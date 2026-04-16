'use client';

import { ChevronUp, ChevronDown, Star, Plus, X } from 'lucide-react';
import { useTheme } from '@/components/ui/ThemeProvider';
import { useFavourites } from '@/components/ui/FavouritesProvider';
import { useModules } from '@/components/ui/ModulesProvider';
import { FAVOURITABLE_ITEMS } from '@/config/navItems';

export default function PreferencesTab() {
  const { theme, setTheme } = useTheme();
  const { favourites, updateFavourites } = useFavourites();
  const { isModuleActive } = useModules();

  // Only show favouritable items whose module is active (or is always-active like clients)
  const availableItems = FAVOURITABLE_ITEMS.filter(item =>
    item.moduleId === 'clients' || isModuleActive(item.moduleId)
  );

  // Current favourites — filtered to only active items (gracefully drops deactivated ones)
  const activeFavourites = favourites
    .map(id => availableItems.find(i => i.moduleId === id))
    .filter((i): i is typeof availableItems[0] => i !== undefined);

  // Items not yet in favourites
  const unpinned = availableItems.filter(item => !favourites.includes(item.moduleId));

  function addFavourite(moduleId: string) {
    updateFavourites([...activeFavourites.map(i => i.moduleId), moduleId]);
  }

  function removeFavourite(moduleId: string) {
    updateFavourites(activeFavourites.map(i => i.moduleId).filter(id => id !== moduleId));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const ids = activeFavourites.map(i => i.moduleId);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    updateFavourites(ids);
  }

  function moveDown(index: number) {
    if (index === activeFavourites.length - 1) return;
    const ids = activeFavourites.map(i => i.moduleId);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    updateFavourites(ids);
  }

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Appearance ─────────────────────────────────────────────────── */}
      <div className="glass-solid rounded-xl p-6">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Appearance</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Choose how SMITH looks. &apos;System&apos; follows your device preference.
        </p>
        <div className="flex gap-3">
          {(['light', 'dark', 'system'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`flex flex-col items-center gap-2 px-5 py-4 rounded-xl border-2 transition-all duration-150 min-w-[80px]
                ${theme === t
                  ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                  : 'border-[var(--border)] hover:border-[var(--accent)] bg-[var(--bg-card)]'
                }`}
            >
              <div className={`w-10 h-7 rounded-md border border-[var(--border-input)] overflow-hidden
                ${t === 'light' ? 'bg-white' : t === 'dark' ? 'bg-[#0D0D14]' : 'bg-gradient-to-r from-white to-[#0D0D14]'}`}
              />
              <span className="text-xs font-medium capitalize text-[var(--text-primary)]">{t}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Favourites ─────────────────────────────────────────────────── */}
      <div className="glass-solid rounded-xl p-6">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Sidebar Favourites</h3>
        <p className="text-xs text-[var(--text-muted)] mb-5">
          Pin items to the top of your sidebar for quick access. Your choices only affect your own view.
        </p>

        {/* Current favourites */}
        {activeFavourites.length > 0 ? (
          <div className="space-y-1 mb-5">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
              Pinned — drag to reorder
            </p>
            {activeFavourites.map((item, index) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.moduleId}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--accent-light)] border border-[var(--accent)]/20"
                >
                  <Star size={13} className="text-[var(--accent)] shrink-0" fill="currentColor" />
                  <Icon size={15} className="text-[var(--accent)] shrink-0" />
                  <span className="text-sm font-medium text-[var(--text-primary)] flex-1">{item.label}</span>
                  {/* Reorder */}
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                      className="p-1 rounded hover:bg-[var(--bg-nav-hover)] disabled:opacity-30 transition-colors"
                      title="Move up"
                    >
                      <ChevronUp size={13} className="text-[var(--text-muted)]" />
                    </button>
                    <button
                      onClick={() => moveDown(index)}
                      disabled={index === activeFavourites.length - 1}
                      className="p-1 rounded hover:bg-[var(--bg-nav-hover)] disabled:opacity-30 transition-colors"
                      title="Move down"
                    >
                      <ChevronDown size={13} className="text-[var(--text-muted)]" />
                    </button>
                  </div>
                  {/* Remove */}
                  <button
                    onClick={() => removeFavourite(item.moduleId)}
                    className="p-1 rounded hover:bg-[var(--danger)]/10 transition-colors"
                    title="Remove from favourites"
                  >
                    <X size={13} className="text-[var(--text-muted)] hover:text-[var(--danger)]" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 mb-4 rounded-lg border border-dashed border-[var(--border)] text-center">
            <Star size={18} className="text-[var(--text-muted)] opacity-40 mb-2" />
            <p className="text-xs text-[var(--text-muted)]">No favourites pinned yet.</p>
            <p className="text-xs text-[var(--text-muted)]">Add items from the list below.</p>
          </div>
        )}

        {/* Available to pin */}
        {unpinned.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
              Available to pin
            </p>
            {unpinned.map(item => {
              const Icon = item.icon;
              return (
                <div
                  key={item.moduleId}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors group"
                >
                  <Star size={13} className="text-[var(--text-muted)] opacity-30 shrink-0" />
                  <Icon size={15} className="text-[var(--text-muted)] shrink-0" />
                  <span className="text-sm text-[var(--text-secondary)] flex-1">{item.label}</span>
                  <button
                    onClick={() => addFavourite(item.moduleId)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-[var(--accent)] opacity-0 group-hover:opacity-100 hover:bg-[var(--accent-light)] transition-all"
                    title="Add to favourites"
                  >
                    <Plus size={11} />
                    Pin
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {availableItems.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">
            No tools are currently active. Ask your admin to enable modules in Settings → Tools.
          </p>
        )}
      </div>
    </div>
  );
}
