/**
 * Convert a #RRGGBB hex string into the three colour roles the MTD IT
 * PDF/email rendering needs:
 *
 *   brand     — the user's chosen primary colour (header band, top bars)
 *   brandSoft — a near-white tint used as a soft background fill
 *   brandInk  — a darker variant used for headings on light backgrounds
 *
 * We mix with white / black rather than using HSL because the brand band
 * needs to keep its identity (a true tint) and pure HSL lightness on
 * highly saturated purples can drift into a different hue family.
 *
 * Falls back to the default lavender if the hex is malformed so PDF
 * generation never crashes mid-render on a bad settings value.
 */

const FALLBACK = '#8B85CF';

function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const src = m ? m[1] : FALLBACK.slice(1);
  return [parseInt(src.slice(0, 2), 16), parseInt(src.slice(2, 4), 16), parseInt(src.slice(4, 6), 16)];
}

function clamp(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }

function mixWith(rgb: [number, number, number], target: [number, number, number], ratio: number): [number, number, number] {
  const r = 1 - ratio;
  return [clamp(rgb[0] * r + target[0] * ratio), clamp(rgb[1] * r + target[1] * ratio), clamp(rgb[2] * r + target[2] * ratio)];
}

export interface BrandPalette {
  brand:     [number, number, number];
  brandSoft: [number, number, number];
  brandInk:  [number, number, number];
  hex:       string;
}

export function paletteFromHex(hex: string | null | undefined): BrandPalette {
  const safeHex = (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) ? hex : FALLBACK;
  const rgb = parseHex(safeHex);
  return {
    brand:     rgb,
    // mix 92% with white → very pale tint for soft backgrounds
    brandSoft: mixWith(rgb, [255, 255, 255], 0.88),
    // mix 25% with black → darker variant readable on light backgrounds
    brandInk:  mixWith(rgb, [0, 0, 0], 0.25),
    hex:       safeHex,
  };
}

/** RGB array → CSS hex, used by the email template builder. */
export function rgbToHex(rgb: [number, number, number]): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}
