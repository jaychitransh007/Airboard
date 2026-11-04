import assert from "node:assert/strict";
import test from "node:test";

import { parseBoardSceneIntent } from "../../../packages/core/src/sceneIntent.ts";
import { BOARD_TEMPLATES, boardTemplate } from "../src/features/board/boardTemplates.ts";

const normalize = (value) => value.trim().toLowerCase();

for (const template of BOARD_TEMPLATES) {
  test(`${template.title} template builds from commands that only refer to earlier elements`, () => {
    const labels = new Set();
    for (const command of template.commands) {
      const intent = parseBoardSceneIntent(command);
      assert.ok(intent && intent.type !== "invalid", `"${command}" should parse`);
      if (intent.type === "create") {
        assert.ok(intent.label, `"${command}" should name what it adds`);
        if (intent.placement?.target === "visible_label") {
          assert.ok(labels.has(normalize(intent.placement.label)), `"${command}" places next to a missing element`);
        }
        assert.ok(!labels.has(normalize(intent.label)), `"${command}" repeats a name`);
        labels.add(normalize(intent.label));
      } else {
        assert.equal(intent.type, "connect", `"${command}" should add or connect`);
        assert.ok(labels.has(normalize(intent.from.label)), `"${command}" starts from a missing element`);
        assert.ok(labels.has(normalize(intent.to.label)), `"${command}" ends at a missing element`);
      }
    }
  });
}

test("templates are found by id and unknown ids are ignored", () => {
  assert.equal(boardTemplate("system-architecture")?.title, "System architecture");
  assert.equal(boardTemplate("missing"), null);
  assert.equal(boardTemplate(null), null);
});
