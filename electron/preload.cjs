const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  setExpanded: (expanded) => ipcRenderer.send("window:set-expanded", expanded),
  close: () => ipcRenderer.send("window:close"),
  onShortcut: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:toggle", listener);
    return () => ipcRenderer.removeListener("shortcut:toggle", listener);
  },
  onSessionShortcut: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:session-picker", listener);
    return () => ipcRenderer.removeListener("shortcut:session-picker", listener);
  },
  orb: {
    action: (action) => ipcRenderer.send("orb:action", action),
    dragStart: () => ipcRenderer.send("orb:drag-start"),
    move: (delta) => ipcRenderer.send("orb:move", delta),
    dragEnd: () => ipcRenderer.send("orb:drag-end"),
    updateState: (state) => ipcRenderer.send("orb:state", state),
    onAction: (callback) => {
      const listener = (_event, action) => callback(action);
      ipcRenderer.on("orb:action", listener);
      return () => ipcRenderer.removeListener("orb:action", listener);
    },
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("orb:state", listener);
      return () => ipcRenderer.removeListener("orb:state", listener);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch) => ipcRenderer.invoke("settings:set", patch),
    reset: () => ipcRenderer.invoke("settings:reset"),
  },
  diagnostics: {
    check: () => ipcRenderer.invoke("diagnostics:check"),
    openSettings: (area) => ipcRenderer.invoke("shell:open-settings", area),
  },
  models: {
    list: () => ipcRenderer.invoke("models:list"),
    download: (id) => ipcRenderer.invoke("models:download", id),
    select: (type, id) => ipcRenderer.invoke("models:select", { type, id }),
  },
  cdp: {
    discover: (port) => ipcRenderer.invoke("cdp:discover", port),
    launchChatGPT: (port) => ipcRenderer.invoke("cdp:launch-chatgpt", port),
    connect: (port) => ipcRenderer.invoke("cdp:connect", port),
    disconnect: () => ipcRenderer.invoke("cdp:disconnect"),
    write: (text, append) => ipcRenderer.invoke("cdp:write", { text, append }),
    send: () => ipcRenderer.invoke("cdp:send"),
    sessions: () => ipcRenderer.invoke("cdp:sessions"),
    switchSession: (id, href) => ipcRenderer.invoke("cdp:sessions-switch", { id, href }),
    newSession: () => ipcRenderer.invoke("cdp:sessions-new"),
    snapshot: () => ipcRenderer.invoke("cdp:snapshot"),
    onEvent: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("cdp:event", listener);
      return () => ipcRenderer.removeListener("cdp:event", listener);
    },
  },
  speech: {
    start: (options) => ipcRenderer.invoke("speech:start", options),
    push: (samples) => ipcRenderer.invoke("speech:push", samples),
    command: (command) => ipcRenderer.invoke("speech:command", command),
    clearSpeaker: () => ipcRenderer.invoke("speech:clear-speaker"),
    stop: () => ipcRenderer.invoke("speech:stop"),
    onEvent: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("speech:event", listener);
      return () => ipcRenderer.removeListener("speech:event", listener);
    },
  },
});
