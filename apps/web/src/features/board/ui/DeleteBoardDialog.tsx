import type { Dispatch, RefObject, SetStateAction } from "react";

export type DeleteBoardDialogProps = {
  deleteDialogRef: RefObject<HTMLElement | null>;
  boardTitle: string;
  deleteError: string | null;
  deleteStatus: "idle" | "deleting" | "error";
  setDeleteDialogOpen: Dispatch<SetStateAction<boolean>>;
  setDeleteStatus: Dispatch<SetStateAction<"idle" | "deleting" | "error">>;
  setDeleteError: Dispatch<SetStateAction<string | null>>;
  confirmDeleteBoard: () => Promise<void>;
};

/** Confirms deleting the board for good. The shell owns its focus trap and open state. */
export function DeleteBoardDialog({
  deleteDialogRef,
  boardTitle,
  deleteError,
  deleteStatus,
  setDeleteDialogOpen,
  setDeleteStatus,
  setDeleteError,
  confirmDeleteBoard,
}: DeleteBoardDialogProps) {
  return (
    <div className="board-lifecycle-backdrop">
      <section
        ref={deleteDialogRef}
        tabIndex={-1}
        className="board-lifecycle-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-canvas-title"
      >
        <span className="eyebrow">Delete</span>
        <h2 id="delete-canvas-title">Delete “{boardTitle}”?</h2>
        <p>
          This permanently deletes the canvas with its versions, images, share links and live-session history.
          It can&apos;t be undone.
        </p>
        {deleteError ? <p className="board-lifecycle-error" role="alert">{deleteError}</p> : null}
        <div className="board-lifecycle-actions">
          <button
            type="button"
            disabled={deleteStatus === "deleting"}
            onClick={() => {
              setDeleteDialogOpen(false);
              setDeleteStatus("idle");
              setDeleteError(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            disabled={deleteStatus === "deleting"}
            onClick={() => void confirmDeleteBoard()}
          >
            {deleteStatus === "deleting" ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </section>
    </div>
  );
}
