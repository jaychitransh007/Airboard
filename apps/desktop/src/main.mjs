import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from "electron";
import {
  applyOverlayWindowCapabilities,
  buildOverlayUrl,
  createOverlayWindowOptions,
  moveOverlayToDisplay,
  OVERLAY_IPC,
  OVERLAY_SHORTCUTS,
} from "./overlayWindow.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopDirectory = path.resolve(moduleDirectory, "..");
const repositoryRoot = path.resolve(desktopDirectory, "../..");
const defaultWebUrl = "http://127.0.0.1:3000";
const webUrl = buildOverlayUrl(process.env.AIRBOARD_DESKTOP_URL ?? defaultWebUrl);
const webOrigin = new URL(webUrl).origin;
const smokeTest = process.argv.includes("--smoke-test");
const preloadPath = path.join(moduleDirectory, "preload.cjs");
const trayIconPath = path.join(
  repositoryRoot,
  "apps/web/public/marketplace/airboard-icon-32.png",
);

let overlayWindow = null;
let tray = null;
let quitting = false;
let targetDisplayId = null;
let clickThrough = true;
let shortcutAvailability = {
  toggleInteraction: false,
  toggleVisibility: false,
};

function currentDisplay() {
  const displays = screen.getAllDisplays();
  return (
    displays.find((display) => String(display.id) === String(targetDisplayId)) ??
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) ??
    screen.getPrimaryDisplay()
  );
}

function stateSnapshot() {
  return {
    clickThrough,
    visible: overlayWindow?.isVisible() ?? false,
    displayId: targetDisplayId,
    shortcuts: {
      toggleInteraction: shortcutAvailability.toggleInteraction
        ? OVERLAY_SHORTCUTS.toggleInteraction
        : null,
      toggleVisibility: shortcutAvailability.toggleVisibility
        ? OVERLAY_SHORTCUTS.toggleVisibility
        : null,
    },
  };
}

function publishState() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(OVERLAY_IPC.stateChanged, stateSnapshot());
  }
  refreshTrayMenu();
}

function setClickThrough(nextClickThrough) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return stateSnapshot();
  }
  clickThrough = Boolean(nextClickThrough);
  applyOverlayWindowCapabilities(overlayWindow, { clickThrough });
  if (clickThrough) {
    overlayWindow.blur();
  } else {
    overlayWindow.show();
    overlayWindow.focus();
  }
  publishState();
  return stateSnapshot();
}

function setOverlayVisible(visible) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return stateSnapshot();
  }
  if (visible) {
    overlayWindow.showInactive();
    if (!clickThrough) {
      overlayWindow.focus();
    }
  } else {
    overlayWindow.hide();
  }
  publishState();
  return stateSnapshot();
}

function selectDisplay(display) {
  targetDisplayId = display.id;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    moveOverlayToDisplay(overlayWindow, display);
  }
  publishState();
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }
  const displays = screen.getAllDisplays();
  const menu = Menu.buildFromTemplate([
    {
      label: "Click-through mode",
      type: "checkbox",
      checked: clickThrough,
      click: () => setClickThrough(!clickThrough),
    },
    {
      label: "Show overlay",
      type: "checkbox",
      checked: overlayWindow?.isVisible() ?? false,
      click: (item) => setOverlayVisible(item.checked),
    },
    {
      label: "Display",
      submenu: displays.map((display, index) => ({
        label: `Display ${index + 1} (${display.bounds.width}×${display.bounds.height})`,
        type: "radio",
        checked: String(display.id) === String(targetDisplayId),
        click: () => selectDisplay(display),
      })),
    },
    { type: "separator" },
    {
      label: `Toggle controls — ${OVERLAY_SHORTCUTS.toggleInteraction}`,
      enabled: shortcutAvailability.toggleInteraction,
      click: () => setClickThrough(!clickThrough),
    },
    {
      label: `Show/hide — ${OVERLAY_SHORTCUTS.toggleVisibility}`,
      enabled: shortcutAvailability.toggleVisibility,
      click: () => setOverlayVisible(!(overlayWindow?.isVisible() ?? false)),
    },
    { type: "separator" },
    {
      label: "Reload Airboard",
      click: () => overlayWindow?.webContents.reloadIgnoringCache(),
    },
    {
      label: "Quit Airboard",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(clickThrough ? "Airboard — click-through" : "Airboard — pointer control on");
}

function createTray() {
  let icon = nativeImage.createFromPath(trayIconPath);
  if (process.platform === "darwin") {
    icon = icon.resize({ width: 18, height: 18 });
    icon.setTemplateImage(true);
  }
  tray = new Tray(icon);
  refreshTrayMenu();
}

function registerShortcuts() {
  shortcutAvailability = {
    toggleInteraction: globalShortcut.register(
      OVERLAY_SHORTCUTS.toggleInteraction,
      () => setClickThrough(!clickThrough),
    ),
    toggleVisibility: globalShortcut.register(
      OVERLAY_SHORTCUTS.toggleVisibility,
      () => setOverlayVisible(!(overlayWindow?.isVisible() ?? false)),
    ),
  };
}

async function createOverlayWindow() {
  const display = currentDisplay();
  targetDisplayId = display.id;
  overlayWindow = new BrowserWindow(createOverlayWindowOptions(display, preloadPath));
  applyOverlayWindowCapabilities(overlayWindow, { clickThrough: true });

  overlayWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  overlayWindow.webContents.on("will-navigate", (event, destination) => {
    if (new URL(destination).origin !== webOrigin) {
      event.preventDefault();
    }
  });
  overlayWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      setOverlayVisible(false);
    }
  });
  overlayWindow.on("show", publishState);
  overlayWindow.on("hide", publishState);
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  await overlayWindow.loadURL(webUrl);
  overlayWindow.showInactive();
  publishState();
  if (smokeTest) {
    console.log(
      `AIRBOARD_DESKTOP_SMOKE ${JSON.stringify({
        loadedUrl: overlayWindow.webContents.getURL(),
        transparent: true,
        alwaysOnTop: overlayWindow.isAlwaysOnTop(),
        visibleOnAllWorkspaces:
          process.platform === "win32" ? null : overlayWindow.isVisibleOnAllWorkspaces(),
        clickThrough,
        focusable: overlayWindow.isFocusable(),
        bounds: overlayWindow.getBounds(),
        displayBounds: display.bounds,
      })}`,
    );
    setTimeout(() => app.quit(), 250);
  }
}

function installIpcHandlers() {
  ipcMain.handle(OVERLAY_IPC.getState, () => stateSnapshot());
  ipcMain.handle(OVERLAY_IPC.setClickThrough, (_event, next) =>
    setClickThrough(Boolean(next)),
  );
  ipcMain.handle(OVERLAY_IPC.hide, () => setOverlayVisible(false));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    setOverlayVisible(true);
  });

  app.whenReady().then(async () => {
    app.setName("Airboard");
    if (process.platform === "darwin") {
      app.dock?.hide();
    }
    installIpcHandlers();
    registerShortcuts();
    createTray();
    await createOverlayWindow();

    const syncDisplayBounds = () => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        moveOverlayToDisplay(overlayWindow, currentDisplay());
      }
      refreshTrayMenu();
    };
    screen.on("display-added", syncDisplayBounds);
    screen.on("display-removed", syncDisplayBounds);
    screen.on("display-metrics-changed", syncDisplayBounds);
  });

  app.on("activate", () => setOverlayVisible(true));
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}
