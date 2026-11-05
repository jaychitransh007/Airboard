import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  BoardAssetLifecycleError,
  browserSafeStoragePath,
  inspectAndNormalizeBoardImage,
  runtimeCanAcceptImage,
  staleAssetCutoff,
  verifyStoredObject,
  verifyVideoSignature,
} from "../src/boardAssetLifecycle.ts";
import {
  assertSafePreviewUrl,
  previewFromHtml,
  resolveBoardLinkPreview,
} from "../src/boardLinkPreview.ts";

test("link previews reject local and private-network destinations", async () => {
  await assert.rejects(
    assertSafePreviewUrl(new URL("http://localhost/admin"), async () => ["127.0.0.1"]),
    /UNSAFE_LINK_PREVIEW_URL/,
  );
  await assert.rejects(
    assertSafePreviewUrl(new URL("https://example.test/"), async () => ["10.1.2.3"]),
    /UNSAFE_LINK_PREVIEW_URL/,
  );
  for (const address of [
    "100.64.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "203.0.113.1",
    "::",
    "fe80::1",
    "2001:db8::1",
  ]) {
    await assert.rejects(
      assertSafePreviewUrl(new URL("https://example.test/"), async () => [address]),
      /UNSAFE_LINK_PREVIEW_URL/,
    );
  }
  await assert.rejects(
    assertSafePreviewUrl(new URL("https://example.com:8443/"), async () => ["93.184.216.34"]),
    /UNSAFE_LINK_PREVIEW_URL/,
  );
});

test("preview parsing produces sanitized static metadata and resolves image URLs", () => {
  const preview = previewFromHtml(
    new URL("https://example.com/article"),
    '<html><head><meta property="og:title" content="A &amp; B"><meta name="description" content="Useful article"><meta property="og:image" content="/cover.png"></head></html>',
  );
  assert.deepEqual(preview, {
    url: "https://example.com/article",
    title: "A & B",
    description: "Useful article",
    imageUrl: "https://example.com/cover.png",
    siteName: null,
    interactive: false,
    embedUrl: null,
  });
});

test("preview metadata rejects private image targets and strips control characters", () => {
  const preview = previewFromHtml(
    new URL("https://example.com/article"),
    '<meta property="og:title" content="Safe&#10;title\u202e"><meta property="og:image" content="http://127.0.0.1/private.png">',
  );
  assert.equal(preview.title, "Safe title");
  assert.equal(preview.imageUrl, null);
});

test("allowlisted providers opt into interactive previews", () => {
  const preview = previewFromHtml(
    new URL("https://www.youtube.com/watch?v=abc"),
    "<title>Demo</title>",
  );
  assert.equal(preview.interactive, true);
  assert.equal(preview.embedUrl, preview.url);
});

test("redirect targets are safety-checked before the second fetch", async () => {
  let calls = 0;
  await assert.rejects(
    resolveBoardLinkPreview("https://public.example/start", {
      resolveHost: async (host) => host === "public.example" ? ["93.184.216.34"] : ["127.0.0.1"],
      fetch: async () => {
        calls += 1;
        return new Response(null, { status: 302, headers: { location: "http://localhost/secret" } });
      },
    }),
    /UNSAFE_LINK_PREVIEW_URL/,
  );
  assert.equal(calls, 1);
});

test("preview fetch accepts only exact HTML media types", async () => {
  await assert.rejects(
    resolveBoardLinkPreview("https://public.example/start", {
      resolveHost: async () => ["93.184.216.34"],
      fetch: async () => new Response("<title>bad</title>", {
        status: 200,
        headers: { "content-type": "text/html-malware" },
      }),
    }),
    /LINK_PREVIEW_NOT_HTML/,
  );
});

const pendingImage = {
  id: "26b385ae-62c8-4fdf-b112-7b42f0db37d5",
  kind: "image",
  mime_type: "image/tiff",
  byte_size: 1_024,
  original_name: "scan.tiff",
  storage_path: "org/board/asset/scan.tiff",
  status: "pending",
  metadata: {},
};

