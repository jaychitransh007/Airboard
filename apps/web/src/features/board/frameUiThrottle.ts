/**
 * Coalesces per-camera-frame UI state into at most one React commit per
 * interval. Urgent (discrete) changes commit immediately, and the trailing
 * value is always flushed so the UI never settles on a stale frame. Keeping
 * this out of the 30 Hz loop stops the whole board from re-rendering on every
 * detection.
 */
export type FrameUiThrottle<T> = {
  push: (value: T, urgent?: boolean) => void;
  cancel: () => void;
};

export const FRAME_UI_COMMIT_INTERVAL_MS = 125;

export function createFrameUiThrottle<T>(
  commit: (value: T) => void,
  options: { intervalMs?: number; now?: () => number } = {},
): FrameUiThrottle<T> {
  const intervalMs = options.intervalMs ?? FRAME_UI_COMMIT_INTERVAL_MS;
  const now = options.now ?? (() => performance.now());
  let lastCommitAt = Number.NEGATIVE_INFINITY;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    lastCommitAt = now();
    commit(value);
  };

  return {
    push(value, urgent = false) {
      pending = { value };
      const elapsed = now() - lastCommitAt;
      if (urgent || elapsed >= intervalMs) {
        if (timer) clearTimeout(timer);
        flush();
        return;
      }
      timer ??= setTimeout(flush, intervalMs - elapsed);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
