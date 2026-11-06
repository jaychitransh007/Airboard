import { useEffect, useRef, type RefObject } from "react";

const MENU_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * Which menu item a navigation key moves to: arrows step and wrap, Home and
 * End jump to the ends. Null for any other key or an empty menu.
 */
export function menuFocusIndex(count: number, currentIndex: number, key: string): number | null {
  if (count === 0 || !MENU_KEYS.has(key)) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const forward = key === "ArrowDown" || key === "ArrowRight";
  if (currentIndex < 0) return forward ? 0 : count - 1;
  return (currentIndex + (forward ? 1 : -1) + count) % count;
}

/** The enabled, visible items of a menu, in order. */
export function menuItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
    (item) => !(item as HTMLButtonElement).disabled && item.getClientRects().length > 0,
  );
}

/**
 * Keyboard behaviour for a menu opened by a button: focus moves to the first
 * item when it opens, arrow keys and Home/End move between items, Escape
 * closes it and returns focus to the button, and Tab closes it so focus moves
 * on as usual. Choosing an item that closes the menu also returns focus to the
 * button, unless the item moved focus on itself (into a dialog, say).
 */
export function useMenuKeyboard(menuRef: RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  // The opening button still has focus while the menu first renders.
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    menuItems(menu)[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        closeRef.current();
        return;
      }
      const items = menuItems(menu);
      const current = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
      const next = menuFocusIndex(items.length, current, event.key);
      if (next === null) return;
      event.preventDefault();
      items[next]?.focus();
    };
    // The chosen item leaves with the menu, which would drop focus on the page.
    const onChoose = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[role="menuitem"]')) return;
      window.requestAnimationFrame(() => {
        const trigger = triggerRef.current;
        const focusLost = !document.activeElement || document.activeElement === document.body;
        if (focusLost && trigger?.isConnected) trigger.focus();
      });
    };
    menu.addEventListener("keydown", onKeyDown);
    menu.addEventListener("click", onChoose);
    return () => {
      menu.removeEventListener("keydown", onKeyDown);
      menu.removeEventListener("click", onChoose);
    };
  }, [menuRef, open]);
}
