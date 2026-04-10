'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase';

interface NavBarProps {
  userEmail: string;
  userRole: string;
}

export default function NavBar({ userEmail, userRole }: NavBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const supabase = createClient();

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const isDashboard = pathname === '/dashboard';

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="SMITH" className="w-7 h-7 rounded dark:invert" />
            <span className="text-base font-bold text-slate-800">SMITH</span>
          </Link>
          <Link
            href="/clients"
            className={`text-sm transition-colors ${
              pathname.startsWith('/clients')
                ? 'text-blue-600 font-medium'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Clients
          </Link>
          {!isDashboard && !pathname.startsWith('/clients') && (
            <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-700 transition-colors">
              ← All tools
            </Link>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400 hidden sm:block">{userEmail}</span>
          {userRole === 'admin' && (
            <Link
              href="/settings"
              className={`text-sm transition-colors ${
                pathname.startsWith('/settings')
                  ? 'text-blue-600 font-medium'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Settings
            </Link>
          )}
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="text-sm text-slate-500 hover:text-slate-800 disabled:opacity-50 transition-colors"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </header>
  );
}
