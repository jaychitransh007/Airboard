import type { BoardPreview } from "@airboard/core";

export type LibraryBoard = {
  title: string;
  updated_at: string;
  visibility: string;
  preview?: BoardPreview;
};

/** The SVG viewBox that frames a preview with a little breathing room. */
export function previewViewBox(bounds: NonNullable<BoardPreview["bounds"]>): string {
  const size = Math.max(bounds.width, bounds.height, 1);
  const pad = size * 0.08;
  return [bounds.x - pad, bounds.y - pad, Math.max(bounds.width, 1) + pad * 2, Math.max(bounds.height, 1) + pad * 2]
    .map((value) => Math.round(value * 10) / 10)
    .join(" ");
}

/** A search matches a board's title or any words on it. */
export function boardMatchesQuery(board: LibraryBoard, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    board.title.toLowerCase().includes(needle) ||
    (board.preview?.text ?? []).some((words) => words.toLowerCase().includes(needle))
  );
}

/** "Updated 5 minutes ago · Only you": when it changed and who can open it. */
export function boardCardDetail(board: LibraryBoard, now: Date = new Date()): string {
  return `${updatedLabel(board.updated_at, now)} · ${board.visibility === "private" ? "Only you" : "Shared"}`;
}

function updatedLabel(updatedAt: string, now: Date): string {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) return "Updated recently";
  const seconds = Math.round((updated.getTime() - now.getTime()) / 1_000);
  if (seconds > -60) return "Updated just now";
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const minutes = Math.round(seconds / 60);
  if (minutes > -60) return `Updated ${relative.format(minutes, "minute")}`;
  const hours = Math.round(minutes / 60);
  if (hours > -24) return `Updated ${relative.format(hours, "hour")}`;
  const days = Math.round(hours / 24);
  if (days > -7) return `Updated ${relative.format(days, "day")}`;
  return `Updated ${updated.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
