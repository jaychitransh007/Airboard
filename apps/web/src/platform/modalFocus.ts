import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab should move focus inside a dialog: wrap from the last control to
 * the first (or the first to the last with Shift), and pull focus back in when
 * it has escaped. Null leaves the move to the browser.
 */
export function wrappedFocusIndex(count: number, currentIndex: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (currentIndex === -1) return backwards ? count - 1 : 0;
  if (backwards && currentIndex === 0) return count - 1;
  if (!backwards && currentIndex === count - 1) return 0;
  return null;
}

/**
 * Keyboard behaviour for a modal dialog while it is open: focus moves in
 * (unless something inside already has it), Tab stays inside, Escape calls
 * `onEscape` when given (and goes no further, so the canvas doesn't react
 * too), and focus returns to where it was when the dialog closes.
 */
export function useModalFocus(
  dialogRef: RefObject<HTMLElement | null>,
  open: boolean,
  onEscape?: () => void,
): void {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  // Remember what had focus while the dialog is first rendering, before an
  // autoFocus field or the dialog's own effects pull focus inside it.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previous = returnFocusRef.current;
    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
    if (!dialog.contains(document.activeElement)) (focusable()[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && escapeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const current = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
      const next = wrappedFocusIndex(items.length, current, event.shiftKey);
      if (next === null) return;
      event.preventDefault();
      items[next]?.focus();
    };
    // Capture on the document so Tab is kept in even after a click outside
    // the dialog moved focus away from it.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [dialogRef, open]);
}
