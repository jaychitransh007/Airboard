/**
 * Ink adaptation for the lightboard (neon-on-dark) theme.
 *
 * Board content is authored against a light board, so default inks are dark
 * and would vanish on the near-black lightboard. Rules:
 * - dark, unsaturated inks (blacks/grays) become a bright neutral core;
 * - dark, saturated inks keep their hue but are lifted to neon lightness;
 * - already-light inks pass through untouched;
 * - unparseable colors pass through untouched — never break rendering.
 */

type Hsla = { h: number; s: number; l: number; a: number };

const LIGHT_ENOUGH = 0.55;
// HSL saturation is misleading near black (a #111827 navy reads as 39%
// saturated); colorfulness = s * (1 - |2l - 1|) measures perceived chroma.
const NEUTRAL_COLORFULNESS = 0.12;
const NEON_LIGHTNESS = 0.66;
const NEUTRAL_CORE = "#f1f5f9";

const cache = new Map<string, string>();
const CACHE_LIMIT = 512;

export function adaptInkForDarkBoard(color: string): string {
  return cachedAdapt("ink:", color, adapt);
}

/**
 * Shape-body fills get the opposite treatment from inks: the light paper
 * fills of the classic theme become dark translucent glass so bright label
 * text and neon outlines stay readable. Hue is kept for tinted fills
 * (sticky-note amber stays warm); dark or transparent fills pass through.
 */
export function adaptFillForDarkBoard(color: string): string {
  return cachedAdapt("fill:", color, adaptFill);
}

function cachedAdapt(
  prefix: string,
  color: string,
  transform: (color: string) => string,
): string {
  const key = prefix + color;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const adapted = transform(color);
  if (cache.size >= CACHE_LIMIT) {
    cache.clear();
  }
  cache.set(key, adapted);
  return adapted;
}

const GLASS_LIGHTNESS = 16;
const GLASS_ALPHA = 0.58;

function adaptFill(color: string): string {
  const parsed = parseColor(color);
  if (!parsed) {
    return color;
  }
  if (parsed.l < LIGHT_ENOUGH) {
    return color;
  }
  const alpha = round(Math.min(parsed.a, GLASS_ALPHA));
  const colorfulness = parsed.s * (1 - Math.abs(2 * parsed.l - 1));
  if (colorfulness <= NEUTRAL_COLORFULNESS) {
    return `rgba(10, 14, 22, ${alpha})`;
  }
  const h = Math.round(parsed.h);
  const s = Math.round(Math.min(1, parsed.s) * 100);
  return `hsla(${h}, ${s}%, ${GLASS_LIGHTNESS}%, ${alpha})`;
}

function adapt(color: string): string {
  const parsed = parseColor(color);
  if (!parsed) {
    return color;
  }
  if (parsed.l >= LIGHT_ENOUGH) {
    return color;
  }
  const colorfulness = parsed.s * (1 - Math.abs(2 * parsed.l - 1));
  if (colorfulness <= NEUTRAL_COLORFULNESS) {
    return parsed.a >= 1 ? NEUTRAL_CORE : `rgba(241, 245, 249, ${round(parsed.a)})`;
  }
  const h = Math.round(parsed.h);
  const s = Math.round(Math.min(1, parsed.s * 1.15) * 100);
  const l = Math.round(NEON_LIGHTNESS * 100);
  return parsed.a >= 1 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${round(parsed.a)})`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function parseColor(color: string): Hsla | null {
  const value = color.trim().toLowerCase();
  if (value === "transparent" || value === "none" || value === "") {
    return null;
  }
  if (value.startsWith("#")) {
    return parseHex(value);
  }
  const rgbMatch = value.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/,
  );
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    const a = rgbMatch[4] === undefined ? 1 : Number(rgbMatch[4]);
    if ([r, g, b].some((c) => !Number.isFinite(c) || c > 255) || !Number.isFinite(a)) {
      return null;
    }
    return rgbToHsl(r / 255, g / 255, b / 255, Math.min(1, a));
  }
  return null;
}

function parseHex(value: string): Hsla | null {
  const hex = value.slice(1);
  if (!/^[0-9a-f]+$/.test(hex)) {
    return null;
  }
  let r: number;
  let g: number;
  let b: number;
  let a = 1;
  if (hex.length === 3 || hex.length === 4) {
    r = parseInt(hex[0]! + hex[0]!, 16);
    g = parseInt(hex[1]! + hex[1]!, 16);
    b = parseInt(hex[2]! + hex[2]!, 16);
    if (hex.length === 4) {
      a = parseInt(hex[3]! + hex[3]!, 16) / 255;
    }
  } else if (hex.length === 6 || hex.length === 8) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
    if (hex.length === 8) {
      a = parseInt(hex.slice(6, 8), 16) / 255;
    }
  } else {
    return null;
  }
  return rgbToHsl(r / 255, g / 255, b / 255, a);
}

function rgbToHsl(r: number, g: number, b: number, a: number): Hsla {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l, a };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    h = ((b - r) / d + 2) * 60;
  } else {
    h = ((r - g) / d + 4) * 60;
  }
  return { h, s, l, a };
}
