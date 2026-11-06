export const DESKTOP_OVERLAY_QUERY_KEY = "desktopOverlay";

export const OVERLAY_IPC = Object.freeze({
  getState: "airboard-overlay:get-state",
  setClickThrough: "airboard-overlay:set-click-through",
  hide: "airboard-overlay:hide",
  stateChanged: "airboard-overlay:state-changed",
});

export const OVERLAY_SHORTCUTS = Object.freeze({
  toggleInteraction: "CommandOrControl+Shift+O",
  toggleVisibility: "CommandOrControl+Shift+H",
});

export const DEVELOPMENT_WEB_URL = "http://127.0.0.1:3000";

/**
 * The Airboard web address the overlay loads: AIRBOARD_DESKTOP_URL when set,
 * otherwise the address an installed build was packaged with, otherwise the
 * local development server.
 */
export function resolveDesktopWebUrl({ env = {}, isPackaged, packagedWebUrl }) {
  const configured = env.AIRBOARD_DESKTOP_URL?.trim();
  if (configured) {
    return configured;
  }
  if (isPackaged) {
    if (!packagedWebUrl) {
      throw new Error("This build was packaged without an Airboard web address.");
    }
    return packagedWebUrl;
  }
  return DEVELOPMENT_WEB_URL;
}

export function buildOverlayUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AIRBOARD_DESKTOP_URL must use http or https.");
  }
  url.searchParams.set(DESKTOP_OVERLAY_QUERY_KEY, "1");
  return url.toString();
}

export function createOverlayWindowOptions(display, preloadPath) {
  const { x, y, width, height } = display.bounds;
  return {
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    autoHideMenuBar: true,
    title: "Airboard Desktop Overlay",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  };
}

export function applyOverlayWindowCapabilities(window, {
  clickThrough,
  platform = process.platform,
} = {}) {
  const topmostLevel = platform === "darwin" ? "screen-saver" : "pop-up-menu";
  window.setAlwaysOnTop(true, topmostLevel);
  if (platform === "darwin" || platform === "linux") {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: platform === "darwin",
      skipTransformProcessType: platform === "darwin",
    });
  }
  window.setIgnoreMouseEvents(Boolean(clickThrough), {
    forward: Boolean(clickThrough),
  });
  window.setFocusable(!clickThrough);
}

export function moveOverlayToDisplay(window, display) {
  window.setBounds(display.bounds, false);
}