test("asset finalize metadata must prove object existence, size and MIME", () => {
  assert.doesNotThrow(() => verifyStoredObject(pendingImage, {
    size: 1_024,
    contentType: "image/tiff; charset=binary",
  }));
  assert.throws(
    () => verifyStoredObject(pendingImage, { contentType: "image/tiff" }),
    (error) => error instanceof BoardAssetLifecycleError &&
      error.code === "BOARD_ASSET_UPLOAD_INCOMPLETE" && error.statusCode === 409,
  );
  assert.throws(
    () => verifyStoredObject(pendingImage, { size: 900, contentType: "image/tiff" }),
    (error) => error instanceof BoardAssetLifecycleError &&
      error.code === "BOARD_ASSET_SIZE_MISMATCH",
  );
  assert.throws(
    () => verifyStoredObject(pendingImage, { size: 1_024, contentType: "image/jpeg" }),
    (error) => error instanceof BoardAssetLifecycleError &&
      error.code === "BOARD_ASSET_MIME_MISMATCH",
  );
});

test("TIFF uploads normalize to a browser-safe JPEG with bounded metadata", async () => {
  const source = await sharp({
    create: {
      width: 8,
      height: 6,
      channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 0.5 },
    },
  }).tiff().toBuffer();
  const result = await inspectAndNormalizeBoardImage(
    source,
    "image/tiff",
    "org/board/asset/scan.tiff",
  );
  assert.equal(result.metadata.format, "tiff");
  assert.equal(result.metadata.normalizedFrom, "image/tiff");
  assert.equal(result.normalized?.mimeType, "image/jpeg");
  assert.equal(result.normalized?.storagePath, "org/board/asset/browser-safe.jpg");
  assert.equal((await sharp(result.normalized?.bytes).metadata()).format, "jpeg");
});

test("HEIC uploads use the portable decoder fallback and normalize to JPEG", async () => {
  const converted = await sharp({
    create: { width: 7, height: 5, channels: 3, background: "#7650df" },
  }).jpeg().toBuffer();
  const source = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypheic"),
    Buffer.alloc(4),
    Buffer.from("heicmif1"),
  ]);
  const result = await inspectAndNormalizeBoardImage(
    source,
    "image/heic",
    "org/board/asset/photo.heic",
    {
      forceHeicFallback: true,
      convertHeic: async () => converted,
    },
  );
  assert.equal(result.metadata.sourceFormat, "heif");
  assert.equal(result.metadata.normalizedFrom, "image/heic");
  assert.equal(result.normalized?.mimeType, "image/jpeg");
  assert.equal(result.normalized?.storagePath, "org/board/asset/browser-safe.jpg");
  assert.equal((await sharp(result.normalized?.bytes).metadata()).format, "jpeg");
  assert.equal(runtimeCanAcceptImage("image/heic"), true);
  assert.equal(runtimeCanAcceptImage("image/heif"), true);
});

test("image decoders reject payloads whose bytes do not match the declared MIME", async () => {
  const jpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#ffffff" },
  }).jpeg().toBuffer();
  await assert.rejects(
    inspectAndNormalizeBoardImage(jpeg, "image/png", "org/board/asset/file.png"),
    (error) => error instanceof BoardAssetLifecycleError &&
      error.code === "BOARD_ASSET_MIME_MISMATCH",
  );
});

test("asset cleanup paths and cutoffs are deterministic", () => {
  assert.equal(
    browserSafeStoragePath("org/board/asset/file.heic"),
    "org/board/asset/browser-safe.jpg",
  );
  assert.equal(staleAssetCutoff(Date.UTC(2026, 7, 7), 60_000), "2026-08-06T23:59:00.000Z");
  assert.equal(runtimeCanAcceptImage("image/tiff"), true);
});

test("video MIME validation uses file signatures instead of upload headers alone", () => {
  assert.doesNotThrow(() => verifyVideoSignature(
    Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
    "video/mp4",
  ));
  assert.doesNotThrow(() => verifyVideoSignature(
    Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]),
    "video/webm",
  ));
  assert.throws(
    () => verifyVideoSignature(new TextEncoder().encode("not a video"), "video/mp4"),
    (error) => error instanceof BoardAssetLifecycleError &&
      error.code === "BOARD_ASSET_INVALID_VIDEO",
  );
});
