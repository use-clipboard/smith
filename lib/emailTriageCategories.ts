/**
 * Server-side helpers for a user's customised email triage categories.
 * The middle categories are stored on users.email_triage_categories (JSON);
 * absent = the built-in defaults. The two anchors are always added by code.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_MIDDLE, FIXED_FIRST, FIXED_LAST, type CategoryDef } from '@/components/features/email/emailCategories';

/** The user's ordered MIDDLE categories (defaults if they haven't customised). */
export async function getUserMiddleCategories(supabase: SupabaseClient, userId: string): Promise<CategoryDef[]> {
  const { data } = await supabase.from('users').select('email_triage_categories').eq('id', userId).maybeSingle();
  const stored = data?.email_triage_categories as CategoryDef[] | null | undefined;
  if (Array.isArray(stored) && stored.length) return stored;
  return DEFAULT_MIDDLE;
}

/** Full ordered list including the fixed anchors. */
export async function getUserCategoryList(supabase: SupabaseClient, userId: string): Promise<CategoryDef[]> {
  const middle = await getUserMiddleCategories(supabase, userId);
  return [FIXED_FIRST, ...middle, FIXED_LAST];
}

/** Every valid category key for this user (anchors + their middle set). */
export async function getUserCategoryKeys(supabase: SupabaseClient, userId: string): Promise<string[]> {
  return (await getUserCategoryList(supabase, userId)).map(c => c.key);
}
