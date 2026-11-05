import sharp, { type Metadata } from "sharp";
import heicConvert from "heic-convert";

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;

export const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/webp",
  "image/gif",
]);

export const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

export type BoardAssetKind = "image" | "video";

export type PendingBoardAsset = {
  id: string;
  kind: BoardAssetKind;
  mime_type: string;
  byte_size: number;
  original_name: string;
  storage_path: string;
  status: "pending" | "ready" | "failed";
  metadata?: Record<string, unknown> | null;
};

export type StoredObjectInfo = {
  size?: number;
  contentType?: string;
  metadata?: Record<string, unknown> | null;
};

export type BrowserImageResult = {
  metadata: Record<string, unknown>;
  normalized: null | {
    bytes: Buffer;
    mimeType: "image/jpeg";
    storagePath: string;
  };
};

type ImageInspectionDependencies = {
  convertHeic?: typeof convertHeicToJpeg;
  forceHeicFallback?: boolean;
};

export class BoardAssetLifecycleError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
    this.name = "BoardAssetLifecycleError";
  }
}

export function assetKind(mimeType: string | null): BoardAssetKind | null {
  if (!mimeType) return null;
  if (IMAGE_MIME_TYPES.has(mimeType)) return "image";
  if (VIDEO_MIME_TYPES.has(mimeType)) return "video";
  return null;
}

export function runtimeCanAcceptImage(mimeType: string): boolean {
  if (mimeType === "image/tiff") return sharp.format.tiff.input.buffer === true;
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    return true;
  }
  return IMAGE_MIME_TYPES.has(mimeType);
}

export function verifyVideoSignature(input: Uint8Array, mimeType: string): void {
  const webm = input.byteLength >= 4 &&
    input[0] === 0x1a && input[1] === 0x45 && input[2] === 0xdf && input[3] === 0xa3;
  if (mimeType === "video/webm" && webm) return;

  const atom = ascii(input, 4, 8);
  const brand = ascii(input, 8, 12).toLowerCase();
  if (atom === "ftyp") {
    if (mimeType === "video/quicktime" && brand === "qt  ") return;
    if (
      mimeType === "video/mp4" &&
      (/^(isom|iso\d|mp4\d|avc1|dash|m4v )$/.test(brand) || brand.startsWith("3g"))
    ) return;
  }
  throw new BoardAssetLifecycleError("BOARD_ASSET_INVALID_VIDEO", 422);
}

/**
 * A signed-upload token does not prove that an object was uploaded. Finalize
 * must compare authoritative storage metadata with the pending database row
 * before making an asset visible to a board.
 */
export function verifyStoredObject(asset: PendingBoardAsset, info: StoredObjectInfo): void {
  const size = Number(info.size ?? info.metadata?.size);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_UPLOAD_INCOMPLETE", 409);
  }
  const maxBytes = asset.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > maxBytes) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_TOO_LARGE", 413);
  }
  if (size !== Number(asset.byte_size)) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_SIZE_MISMATCH", 422);
  }

  const storedMimeType = normalizedMimeType(
    info.contentType ?? stringMetadata(info.metadata, "mimetype") ??
      stringMetadata(info.metadata, "contentType"),
  );
  if (!storedMimeType || storedMimeType !== asset.mime_type) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_MIME_MISMATCH", 422);
  }
  if (assetKind(storedMimeType) !== asset.kind) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_MIME_MISMATCH", 422);
  }
}

/**
 * Decode image headers server-side and normalize formats that browsers do not
 * render consistently. Sharp/libvips always supports TIFF in our runtime. HEIC
 * succeeds only on deployments whose libvips includes a HEVC decoder; a codec
 * failure is surfaced and the asset is never promoted to ready.
 */
