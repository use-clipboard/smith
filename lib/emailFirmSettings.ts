import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_EMAIL_FONT, isEmailFontId } from './emailFonts';

/**
 * The firm's default email font, for server paths that need to resolve a body
 * font when the client didn't name one.
 *
 * Never throws: an unset firm, an unapplied migration or a transient read error
 * all fall back to the default. A font is cosmetic, and failing a send over one
 * would be a far worse outcome than sending in Arial.
 */
export async function getFirmEmailFont(supabase: SupabaseClient, firmId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('firm_email_settings')
      .select('default_font')
      .eq('firm_id', firmId)
      .maybeSingle();
    return isEmailFontId(data?.default_font) ? (data!.default_font as string) : DEFAULT_EMAIL_FONT;
  } catch {
    return DEFAULT_EMAIL_FONT;
  }
}
