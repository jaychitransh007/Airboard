import assert from "node:assert/strict";
import test from "node:test";

import { exportFileName, pdfFromJpeg } from "../src/features/board/boardExport.ts";

const latin1 = (bytes) => Buffer.from(bytes).toString("latin1");

test("a board PDF is one page the size of the image, with offsets a reader can follow", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = latin1(pdfFromJpeg(jpeg, 1280, 720));
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  // 1280×720 screen pixels is 960×540 points.
  assert.match(pdf, /\/MediaBox \[0 0 960 540\]/);
  assert.match(pdf, /\/Width 1280 \/Height 720 .*\/Filter \/DCTDecode \/Length 9/);
  assert.match(pdf, /q 960 0 0 540 0 0 cm \/Im0 Do Q/);
  // Every cross-reference entry points at its object, and startxref at the table.
  const xrefAt = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(xrefAt, xrefAt + 4), "xref");
  const entries = pdf.slice(xrefAt).split("\n").slice(3, 8);
  entries.forEach((entry, index) => {
    const offset = Number(entry.slice(0, 10));
    assert.equal(pdf.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`);
  });
  // The JPEG bytes are embedded unchanged.
  assert.ok(pdf.includes(latin1(jpeg)));
});

test("a high-DPI board keeps every pixel but gets a page its on-screen size", () => {
  const pdf = latin1(pdfFromJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 2560, 1440, 1280, 720));
  assert.match(pdf, /\/MediaBox \[0 0 960 540\]/);
  assert.match(pdf, /\/Width 2560 \/Height 1440 /);
});

test("exports are named like the existing PNG export", () => {
  const now = new Date("2026-11-05T10:20:30.123Z");
  assert.equal(exportFileName("pdf", now), "airboard-2026-11-05T10-20-30.123Z.pdf");
  assert.equal(exportFileName("png", now), "airboard-2026-11-05T10-20-30.123Z.png");
});
