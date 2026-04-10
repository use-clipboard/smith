// Server-side only — never import this in client components
import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase-server';

/** Thrown when the firm has not yet set up their Anthropic API key. */
export class ApiKeyNotConfiguredError extends Error {
  constructor() {
    super('No AI API key configured for your firm. Please ask your admin to add one in Settings → AI & API Key.');
    this.name = 'ApiKeyNotConfiguredError';
  }
}

/**
 * Returns an Anthropic client configured with the firm's own API key.
 * Throws ApiKeyNotConfiguredError if no key is set so API routes can
 * surface a clear, user-facing message.
 */
export async function getAnthropicForFirm(firmId: string): Promise<Anthropic> {
  const service = createServiceClient();

  const { data: firm } = await service
    .from('firms')
    .select('anthropic_api_key')
    .eq('id', firmId)
    .single();

  const apiKey = (firm as { anthropic_api_key?: string } | null)?.anthropic_api_key;

  if (!apiKey) {
    throw new ApiKeyNotConfiguredError();
  }

  return new Anthropic({ apiKey });
}
