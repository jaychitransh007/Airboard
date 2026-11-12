import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import type { ContractElement } from "./scenes";

/** Where each scene's committed computed-style baseline lives. */
export const BASELINE_DIR = resolve(import.meta.dirname, "computed");

/** Set to 1 to rewrite the baselines from today's styling instead of comparing. */
export const UPDATE = process.env.AIRBOARD_STYLE_CONTRACT_UPDATE === "1";

export type ElementStyle = Record<string, string | number>;
export type SceneStyles = Record<string, ElementStyle>;

/**
 * Reads the computed values that styling decides and fonts do not: colours,
 * backgrounds, borders, radii, spacing, display, position, stacking and
 * visibility. Sizes and offsets that text decides (widths, auto margins,
 * insets of shrink-wrapped boxes, percentage transforms) are left out, so the
 * baseline holds on any machine and font stack, including Linux CI.
 *
 * A property equal on all four sides or corners is written once.
 */
export async function readElementStyle(page: Page, element: ContractElement): Promise<ElementStyle> {
  const locator = element.locate(page);
  try {
    await locator.waitFor({ state: "attached", timeout: 10_000 });
  } catch {
    throw new Error(`Style contract: "${element.name}" is not on the page (${locator})`);
  }
  return locator.evaluate((node, box) => {
    const style = getComputedStyle(node);
    const get = (property: string) => style.getPropertyValue(property);
    const sides = (format: (side: string) => string) => {
      const values = ["top", "right", "bottom", "left"].map(format);
      return values.every((value) => value === values[0]) ? values[0]! : values.join(" | ");
    };
    const corners = () => {
      const values = ["top-left", "top-right", "bottom-right", "bottom-left"].map((corner) => get(`border-${corner}-radius`));
      return values.every((value) => value === values[0]) ? values[0]! : values.join(" | ");
    };
    const out: Record<string, string | number> = {
      display: get("display"),
      position: get("position"),
      zIndex: get("z-index"),
      visibility: get("visibility"),
      opacity: get("opacity"),
      overflow: `${get("overflow-x")} ${get("overflow-y")}`,
      pointerEvents: get("pointer-events"),
      cursor: get("cursor"),
      color: get("color"),
      backgroundColor: get("background-color"),
      backgroundImage: get("background-image"),
      border: sides((side) => `${get(`border-${side}-width`)} ${get(`border-${side}-style`)} ${get(`border-${side}-color`)}`),
      borderRadius: corners(),
      outline: `${get("outline-width")} ${get("outline-style")} ${get("outline-color")}`,
      boxShadow: get("box-shadow"),
      backdropFilter: get("backdrop-filter"),
      padding: sides((side) => get(`padding-${side}`)),
      gap: `${get("row-gap")} ${get("column-gap")}`,
      maxWidth: get("max-width"),
      flexDirection: get("flex-direction"),
      alignItems: get("align-items"),
      justifyContent: get("justify-content"),
      // Chrome on macOS reports BlinkMacSystemFont as "system-ui"; Linux
      // keeps the name. Normalise so one baseline fits both platforms.
      fontFamily: get("font-family").replace(/"system-ui"/g, "BlinkMacSystemFont"),
      fontSize: get("font-size"),
      fontWeight: get("font-weight"),
      fontStyle: get("font-style"),
      lineHeight: get("line-height"),
      letterSpacing: get("letter-spacing"),
      textAlign: get("text-align"),
      textTransform: get("text-transform"),
      textDecoration: `${get("text-decoration-line")} ${get("text-decoration-style")}`,
      whiteSpace: get("white-space"),
    };
    if (box.length) {
      const rect = node.getBoundingClientRect();
      const metrics: Record<string, number> = {
        left: rect.left,
        top: rect.top,
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2 - window.innerWidth / 2,
      };
      for (const metric of box) out[`box.${metric}`] = Math.round(metrics[metric]!);
    }
    return out;
  }, element.box ?? []);
}

export async function readSceneStyles(page: Page, elements: ContractElement[]): Promise<SceneStyles> {
  const styles: SceneStyles = {};
  for (const element of elements) {
    if (styles[element.name]) throw new Error(`Style contract: two elements named "${element.name}"`);
    styles[element.name] = await readElementStyle(page, element);
  }
  return styles;
}

export function baselinePath(sceneName: string) {
  return resolve(BASELINE_DIR, `${sceneName}.json`);
}

export function readBaseline(sceneName: string): SceneStyles | null {
  const path = baselinePath(sceneName);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SceneStyles) : null;
}

export function writeBaseline(sceneName: string, styles: SceneStyles) {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(baselinePath(sceneName), `${JSON.stringify(styles, null, 2)}\n`);
}

/** One line per difference: "element › property: baseline → now". */
export function differences(baseline: SceneStyles, actual: SceneStyles): string[] {
  const lines: string[] = [];
  for (const name of new Set([...Object.keys(baseline), ...Object.keys(actual)])) {
    const before = baseline[name];
    const after = actual[name];
    if (!before) {
      lines.push(`${name}: not in the baseline`);
      continue;
    }
    if (!after) {
      lines.push(`${name}: in the baseline but no longer checked`);
      continue;
    }
    for (const property of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[property] !== after[property]) {
        lines.push(`${name} › ${property}: ${JSON.stringify(before[property])} → ${JSON.stringify(after[property])}`);
      }
    }
  }
  return lines;
}
