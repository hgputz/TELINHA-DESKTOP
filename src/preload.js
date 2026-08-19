// Ponte estreita entre o site e o shell. O site detecta o app por
// window.telinhaDesktop e, quando existir integração, usa getSources +
// setNextCapture para trocar o picker do shell pelo seletor do próprio painel.
// Nada além disso atravessa: o shell não lê nem escreve estado do site.

const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("telinhaDesktop", {
  apiVersion: 1,
  platform: process.platform,

  // Lista telas e janelas: [{ id, name, kind: "screen"|"window", thumbnail, appIcon }]
  // (thumbnail/appIcon são data URLs, prontos para <img src>).
  getSources: () => ipcRenderer.invoke("desktop:get-sources"),

  // Marca a fonte da PRÓXIMA chamada de getDisplayMedia (expira em 15 s).
  // Com isso o site pode chamar getDisplayMedia normalmente e o shell responde
  // sem abrir picker nenhum. Passar null desfaz.
  setNextCapture: (selection) => ipcRenderer.invoke("desktop:set-next-capture", selection),
})
