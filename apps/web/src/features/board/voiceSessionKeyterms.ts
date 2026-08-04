import type { BoardState, Stroke } from "@airboard/core";
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
  selectedStrokeIds: readonly string[] = [],
): string[] {
  const selectedIds = new Set(selectedStrokeIds);
  const committed = Object.values(state.strokes).filter(
    (stroke) => stroke.status === "committed" && stroke.annotation,
  );
  const selectedNodeLabels = committed
    .filter((stroke) => selectedIds.has(stroke.id) && isBoardNode(stroke))
    .map(annotationLabel)
    .filter(isNonEmptyString);
  const nodeLabels = committed
    .filter((stroke) => !selectedIds.has(stroke.id) && isBoardNode(stroke))
    .map(annotationLabel)
    .filter(isNonEmptyString);
  const connectorLabels = committed
    .filter((stroke) => isConnector(stroke))
    .map(annotationLabel)
    .filter(isNonEmptyString);

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
  selectedStrokeIds: readonly string[] = [],
): string {
  return buildSessionKeyterms(state, selectedStrokeIds)
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
  const label = stroke.annotation?.label?.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return label && label.length <= 100 ? label : null;
}

function isNonEmptyString(value: string | null): value is string {
  return Boolean(value);
}
