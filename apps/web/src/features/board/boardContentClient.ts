import type { AssetReference, LinkPreviewElement } from "@airboard/core";
import { AIRBOARD_API_URL } from "../../platform/config.ts";
import { airboardApi } from "../../platform/api.ts";

export const BOARD_MEDIA_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

export const MAX_BOARD_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_BOARD_IMAGE_BYTES = 32 * 1024 * 1024;

type PendingAsset = {
  id: string;
  kind: "image" | "video";
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  status: "pending" | "ready";
  contentUrl: string;
};

type LinkPreviewResponse = {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  interactive: boolean;
  embedUrl: string | null;
};

/**
 * Upload a board asset without proxying its bytes through the Airboard API.
 * The API authorizes the board and issues a single-use private-storage URL;
 * only the finalized metadata is suitable for a committed board event.
 */
export async function uploadBoardAsset(input: {
  boardId: string;
  accessToken: string;
  file: File;
  signal?: AbortSignal;
}): Promise<AssetReference & { mediaKind: "image" | "gif" | "video" }> {
  const mimeType = boardMediaMimeType(input.file);
  assertSupportedBoardMedia(mimeType, input.file.size);
  const prepared = await airboardApi<{
    asset: PendingAsset;
    upload: { url: string; token: string };
  }>(`/boards/${encodeURIComponent(input.boardId)}/assets/uploads`, {
    method: "POST",
    accessToken: input.accessToken,
    ...(input.signal ? { signal: input.signal } : {}),
    body: JSON.stringify({
      fileName: input.file.name,
      mimeType,
      sizeBytes: input.file.size,
    }),
  });

  const uploadResponse = await fetch(prepared.upload.url, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "x-upsert": "false",
    },
    body: input.file,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!uploadResponse.ok) {
    // The pending row is harmless and can be cleaned by the server, but make a
    // best-effort deletion so failed uploads disappear immediately.
    await deleteBoardAsset({
      boardId: input.boardId,
      assetId: prepared.asset.id,
      accessToken: input.accessToken,
    }).catch(() => undefined);
    throw new Error("BOARD_ASSET_UPLOAD_FAILED");
  }

  const finalized = await airboardApi<{ asset: PendingAsset }>(
    `/boards/${encodeURIComponent(input.boardId)}/assets/${encodeURIComponent(prepared.asset.id)}/finalize`,
    {
      method: "POST",
      accessToken: input.accessToken,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
  return assetReference(input.boardId, finalized.asset);
}

/** Some browsers leave File.type blank for HEIC, TIFF, and MOV selections. */
export function boardMediaMimeType(file: Pick<File, "name" | "type">): string {
  const declared = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if ((BOARD_MEDIA_ACCEPT as readonly string[]).includes(declared)) return declared;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  const byExtension: Record<string, (typeof BOARD_MEDIA_ACCEPT)[number]> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    heic: "image/heic",
    heif: "image/heif",
    tif: "image/tiff",
    tiff: "image/tiff",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
  };
  return byExtension[extension] ?? declared;
}

export async function deleteBoardAsset(input: {
  boardId: string;
  assetId: string;
  accessToken: string;
}): Promise<void> {
  await airboardApi(
    `/boards/${encodeURIComponent(input.boardId)}/assets/${encodeURIComponent(input.assetId)}`,
    { method: "DELETE", accessToken: input.accessToken },
  );
}

/** Fetch private media as a blob URL for an img/video element. */
export async function loadBoardAssetObjectUrl(input: {
  asset: Pick<AssetReference, "url">;
  accessToken: string;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await fetch(new URL(input.asset.url, AIRBOARD_API_URL), {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) throw new Error("BOARD_ASSET_DOWNLOAD_FAILED");
  return URL.createObjectURL(await response.blob());
}

export async function resolveBoardLink(input: {
  url: string;
  accessToken: string;
  signal?: AbortSignal;
}): Promise<LinkPreviewResponse> {
  const response = await airboardApi<{ preview: LinkPreviewResponse }>("/link-previews", {
    method: "POST",
    accessToken: input.accessToken,
    ...(input.signal ? { signal: input.signal } : {}),
    body: JSON.stringify({ url: input.url }),
  });
  return response.preview;
}

export function linkPreviewFields(
  preview: LinkPreviewResponse,
): Pick<
  LinkPreviewElement,
  "url" | "display" | "layout" | "title" | "description" | "siteName" | "imageUrl" | "embedUrl"
> {
  return {
    url: preview.url,
    display: "card",
    layout: "horizontal",
    title: preview.title,
    ...(preview.description ? { description: preview.description } : {}),
    ...(preview.siteName ? { siteName: preview.siteName } : {}),
    ...(preview.imageUrl ? { imageUrl: preview.imageUrl } : {}),
    ...(preview.interactive && preview.embedUrl ? { embedUrl: preview.embedUrl } : {}),
  };
}

export function assertSupportedBoardMedia(mimeType: string, sizeBytes: number): void {
  const supported = (BOARD_MEDIA_ACCEPT as readonly string[]).includes(mimeType);
  if (!supported || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("INVALID_BOARD_ASSET");
  }
  const isVideo = mimeType.startsWith("video/");
  if (sizeBytes > (isVideo ? MAX_BOARD_VIDEO_BYTES : MAX_BOARD_IMAGE_BYTES)) {
    throw new Error("BOARD_ASSET_TOO_LARGE");
  }
}

function assetReference(
  boardId: string,
  asset: PendingAsset,
): AssetReference & { mediaKind: "image" | "gif" | "video" } {
  return {
    id: asset.id,
    boardId,
    url: asset.contentUrl,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    fileName: asset.fileName,
    mediaKind: asset.kind === "video" ? "video" : asset.mimeType === "image/gif" ? "gif" : "image",
  };
}
