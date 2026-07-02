// Shared chart palette for the Timesheets module.
// Indigo-led to sit on SMITH's accent, with a warm/cool spread for donuts.

export const CHART_COLORS = [
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#0EA5E9', // sky
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F43F5E', // rose
  '#A855F7', // purple
  '#3B82F6', // blue
];

export function colorAt(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length];
}

/** Consistent colours for the three time categories. */
export const TYPE_COLORS = {
  billable: '#10B981',     // emerald
  non_billable: '#8B5CF6', // violet
  internal: '#6366F1',     // indigo (a touch lighter in use)
} as const;

export const TYPE_LABELS = {
  billable: 'Billable',
  non_billable: 'Non-billable',
  internal: 'Internal',
} as const;

/** hsl string from a stored hue — used for avatars + per-staff bars. */
export function hueColor(hue: number, s = 70, l = 58): string {
  return `hsl(${hue} ${s}% ${l}%)`;
}
