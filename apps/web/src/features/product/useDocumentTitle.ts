import { useEffect } from "react";

/**
 * Names the browser tab after something only known once it loads, such as a
 * board's title. The route's own metadata title stands until then.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title) document.title = `${title} · Airboard`;
  }, [title]);
}
