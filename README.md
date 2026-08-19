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

## Build e release

O instalador **não fecha na máquina do dev** enquanto o Windows 11 estiver com
Smart App Control em enforcement. Para assinar o desinstalador, o
electron-builder monta um instalador temporário e o executa; o SAC recusa
executar binário não assinado, então o build morre com `spawn UNKNOWN` depois
de gerar os 100 MB do pacote — e deixa para trás um `.exe` de 168 KB que parece
um instalador e não é. Desligar o SAC é permanente (só volta reinstalando o
Windows), então o release sai por CI: `.github/workflows/release.yml` builda no
runner do GitHub e sobe como **rascunho** de release ao empurrar uma tag `v*`.

`npm run dist` continua servindo localmente para validar o empacotamento até a
etapa do NSIS.

## Pendências

- **Smart App Control nos usuários.** O mesmo bloqueio vale para quem baixa: em
  Windows 11 recente e sem assinatura, o instalador não roda e não existe
  "executar assim mesmo". A página de download do site já explica isso e manda
  usar o navegador nesse caso.
- **Assinatura de código.** Resolve o SAC e o SmartScreen de uma vez. Cert OV
  gira em US$ 200-400/ano; o Azure Trusted Signing sai bem mais barato, mas
  exige pessoa jurídica com histórico. Ao ter o certificado, remover
  `signExecutable: false` do `package.json` e apontar as credenciais.
- **Teste manual** com dois dispositivos antes de publicar o rascunho.
