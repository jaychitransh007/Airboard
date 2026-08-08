import assert from "node:assert/strict";
import test from "node:test";
import {
  SCENE_EMBED_SANDBOX,
  safeEmbedUrl,
  sceneMediaCropStyle,
  scenePlaybackFrame,
  scenePlaybackTarget,
} from "../src/features/board/scenePlaybackOverlayGeometry.ts";

const base = {
  id: "element-1",
  boardId: "board-1",
  status: "active",
  transform: { x: 20, y: 30, width: 160, height: 90, rotation: 15 },
  zIndex: 2,
  locked: false,
  visible: true,
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
  revision: 1,
};

function media(overrides = {}) {
  return {
    ...base,
    kind: "media",
    mediaKind: "video",
    asset: {
      id: "asset-1",
      boardId: "board-1",
      url: "/boards/board-1/assets/asset-1/content",
      mimeType: "video/mp4",
      sizeBytes: 100,
    },
    altText: "Demo",
    crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.25, zoom: 1.5 },
    playing: true,
    ...overrides,
  };
}

test("only explicitly active video/GIF media receives playback", () => {
  assert.equal(scenePlaybackTarget(media())?.kind, "media");
  assert.equal(scenePlaybackTarget(media({ mediaKind: "gif" }))?.kind, "media");
  assert.equal(scenePlaybackTarget(media({ mediaKind: "image" })), null);
  assert.equal(scenePlaybackTarget(media({ playing: false })), null);
  assert.equal(scenePlaybackTarget(media({ visible: false })), null);
});

test("embed playback requires embed display and a safe HTTP(S) URL", () => {
  const link = {
    ...base,
    kind: "link_preview",
    url: "https://www.youtube.com/watch?v=1",
    display: "embed",
    layout: "horizontal",
    embedUrl: "https://www.youtube-nocookie.com/embed/1",
  };
  assert.equal(scenePlaybackTarget(link)?.kind, "embed");
  assert.equal(scenePlaybackTarget({ ...link, display: "card" }), null);
  assert.equal(scenePlaybackTarget({ ...link, embedUrl: "javascript:alert(1)" }), null);
  assert.equal(scenePlaybackTarget({ ...link, embedUrl: "https://example.com/embed" }), null);
  assert.equal(safeEmbedUrl("https://user:password@example.com/embed"), null);
  assert.equal(SCENE_EMBED_SANDBOX.includes("allow-same-origin"), false);
});

test("playback bounds use the same board viewport and rotation as canvas rendering", () => {
  assert.deepEqual(
    scenePlaybackFrame(media(), { x: -10, y: 5, scale: 2 }, { x: 10, y: 10 }),
    { left: 40, top: 75, width: 320, height: 180, rotation: 15 },
  );
});

test("media crop percentages mirror the deterministic canvas crop math", () => {
  assert.deepEqual(sceneMediaCropStyle(media()), {
    left: "-30%",
    top: "-120%",
    width: "300%",
    height: "600%",
  });
});
