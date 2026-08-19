// Telinha Desktop — shell fino sobre o site (telinha.app).
// O que ele acrescenta ao navegador, e a razão de existir:
//   1. Áudio do sistema por loopback (WASAPI): getDisplayMedia aqui captura o som
//      da máquina inteira, sem Voicemeeter/VB-Cable e sem depender do dispositivo
//      de saída padrão — a limitação que lib/media/audio-inputs.ts do site contorna.
//   2. Seletor de fonte próprio (desktopCapturer), em português, no lugar do
//      diálogo do Chrome — e o áudio vem junto mesmo compartilhando janela.
//   3. Vida no tray: fechar a janela esconde; a transmissão continua.
// Toda a lógica de sala/mídia continua no site — o shell não versiona produto.

const electron = require("electron")

// Terminais do VSCode herdam ELECTRON_RUN_AS_NODE=1; com ela o binário sobe
// como Node puro e require("electron") devolve o caminho do executável em vez
// da API. Detecta e relança limpo, para npm start funcionar de qualquer lugar.
if (typeof electron === "string") {
  const { spawnSync } = require("node:child_process")
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(electron, process.argv.slice(1), { env, stdio: "inherit" })
  process.exit(result.status ?? 0)
}

const { app, BrowserWindow, Tray, Menu, desktopCapturer, ipcMain, shell, nativeImage } = electron
const path = require("node:path")
const fs = require("node:fs")

const DEFAULT_URL = "https://telinha.app"

function resolveSiteUrl() {
  const flag = process.argv.find((arg) => arg.startsWith("--url="))
  return (flag ? flag.slice("--url=".length) : process.env.TELINHA_URL) || DEFAULT_URL
}

const appUrl = resolveSiteUrl()
const appOrigin = new URL(appUrl).origin
const startHidden = process.argv.includes("--hidden")
const iconPath = path.join(__dirname, "..", "assets", "icon.ico")

let mainWindow = null
let tray = null
let quitting = false

// Fonte pré-escolhida pelo site via bridge (window.telinhaDesktop.setNextCapture):
// quando o site ganhar seletor próprio, ele marca a fonte aqui e o handler de
// getDisplayMedia usa sem abrir picker. Expira para não vazar para outra captura.
let nextCapture = null

// Só um picker por vez — um segundo pedido de captura cancela o anterior.
let activePicker = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId("app.telinha.desktop")
  app.on("second-instance", showMainWindow)
  app.on("before-quit", () => {
    quitting = true
  })
  // Sem janelas não significa sair: o app mora no tray.
  app.on("window-all-closed", () => {})
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    createMainWindow()
    createTray()
    registerCaptureHandlers()
    registerBridge()
  })
}

function showMainWindow() {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: !startHidden,
    autoHideMenuBar: true,
    backgroundColor: "#09090b",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // Versão chega ao preload por argumento (env do main não propaga para o
      // renderer): é o que deixa o site saber qual build está rodando.
      additionalArguments: [`--telinha-version=${app.getVersion()}`],
      // Escondida no tray, a janela segue codificando: sem isto o Chromium
      // estrangula timers/render e a transmissão degrada.
      backgroundThrottling: false,
    },
  })

  mainWindow.loadURL(appUrl)

  // Sem internet o loadURL falha e a janela ficaria preta para sempre — a
  // versão shell do erro silencioso. Troca por uma tela local com "tentar de
  // novo". errorCode -3 é ABORTED (navegação cancelada), que não é falha.
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    const detail = encodeURIComponent(`${errorDescription} (${errorCode})`)
    mainWindow.loadFile(path.join(__dirname, "offline.html"), { hash: detail })
    mainWindow.show()
  })

  // Fechar esconde para o tray. A aba continua viva, logo a transmissão e a
  // hostKey (sessionStorage) também. Sair de verdade é pelo menu do tray.
  mainWindow.on("close", (event) => {
    if (quitting) return
    event.preventDefault()
    mainWindow.hide()
    announceTray()
  })

  // Links externos (LivePix etc.) abrem no navegador do sistema, nunca aqui.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: "deny" }
  })
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === appOrigin) return
    event.preventDefault()
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })

  // Menu de aplicação foi removido; atalhos essenciais entram à mão.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return
    if (input.key === "F12") {
      mainWindow.webContents.toggleDevTools()
      event.preventDefault()
    } else if (input.key.toLowerCase() === "r" && input.control && !input.alt && !input.meta) {
      mainWindow.webContents.reload()
      event.preventDefault()
    }
  })
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip("Telinha")
  tray.on("click", showMainWindow)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir a Telinha", click: showMainWindow },
      { type: "separator" },
      {
        label: "Iniciar com o Windows",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] })
        },
      },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ])
  )
}

