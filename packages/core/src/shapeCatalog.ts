/**
 * Stable, product-owned shape metadata for the board creation surface.
 *
 * The catalog intentionally contains no renderer-specific path data. Canvas,
 * SVG, thumbnails, accessibility, Airo, and the creation pane can therefore
 * share the same names, ordering, aliases, and default sizes without coupling
 * core state to a particular drawing implementation.
 */

import type { ShapeKind } from "./types.ts";

export const FIGJAM_BASIC_SHAPE_KINDS = [
  "square",
  "ellipse",
  "diamond",
  "triangle",
  "downward-triangle",
  "rounded-rectangle",
  "pentagon",
  "octagon",
  "plus",
  "left-arrow",
  "right-arrow",
  "chevron",
  "star",
  "speech-bubble",
] as const;

export const FIGJAM_FLOWCHART_SHAPE_KINDS = [
  "right-parallelogram",
  "left-parallelogram",
  "cylinder",
  "horizontal-cylinder",
  "file",
  "folder",
  "document",
  "multiple-documents",
  "predefined-process",
  "shield",
  "trapezoid",
  "manual-input",
  "hexagon",
  "internal-storage",
  "or",
  "summing-junction",
] as const;

export const FIGJAM_ADVANCED_SHAPE_KINDS = [
  "activity",
  "archive",
  "authentication",
  "chat",
  "cloud",
  "computer",
  "database",
  "desktop",
  "email",
  "file",
  "frontend",
  "instant",
  "location",
  "mobile",
  "package",
  "payment",
  "security",
  "send",
  "server",
  "service",
  "settings",
  "storage",
  "terminal",
  "user",
  "wallet",
  "web",
] as const;

export const AIRBOARD_EXTRA_SHAPE_KINDS = [
  "process",
  "terminator",
  "api",
  "queue",
] as const;

export type CatalogShapeKind =
  | (typeof FIGJAM_BASIC_SHAPE_KINDS)[number]
  | (typeof FIGJAM_FLOWCHART_SHAPE_KINDS)[number]
  | (typeof FIGJAM_ADVANCED_SHAPE_KINDS)[number]
  | (typeof AIRBOARD_EXTRA_SHAPE_KINDS)[number];

type AssertNoShapeKindDrift<T extends never> = T;
type _MissingCatalogShapeKinds = AssertNoShapeKindDrift<Exclude<ShapeKind, CatalogShapeKind>>;
type _UnknownCatalogShapeKinds = AssertNoShapeKindDrift<Exclude<CatalogShapeKind, ShapeKind>>;

export type ShapeCatalogCategory = "basic" | "flowchart" | "advanced" | "airboard";

export type ShapeCatalogEntry = {
  /** Unique palette identity. `file` is intentionally shown in two categories. */
  id: string;
  kind: CatalogShapeKind;
  name: string;
  category: ShapeCatalogCategory;
  order: number;
  defaultSize: Readonly<{ width: number; height: number }>;
  aliases: readonly string[];
};

const standard = { width: 144, height: 88 } as const;
const square = { width: 112, height: 112 } as const;
const portrait = { width: 112, height: 136 } as const;
const wide = { width: 156, height: 80 } as const;

function entries(
  category: ShapeCatalogCategory,
  definitions: readonly [
    kind: CatalogShapeKind,
    name: string,
    size?: Readonly<{ width: number; height: number }>,
    aliases?: readonly string[],
    id?: string,
  ][],
): ShapeCatalogEntry[] {
  return definitions.map(([kind, name, size = standard, aliases = [], id = kind], order) => ({
    id,
    kind,
    name,
    category,
    order,
    defaultSize: size,
    aliases,
  }));
}

export const BASIC_SHAPE_CATALOG = entries("basic", [
  ["square", "Square", square, ["box", "rectangle"]],
  ["ellipse", "Ellipse", square, ["circle", "oval"]],
  ["diamond", "Diamond", square, ["decision"]],
  ["triangle", "Triangle", square],
  ["downward-triangle", "Downward Triangle", square, ["down triangle"]],
  ["rounded-rectangle", "Rounded Rectangle", standard, ["rounded box"]],
  ["pentagon", "Pentagon", square],
  ["octagon", "Octagon", square],
  ["plus", "Plus", square, ["cross"]],
  ["left-arrow", "Left Arrow", standard],
  ["right-arrow", "Right Arrow", standard, ["arrow shape"]],
  ["chevron", "Chevron", standard],
  ["star", "Star", square],
  ["speech-bubble", "Speech Bubble", standard, ["speech", "bubble"]],
]);

