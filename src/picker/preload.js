const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("picker", {
  onSources: (listener) => {
    ipcRenderer.on("picker:sources", (_event, data) => listener(data))
  },
  choose: (id) => ipcRenderer.send("picker:choose", id),
  cancel: () => ipcRenderer.send("picker:choose", null),
})