// Fechar a janela e o app sumir sem explicação faz o usuário achar que fechou
// — e ele continua transmitindo. O balão aparece uma vez na vida da instalação.
function announceTray() {
  const flagPath = path.join(app.getPath("userData"), "tray-hint.flag")
  try {
    if (fs.existsSync(flagPath)) return
    fs.writeFileSync(flagPath, "1")
  } catch {
    return // sem poder gravar, melhor calar do que avisar toda vez
  }
  tray.displayBalloon({
    icon: nativeImage.createFromPath(iconPath),
    title: "A Telinha continua aqui",
    content: "A transmissão segue no ar. Clique no ícone ao lado do relógio para voltar.",
  })
}

async function listSources() {
  return desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  })
}

function serializeSource(source) {
  return {
    id: source.id,
    name: source.name,
    kind: source.id.startsWith("screen:") ? "screen" : "window",
    thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
    appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
  }
}

function takeNextCapture() {
  const pending = nextCapture
  nextCapture = null
  if (!pending || Date.now() - pending.at > 15_000) return null
  return pending
}

function registerCaptureHandlers() {
  const ses = mainWindow.webContents.session

  // O site pede câmera (getUserMedia) e captura de tela; nada além disso.
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(["media", "display-capture", "fullscreen", "clipboard-sanitized-write"].includes(permission))
  })

  // Todo getDisplayMedia do site cai aqui. audio "loopback" = WASAPI: o som do
  // sistema inteiro, estéreo, independente do dispositivo de saída padrão — e
  // disponível até compartilhando janela, o que navegador nenhum oferece.
  // audioRequested=false significa que o host escolheu uma entrada de áudio no
  // painel (o site captura com audio: false para as fontes não brigarem).
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await listSources()
      const preset = takeNextCapture()
      let chosenId = preset && sources.some((s) => s.id === preset.sourceId) ? preset.sourceId : null
      if (!chosenId) {
        chosenId = await askPicker(sources.map(serializeSource), request.audioRequested)
      }
      const source = sources.find((s) => s.id === chosenId)
      if (!source) {
        callback(null) // cancelado — o site trata como seletor fechado
        return
      }
      callback({ video: source, audio: request.audioRequested ? "loopback" : undefined })
    } catch {
      callback(null)
    }
  })
}

function askPicker(sources, wantsAudio) {
  if (activePicker) {
    const previous = activePicker
    activePicker = null
    previous.resolve(null)
    previous.window.destroy()
  }
  return new Promise((resolve) => {
    const pickerWindow = new BrowserWindow({
      width: 780,
      height: 600,
      parent: mainWindow,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      backgroundColor: "#09090b",
      title: "Escolher o que compartilhar",
      icon: iconPath,
      webPreferences: {
        preload: path.join(__dirname, "picker", "preload.js"),
      },
    })
    activePicker = { window: pickerWindow, resolve }

    pickerWindow.loadFile(path.join(__dirname, "picker", "picker.html"))
    pickerWindow.webContents.once("did-finish-load", () => {
      pickerWindow.webContents.send("picker:sources", { sources, wantsAudio })
    })
    pickerWindow.on("closed", () => {
      if (activePicker && activePicker.window === pickerWindow) {
        activePicker = null
        resolve(null)
      }
    })
  })
}

ipcMain.on("picker:choose", (event, id) => {
  if (!activePicker || event.sender !== activePicker.window.webContents) return
  const { window: pickerWindow, resolve } = activePicker
  activePicker = null
  resolve(typeof id === "string" ? id : null)
  pickerWindow.destroy()
})

// Bridge para o site (window.telinhaDesktop) — só a janela principal pode usar.
function registerBridge() {
  ipcMain.on("shell:retry", (event) => {
    if (event.sender !== mainWindow.webContents) return
    mainWindow.loadURL(appUrl)
  })
  ipcMain.handle("desktop:get-sources", async (event) => {
    if (event.sender !== mainWindow.webContents) return []
    const sources = await listSources()
    return sources.map(serializeSource)
  })
  ipcMain.handle("desktop:set-next-capture", (event, selection) => {
    if (event.sender !== mainWindow.webContents) return false
    if (!selection || typeof selection.sourceId !== "string") {
      nextCapture = null
      return false
    }
    nextCapture = { sourceId: selection.sourceId, at: Date.now() }
    return true
  })
}