export async function inspectAndNormalizeBoardImage(
  input: Buffer,
  mimeType: string,
  storagePath: string,
  dependencies: ImageInspectionDependencies = {},
): Promise<BrowserImageResult> {
  if (
    (mimeType === "image/heic" || mimeType === "image/heif") &&
    (dependencies.forceHeicFallback || !nativeHeicDecodeAvailable())
  ) {
    return inspectAndNormalizeHeic(
      input,
      mimeType,
      storagePath,
      dependencies.convertHeic ?? convertHeicToJpeg,
    );
  }
  const expectedFormat = expectedSharpFormat(mimeType);
  if (!expectedFormat) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_UNSUPPORTED_IMAGE", 415);
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      animated: mimeType === "image/gif",
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
  } catch {
    throw new BoardAssetLifecycleError(
      requiresNormalization(mimeType)
        ? "BOARD_ASSET_NORMALIZATION_UNAVAILABLE"
        : "BOARD_ASSET_INVALID_IMAGE",
      422,
    );
  }

  if (metadata.format !== expectedFormat) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_MIME_MISMATCH", 422);
  }
  const safeMetadata = imageMetadata(metadata);
  if (!requiresNormalization(mimeType)) {
    return { metadata: safeMetadata, normalized: null };
  }

  try {
    const bytes = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new BoardAssetLifecycleError("BOARD_ASSET_TOO_LARGE", 413);
    }
    return {
      metadata: {
        ...safeMetadata,
        normalizedFrom: mimeType,
        normalizedAt: new Date().toISOString(),
      },
      normalized: {
        bytes,
        mimeType: "image/jpeg",
        storagePath: browserSafeStoragePath(storagePath),
      },
    };
  } catch (error) {
    if (error instanceof BoardAssetLifecycleError) throw error;
    throw new BoardAssetLifecycleError("BOARD_ASSET_NORMALIZATION_UNAVAILABLE", 422);
  }
}

async function inspectAndNormalizeHeic(
  input: Buffer,
  mimeType: "image/heic" | "image/heif",
  storagePath: string,
  converter: typeof convertHeicToJpeg,
): Promise<BrowserImageResult> {
  if (!hasHeicBrand(input)) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_MIME_MISMATCH", 422);
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await converter(input));
  } catch {
    throw new BoardAssetLifecycleError("BOARD_ASSET_INVALID_IMAGE", 422);
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_TOO_LARGE", 413);
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
  } catch {
    throw new BoardAssetLifecycleError("BOARD_ASSET_INVALID_IMAGE", 422);
  }
  if (metadata.format !== "jpeg") {
    throw new BoardAssetLifecycleError("BOARD_ASSET_INVALID_IMAGE", 422);
  }
  return {
    metadata: {
      ...imageMetadata(metadata),
      sourceFormat: "heif",
      normalizedFrom: mimeType,
      normalizedAt: new Date().toISOString(),
    },
    normalized: {
      bytes,
      mimeType: "image/jpeg",
      storagePath: browserSafeStoragePath(storagePath),
    },
  };
}

async function convertHeicToJpeg(input: Buffer): Promise<Buffer> {
  return Buffer.from(await heicConvert({
    buffer: input,
    format: "JPEG",
    quality: 0.9,
  }));
}

function nativeHeicDecodeAvailable(): boolean {
  const suffixes = sharp.format.heif.input.fileSuffix ?? [];
  return sharp.format.heif.input.buffer === true &&
    suffixes.some((suffix) => suffix === ".heic" || suffix === ".heif");
}

function hasHeicBrand(input: Uint8Array): boolean {
  if (input.byteLength < 12 || ascii(input, 4, 8) !== "ftyp") return false;
  const accepted = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
  for (let offset = 8; offset + 4 <= Math.min(input.byteLength, 64); offset += 4) {
    if (accepted.has(ascii(input, offset, offset + 4).toLowerCase())) return true;
  }
  return false;
}

export function browserSafeStoragePath(storagePath: string): string {
  const slash = storagePath.lastIndexOf("/");
  const directory = slash >= 0 ? storagePath.slice(0, slash + 1) : "";
  return `${directory}browser-safe.jpg`;
}

export function staleAssetCutoff(now = Date.now(), maximumAgeMs = 24 * 60 * 60 * 1_000): string {
  return new Date(now - maximumAgeMs).toISOString();
}

function expectedSharpFormat(mimeType: string): string | null {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpeg";
    case "image/heic":
    case "image/heif": return "heif";
    case "image/tiff": return "tiff";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return null;
  }
}

function requiresNormalization(mimeType: string): boolean {
  return mimeType === "image/heic" || mimeType === "image/heif" || mimeType === "image/tiff";
}

function normalizedMimeType(value: string | null | undefined): string | null {
  if (!value) return null;
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mimeType || null;
}

function stringMetadata(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

function imageMetadata(metadata: Metadata): Record<string, unknown> {
  return {
    format: metadata.format ?? null,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    pages: metadata.pages ?? 1,
    orientation: metadata.orientation ?? null,
    hasAlpha: metadata.hasAlpha ?? false,
  };
}

function ascii(input: Uint8Array, start: number, end: number): string {
  if (input.byteLength < end) return "";
  return String.fromCharCode(...input.slice(start, end));
}
