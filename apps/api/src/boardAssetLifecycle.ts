import sharp, { type Metadata, type SharpOptions } from "sharp";
import heicConvert from "heic-convert";

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;

/**
 * Bytes of board images and video one organization may keep (threat model
 * A-6). Pending uploads count at their declared size, so concurrent starts
 * cannot reserve past the limit. Exported so it can move to config later.
 */
export const DEFAULT_ORGANIZATION_ASSET_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/** Upload starts one person may make per minute, on each API instance. */
export const UPLOAD_STARTS_PER_MINUTE = 30;

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

export type BoardImageResult = {
  metadata: Record<string, unknown>;
  /**
   * The image re-encoded by sharp: EXIF orientation applied, colour converted
   * to sRGB and no EXIF, GPS, XMP, IPTC or ICC data. These bytes replace the
   * uploaded object, so the type here is what the row must record.
   */
  stored: {
    bytes: Buffer;
    mimeType: string;
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
 * Decodes an uploaded image server-side and re-encodes it with sharp, so the
 * stored copy carries no EXIF, GPS, XMP or IPTC data (threat model A-8): view
 * links serve these bytes to anyone holding them. PNG, JPEG, WebP and GIF keep
 * their format, transparency and animation; TIFF and HEIC become JPEG, which
 * every browser renders. Colour is converted to sRGB and the profile dropped.
 * Sharp/libvips always supports TIFF in our runtime. HEIC decodes natively
 * only where libvips includes a HEVC decoder, otherwise through heic-convert.
 */
export async function inspectAndNormalizeBoardImage(
  input: Buffer,
  mimeType: string,
  dependencies: ImageInspectionDependencies = {},
): Promise<BoardImageResult> {
  if (
    (mimeType === "image/heic" || mimeType === "image/heif") &&
    (dependencies.forceHeicFallback || !nativeHeicDecodeAvailable())
  ) {
    return inspectAndNormalizeHeic(
      input,
      mimeType,
      dependencies.convertHeic ?? convertHeicToJpeg,
    );
  }
  const expectedFormat = expectedSharpFormat(mimeType);
  if (!expectedFormat) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_UNSUPPORTED_IMAGE", 415);
  }
  // Every frame of an animation is decoded, so the pixel limit bounds the
  // whole animation, not just its first frame.
  const decodeOptions: SharpOptions = {
    animated: mimeType === "image/gif" || mimeType === "image/webp",
    failOn: "error",
    limitInputPixels: MAX_IMAGE_PIXELS,
  };

  let metadata: Metadata;
  try {
    metadata = await sharp(input, decodeOptions).metadata();
  } catch (error) {
    throw imageDecodeError(error, mimeType);
  }
  if (metadata.format !== expectedFormat) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_MIME_MISMATCH", 422);
  }

  let pipeline = sharp(input, decodeOptions);
  // libvips cannot rotate multi-page images; GIF has no EXIF orientation and
  // animated WebP with one does not occur in practice, so frames keep theirs.
  if ((metadata.pages ?? 1) <= 1) pipeline = pipeline.autoOrient();
  let storedMimeType = mimeType;
  switch (mimeType) {
    case "image/jpeg":
      pipeline = pipeline.jpeg({
        quality: 90,
        chromaSubsampling: metadata.chromaSubsampling === "4:4:4" ? "4:4:4" : "4:2:0",
      });
      break;
    case "image/png":
      pipeline = pipeline.png({ palette: metadata.isPalette === true });
      break;
    case "image/webp":
      pipeline = pipeline.webp(webpIsLossless(input) ? { lossless: true } : { quality: 90 });
      break;
    case "image/gif":
      pipeline = pipeline.gif();
      break;
    default:
      // TIFF and native HEIC: flatten onto white and hand browsers a JPEG.
      pipeline = pipeline
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 90, mozjpeg: true });
      storedMimeType = "image/jpeg";
  }

  let bytes: Buffer;
  try {
    bytes = await pipeline.toBuffer();
  } catch (error) {
    throw imageDecodeError(error, mimeType);
  }
  assertStoredImageSize(bytes);
  const storedMetadata = await storedImageMetadata(bytes, storedMimeType);
  return {
    metadata: storedMimeType === mimeType
      ? storedMetadata
      : {
        ...storedMetadata,
        sourceFormat: expectedFormat,
        normalizedFrom: mimeType,
        normalizedAt: new Date().toISOString(),
      },
    stored: { bytes, mimeType: storedMimeType },
  };
}

