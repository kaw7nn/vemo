# Vemo

Extensão de navegador para assistir **YouTube** e **Netflix** em sincronia com outra pessoa, cada uma na sua casa e na sua própria conta. Pausou aqui, pausa lá. Deu play, pulou um trecho, trocou de vídeo: o outro lado acompanha.

Nenhum vídeo passa pela extensão nem pelo servidor. Só trafegam comandos pequenos ("pausou em 12:34"). Por isso funciona com serviços protegidos como a Netflix: cada pessoa precisa ter acesso ao conteúdo na própria conta.

## Como funciona

```
 Navegador A                                                      Navegador B
 aba do vídeo ⇄ background ⇄  servidor de salas (sala ABC123)  ⇄ background ⇄ aba do vídeo
```

- **Módulo do serviço** (`extension/content/adapters/`): sabe achar o player daquele site, ler o estado e mandar play, pausa e pulo.
- **Núcleo de sincronização** (`extension/content/sync-core.js`): decide o que é ação da pessoa (e vira mensagem) e o que é reflexo de um comando remoto (e não volta como eco). Também cuida de:
  - **Travou pra carregar:** se o vídeo de um trava, o outro espera.
  - **Anúncio do YouTube:** quem não está vendo anúncio espera o outro terminar.
  - **Pequenas diferenças:** quem fez a última ação manda um "batimento" a cada 4 s; o outro corrige se ficar mais de 2 s fora.
  - **Autoplay:** logo depois de abrir o vídeo da sala, o autoplay da página não passa por cima da sala. Um clique ou tecla de verdade vale normalmente.
- **Background** (`extension/background.js`): mantém a conexão com o servidor e leva a aba para o mesmo vídeo quando a outra pessoa troca. Só navega para endereços `https` do YouTube e da Netflix.
- **Servidor de salas** (`server/worker.js`): um Worker do Cloudflare com um Durable Object por sala. Repassa mensagens entre as pessoas da sala e guarda o último estado, pra quem entrar depois já cair no ponto certo. As conexões hibernam: sala parada não consome nada. Sala vazia é apagada depois de 30 minutos.

## Rodando

Precisa de Node 20 ou mais novo e de um navegador baseado em Chromium (Chrome, Brave, Edge ou Chromium), versão 116 ou mais nova.

```bash
npm install
npm run server          # servidor local (wrangler dev) em ws://localhost:8787
```

A extensão já vem apontando para o servidor de produção. Para desenvolver contra o local, troque o endereço em **Configurações** no popup.

### Instalar a extensão

1. Abra `chrome://extensions` (ou `brave://extensions`).
2. Ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta `extension/`.

### Usar

1. Nas **Configurações** do popup, cada um põe o seu nome. O servidor já vem configurado.
2. Uma pessoa abre um vídeo e clica em **Criar sala nesta aba**. Aparece um código.
3. A outra digita o código e clica em **Entrar**. A aba dela vai pro mesmo vídeo e no mesmo ponto.

## Produção

O servidor roda no Cloudflare Workers, com Durable Objects (plano gratuito).

```bash
npm run deploy          # publica o Worker (precisa de `npx wrangler login`)
```

Ele também serve a política de privacidade em `/privacidade`.

### Chrome Web Store

```bash
npm run pack                     # dist/vemo-<versão>.zip
node scripts/store-assets.js     # capturas e bloco promocional em store/
```

Textos da ficha, justificativas de permissão e respostas de privacidade: [`store/LISTING.md`](store/LISTING.md).

## Adicionando um serviço novo

1. Crie `extension/content/adapters/<servico>.js` implementando:

   | Função | O que faz |
   |---|---|
   | `matches(location)` | se o módulo vale para a página |
   | `video()` | o elemento `<video>` principal |
   | `mediaKey()` | id único do conteúdo, ex. `netflix:81234567`; `null` fora de um vídeo |
   | `canonicalUrl()` | endereço para a outra pessoa abrir o mesmo conteúdo |
   | `title()` | nome exibido no popup |
   | `isBlocked()` | `true` durante anúncios (o vídeo da sala fica parado) |
   | `getState()` | `{ playing, time }` ou `null` se o player não está pronto |
   | `play()`, `pause()`, `seek(segundos)` | comandos |

2. Inclua o arquivo no `manifest.json` (`content_scripts` e `host_permissions`).
3. Libere o domínio em `ALLOWED_HOSTS` no `background.js`.

Se o site quebrar quando alguém mexe direto no `<video>` (como a Netflix), mande os comandos para um script na página (`world: "MAIN"`). Veja `netflix-page.js`.

## Testes

```bash
npm run check   # sintaxe de todos os arquivos e arquivos citados no manifest
npm test        # servidor e núcleo de sincronização (sem navegador)
npm run e2e     # dois Chromium reais com a extensão, no YouTube de verdade
```

O `test` e o `e2e` sobem o Worker local sozinhos. O `e2e` usa `/usr/bin/chromium` (troque com `CHROME=/caminho`), e com `SERVER=wss://…` roda contra um servidor já no ar. Com `DEBUG=1`, mostra as últimas mensagens de cada lado quando algo falha. Com `HEADFUL=1`, abre as janelas.

## Limitações conhecidas

- **Netflix** não tem teste automático, porque exige login. O módulo usa o player interno da Netflix, que pode mudar sem aviso.
- Só Chromium por enquanto. Firefox precisa de ajustes no manifest.
- Sem chat, voz ou câmera: a ideia é conversar por fora (WhatsApp, Discord etc.).
- Velocidade de reprodução (1,5x etc.) não é sincronizada.
