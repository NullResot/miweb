"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed imported previews never receive a native bridge.
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld(
    "miwebDesktop",
    Object.freeze({
      platform: process.platform,
      selectProject: () => ipcRenderer.invoke("miweb:select-project"),
    }),
  );
}
