import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSupportedBoardMedia,
  boardMediaMimeType,
  linkPreviewFields,
  MAX_BOARD_IMAGE_BYTES,
  MAX_BOARD_VIDEO_BYTES,
} from "../src/features/board/boardContentClient.ts";

test("board media validation supports the specified image and video formats", () => {
  for (const mimeType of [
    "image/png", "image/jpeg", "image/heic", "image/heif", "image/tiff", "image/webp", "image/gif",
    "video/mp4", "video/quicktime", "video/webm",
  ]) {
    assert.doesNotThrow(() => assertSupportedBoardMedia(mimeType, 1024));
  }
  assert.throws(() => assertSupportedBoardMedia("image/svg+xml", 1024), /INVALID_BOARD_ASSET/);
});

test("board media infers browser-omitted MIME types from supported file extensions", () => {
  assert.equal(boardMediaMimeType({ name: "camera.HEIC", type: "" }), "image/heic");
  assert.equal(boardMediaMimeType({ name: "scan.tif", type: "application/octet-stream" }), "image/tiff");
  assert.equal(boardMediaMimeType({ name: "clip.mov", type: "" }), "video/quicktime");
  assert.equal(boardMediaMimeType({ name: "photo.jpg", type: "image/jpeg; charset=binary" }), "image/jpeg");
  assert.equal(boardMediaMimeType({ name: "unsafe.svg", type: "" }), "");
});

test("board media validation enforces image and 100 MB video limits", () => {
  assert.doesNotThrow(() => assertSupportedBoardMedia("image/png", MAX_BOARD_IMAGE_BYTES));
  assert.doesNotThrow(() => assertSupportedBoardMedia("video/mp4", MAX_BOARD_VIDEO_BYTES));
  assert.throws(
    () => assertSupportedBoardMedia("image/png", MAX_BOARD_IMAGE_BYTES + 1),
    /BOARD_ASSET_TOO_LARGE/,
  );
  assert.throws(
    () => assertSupportedBoardMedia("video/mp4", MAX_BOARD_VIDEO_BYTES + 1),
    /BOARD_ASSET_TOO_LARGE/,
  );
});

test("link cards activate embeds only when the server allowlists them", () => {
  assert.deepEqual(linkPreviewFields({
    url: "https://example.com/a",
    title: "Example",
    description: "Description",
    imageUrl: null,
    siteName: "Example Inc.",
    interactive: false,
    embedUrl: "https://example.com/a",
  }), {
    url: "https://example.com/a",
    display: "card",
    layout: "horizontal",
    title: "Example",
    description: "Description",
    siteName: "Example Inc.",
  });
});
