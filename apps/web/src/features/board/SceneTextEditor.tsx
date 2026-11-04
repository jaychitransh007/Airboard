"use client";

import { useEffect, useRef, useState } from "react";

export type SceneTextEditorBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Edits an element's text in place on the canvas: it opens focused over the
 * element after it is placed, double-clicked, or opened with Enter/F2, and saves
 * once when editing ends so the edit is a single undo step. Enter or clicking
 * away saves, Shift+Enter adds a line, and Escape leaves keeping what was typed.
 */
export function SceneTextEditor({
  initialText,
  label,
  bounds,
  align,
  onCommit,
  onClose,
}: {
  initialText: string;
  label: string;
  bounds: SceneTextEditorBounds;
  align: "left" | "center";
  onCommit: (text: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initialText);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const text = draft.replace(/\s+$/, "");
    if (text !== initialText) onCommit(text);
    onClose();
  };

  return (
    <textarea
      ref={inputRef}
      className="scene-text-editor"
      aria-label={label}
      data-testid="scene-text-editor"
      style={{ ...bounds, textAlign: align }}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
          event.preventDefault();
          finish();
        }
      }}
      onBlur={finish}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}
