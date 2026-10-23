# Vemo na Chrome Web Store

Tudo o que o painel de desenvolvedor da Chrome Web Store pede, pronto para colar.
Pacote: `npm run pack` → `dist/vemo-<versão>.zip`. Imagens: `node scripts/store-assets.js` → `store/*.png`.

## Ficha da loja

**Nome:** Vemo

**Resumo** (até 132 caracteres):
> Assista YouTube e Netflix junto com outra pessoa, cada um na sua casa: pausou aqui, pausa lá.

**Descrição:**
> O Vemo deixa duas ou mais pessoas assistindo o mesmo vídeo ao mesmo tempo, cada uma no próprio computador e na própria conta.
>
> Como funciona:
> 1. Abra um vídeo do YouTube ou da Netflix e clique em "Criar sala nesta aba".
> 2. Mande o código da sala para quem vai assistir com você.
> 3. A outra pessoa digita o código e cai no mesmo vídeo, no mesmo ponto.
>
> A partir daí, play, pausa e pulo de trecho acontecem nos dois lados. Se o vídeo de alguém trava para carregar, ou entra um anúncio no YouTube, o outro espera. Se a pessoa troca de vídeo, a sala vai junto.
>
> O Vemo não transmite nenhum vídeo: cada pessoa assiste pelo próprio serviço, com a própria assinatura. Só passam comandos pequenos, como "pausou em 34:12". Sem cadastro, sem anúncios, sem rastreamento.
>
> Funciona com: YouTube e Netflix (mais serviços em breve).
> Código aberto: https://github.com/kaw7nn/vemo

**Categoria:** Entretenimento
**Idioma:** Português (Brasil)

**Imagens:**
- Ícone: `extension/icons/128.png` (já vai no pacote)
- Capturas de tela (1280×800): `store/screenshot-1.png`, `store/screenshot-2.png`
- Bloco promocional pequeno (440×280): `store/promo-440x280.png`

## Privacidade (aba "Práticas de privacidade")

**Finalidade única:**
> Sincronizar a reprodução (play, pausa e posição) de vídeos do YouTube e da Netflix entre pessoas que estão na mesma sala.

**Justificativa das permissões:**
- `storage`: guardar localmente o nome escolhido pela pessoa e o endereço do servidor de salas.
- Acesso a `youtube.com` e `netflix.com`: detectar o player de vídeo nesses sites, ler se está tocando e em que posição, e aplicar play, pausa e pulo vindos da outra pessoa da sala.

**Código remoto:** Não. Todo o código está no pacote; a extensão só troca mensagens JSON com o servidor de salas.

**Dados coletados** (marcar):
- Informações de identificação pessoal: só o nome opcional que a pessoa escolhe, mostrado às outras pessoas da sala.
- Conteúdo do site: endereço e título do vídeo aberto na aba sincronizada, além de posição e estado de reprodução, enviados às outras pessoas da sala.

**Certificações** (marcar as três):
- Não vendo nem transfiro dados de usuários a terceiros, fora dos casos de uso aprovados.
- Não uso nem transfiro dados de usuários para fins não relacionados à finalidade única do item.
- Não uso nem transfiro dados de usuários para determinar capacidade de crédito ou para fins de empréstimo.

**URL da política de privacidade:** https://vemo.kawannmarcelo7.workers.dev/privacidade

## Conta de desenvolvedor

- Cadastro: https://chrome.google.com/webstore/devconsole. Taxa única de US$ 5.
- E-mail de contato público da ficha: o mesmo da política de privacidade.
