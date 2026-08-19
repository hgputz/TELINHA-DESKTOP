# Telinha Desktop

Shell Electron fino sobre o site (`telinha.app`) que vive no tray do Windows. O servidor, as salas e o LiveKit são exatamente os do site — o app é só mais um cliente da mesma sala, e espectadores continuam entrando pelo navegador normalmente.

O que ele acrescenta ao navegador:

1. **Áudio do sistema por loopback (WASAPI).** Toda captura de tela sai com o som da máquina inteira, estéreo — sem Voicemeeter/VB-Cable e sem depender do dispositivo de saída padrão. Vale até compartilhando **janela**, coisa que navegador nenhum faz.
2. **Seletor de fonte próprio** (`desktopCapturer`), em português, no lugar do diálogo do Chrome.
3. **Vida no tray:** fechar a janela só esconde (a transmissão continua, com `backgroundThrottling` desligado); sair de verdade é pelo menu do tray, que também tem "Iniciar com o Windows".

## Rodar

```
npm install
npm start              # carrega https://telinha.app
npm run start:local    # carrega http://localhost:3000 (next dev do site)
```

`--url=<...>` ou a env `TELINHA_URL` trocam a URL. `--hidden` inicia direto no tray (é o que o autostart usa). F12 abre DevTools, Ctrl+R recarrega.

## Como a captura funciona

O site chama `getDisplayMedia` normalmente; o Electron intercepta via `setDisplayMediaRequestHandler`:

- abre o picker do shell (ou usa a fonte pré-marcada pela bridge, ver abaixo);
- responde com a fonte escolhida e `audio: "loopback"` quando o site pediu áudio (`audioRequested`) — quando o host escolheu uma entrada de áudio no painel, o site captura com `audio: false` e o loopback fica de fora, como deve;
- cancelar o picker rejeita o `getDisplayMedia`, que o site já trata como seletor fechado.

**Zero mudança no site é necessária para tudo isso funcionar.**

## Bridge para integração futura no site

O preload expõe `window.telinhaDesktop` (ausente no navegador — é o detector de "estou no app"):

```ts
telinhaDesktop.apiVersion        // 1
telinhaDesktop.platform          // "win32" | ...
telinhaDesktop.getSources()      // Promise<{ id, name, kind: "screen"|"window", thumbnail, appIcon }[]>
telinhaDesktop.setNextCapture({ sourceId })  // a próxima getDisplayMedia usa essa fonte sem abrir picker (expira em 15 s)
```

Com isso o `HostSidebar` pode listar as fontes com thumbnail dentro do próprio painel e dispensar o picker do shell. Enquanto o site souber que está no app, também pode esconder o seletor de entrada de áudio (o loopback torna o roteamento desnecessário) e os avisos de `screen-audio` (aqui o áudio sempre vem).

## Pendências para distribuir

- **Ícone:** `assets/icon.ico` é o favicon do site (32 px) — serve para tray/janela, mas o `electron-builder` exige 256 px no instalador. Regerar a partir de `public/logo.png` (512 px) do repo do site.
- **Assinatura de código:** sem certificado o SmartScreen avisa "app não reconhecido" na primeira execução. Cert OV ~US$ 200–400/ano.
- **Auto-update:** `electron-updater` com feed estático (cabe na Hostinger). Só o shell precisa de release — a UI do produto é o site, deploy do site atualiza todo mundo.
- `npm run dist` gera o instalador NSIS em `dist/`.
