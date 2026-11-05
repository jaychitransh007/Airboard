import { previewViewBox, type LibraryBoard } from "./boardLibrary";

/** A miniature of the board's shapes and arrows, or its initial when it is empty. */
export function BoardThumbnail({ board }: { board: Pick<LibraryBoard, "title" | "preview"> }) {
  const preview = board.preview;
  if (!preview?.bounds || preview.shapes.length + preview.lines.length === 0) {
    return (
      <div className="board-thumbnail">
        <span>{board.title[0]?.toUpperCase()}</span>
      </div>
    );
  }
  return (
    <div className="board-thumbnail">
      <svg className="board-preview" viewBox={previewViewBox(preview.bounds)} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {preview.lines.map((line, index) => (
          <line key={`l${index}`} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} vectorEffect="non-scaling-stroke" />
        ))}
        {preview.shapes.map((shape, index) =>
          shape.round ? (
            <ellipse
              key={`s${index}`}
              cx={shape.x + shape.width / 2}
              cy={shape.y + shape.height / 2}
              rx={shape.width / 2}
              ry={shape.height / 2}
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <rect
              key={`s${index}`}
              className={shape.kind === "sticky" ? "sticky" : undefined}
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              rx={Math.min(shape.width, shape.height) * 0.12}
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}
      </svg>
    </div>
  );
}
