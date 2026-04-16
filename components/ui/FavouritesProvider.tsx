'use client';

import { createContext, useContext, useState, useCallback, useRef } from 'react';

interface FavouritesContextValue {
  favourites: string[];
  updateFavourites: (ids: string[]) => Promise<void>;
}

const FavouritesContext = createContext<FavouritesContextValue>({
  favourites: [],
  updateFavourites: async () => {},
});

export function FavouritesProvider({
  initialFavourites,
  children,
}: {
  initialFavourites: string[];
  children: React.ReactNode;
}) {
  const [favourites, setFavourites] = useState<string[]>(initialFavourites);
  // Ref lets us capture the previous value for rollback without stale closure issues
  const previousRef = useRef<string[]>(initialFavourites);

  const updateFavourites = useCallback(async (ids: string[]) => {
    // Capture current value before optimistic update so we can roll back
    const previous = previousRef.current;
    previousRef.current = ids;
    setFavourites(ids);

    try {
      const res = await fetch('/api/users/favourites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favourites: ids }),
      });
      if (!res.ok) {
        // Save failed — revert to previous state
        previousRef.current = previous;
        setFavourites(previous);
        console.error('Failed to save favourites — changes reverted');
      }
    } catch {
      // Network error — revert to previous state
      previousRef.current = previous;
      setFavourites(previous);
      console.error('Network error saving favourites — changes reverted');
    }
  }, []);

  return (
    <FavouritesContext.Provider value={{ favourites, updateFavourites }}>
      {children}
    </FavouritesContext.Provider>
  );
}

export function useFavourites() {
  return useContext(FavouritesContext);
}
