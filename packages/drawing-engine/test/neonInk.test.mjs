import assert from "node:assert/strict";
import test from "node:test";

import { adaptInkForDarkBoard } from "../src/neonInk.ts";

test("dark neutral inks become the bright neutral core", () => {
  for (const dark of ["#111827", "#000", "#1f2937", "rgb(17, 24, 39)"]) {
    assert.equal(adaptInkForDarkBoard(dark), "#f1f5f9", dark);
  }
});

test("dark neutral inks with alpha keep their alpha", () => {
  assert.equal(adaptInkForDarkBoard("rgba(17, 24, 39, 0.55)"), "rgba(241, 245, 249, 0.55)");
});

test("dark saturated inks keep their hue but lift to neon lightness", () => {
  // #0f766e is the teal selection color: hue ~175.
  const adapted = adaptInkForDarkBoard("#0f766e");
  const match = adapted.match(/^hsl\((\d+), (\d+)%, (\d+)%\)$/);
  assert.ok(match, adapted);
  const hue = Number(match[1]);
  assert.ok(hue > 165 && hue < 185, `hue preserved: ${hue}`);
  assert.equal(Number(match[3]), 66, "lifted to neon lightness");
});

test("already-light inks pass through untouched", () => {
  for (const light of ["#ffffff", "#fde68a", "#f8fafc", "rgba(239, 68, 68, 0.55)"]) {
    assert.equal(adaptInkForDarkBoard(light), light, light);
  }
});

test("unparseable or non-colors pass through untouched", () => {
  for (const odd of ["transparent", "", "url(#gradient)", "#12", "notacolor"]) {
    assert.equal(adaptInkForDarkBoard(odd), odd, JSON.stringify(odd));
  }
});
