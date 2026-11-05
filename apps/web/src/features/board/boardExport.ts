/**
 * Board exports beyond PNG: a one-page PDF (for email and printing) and an
 * image on the clipboard (for pasting into chat, docs or slides). Both start
 * from the rendered canvas, like the PNG export.
 */

/** Screen pixels are 1/96 inch; PDF points are 1/72 inch. */
const POINTS_PER_PIXEL = 72 / 96;

/** "airboard-2026-11-05T10-20-30.123Z.pdf", matching the PNG export's naming. */
export function exportFileName(extension: "png" | "pdf", now: Date = new Date()): string {
  return `airboard-${now.toISOString().replaceAll(":", "-")}.${extension}`;
}

/**
 * Wraps a JPEG in a minimal single-page PDF. PDF readers draw JPEG data
 * natively (DCTDecode), so no re-encoding or library is needed. The page takes
 * the board's on-screen size while the image keeps every device pixel, so a
 * high-DPI export prints sharp at a sensible size.
 */
export function pdfFromJpeg(
  jpeg: Uint8Array,
  imageWidthPx: number,
  imageHeightPx: number,
  pageWidthPx: number = imageWidthPx,
  pageHeightPx: number = imageHeightPx,
): Uint8Array<ArrayBuffer> {
  const width = Math.max(1, Math.round(pageWidthPx * POINTS_PER_PIXEL * 100) / 100);
  const height = Math.max(1, Math.round(pageHeightPx * POINTS_PER_PIXEL * 100) / 100);
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: Uint8Array | string, stream?: Uint8Array) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    push(body);
    if (stream) {
      push("\nstream\n");
      push(stream);
      push("\nendstream");
    }
    push("\nendobj\n");
  };

  // The binary comment marks the file as binary for transfer tools.
  push("%PDF-1.4\n%âãÏÓ\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, `<< /Type /XObject /Subtype /Image /Width ${Math.round(imageWidthPx)} /Height ${Math.round(imageHeightPx)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  object(5, `<< /Length ${encoder.encode(content).length} >>`, encoder.encode(content));

  const xrefOffset = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let id = 1; id <= 5; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const pdf = new Uint8Array(length);
  let position = 0;
  for (const part of parts) {
    pdf.set(part, position);
    position += part.length;
  }
  return pdf;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("EXPORT_FAILED"))), type, quality);
  });
}

/**
 * JPEG has no transparency, so the board is drawn over its own background
 * colour (white when the canvas is see-through) before encoding.
 */
async function flattenedJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const context = flat.getContext("2d");
  if (!context) throw new Error("EXPORT_FAILED");
  const background = getComputedStyle(canvas).backgroundColor;
  context.fillStyle = !background || /rgba\(.*,\s*0\)$|transparent/.test(background) ? "#ffffff" : background;
  context.fillRect(0, 0, flat.width, flat.height);
  context.drawImage(canvas, 0, 0);
  return new Uint8Array(await (await canvasBlob(flat, "image/jpeg", 0.92)).arrayBuffer());
}

export async function downloadCanvasPdf(canvas: HTMLCanvasElement): Promise<void> {
  const pdf = pdfFromJpeg(
    await flattenedJpeg(canvas),
    canvas.width,
    canvas.height,
    canvas.clientWidth || canvas.width,
    canvas.clientHeight || canvas.height,
  );
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exportFileName("pdf");
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Puts the board on the clipboard as a PNG; throws if the browser refuses. */
export async function copyCanvasImage(canvas: HTMLCanvasElement): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("CLIPBOARD_UNAVAILABLE");
  // Passing the promise keeps Safari's user-gesture check satisfied.
  await navigator.clipboard.write([new ClipboardItem({ "image/png": canvasBlob(canvas, "image/png") })]);
}