export const FLOWCHART_SHAPE_CATALOG = entries("flowchart", [
  ["right-parallelogram", "Right-leaning Parallelogram", standard, ["input output", "io"]],
  ["left-parallelogram", "Left-leaning Parallelogram", standard],
  ["cylinder", "Cylinder", portrait],
  ["horizontal-cylinder", "Horizontal Cylinder", standard],
  ["file", "File", standard, ["flowchart file"], "flowchart-file"],
  ["folder", "Folder", standard],
  ["document", "Document", standard],
  ["multiple-documents", "Multiple Documents", standard, ["documents"]],
  ["predefined-process", "Predefined Process", standard, ["subroutine"]],
  ["shield", "Shield", portrait],
  ["trapezoid", "Trapezoid", standard],
  ["manual-input", "Manual Input", standard],
  ["hexagon", "Hexagon", standard, ["preparation"]],
  ["internal-storage", "Internal Storage", standard],
  ["or", "Or", square, ["or junction"]],
  ["summing-junction", "Summing Junction", square, ["sum junction"]],
]);

export const ADVANCED_SHAPE_CATALOG = entries("advanced", [
  ["activity", "Activity", square],
  ["archive", "Archive", square],
  ["authentication", "Authentication", square, ["auth"]],
  ["chat", "Chat", square],
  ["cloud", "Cloud", standard],
  ["computer", "Computer", standard, ["laptop"]],
  ["database", "Database", standard, ["db", "data store"]],
  ["desktop", "Desktop", standard, ["monitor"]],
  ["email", "Email", standard, ["mail"]],
  ["file", "File", standard, ["advanced file"]],
  ["frontend", "Frontend", standard, ["front end"]],
  ["instant", "Instant", square, ["lightning"]],
  ["location", "Location", portrait, ["map pin"]],
  ["mobile", "Mobile", portrait, ["phone"]],
  ["package", "Package", square, ["box package"]],
  ["payment", "Payment", standard, ["card"]],
  ["security", "Security", portrait, ["lock"]],
  ["send", "Send", square, ["paper plane"]],
  ["server", "Server", standard],
  ["service", "Service", standard, ["microservice"]],
  ["settings", "Settings", square, ["gear", "cog"]],
  ["storage", "Storage", standard],
  ["terminal", "Terminal", standard, ["console"]],
  ["user", "User", portrait, ["person", "actor"]],
  ["wallet", "Wallet", standard],
  ["web", "Web", square, ["globe"]],
]);

export const AIRBOARD_SHAPE_CATALOG = entries("airboard", [
  ["process", "Process", standard, ["step", "task"]],
  ["terminator", "Start / End", wide, ["start", "end", "start end"]],
  ["api", "API", standard, ["endpoint", "gateway"]],
  ["queue", "Queue", standard, ["message queue", "event bus"]],
]);

/** The 56 built-in entries, including File in both documented categories. */
export const FIGJAM_SHAPE_CATALOG = [
  ...BASIC_SHAPE_CATALOG,
  ...FLOWCHART_SHAPE_CATALOG,
  ...ADVANCED_SHAPE_CATALOG,
] as const;

export const BOARD_SHAPE_CATALOG = [
  ...FIGJAM_SHAPE_CATALOG,
  ...AIRBOARD_SHAPE_CATALOG,
] as const;

export const SHAPE_CATALOG_BY_CATEGORY = {
  basic: BASIC_SHAPE_CATALOG,
  flowchart: FLOWCHART_SHAPE_CATALOG,
  advanced: ADVANCED_SHAPE_CATALOG,
  airboard: AIRBOARD_SHAPE_CATALOG,
} as const satisfies Record<ShapeCatalogCategory, readonly ShapeCatalogEntry[]>;

const normalizedAliases = new Map<string, CatalogShapeKind>();
for (const entry of BOARD_SHAPE_CATALOG) {
  for (const term of [entry.kind, entry.name, ...entry.aliases]) {
    normalizedAliases.set(normalizeShapeTerm(term), entry.kind);
  }
}

/** Maps legacy names, speech terms, and palette labels to canonical shape kinds. */
export function canonicalShapeKind(value: string): CatalogShapeKind | null {
  return normalizedAliases.get(normalizeShapeTerm(value)) ?? null;
}

export function isCatalogShapeKind(value: unknown): value is CatalogShapeKind {
  return typeof value === "string" && canonicalKinds.has(value as CatalogShapeKind);
}

export function shapeCatalogEntry(
  kind: CatalogShapeKind,
  preferredCategory?: ShapeCatalogCategory,
): ShapeCatalogEntry {
  const match = BOARD_SHAPE_CATALOG.find(
    (entry) => entry.kind === kind && (!preferredCategory || entry.category === preferredCategory),
  );
  if (match) return match;
  // Every CatalogShapeKind is constructed from this catalog; this guards
  // malformed runtime input without making all consumers handle undefined.
  throw new Error(`Missing board shape catalog entry: ${kind}`);
}

function normalizeShapeTerm(value: string): string {
  return value.trim().toLowerCase().replace(/[_/]+/g, " ").replace(/[-\s]+/g, " ");
}

const canonicalKinds = new Set<CatalogShapeKind>(
  BOARD_SHAPE_CATALOG.map(({ kind }) => kind),
);
