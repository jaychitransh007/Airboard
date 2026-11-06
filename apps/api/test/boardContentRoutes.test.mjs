import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  BoardAssetLifecycleError,
  DEFAULT_ORGANIZATION_ASSET_QUOTA_BYTES,
  MAX_IMAGE_PIXELS,
  UPLOAD_STARTS_PER_MINUTE,
  heifImageDimensions,
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
  const result = await inspectAndNormalizeBoardImage(source, "image/tiff");
  assert.equal(result.metadata.format, "jpeg");
  assert.equal(result.metadata.sourceFormat, "tiff");
  assert.equal(result.metadata.normalizedFrom, "image/tiff");
  assert.equal(result.metadata.width, 8);
  assert.equal(result.stored.mimeType, "image/jpeg");
  assert.equal((await sharp(result.stored.bytes).metadata()).format, "jpeg");
});

/** An ISO-BMFF box; `full` prepends the version and flags of a FullBox. */
function box(type, ...payloads) {
  const body = Buffer.concat(payloads);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

function fullBox(type, ...payloads) {
  return box(type, Buffer.alloc(4), ...payloads);
}

/** A HEIC container declaring image items of the given sizes, with no pixels. */
function heicContainer(...sizes) {
  const ispe = ([width, height]) => {
    const body = Buffer.alloc(8);
    body.writeUInt32BE(width);
    body.writeUInt32BE(height, 4);
    return fullBox("ispe", body);
  };
  return Buffer.concat([
    box("ftyp", Buffer.from("heic"), Buffer.alloc(4), Buffer.from("mif1heic")),
    fullBox(
      "meta",
      fullBox("hdlr", Buffer.alloc(4), Buffer.from("pict"), Buffer.alloc(13)),
      box("iprp", box("ipco", ...sizes.map(ispe))),
    ),
    box("mdat", Buffer.alloc(16)),
  ]);
}

/** A JPEG that says where it was taken and needs a 90 degree turn to display. */
async function photoWithLocation(width = 40, height = 20) {
  const plain = await sharp({
    create: { width, height, channels: 3, background: "#d04020" },
  }).jpeg().toBuffer();
  return sharp(plain)
    .withExif({
      IFD0: { Make: "LeakyCam", Model: "GPS-1" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "51/1 30/1 1234/100",
        GPSLongitudeRef: "W",
        GPSLongitude: "0/1 7/1 3912/100",
        GPSMapDatum: "WGS-84",
      },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

function assertNoLocation(bytes) {
  for (const marker of ["WGS-84", "LeakyCam", "Exif", "http://ns.adobe.com/xap", "Photoshop 3.0"]) {
    assert.equal(bytes.includes(marker), false, `stored bytes still contain ${marker}`);
  }
}

test("HEIC uploads use the portable decoder fallback and normalize to JPEG", async () => {
  // The decoder may emit EXIF of its own; the stored copy still has none.
  const converted = await photoWithLocation(7, 5);
  let decoded = 0;
  const result = await inspectAndNormalizeBoardImage(
    heicContainer([7, 5]),
    "image/heic",
    {
      forceHeicFallback: true,
      convertHeic: async () => {
        decoded += 1;
        return converted;
      },
    },
  );
  assert.equal(decoded, 1);
  assert.equal(result.metadata.sourceFormat, "heif");
  assert.equal(result.metadata.normalizedFrom, "image/heic");
  assert.equal(result.stored.mimeType, "image/jpeg");
  const stored = await sharp(result.stored.bytes).metadata();
  assert.equal(stored.format, "jpeg");
  assert.equal(stored.exif, undefined);
  assertNoLocation(result.stored.bytes);
  assert.equal(runtimeCanAcceptImage("image/heic"), true);
  assert.equal(runtimeCanAcceptImage("image/heif"), true);
});

test("HEIC over the pixel limit is refused from its container before decoding", async () => {
  let decoded = 0;
  const convertHeic = async () => {
    decoded += 1;
    throw new Error("must not decode");
  };
  // 8000 x 6000 = 48 MP; the grid's 512 x 512 tiles alone would pass.
  await assert.rejects(
    inspectAndNormalizeBoardImage(
      heicContainer([512, 512], [8000, 6000], [512, 512]),
      "image/heic",
      { forceHeicFallback: true, convertHeic },
    ),
    (error) => error instanceof BoardAssetLifecycleError &&
      error.code === "BOARD_ASSET_TOO_LARGE" && error.statusCode === 413,
  );
  // A container that declares no size cannot be checked, so it is refused.
  await assert.rejects(
    inspectAndNormalizeBoardImage(heicContainer(), "image/heif", { forceHeicFallback: true, convertHeic }),
    (error) => error instanceof BoardAssetLifecycleError && error.code === "BOARD_ASSET_INVALID_IMAGE",
  );
  assert.equal(decoded, 0);
  assert.ok(8000 * 6000 > MAX_IMAGE_PIXELS);
});

test("HEIF container sizes are read from real encoder output", async () => {
  // AVIF uses the same HEIF container as HEIC; sharp can encode it here.
  const avif = await sharp({
    create: { width: 64, height: 48, channels: 3, background: "#3366aa" },
  }).avif().toBuffer();
  assert.deepEqual(heifImageDimensions(avif), { width: 64, height: 48 });
  assert.deepEqual(heifImageDimensions(heicContainer([10, 10], [300, 200])), { width: 300, height: 200 });
  assert.equal(heifImageDimensions(Buffer.from("not a heif file")), null);
  // A box claiming more bytes than the file has is not followed.
  const truncated = heicContainer([300, 200]).subarray(0, 60);
  assert.equal(heifImageDimensions(truncated), null);
});

test("JPEG photos lose their GPS and camera EXIF but keep their orientation", async () => {
  const source = await photoWithLocation();
  const before = await sharp(source).metadata();
  assert.equal(before.orientation, 6);
  assert.ok(before.exif);
  assert.ok(source.includes("WGS-84"), "fixture must carry GPS EXIF");

  const result = await inspectAndNormalizeBoardImage(source, "image/jpeg");
  assert.equal(result.stored.mimeType, "image/jpeg");
  const stored = await sharp(result.stored.bytes).metadata();
  assert.equal(stored.format, "jpeg");
  assert.equal(stored.exif, undefined);
  assert.equal(stored.xmp, undefined);
  assert.equal(stored.iptc, undefined);
  assert.equal(stored.orientation, undefined);
  // The 90 degree turn is now in the pixels.
  assert.equal(stored.width, 20);
  assert.equal(stored.height, 40);
  assert.equal(result.metadata.width, 20);
  assert.equal(result.metadata.height, 40);
  assert.equal(result.metadata.metadataStripped, true);
  assertNoLocation(result.stored.bytes);
});

test("PNG keeps its transparency and loses EXIF and XMP", async () => {
  const source = await sharp({
    create: { width: 30, height: 20, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.4 } },
  })
    .png()
    .withExif({ IFD0: { Make: "LeakyCam" }, IFD3: { GPSMapDatum: "WGS-84" } })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">where</x:xmpmeta>')
    .toBuffer();
  assert.ok((await sharp(source).metadata()).exif);

  const result = await inspectAndNormalizeBoardImage(source, "image/png");
  assert.equal(result.stored.mimeType, "image/png");
  const stored = await sharp(result.stored.bytes).metadata();
  assert.equal(stored.format, "png");
  assert.equal(stored.hasAlpha, true);
  assert.equal(stored.exif, undefined);
  assert.equal(stored.xmp, undefined);
  const { data } = await sharp(result.stored.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 102);
  assertNoLocation(result.stored.bytes);
});

async function animationFrames() {
  return Promise.all(["#ff0000", "#00ff00", "#0000ff"].map((background) =>
    sharp({ create: { width: 20, height: 10, channels: 4, background } }).png().toBuffer()));
}

test("GIF and WebP animations keep every frame, their timing and their loop count", async () => {
  const frames = await animationFrames();
  const gif = await sharp(frames, { join: { animated: true } })
    .gif({ delay: [100, 200, 300], loop: 3 })
    .toBuffer();
  const gifResult = await inspectAndNormalizeBoardImage(gif, "image/gif");
  const storedGif = await sharp(gifResult.stored.bytes, { animated: true }).metadata();
  assert.equal(gifResult.stored.mimeType, "image/gif");
  assert.equal(storedGif.pages, 3);
  assert.deepEqual(storedGif.delay, [100, 200, 300]);
  assert.equal(storedGif.loop, 3);
  assert.equal(gifResult.metadata.pages, 3);
  assert.equal(gifResult.metadata.height, 10);

  const webp = await sharp(frames, { join: { animated: true } })
    .webp({ delay: [100, 200, 300], loop: 0 })
    .withExif({ IFD0: { Make: "LeakyCam" }, IFD3: { GPSMapDatum: "WGS-84" } })
    .toBuffer();
  assert.ok(webp.includes("EXIF"));
  const webpResult = await inspectAndNormalizeBoardImage(webp, "image/webp");
  const storedWebp = await sharp(webpResult.stored.bytes, { animated: true }).metadata();
  assert.equal(webpResult.stored.mimeType, "image/webp");
  assert.equal(storedWebp.pages, 3);
  assert.deepEqual(storedWebp.delay, [100, 200, 300]);
  assert.equal(storedWebp.exif, undefined);
  assertNoLocation(webpResult.stored.bytes);
  assert.equal(webpResult.stored.bytes.includes("EXIF"), false);
});

test("lossless WebP stays lossless and wide-gamut colour becomes sRGB without a profile", async () => {
  const lossless = await sharp({
    create: { width: 16, height: 16, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } },
  }).webp({ lossless: true }).toBuffer();
  const webp = await inspectAndNormalizeBoardImage(lossless, "image/webp");
  assert.ok(webp.stored.bytes.includes("VP8L"));
  assert.equal((await sharp(webp.stored.bytes).metadata()).hasAlpha, true);

  const displayP3 = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#ff0000" },
  }).withIccProfile("p3").jpeg().toBuffer();
  assert.equal((await sharp(displayP3).metadata()).hasProfile, true);
  const jpeg = await inspectAndNormalizeBoardImage(displayP3, "image/jpeg");
  const stored = await sharp(jpeg.stored.bytes).metadata();
  assert.equal(stored.hasProfile, false);
  assert.equal(stored.icc, undefined);
  assert.equal(stored.space, "srgb");
});

test("image decoders reject payloads whose bytes do not match the declared MIME", async () => {
  const jpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#ffffff" },
  }).jpeg().toBuffer();
  await assert.rejects(
    inspectAndNormalizeBoardImage(jpeg, "image/png"),
    (error) => error instanceof BoardAssetLifecycleError &&
      error.code === "BOARD_ASSET_MIME_MISMATCH",
  );
});

test("asset cleanup cutoffs and upload limits are deterministic", () => {
  assert.equal(staleAssetCutoff(Date.UTC(2026, 7, 7), 60_000), "2026-08-06T23:59:00.000Z");
  assert.equal(runtimeCanAcceptImage("image/tiff"), true);
  assert.equal(DEFAULT_ORGANIZATION_ASSET_QUOTA_BYTES, 2 * 1024 ** 3);
  assert.equal(UPLOAD_STARTS_PER_MINUTE, 30);
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
