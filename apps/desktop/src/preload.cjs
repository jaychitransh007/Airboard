const { contextBridge, ipcRenderer } = require("electron");

const overlayIpc = Object.freeze({
  getState: "airboard-overlay:get-state",
  setClickThrough: "airboard-overlay:set-click-through",
  hide: "airboard-overlay:hide",
  stateChanged: "airboard-overlay:state-changed",
});

contextBridge.exposeInMainWorld("airboardDesktop", {
  initialState: Object.freeze({
    clickThrough: true,
    visible: true,
    displayId: null,
    shortcuts: Object.freeze({
      toggleInteraction: "CommandOrControl+Shift+O",
      toggleVisibility: "CommandOrControl+Shift+H",
    }),
  }),
  getState: () => ipcRenderer.invoke(overlayIpc.getState),
  setClickThrough: (clickThrough) =>
    ipcRenderer.invoke(overlayIpc.setClickThrough, Boolean(clickThrough)),
  hide: () => ipcRenderer.invoke(overlayIpc.hide),
  onStateChanged: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on(overlayIpc.stateChanged, handler);
    return () => ipcRenderer.removeListener(overlayIpc.stateChanged, handler);
  },
});