async function inspectAndNormalizeHeic(
  input: Buffer,
  mimeType: "image/heic" | "image/heif",
  converter: typeof convertHeicToJpeg,
): Promise<BoardImageResult> {
  if (!hasHeicBrand(input)) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_MIME_MISMATCH", 422);
  }
  // heic-convert decodes the whole image before any sharp limit applies, so
  // read the declared size from the container first.
  const dimensions = heifImageDimensions(input);
  if (!dimensions) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_INVALID_IMAGE", 422);
  }
  if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_TOO_LARGE", 413);
  }
  let converted: Buffer;
  try {
    converted = Buffer.from(await converter(input));
  } catch {
    throw new BoardAssetLifecycleError("BOARD_ASSET_INVALID_IMAGE", 422);
  }
  if (converted.byteLength <= 0 || converted.byteLength > MAX_IMAGE_BYTES) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_TOO_LARGE", 413);
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(converted, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
  } catch (error) {
    throw imageDecodeError(error, "image/jpeg");
  }
  if (metadata.format !== "jpeg") {
    throw new BoardAssetLifecycleError("BOARD_ASSET_INVALID_IMAGE", 422);
  }
  // The decoder already applied the container's rotation; re-encoding through
  // sharp guarantees the stored copy carries no metadata whatever it emitted.
  let bytes: Buffer;
  try {
    bytes = await sharp(converted, { failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS })
      .autoOrient()
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (error) {
    throw imageDecodeError(error, "image/jpeg");
  }
  assertStoredImageSize(bytes);
  return {
    metadata: {
      ...(await storedImageMetadata(bytes, "image/jpeg")),
      sourceFormat: "heif",
      normalizedFrom: mimeType,
      normalizedAt: new Date().toISOString(),
    },
    stored: { bytes, mimeType: "image/jpeg" },
  };
}

/**
 * Width and height declared by a HEIF/HEIC container's `ispe` properties
 * (meta > iprp > ipco > ispe), read without decoding anything. Returns the
 * largest image item (a grid's canvas is larger than its tiles), or null
 * when the container declares no usable size.
 */
export function heifImageDimensions(input: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let largest: { width: number; height: number } | null = null;
  for (const meta of isoBoxes(view, 0, input.byteLength, "meta")) {
    // meta is a FullBox: four bytes of version and flags precede its children.
    for (const iprp of isoBoxes(view, meta.start + 4, meta.end, "iprp")) {
      for (const ipco of isoBoxes(view, iprp.start, iprp.end, "ipco")) {
        for (const ispe of isoBoxes(view, ipco.start, ipco.end, "ispe")) {
          if (ispe.end - ispe.start < 12) return null;
          const width = view.getUint32(ispe.start + 4);
          const height = view.getUint32(ispe.start + 8);
          if (width === 0 || height === 0) return null;
          if (!largest || width * height > largest.width * largest.height) {
            largest = { width, height };
          }
        }
      }
    }
  }
  return largest;
}

/** The child boxes of one ISO-BMFF box (or the file) with the given type. */
function isoBoxes(
  view: DataView,
  start: number,
  end: number,
  type: string,
): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    if (boxType(view, offset + 4) === type) {
      found.push({ start: offset + header, end: offset + size });
    }
    offset += size;
  }
  return found;
}

function boxType(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Whether a WebP's first frame is VP8L (lossless). Screenshots saved as
 * lossless WebP stay lossless instead of gaining JPEG-style artefacts.
 */
function webpIsLossless(input: Uint8Array): boolean {
  if (ascii(input, 0, 4) !== "RIFF" || ascii(input, 8, 12) !== "WEBP") return false;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  return webpBitstream(view, 12, input.byteLength, true) === "lossless";
}

function webpBitstream(
  view: DataView,
  start: number,
  end: number,
  descend: boolean,
): "lossless" | "lossy" | null {
  let offset = start;
  while (offset + 8 <= end) {
    const type = boxType(view, offset);
    const size = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (type === "VP8L") return "lossless";
    if (type === "VP8 ") return "lossy";
    if (type === "ANMF" && descend) {
      // An animation frame: a 16-byte header, then the frame's own chunks.
      const frame = webpBitstream(view, payload + 16, Math.min(end, payload + size), false);
      if (frame) return frame;
    }
    offset = payload + size + (size % 2);
  }
  return null;
}

function assertStoredImageSize(bytes: Buffer): void {
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new BoardAssetLifecycleError("BOARD_ASSET_TOO_LARGE", 413);
  }
}

/** Describes the re-encoded copy: what is stored, not what was uploaded. */
async function storedImageMetadata(bytes: Buffer, mimeType: string): Promise<Record<string, unknown>> {
  const metadata = await sharp(bytes, {
    animated: mimeType === "image/gif" || mimeType === "image/webp",
    limitInputPixels: false,
  }).metadata();
  return {
    format: metadata.format ?? null,
    width: metadata.width ?? null,
    height: metadata.pageHeight ?? metadata.height ?? null,
    pages: metadata.pages ?? 1,
    hasAlpha: metadata.hasAlpha ?? false,
    metadataStripped: true,
  };
}

function imageDecodeError(error: unknown, mimeType: string): BoardAssetLifecycleError {
  if (error instanceof BoardAssetLifecycleError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/pixel limit/i.test(message)) {
    return new BoardAssetLifecycleError("BOARD_ASSET_TOO_LARGE", 413);
  }
  return new BoardAssetLifecycleError(
    requiresNormalization(mimeType)
      ? "BOARD_ASSET_NORMALIZATION_UNAVAILABLE"
      : "BOARD_ASSET_INVALID_IMAGE",
    422,
  );
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

function ascii(input: Uint8Array, start: number, end: number): string {
  if (input.byteLength < end) return "";
  return String.fromCharCode(...input.slice(start, end));
}
