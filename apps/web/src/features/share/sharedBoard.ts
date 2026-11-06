import { BOARD_SCENE_VERSION, boardPreview, type BoardState } from "@airboard/core";
import { AIRBOARD_API_URL } from "../../platform/config.ts";

/** A board opened through a view-only link: content only, no members or cursors. */
export type SharedBoard = {
  title: string;
  updatedAt: string | null;
  expiresAt: string | null;
  state: BoardState;
};

export type Bounds = { x: number; y: number; width: number; height: number };

/** The board behind a view-only link, or null when the link no longer works. */
export async function fetchSharedBoard(token: string, fetcher: typeof fetch = fetch): Promise<SharedBoard | null> {
  const response = await fetcher(`${AIRBOARD_API_URL}/shared-boards/${encodeURIComponent(token)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`SHARED_BOARD_${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return {
    title: typeof body.title === "string" && body.title.trim() ? body.title : "Untitled board",
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
    expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
    state: sharedBoardState(body.state),
  };
}

export function sharedBoardState(value: unknown): BoardState {
  const candidate = isRecord(value) ? (value as Partial<BoardState>) : {};
  return {
    boardId: "shared",
    sceneVersion: BOARD_SCENE_VERSION,
    elements: isRecord(candidate.elements) ? (candidate.elements as BoardState["elements"]) : {},
    strokes: isRecord(candidate.strokes) ? (candidate.strokes as BoardState["strokes"]) : {},
    activeStrokes: {},
    eraseActions: isRecord(candidate.eraseActions) ? (candidate.eraseActions as BoardState["eraseActions"]) : {},
    participants: {},
    cursors: {},
    lastSequence: 0,
    ...(typeof candidate.clearedAt === "string" ? { clearedAt: candidate.clearedAt } : {}),
  };
}

/** Everything drawn on the board, so "fit" frames all of it. */
export function sharedBoardBounds(state: BoardState): Bounds | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const element of Object.values(state.elements)) {
    if (element.status !== "active") continue;
    const { x, y, width, height } = element.transform;
    if (![x, y, width, height].every(Number.isFinite)) continue;
    xs.push(x, x + width);
    ys.push(y, y + height);
  }
  for (const stroke of Object.values(state.strokes)) {
    if (stroke.status === "deleted") continue;
    for (const point of stroke.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  if (!xs.length) return null;
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

export type ImageSource = { url: string; aliases: string[] };

/**
 * The pictures a shared board draws, each loaded through the link instead of
 * the members-only asset route, with every key the renderer may look it up by.
 */
export function sharedImageSources(state: BoardState, token: string): ImageSource[] {
  return boardImageSources(state, (assetId) =>
    `${AIRBOARD_API_URL}/shared-boards/${encodeURIComponent(token)}/assets/${assetId}/content`);
}

/** The pictures a board draws, each fetched from `contentUrl(assetId)`. */
export function boardImageSources(state: BoardState, contentUrl: (assetId: string) => string): ImageSource[] {
  const sources = new Map<string, string[]>();
  const add = (sourceUrl: string | undefined, aliases: Array<string | undefined>) => {
    const assetId = sourceUrl ? /\/assets\/([0-9a-f-]{36})\/content/i.exec(sourceUrl)?.[1] : undefined;
    if (!assetId) return;
    sources.set(contentUrl(assetId), aliases.filter((alias): alias is string => Boolean(alias)));
  };
  for (const element of Object.values(state.elements)) {
    if (element.status !== "active") continue;
    if (element.kind === "media") {
      const { asset } = element;
      add(element.mediaKind === "video" ? asset.posterUrl : asset.thumbnailUrl ?? asset.url, [
        asset.id, asset.url, asset.thumbnailUrl, asset.posterUrl,
      ]);
    } else if (element.kind === "stamp" && element.faceAsset) {
      const face = element.faceAsset;
      add(face.thumbnailUrl ?? face.url, [face.id, face.url, face.thumbnailUrl]);
    } else if (element.kind === "drawing" && element.style.patternAsset) {
      const pattern = element.style.patternAsset;
      add(pattern.url, [pattern.id, pattern.url]);
    }
  }
  return [...sources].map(([url, aliases]) => ({ url, aliases }));
}

/** The words on the board, for people who cannot see the canvas. */
export function sharedBoardText(state: BoardState): string[] {
  return boardPreview(state).text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
