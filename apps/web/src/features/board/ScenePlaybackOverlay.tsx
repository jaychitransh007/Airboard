"use client";

import type { AssetReference, BoardSceneElement } from "@airboard/core";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { loadBoardAssetObjectUrl } from "./boardContentClient.ts";
import type { BoardViewport } from "./boardViewport.ts";
import styles from "./ScenePlaybackOverlay.module.css";
import {
  SCENE_EMBED_SANDBOX,
  sceneMediaCropStyle,
  scenePlaybackFrame,
  scenePlaybackTarget,
  type PlaybackSurfaceOffset,
} from "./scenePlaybackOverlayGeometry.ts";

export type SceneAssetObjectUrlLoader = (input: {
  asset: Pick<AssetReference, "url">;
  accessToken: string;
  signal?: AbortSignal;
}) => Promise<string>;

export type ScenePlaybackOverlayProps = {
  selected: BoardSceneElement | null;
  accessToken?: string;
  viewport: BoardViewport;
  /**
   * Offset from the overlay's positioned parent to the canvas drawing surface.
   * Keep this at zero when the component is mounted in a canvas-aligned layer.
   */
  surfaceOffset?: PlaybackSurfaceOffset;
  /** Injectable for focused tests or alternate authenticated asset delivery. */
  assetLoader?: SceneAssetObjectUrlLoader;
};

/**
 * Hosts the single locally activated scene playback surface. Everything else
 * remains on the deterministic canvas renderer, including static media frames
 * and link cards.
 */
export function ScenePlaybackOverlay({
  selected,
  accessToken,
  viewport,
  surfaceOffset,
  assetLoader,
}: ScenePlaybackOverlayProps) {
  const target = scenePlaybackTarget(selected);
  const media = target?.kind === "media" ? target.element : null;
  const loadAsset = assetLoader ?? loadBoardAssetObjectUrl;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [assetStatus, setAssetStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    let disposed = false;
    let loadedObjectUrl: string | null = null;
    const controller = new AbortController();

    setObjectUrl(null);
    if (!media) {
      setAssetStatus("idle");
      return () => controller.abort();
    }
    if (!accessToken) {
      setAssetStatus("error");
      return () => controller.abort();
    }

    setAssetStatus("loading");
    void loadAsset({
      asset: media.asset,
      accessToken,
      signal: controller.signal,
    }).then(
      (url) => {
        loadedObjectUrl = url;
        if (disposed) {
          revokeObjectUrl(url);
          return;
        }
        setObjectUrl(url);
        setAssetStatus("idle");
      },
      (error: unknown) => {
        if (disposed || isAbortError(error)) return;
        setAssetStatus("error");
      },
    );

    return () => {
      disposed = true;
      controller.abort();
      if (loadedObjectUrl) revokeObjectUrl(loadedObjectUrl);
    };
  }, [accessToken, loadAsset, media?.asset.id, media?.asset.url, media?.id]);

  const frame = useMemo(
    () => target ? scenePlaybackFrame(target.element, viewport, surfaceOffset) : null,
    [surfaceOffset, target, viewport],
  );

  if (!target || !frame) return null;

  const frameStyle: CSSProperties = {
    left: frame.left,
    top: frame.top,
    width: frame.width,
    height: frame.height,
    transform: `rotate(${frame.rotation}deg)`,
  };

  if (target.kind === "embed") {
    return (
      <div className={styles.overlay} style={frameStyle} data-scene-playback="embed">
        <iframe
          className={styles.embed}
          src={target.embedUrl}
          title={target.element.title || target.element.siteName || "Embedded link preview"}
          sandbox={SCENE_EMBED_SANDBOX}
          referrerPolicy="no-referrer"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        />
      </div>
    );
  }

  const cropStyle: CSSProperties = sceneMediaCropStyle(target.element);
  return (
    <div className={styles.overlay} style={frameStyle} data-scene-playback={target.element.mediaKind}>
      {objectUrl && target.element.mediaKind === "video" ? (
        <video
          key={objectUrl}
          className={styles.media}
          style={cropStyle}
          src={objectUrl}
          aria-label={target.element.altText || target.element.asset.fileName || "Board video"}
          controls
          autoPlay
          playsInline
          preload="metadata"
        />
      ) : objectUrl ? (
        <img
          className={styles.media}
          style={cropStyle}
          src={objectUrl}
          alt={target.element.altText}
          draggable={false}
        />
      ) : (
        <span className={styles.status} role={assetStatus === "error" ? "alert" : "status"}>
          {assetStatus === "error" ? "Media unavailable" : "Loading media…"}
        </span>
      )}
    </div>
  );
}

function revokeObjectUrl(url: string): void {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
