import {
  richTextToPlainText,
  shapeCatalogEntry,
  type BoardSceneElement,
  type BoardState,
  type Stroke,
} from "@airboard/core";
import { AIRBOARD_TRANSCRIPTION_KEYTERMS } from "./browserSpeech.ts";
import { boundedKeyterms } from "./realtimeSpeech.ts";

const KEYTERM_WAKE_HEAD_COUNT = 8;

/**
 * Builds the complete replacement vocabulary for a live transcription
 * session. Flux replaces (rather than merges) keyterms on Configure, so this
 * list always includes the wake/command vocabulary as well as the current
 * board labels.
 */
export function buildSessionKeyterms(
  state: BoardState,
  selectedElementIds: readonly string[] = [],
): string[] {
  const selectedIds = new Set(selectedElementIds);
  const sceneElements = Object.values(state.elements ?? {}).filter(
    (element) => element.status === "active" && element.visible && !element.legacyStrokeId,
  );
  const committed = Object.values(state.strokes).filter(
    (stroke) => stroke.status === "committed" && stroke.annotation,
  );
  const selectedNodeLabels = [
    ...sceneElements
      .filter((element) => selectedIds.has(element.id) && element.kind !== "connector")
      .map(sceneElementLabel)
      .filter(isNonEmptyString),
    ...committed
    .filter((stroke) => selectedIds.has(stroke.id) && isBoardNode(stroke))
    .map(annotationLabel)
      .filter(isNonEmptyString),
  ];
  const nodeLabels = [
    ...sceneElements
      .filter((element) => !selectedIds.has(element.id) && element.kind !== "connector")
      .map(sceneElementLabel)
      .filter(isNonEmptyString),
    ...committed
    .filter((stroke) => !selectedIds.has(stroke.id) && isBoardNode(stroke))
    .map(annotationLabel)
      .filter(isNonEmptyString),
  ];
  const connectorLabels = [
    ...sceneElements
      .filter((element) => element.kind === "connector")
      .map(sceneElementLabel)
      .filter(isNonEmptyString),
    ...committed
    .filter((stroke) => isConnector(stroke))
    .map(annotationLabel)
      .filter(isNonEmptyString),
  ];

  return boundedKeyterms([
    ...AIRBOARD_TRANSCRIPTION_KEYTERMS.slice(0, KEYTERM_WAKE_HEAD_COUNT),
    ...selectedNodeLabels,
    ...nodeLabels,
    ...connectorLabels,
    ...AIRBOARD_TRANSCRIPTION_KEYTERMS.slice(KEYTERM_WAKE_HEAD_COUNT),
  ]);
}

export function boardVoiceKeytermFingerprint(
  state: BoardState,
  selectedElementIds: readonly string[] = [],
): string {
  return buildSessionKeyterms(state, selectedElementIds)
    .map((term) => term.toLocaleLowerCase("en-US"))
    .join("\u0000");
}

function isBoardNode(stroke: Stroke): boolean {
  const type = stroke.annotation?.type;
  return Boolean(
    stroke.annotation?.bounds &&
      type !== "connector" &&
      type !== "arrow",
  );
}

function isConnector(stroke: Stroke): boolean {
  const type = stroke.annotation?.type;
  return type === "connector" || type === "arrow";
}

function annotationLabel(stroke: Stroke): string | null {
  return boundedLabel(stroke.annotation?.label);
}

function sceneElementLabel(element: BoardSceneElement): string | null {
  switch (element.kind) {
    case "sticky":
    case "text":
    case "mind_map_node":
      return boundedLabel(richTextToPlainText(element.content));
    case "shape":
      return boundedLabel(richTextToPlainText(element.content)) ?? shapeCatalogEntry(element.shapeKind).name;
    case "connector":
      return boundedLabel(richTextToPlainText(element.label));
    case "section":
      return boundedLabel(richTextToPlainText(element.title)) ?? "Section";
    case "table":
      return Object.values(element.cells)
        .map((cell) => boundedLabel(richTextToPlainText(cell.content)))
        .find(isNonEmptyString) ?? "Table";
    case "stamp":
      return boundedLabel(element.label) ?? boundedLabel(element.emoji);
    case "media":
      return boundedLabel(element.altText) ?? boundedLabel(element.asset.fileName) ?? "Media";
    case "link_preview":
      return boundedLabel(element.title) ?? boundedLabel(element.url);
    case "code_block":
      return boundedLabel(element.code.split("\n", 1)[0]) ?? "Code block";
    case "drawing":
      return null;
  }
}

function boundedLabel(value: string | undefined): string | null {
  const label = value?.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return label && label.length <= 100 ? label : null;
}

function isNonEmptyString(value: string | null): value is string {
  return Boolean(value);
}
