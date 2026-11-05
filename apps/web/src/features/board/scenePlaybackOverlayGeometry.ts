import type {
  BoardSceneElement,
  LinkPreviewElement,
  MediaElement,
} from "@airboard/core";
import type { BoardViewport } from "./boardViewport.ts";

const INTERACTIVE_EMBED_HOSTS = new Set([
  "airtable.com",
  "coda.io",
  "codepen.io",
  "figma.com",
  "framer.com",
  "loom.com",
  "miro.com",
  "mural.co",
  "music.apple.com",
  "pitch.com",
  "spotify.com",
  "tidal.com",
  "vimeo.com",
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

export const SCENE_EMBED_SANDBOX =
  "allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts";

export type PlaybackSurfaceOffset = {
  x: number;
  y: number;
};

export type ScenePlaybackTarget =
  | { kind: "media"; element: MediaElement }
  | { kind: "embed"; element: LinkPreviewElement; embedUrl: string };

export type ScenePlaybackFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
};

/**
 * Returns the one scene element that is eligible for live DOM playback.
 * Static images and link cards remain canvas-rendered; only an explicitly
 * playing video/GIF or an explicitly activated embed receives a DOM surface.
 */
export function scenePlaybackTarget(
  selected: BoardSceneElement | null,
): ScenePlaybackTarget | null {
  if (!selected || selected.status !== "active" || !selected.visible) return null;
  if (
    selected.kind === "media" &&
    selected.playing &&
    (selected.mediaKind === "video" || selected.mediaKind === "gif")
  ) {
    return { kind: "media", element: selected };
  }
  if (selected.kind === "link_preview" && selected.display === "embed") {
    const embedUrl = safeEmbedUrl(selected.embedUrl);
    if (embedUrl) return { kind: "embed", element: selected, embedUrl };
  }
  return null;
}

/** Convert board-space transform bounds into the canvas-aligned DOM plane. */
export function scenePlaybackFrame(
  element: BoardSceneElement,
  viewport: BoardViewport,
  surfaceOffset: PlaybackSurfaceOffset = { x: 0, y: 0 },
): ScenePlaybackFrame {
  return {
    left: surfaceOffset.x + viewport.x + element.transform.x * viewport.scale,
    top: surfaceOffset.y + viewport.y + element.transform.y * viewport.scale,
    width: Math.max(1, element.transform.width * viewport.scale),
    height: Math.max(1, element.transform.height * viewport.scale),
    rotation: element.transform.rotation,
  };
}

/**
 * Mirrors the deterministic canvas crop math as percentage-based DOM bounds.
 * The returned box is intended for an absolutely positioned img/video inside
 * an overflow-hidden element frame.
 */
export function sceneMediaCropStyle(element: MediaElement): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  const zoom = Math.max(0.1, element.crop.zoom);
  const cropWidth = Math.max(0.01, element.crop.width);
  const cropHeight = Math.max(0.01, element.crop.height);
  const width = (100 * zoom) / cropWidth;
  const height = (100 * zoom) / cropHeight;
  return {
    left: `${-element.crop.x * width}%`,
    top: `${-element.crop.y * height}%`,
    width: `${width}%`,
    height: `${height}%`,
  };
}

/** Only server-allowlisted HTTP(S) embed URLs should reach the iframe. */
export function safeEmbedUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    const isAllowed = [...INTERACTIVE_EMBED_HOSTS].some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
    if (!isAllowed) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
