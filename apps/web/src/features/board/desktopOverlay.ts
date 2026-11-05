export type DesktopOverlayState = {
  clickThrough: boolean;
  visible: boolean;
  displayId: string | number | null;
  shortcuts: {
    toggleInteraction: string | null;
    toggleVisibility: string | null;
  };
};

export type DesktopOverlayBridge = {
  initialState: DesktopOverlayState;
  getState(): Promise<DesktopOverlayState>;
  setClickThrough(clickThrough: boolean): Promise<DesktopOverlayState>;
  hide(): Promise<DesktopOverlayState>;
  onStateChanged(listener: (state: DesktopOverlayState) => void): () => void;
};

declare global {
  interface Window {
    airboardDesktop?: DesktopOverlayBridge;
  }
}

export const DEFAULT_DESKTOP_OVERLAY_STATE: DesktopOverlayState = {
  clickThrough: true,
  visible: true,
  displayId: null,
  shortcuts: {
    toggleInteraction: "CommandOrControl+Shift+O",
    toggleVisibility: "CommandOrControl+Shift+H",
  },
};
