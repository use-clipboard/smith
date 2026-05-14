/**
 * Shared helpers for the community feature.
 * Identity policy: "First name + last initial" (no firm exposure across the network).
 */

export const COMMUNITY_CATEGORIES = [
  { id: 'general',     label: 'General' },
  { id: 'accountancy', label: 'Accountancy' },
  { id: 'smith',       label: 'SMITH' },
  { id: 'tech',        label: 'Tech' },
] as const;

export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number]['id'];

export function isCommunityCategory(value: unknown): value is CommunityCategory {
  return typeof value === 'string' && COMMUNITY_CATEGORIES.some(c => c.id === value);
}

export function categoryLabel(id: string): string {
  return COMMUNITY_CATEGORIES.find(c => c.id === id)?.label ?? 'General';
}

/**
 * Render an author for the community feed: "First L." (e.g. "Christos M.").
 * Falls back gracefully when full_name is null or single-word.
 */
export function communityDisplayName(fullName: string | null | undefined, email: string | null | undefined): string {
  const name = (fullName ?? '').trim();
  if (name) {
    const parts = name.split(/\s+/);
    const first = parts[0];
    const last = parts.length > 1 ? parts[parts.length - 1] : '';
    if (last) {
      const initial = last.charAt(0).toUpperCase();
      return `${first} ${initial}.`;
    }
    return first;
  }
  // Fallback to email local-part — strips after the @ and any plus-suffix
  const e = (email ?? '').trim();
  if (e.includes('@')) {
    const local = e.split('@')[0].split('+')[0];
    return local || 'Anonymous';
  }
  return 'Anonymous';
}

/**
 * Convert plain text to HTML with bare URLs turned into clickable links and
 * newlines preserved. All non-URL text is HTML-escaped first to prevent XSS.
 */
export function linkifyPlainText(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Match http(s)://... or www. style URLs, stopping at whitespace or trailing punctuation.
  const urlRe = /\b((?:https?:\/\/|www\.)[^\s<]+[^\s.,;:!?<()])/gi;
  const linked = escaped.replace(urlRe, raw => {
    const href = raw.startsWith('http') ? raw : `https://${raw}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-[var(--accent)] hover:underline break-words">${raw}</a>`;
  });

  return linked.replace(/\n/g, '<br/>');
}

/**
 * Score used by the "Trending" sort. Likes weighted by post age (decays
 * smoothly so older posts can still appear if they keep getting likes).
 */
export function trendingScore(likeCount: number, createdAt: string): number {
  const ageHours = Math.max(1, (Date.now() - new Date(createdAt).getTime()) / 36e5);
  return (likeCount + 1) / Math.pow(ageHours + 2, 1.5);
}
